import type { Pool } from "pg";
import type { InvoiceCurrency, InvoiceQtyUnit, ReceiptOutcome, ReceiptStatus } from "../db/types.js";
import {
  driverRawResolved,
  stationSummary,
  truckRawResolved,
  type RawResolvedString,
  type TransactionStationSummary,
} from "./transactions.js";

// ─── Ordering (D17) ───────────────────────────────────────────────────────

/**
 * The only two fields the queue can currently sort on. `has_exception` is
 * always present in the queue SELECT regardless of which spec is active, so
 * switching a caller from `DEFAULT_QUEUE_ORDER` to
 * `EXCEPTIONS_FIRST_QUEUE_ORDER` needs no migration and no query rewrite —
 * only a different spec (D17: Q3/A18 may make this the default once
 * Samsara's API is confirmed to expose receipt uploads).
 */
export type QueueOrderField = "occurred_at" | "has_exception";

export interface QueueOrderStep {
  field: QueueOrderField;
  direction: "asc" | "desc";
}

export type QueueOrderSpec = readonly QueueOrderStep[];

/** Whitelisted field -> column mapping (D1: no caller-supplied text ever
 * reaches SQL, not even a column name). */
const QUEUE_ORDER_COLUMNS: Record<QueueOrderField, string> = {
  occurred_at: "fs.occurred_at",
  has_exception: "has_exception",
};

export const DEFAULT_QUEUE_ORDER: QueueOrderSpec = [{ field: "occurred_at", direction: "asc" }];

export const EXCEPTIONS_FIRST_QUEUE_ORDER: QueueOrderSpec = [
  { field: "has_exception", direction: "desc" },
  { field: "occurred_at", direction: "asc" },
];

/**
 * Pure — builds the `ORDER BY` clause from a spec. Always ends on `fs.id
 * ASC` so two callers on the same spec (and the same spec called twice) see
 * the same order even when every spec'd field ties.
 */
export function buildQueueOrderClause(spec: QueueOrderSpec): string {
  const steps = spec.map((step) => `${QUEUE_ORDER_COLUMNS[step.field]} ${step.direction === "asc" ? "ASC" : "DESC"}`);
  steps.push("fs.id ASC");
  return `ORDER BY ${steps.join(", ")}`;
}

// ─── Queue read ───────────────────────────────────────────────────────────

export interface ReceiptQueueItem {
  id: string;
  occurredAt: string;
  driver: RawResolvedString;
  /** The resolved driver, which is what a batch confirm posts; `null` when the card's driver never resolved. */
  driverId: string | null;
  truck: RawResolvedString;
  station: TransactionStationSummary | null;
  /** The diesel (TA) line's quantity in `qtyUnit`, as BVD printed it; `null` when the stop has no TA line. */
  qty: number | null;
  qtyUnit: InvoiceQtyUnit;
  /** In `currency`, as billed. */
  total: number;
  currency: InvoiceCurrency;
  receiptStatus: ReceiptStatus;
  /** Whether this stop carries an undismissed anomaly — the field
   * `EXCEPTIONS_FIRST_QUEUE_ORDER` sorts on (D17). */
  hasException: boolean;
  /** The open anomalies behind `hasException`, for a hover. `charges_no_fuel` is left out, as
   * Transactions never shows it as a flag. */
  flags: { rule: string; severity: "amber" | "red" }[];
}

export interface ReceiptQueueProgress {
  done: number;
  total: number;
}

export interface ReceiptQueueResult {
  items: ReceiptQueueItem[];
  progress: ReceiptQueueProgress;
}

interface QueueRow {
  id: string;
  occurred_at: Date;
  total: string;
  currency: InvoiceCurrency;
  qty_unit: InvoiceQtyUnit;
  ta_qty: string | null;
  receipt_status: ReceiptStatus;
  driver_id: string | null;
  unit_raw: string;
  driver_name_raw: string;
  truck_unit_number: string | null;
  driver_display_name: string | null;
  station_id: string | null;
  station_name_raw: string | null;
  station_city_raw: string | null;
  station_state_usps: string | null;
  has_exception: boolean;
  flags: { rule: string; severity: "amber" | "red" }[];
}

function toQueueItem(row: QueueRow): ReceiptQueueItem {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    driver: driverRawResolved(row),
    driverId: row.driver_id,
    truck: truckRawResolved(row),
    station: stationSummary(row),
    qty: row.ta_qty === null ? null : Number(row.ta_qty),
    qtyUnit: row.qty_unit,
    total: Number(row.total),
    currency: row.currency,
    receiptStatus: row.receipt_status,
    hasException: row.has_exception,
    flags: row.flags,
  };
}

/** The queue's optional narrowing (T-63): a billing week, a side of it, or both.
 * Neither is required — the queue is a standing worklist across every week
 * (D17), and the sidebar badge counts all of it. */
export interface ReceiptQueueScope {
  /** A billing week's end, `YYYY-MM-DD`. */
  week?: string;
  currency?: InvoiceCurrency;
  /** Also return stops already confirmed — the Receipt Queue screen's Confirmed and All views.
   * Off by default, so the sidebar badge and every older caller still get the work queue only. */
  includeConfirmed?: boolean;
}

/** Parameterised `AND` conditions over `invoices i`, shared by the queue and its progress. */
function scopeClause(scope: ReceiptQueueScope): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (scope.week !== undefined) {
    params.push(scope.week);
    conditions.push(`i.billing_week_end = $${params.length}::date`);
  }
  if (scope.currency !== undefined) {
    params.push(scope.currency);
    conditions.push(`i.currency = $${params.length}`);
  }
  return { sql: conditions.map((c) => ` AND ${c}`).join(""), params };
}

async function loadProgress(pool: Pool, scope: ReceiptQueueScope): Promise<ReceiptQueueProgress> {
  const { sql, params } = scopeClause(scope);
  const { rows } = await pool.query<{ done: string; total: string }>(
    `SELECT count(*) FILTER (WHERE fs.receipt_status = 'confirmed') AS done, count(*) AS total
     FROM fuel_stops fs
     JOIN invoices i ON i.id = fs.invoice_id${sql}`,
    params,
  );
  return { done: Number(rows[0]!.done), total: Number(rows[0]!.total) };
}

/**
 * `GET /receipt-queue` (A8.5). Unconfirmed stops (`receipt_status <>
 * 'confirmed'` — `'pending'` and `'missing'` both still need a human look)
 * with enough context to search Samsara, plus `progress` over every stop in
 * the same scope so the dispatcher sees overall completion, not just what's
 * left. `scope` narrows both to a week and/or one side of it (T-63); with none,
 * both are system-wide and both currencies are in the queue, each item carrying
 * its own `currency`. A confirmed stop is excluded at the WHERE clause, not filtered
 * client-side, so it can never reappear once `POST /receipt-checks` confirms
 * it (T-35's own DoD).
 */
export async function listReceiptQueue(
  pool: Pool,
  orderSpec: QueueOrderSpec = DEFAULT_QUEUE_ORDER,
  scope: ReceiptQueueScope = {},
): Promise<ReceiptQueueResult> {
  const orderClause = buildQueueOrderClause(orderSpec);
  const { sql: scopeSql, params: scopeParams } = scopeClause(scope);

  const [{ rows }, progress] = await Promise.all([
    pool.query<QueueRow>(
      `SELECT fs.id, fs.occurred_at, fs.total, i.currency, i.qty_unit, ta.qty AS ta_qty, fs.receipt_status,
              fs.driver_id, fs.unit_raw, fs.driver_name_raw,
              t.unit_number AS truck_unit_number,
              d.display_name AS driver_display_name,
              s.id AS station_id, s.name_raw AS station_name_raw,
              s.city_raw AS station_city_raw, s.state_usps AS station_state_usps,
              EXISTS (
                SELECT 1 FROM anomalies a
                WHERE a.subject_type = 'fuel_stop' AND a.subject_id = fs.id AND a.dismissed_at IS NULL
                  AND a.rule <> 'charges_no_fuel'
              ) AS has_exception,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object('rule', a.rule, 'severity', a.severity) ORDER BY a.rule)
                FROM anomalies a
                WHERE a.subject_type = 'fuel_stop' AND a.subject_id = fs.id AND a.dismissed_at IS NULL
                  AND a.rule <> 'charges_no_fuel'
              ), '[]'::jsonb) AS flags
       FROM fuel_stops fs
       JOIN invoices i ON i.id = fs.invoice_id
       LEFT JOIN trucks t ON t.id = fs.truck_id
       LEFT JOIN drivers d ON d.id = fs.driver_id
       LEFT JOIN stations s ON s.id = fs.station_id
       LEFT JOIN LATERAL (
         SELECT qty FROM fuel_stop_lines WHERE fuel_stop_id = fs.id AND product_code = 'TA' LIMIT 1
       ) ta ON true
       WHERE ${scope.includeConfirmed === true ? "true" : "fs.receipt_status <> 'confirmed'"}${scopeSql}
       ${orderClause}`,
      scopeParams,
    ),
    loadProgress(pool, scope),
  ]);

  return { items: rows.map(toQueueItem), progress };
}

// ─── Writes ───────────────────────────────────────────────────────────────

export interface ReceiptCheckResult {
  fuelStopId: string;
  outcome: ReceiptOutcome;
  checkedBy: string;
  checkedAt: string;
}

/**
 * `POST /receipt-checks`, single decision (A8.5). Appends one row to
 * `receipt_checks` and updates `fuel_stops.receipt_status` to match in the
 * same transaction — the table's own comment is explicit that a stop's
 * status "derives from the latest row here", so the two writes must never
 * observably disagree. Returns `null` when `fuelStopId` doesn't resolve to a
 * fuel stop, for the route to map to 404; skip is not represented here at
 * all — it never reaches this function, since skip writes nothing (T-35 DoD).
 */
export async function recordReceiptCheck(
  pool: Pool,
  params: { fuelStopId: string; outcome: ReceiptOutcome; checkedBy: string },
): Promise<ReceiptCheckResult | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: stopRows } = await client.query<{ id: string }>(
      "SELECT id FROM fuel_stops WHERE id = $1",
      [params.fuelStopId],
    );
    if (stopRows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const { rows: checkRows } = await client.query<{ checked_at: Date }>(
      `INSERT INTO receipt_checks (fuel_stop_id, checked_by, outcome)
       VALUES ($1, $2, $3)
       RETURNING checked_at`,
      [params.fuelStopId, params.checkedBy, params.outcome],
    );
    await client.query("UPDATE fuel_stops SET receipt_status = $2 WHERE id = $1", [
      params.fuelStopId,
      params.outcome,
    ]);

    await client.query("COMMIT");
    return {
      fuelStopId: params.fuelStopId,
      outcome: params.outcome,
      checkedBy: params.checkedBy,
      checkedAt: checkRows[0]!.checked_at.toISOString(),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface BatchConfirmResult {
  driverId: string;
  confirmedCount: number;
}

/**
 * `POST /receipt-checks`, batch confirm for one driver (A8.5). Scoped to
 * "every stop currently in the queue for this driver" — since the queue is
 * already `receipt_status <> 'confirmed'` stops, that scope makes the batch
 * idempotent for free: a second call finds nothing left to confirm and
 * writes nothing. One `receipt_checks` row per stop, in one transaction.
 */
export async function confirmReceiptsForDriver(
  pool: Pool,
  params: { driverId: string; checkedBy: string },
): Promise<BatchConfirmResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: stopRows } = await client.query<{ id: string }>(
      "SELECT id FROM fuel_stops WHERE driver_id = $1 AND receipt_status <> 'confirmed'",
      [params.driverId],
    );

    for (const stop of stopRows) {
      await client.query(
        "INSERT INTO receipt_checks (fuel_stop_id, checked_by, outcome) VALUES ($1, $2, 'confirmed')",
        [stop.id, params.checkedBy],
      );
    }
    if (stopRows.length > 0) {
      await client.query("UPDATE fuel_stops SET receipt_status = 'confirmed' WHERE id = ANY($1)", [
        stopRows.map((r) => r.id),
      ]);
    }

    await client.query("COMMIT");
    return { driverId: params.driverId, confirmedCount: stopRows.length };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * `POST /receipt-checks`, batch confirm for an explicit list of stops — what the Receipt Queue's
 * "Confirm all N shown" posts, because the dispatcher confirms the rows a driver and/or day
 * filter shows, not the driver's whole queue. Already-confirmed ids are skipped, so a retry
 * writes nothing twice; `confirmedCount` is the number actually written. One transaction.
 */
export async function confirmReceiptStops(
  pool: Pool,
  params: { fuelStopIds: readonly string[]; checkedBy: string },
): Promise<{ confirmedCount: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM fuel_stops WHERE id = ANY($1::uuid[]) AND receipt_status <> 'confirmed'",
      [params.fuelStopIds],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await client.query(
        "INSERT INTO receipt_checks (fuel_stop_id, checked_by, outcome) SELECT unnest($1::uuid[]), $2, 'confirmed'",
        [ids, params.checkedBy],
      );
      await client.query("UPDATE fuel_stops SET receipt_status = 'confirmed' WHERE id = ANY($1::uuid[])", [ids]);
    }
    await client.query("COMMIT");
    return { confirmedCount: ids.length };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
