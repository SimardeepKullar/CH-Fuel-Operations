import type { Pool } from "pg";
import { normalizeName } from "../resolve/normalizeName.js";
import { parseStoreName } from "../resolution/storeNumber.js";
import type { AnomalySeverity, ReceiptStatus } from "../db/types.js";
import { buildTransactionFilterClause, type TransactionFilters } from "./transactionQuery.js";

export type TransactionSortField = "occurred_at" | "total_usd";
export interface TransactionSort {
  field: TransactionSortField;
  direction: "asc" | "desc";
}

export interface TransactionPagination {
  /** 1-based. */
  page: number;
  pageSize: number;
}

/** A9's raw-vs-resolved convention: `agrees` is `null` — not `false` — when
 * there is nothing resolved to compare against (nulls are meaningful). */
export interface RawResolvedString {
  resolved: string | null;
  raw: string;
  agrees: boolean | null;
}

export interface TransactionStationSummary {
  id: string;
  /** Parsed fresh from `stations.name_raw` (`LOVES #294` -> 294) — the
   * column itself is never populated at ingest (`resolveStation.ts`), so it
   * is derived here rather than trusted from a column that doesn't exist. */
  loveNumber: number | null;
  city: string;
  state: string;
}

export interface AnomalyFlag {
  rule: string;
  severity: AnomalySeverity;
}

export interface TransactionLine {
  productCode: string;
  gallons: number;
  retailUsdPerGal: number;
  billedUsdPerGal: number;
  amountUsd: number;
  currency: "USD";
}

export interface TransactionListItem {
  id: string;
  baseAuthCode: string;
  occurredAt: string;
  card: { id: string; number: string };
  driver: RawResolvedString;
  truck: RawResolvedString;
  station: TransactionStationSummary | null;
  /** The diesel (TA) line's figures — `null` when the stop carries no TA
   * line (e.g. a card-with-no-fuel charge, A10's `charges_no_fuel` case). */
  gallons: number | null;
  retailUsdPerGal: number | null;
  billedUsdPerGal: number | null;
  totalUsd: number;
  currency: "USD";
  receiptStatus: ReceiptStatus;
  flags: AnomalyFlag[];
  lines?: TransactionLine[];
}

export interface ListTransactionsResult {
  rows: TransactionListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ListTransactionsOptions {
  includeLines?: boolean;
}

interface TransactionRow {
  id: string;
  base_auth_code: string;
  occurred_at: Date;
  total: string;
  receipt_status: ReceiptStatus;
  unit_raw: string;
  driver_name_raw: string;
  card_id: string;
  card_number: string;
  truck_unit_number: string | null;
  driver_display_name: string | null;
  station_id: string | null;
  station_name_raw: string | null;
  station_city_raw: string | null;
  station_state_usps: string | null;
  ta_gallons: string | null;
  ta_retail: string | null;
  ta_billed: string | null;
}

const SORT_COLUMNS: Record<TransactionSortField, string> = {
  occurred_at: "fs.occurred_at",
  // The API sort value keeps its name until T-63 reshapes the contract.
  total_usd: "fs.total",
};

const BASE_SELECT = `
  SELECT fs.id, fs.base_auth_code, fs.occurred_at, fs.total, fs.receipt_status,
         fs.unit_raw, fs.driver_name_raw,
         fc.id AS card_id, fc.card_number,
         t.unit_number AS truck_unit_number,
         d.display_name AS driver_display_name,
         s.id AS station_id, s.name_raw AS station_name_raw,
         s.city_raw AS station_city_raw, s.state_usps AS station_state_usps,
         ta.qty AS ta_gallons, ta.retail_per_unit AS ta_retail, ta.billed_per_unit AS ta_billed
  FROM fuel_stops fs
  JOIN fuel_cards fc ON fc.id = fs.card_id
  LEFT JOIN trucks t ON t.id = fs.truck_id
  LEFT JOIN drivers d ON d.id = fs.driver_id
  LEFT JOIN stations s ON s.id = fs.station_id
  LEFT JOIN LATERAL (
    SELECT qty, retail_per_unit, billed_per_unit
    FROM fuel_stop_lines
    WHERE fuel_stop_id = fs.id AND product_code = 'TA'
    LIMIT 1
  ) ta ON true
`;

/**
 * `Pick`ed rather than typed to `TransactionRow` so `receipts.ts`'s queue
 * query — a different SELECT with the same column names but not every
 * `TransactionRow` field — can reuse these three builders instead of a
 * second copy of the same raw/resolved logic (A8.5 is the same shape as
 * A8.3 minus fields, not a different one).
 */
export function driverRawResolved(
  row: Pick<TransactionRow, "driver_display_name" | "driver_name_raw">,
): RawResolvedString {
  const resolved = row.driver_display_name;
  return {
    resolved,
    raw: row.driver_name_raw,
    agrees: resolved === null ? null : normalizeName(row.driver_name_raw) === normalizeName(resolved),
  };
}

export function truckRawResolved(row: Pick<TransactionRow, "truck_unit_number" | "unit_raw">): RawResolvedString {
  const resolved = row.truck_unit_number;
  return {
    resolved,
    raw: row.unit_raw,
    agrees: resolved === null ? null : row.unit_raw.trim() === resolved,
  };
}

export function stationSummary(
  row: Pick<TransactionRow, "station_id" | "station_name_raw" | "station_city_raw" | "station_state_usps">,
): TransactionStationSummary | null {
  if (row.station_id === null || row.station_name_raw === null) {
    return null;
  }
  return {
    id: row.station_id,
    loveNumber: parseStoreName(row.station_name_raw).storeNumber,
    city: row.station_city_raw ?? "",
    state: row.station_state_usps ?? "",
  };
}

function toListItem(row: TransactionRow, flagsByStop: ReadonlyMap<string, AnomalyFlag[]>): TransactionListItem {
  return {
    id: row.id,
    baseAuthCode: row.base_auth_code,
    occurredAt: row.occurred_at.toISOString(),
    card: { id: row.card_id, number: row.card_number },
    driver: driverRawResolved(row),
    truck: truckRawResolved(row),
    station: stationSummary(row),
    gallons: row.ta_gallons === null ? null : Number(row.ta_gallons),
    retailUsdPerGal: row.ta_retail === null ? null : Number(row.ta_retail),
    billedUsdPerGal: row.ta_billed === null ? null : Number(row.ta_billed),
    totalUsd: Number(row.total),
    currency: "USD",
    receiptStatus: row.receipt_status,
    flags: flagsByStop.get(row.id) ?? [],
  };
}

interface AnomalyFlagRow {
  subject_id: string;
  rule: string;
  severity: AnomalySeverity;
}

async function loadFlags(pool: Pool, stopIds: readonly string[]): Promise<Map<string, AnomalyFlag[]>> {
  const byStop = new Map<string, AnomalyFlag[]>();
  if (stopIds.length === 0) {
    return byStop;
  }
  const { rows } = await pool.query<AnomalyFlagRow>(
    `SELECT subject_id, rule, severity FROM anomalies
     WHERE subject_type = 'fuel_stop' AND subject_id = ANY($1) AND dismissed_at IS NULL`,
    [stopIds],
  );
  for (const row of rows) {
    const existing = byStop.get(row.subject_id);
    const flag: AnomalyFlag = { rule: row.rule, severity: row.severity };
    if (existing) {
      existing.push(flag);
    } else {
      byStop.set(row.subject_id, [flag]);
    }
  }
  return byStop;
}

interface FuelStopLineRow {
  fuel_stop_id: string;
  product_code: string;
  qty: string;
  retail_per_unit: string;
  billed_per_unit: string;
  amount: string;
}

async function loadLines(pool: Pool, stopIds: readonly string[]): Promise<Map<string, TransactionLine[]>> {
  const byStop = new Map<string, TransactionLine[]>();
  if (stopIds.length === 0) {
    return byStop;
  }
  const { rows } = await pool.query<FuelStopLineRow>(
    `SELECT fuel_stop_id, product_code, qty, retail_per_unit, billed_per_unit, amount
     FROM fuel_stop_lines
     WHERE fuel_stop_id = ANY($1)
     ORDER BY fuel_stop_id, product_code`,
    [stopIds],
  );
  for (const row of rows) {
    const line: TransactionLine = {
      productCode: row.product_code,
      gallons: Number(row.qty),
      retailUsdPerGal: Number(row.retail_per_unit),
      billedUsdPerGal: Number(row.billed_per_unit),
      amountUsd: Number(row.amount),
      currency: "USD",
    };
    const existing = byStop.get(row.fuel_stop_id);
    if (existing) {
      existing.push(line);
    } else {
      byStop.set(row.fuel_stop_id, [line]);
    }
  }
  return byStop;
}

interface InvoiceIdRow {
  id: string;
}

/**
 * `?period=` -> `fuel_stops.invoice_id` (T-40, A7). `period` is
 * `invoices.period_start`, the same key `GET /overview`/`GET /drivers` take.
 * `null` when no invoice has that `period_start` — the caller passes that
 * straight through to `TransactionFilters.invoiceId`, which filters to zero
 * rows rather than falling back to the unfiltered set.
 */
export async function resolveInvoiceIdForPeriod(pool: Pool, period: string): Promise<string | null> {
  const { rows } = await pool.query<InvoiceIdRow>("SELECT id FROM invoices WHERE period_start = $1::date", [period]);
  return rows[0]?.id ?? null;
}

/**
 * `GET /transactions` (A13). One row per fuel stop; `lines[]` only when
 * `options.includeLines` is set — A8.3's list stays dense by default and
 * expands on request. `anomalyOnly` and every other filter compose through
 * `buildTransactionFilterClause` (Step 32.1) and apply identically to the
 * page query and the count query, so `total` always reflects the filtered
 * set, never the unfiltered table.
 */
export async function listTransactions(
  pool: Pool,
  filters: TransactionFilters,
  sort: TransactionSort,
  pagination: TransactionPagination,
  options: ListTransactionsOptions = {},
): Promise<ListTransactionsResult> {
  const { whereSql, params } = buildTransactionFilterClause(filters);
  const sortColumn = SORT_COLUMNS[sort.field];
  const direction = sort.direction === "asc" ? "ASC" : "DESC";

  const limitParamIndex = params.length + 1;
  const offsetParamIndex = params.length + 2;
  const pageParams = [...params, pagination.pageSize, (pagination.page - 1) * pagination.pageSize];

  const { rows } = await pool.query<TransactionRow>(
    `${BASE_SELECT}
     ${whereSql}
     ORDER BY ${sortColumn} ${direction}, fs.id ASC
     LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
    pageParams,
  );

  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM fuel_stops fs ${whereSql}`,
    params,
  );
  const total = Number(countRows[0]?.count ?? "0");

  const stopIds = rows.map((r) => r.id);
  const flagsByStop = await loadFlags(pool, stopIds);
  const linesByStop = options.includeLines ? await loadLines(pool, stopIds) : undefined;

  return {
    rows: rows.map((row) => {
      const item = toListItem(row, flagsByStop);
      if (linesByStop) {
        item.lines = linesByStop.get(row.id) ?? [];
      }
      return item;
    }),
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
  };
}

export interface ReceiptCheckSummary {
  outcome: string;
  checkedBy: string;
  checkedAt: string;
}

export interface TransactionDetail extends Omit<TransactionListItem, "lines"> {
  lines: TransactionLine[];
  station: (TransactionStationSummary & { resolution: string; resolutionSource: string | null }) | null;
  receiptCheck: ReceiptCheckSummary | null;
  invoiceId: string;
  planId: string | null;
}

interface DetailRow extends TransactionRow {
  invoice_id: string;
  truck_id: string | null;
  station_resolution: string | null;
  station_resolution_source: string | null;
}

interface ReceiptCheckRow {
  outcome: string;
  checked_by_name: string;
  checked_at: Date;
}

async function loadLatestReceiptCheck(pool: Pool, fuelStopId: string): Promise<ReceiptCheckSummary | null> {
  const { rows } = await pool.query<ReceiptCheckRow>(
    `SELECT rc.outcome, rc.checked_at, u.display_name AS checked_by_name
     FROM receipt_checks rc
     JOIN users u ON u.id = rc.checked_by
     WHERE rc.fuel_stop_id = $1
     ORDER BY rc.checked_at DESC
     LIMIT 1`,
    [fuelStopId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { outcome: row.outcome, checkedBy: row.checked_by_name, checkedAt: row.checked_at.toISOString() };
}

interface DispatchedPlanRow {
  id: string;
}

/**
 * A8.4's plan link: a **dispatched** plan (`dispatched_at IS NOT NULL`,
 * A14) for the same resolved truck, priced as of the stop's calendar date.
 * `null` — never a guess — when the stop's truck didn't resolve or no
 * dispatched plan matches.
 *
 * `p.truck_id = $1` directly (T-56) — before the merge this joined on
 * `truck_profile_id`, the abstract mpg/tank class, which could match a plan
 * for a *different* real truck sharing the same class. `plans.truck_id` is
 * now the real fleet unit itself, unambiguous.
 */
async function findDispatchedPlanId(pool: Pool, truckId: string | null, occurredAt: Date): Promise<string | null> {
  if (truckId === null) {
    return null;
  }
  const { rows } = await pool.query<DispatchedPlanRow>(
    `SELECT p.id
     FROM plans p
     WHERE p.truck_id = $1
       AND p.dispatched_at IS NOT NULL
       AND p.price_as_of = ($2::timestamptz AT TIME ZONE 'UTC')::date
     ORDER BY p.dispatched_at DESC
     LIMIT 1`,
    [truckId, occurredAt],
  );
  return rows[0]?.id ?? null;
}

/**
 * `GET /transactions/{id}` (A8.4). `null` when the id doesn't resolve to a
 * fuel stop — the route maps that to a 404 problem+json.
 */
export async function getTransactionById(pool: Pool, id: string): Promise<TransactionDetail | null> {
  const { rows } = await pool.query<DetailRow>(
    `SELECT fs.id, fs.invoice_id, fs.base_auth_code, fs.occurred_at, fs.total, fs.receipt_status,
            fs.unit_raw, fs.driver_name_raw, fs.truck_id,
            fc.id AS card_id, fc.card_number,
            t.unit_number AS truck_unit_number,
            d.display_name AS driver_display_name,
            s.id AS station_id, s.name_raw AS station_name_raw,
            s.city_raw AS station_city_raw, s.state_usps AS station_state_usps,
            s.resolution AS station_resolution, s.resolution_source AS station_resolution_source,
            ta.qty AS ta_gallons, ta.retail_per_unit AS ta_retail, ta.billed_per_unit AS ta_billed
     FROM fuel_stops fs
     JOIN fuel_cards fc ON fc.id = fs.card_id
     LEFT JOIN trucks t ON t.id = fs.truck_id
     LEFT JOIN drivers d ON d.id = fs.driver_id
     LEFT JOIN stations s ON s.id = fs.station_id
     LEFT JOIN LATERAL (
       SELECT qty, retail_per_unit, billed_per_unit
       FROM fuel_stop_lines
       WHERE fuel_stop_id = fs.id AND product_code = 'TA'
       LIMIT 1
     ) ta ON true
     WHERE fs.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }

  const [flagsByStop, linesByStop, receiptCheck, planId] = await Promise.all([
    loadFlags(pool, [row.id]),
    loadLines(pool, [row.id]),
    loadLatestReceiptCheck(pool, row.id),
    findDispatchedPlanId(pool, row.truck_id, row.occurred_at),
  ]);

  const base = toListItem(row, flagsByStop);
  const station =
    base.station === null
      ? null
      : {
          ...base.station,
          resolution: row.station_resolution ?? "unresolved",
          resolutionSource: row.station_resolution_source,
        };

  return {
    ...base,
    lines: linesByStop.get(row.id) ?? [],
    station,
    receiptCheck,
    invoiceId: row.invoice_id,
    planId,
  };
}
