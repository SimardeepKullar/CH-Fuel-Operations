import type { Pool, PoolClient } from "pg";
import { runAnomalies } from "../anomaly/runAnomalies.js";
import type { DateWindow } from "../catalog/assignmentWindow.js";
import { resolveExpressDriver } from "./resolveDriver.js";
import { resolveTruckForStop } from "./resolveTruck.js";

export interface ReresolvePeriod {
  from?: Date;
  to?: Date;
  /** Only this driver's stops (by the stop's driver or its card's driver);
   * express charges are skipped, since their driver comes from a printed name
   * and never from an assignment. Set by the assignment write paths. */
  driverId?: string;
  /** Do everything, then roll back: the report is the diff, nothing is written. */
  dryRun?: boolean;
}

export type ReresolveSubject = "fuel_stop" | "express_charge";
export type ReresolveField = "truck_id" | "driver_id" | "match_status";

export interface ReresolveChange {
  subjectType: ReresolveSubject;
  subjectId: string;
  field: ReresolveField;
  before: string | null;
  after: string | null;
}

/** A finding that cleared, appeared or changed on a stop when its invoice's
 * flags were rebuilt. */
export interface FlagChange {
  change: "cleared" | "appeared" | "changed";
  rule: string;
  stopId: string;
  severity: "amber" | "red";
  detail: unknown;
}

export interface ReresolveReport {
  fuelStopsScanned: number;
  expressChargesScanned: number;
  changes: ReresolveChange[];
  /** Invoices whose flags were rebuilt: every invoice with a stop in scope. */
  invoicesRebuilt: number;
  flags: FlagChange[];
  /** Fuel stops whose truck changed, with what was entered — what a preview shows. */
  stopMoves: { stopId: string; occurredAt: string; unitRaw: string; before: string | null; after: string | null }[];
  dryRun: boolean;
}

interface FuelStopForReresolve {
  id: string;
  card_id: string;
  occurred_at: Date;
  unit_raw: string;
  truck_id: string | null;
  driver_id: string | null;
}

interface ExpressChargeForReresolve {
  id: string;
  driver_name_raw: string | null;
  driver_id: string | null;
  match_status: string;
}

interface FindingRow {
  rule: string;
  subject_id: string;
  severity: "amber" | "red";
  detail: unknown;
}

type Db = Pool | PoolClient;

/** A calendar window (`YYYY-MM-DD`, inclusive, UTC) as the instants `reresolve` filters on. */
export function windowPeriod(driverId: string, window: DateWindow): ReresolvePeriod {
  return {
    driverId,
    from: new Date(`${window.from}T00:00:00Z`),
    ...(window.to === null ? {} : { to: new Date(`${window.to}T23:59:59.999Z`) }),
  };
}

/** `occurred_at` bounds and the driver filter, as SQL over `fs` (fuel_stops) and `fc` (its card). */
function stopFilter(period: ReresolvePeriod, params: unknown[]): string {
  const clauses: string[] = [];
  if (period.from) {
    params.push(period.from);
    clauses.push(`fs.occurred_at >= $${params.length}`);
  }
  if (period.to) {
    params.push(period.to);
    clauses.push(`fs.occurred_at <= $${params.length}`);
  }
  if (period.driverId) {
    params.push(period.driverId);
    clauses.push(`(fs.driver_id = $${params.length} OR fc.driver_id = $${params.length})`);
  }
  return clauses.map((c) => ` AND ${c}`).join("");
}

function expressFilter(period: ReresolvePeriod, params: unknown[]): string {
  const clauses: string[] = [];
  if (period.from) {
    params.push(period.from);
    clauses.push(`occurred_at >= $${params.length}`);
  }
  if (period.to) {
    params.push(period.to);
    clauses.push(`occurred_at <= $${params.length}`);
  }
  return clauses.map((c) => ` AND ${c}`).join("");
}

async function invoicesInScope(db: Db, period: ReresolvePeriod): Promise<string[]> {
  const stopParams: unknown[] = [];
  const { rows: stopInvoices } = await db.query<{ invoice_id: string }>(
    `SELECT DISTINCT fs.invoice_id
       FROM fuel_stops fs JOIN fuel_cards fc ON fc.id = fs.card_id
      WHERE true${stopFilter(period, stopParams)}`,
    stopParams,
  );
  const ids = new Set(stopInvoices.map((r) => r.invoice_id));
  if (!period.driverId) {
    const expressParams: unknown[] = [];
    const { rows } = await db.query<{ invoice_id: string }>(
      `SELECT DISTINCT invoice_id FROM express_charges WHERE true${expressFilter(period, expressParams)}`,
      expressParams,
    );
    for (const r of rows) ids.add(r.invoice_id);
  }
  return [...ids].sort();
}

async function loadFindings(db: Db, invoiceId: string): Promise<Map<string, FindingRow>> {
  const { rows } = await db.query<FindingRow>(
    `SELECT a.rule, a.subject_id, a.severity, a.detail
       FROM anomalies a JOIN fuel_stops fs ON fs.id = a.subject_id
      WHERE a.subject_type = 'fuel_stop' AND fs.invoice_id = $1`,
    [invoiceId],
  );
  return new Map(rows.map((r) => [`${r.rule}|${r.subject_id}`, r]));
}

function diffFindings(before: Map<string, FindingRow>, after: Map<string, FindingRow>): FlagChange[] {
  const out: FlagChange[] = [];
  for (const [key, row] of before) {
    const now = after.get(key);
    if (!now) {
      out.push({ change: "cleared", rule: row.rule, stopId: row.subject_id, severity: row.severity, detail: row.detail });
    } else if (now.severity !== row.severity || JSON.stringify(now.detail) !== JSON.stringify(row.detail)) {
      out.push({ change: "changed", rule: now.rule, stopId: now.subject_id, severity: now.severity, detail: now.detail });
    }
  }
  for (const [key, row] of after) {
    if (!before.has(key)) {
      out.push({ change: "appeared", rule: row.rule, stopId: row.subject_id, severity: row.severity, detail: row.detail });
    }
  }
  return out;
}

/** One invoice's re-resolve and flag rebuild, on the caller's transaction. */
async function reresolveInvoice(db: Db, invoiceId: string, period: ReresolvePeriod, report: ReresolveReport) {
  const stopParams: unknown[] = [invoiceId];
  const { rows: fuelStops } = await db.query<FuelStopForReresolve>(
    `SELECT fs.id, fs.card_id, fs.occurred_at, fs.unit_raw, fs.truck_id, fs.driver_id
       FROM fuel_stops fs JOIN fuel_cards fc ON fc.id = fs.card_id
      WHERE fs.invoice_id = $1${stopFilter(period, stopParams)}
      ORDER BY fs.occurred_at, fs.id`,
    stopParams,
  );
  const findingsBefore = await loadFindings(db, invoiceId);

  for (const stop of fuelStops) {
    const resolution = await resolveTruckForStop(db, stop.card_id, stop.occurred_at, stop.unit_raw);

    if (resolution.truckId !== stop.truck_id) {
      await db.query("UPDATE fuel_stops SET truck_id = $1 WHERE id = $2", [resolution.truckId, stop.id]);
      report.changes.push({
        subjectType: "fuel_stop",
        subjectId: stop.id,
        field: "truck_id",
        before: stop.truck_id,
        after: resolution.truckId,
      });
      report.stopMoves.push({
        stopId: stop.id,
        occurredAt: stop.occurred_at.toISOString(),
        unitRaw: stop.unit_raw,
        before: stop.truck_id,
        after: resolution.truckId,
      });
    }
    if (resolution.driverId !== stop.driver_id) {
      await db.query("UPDATE fuel_stops SET driver_id = $1 WHERE id = $2", [resolution.driverId, stop.id]);
      report.changes.push({
        subjectType: "fuel_stop",
        subjectId: stop.id,
        field: "driver_id",
        before: stop.driver_id,
        after: resolution.driverId,
      });
    }
  }
  report.fuelStopsScanned += fuelStops.length;

  if (!period.driverId) {
    const expressParams: unknown[] = [invoiceId];
    const { rows: expressCharges } = await db.query<ExpressChargeForReresolve>(
      `SELECT id, driver_name_raw, driver_id, match_status
         FROM express_charges
        WHERE invoice_id = $1${expressFilter(period, expressParams)}`,
      expressParams,
    );
    for (const charge of expressCharges) {
      const resolution = await resolveExpressDriver(db, charge.driver_name_raw);

      if (resolution.driverId !== charge.driver_id) {
        await db.query("UPDATE express_charges SET driver_id = $1 WHERE id = $2", [resolution.driverId, charge.id]);
        report.changes.push({
          subjectType: "express_charge",
          subjectId: charge.id,
          field: "driver_id",
          before: charge.driver_id,
          after: resolution.driverId,
        });
      }
      if (resolution.matchStatus !== charge.match_status) {
        await db.query("UPDATE express_charges SET match_status = $1 WHERE id = $2", [
          resolution.matchStatus,
          charge.id,
        ]);
        report.changes.push({
          subjectType: "express_charge",
          subjectId: charge.id,
          field: "match_status",
          before: charge.match_status,
          after: resolution.matchStatus,
        });
      }
    }
    report.expressChargesScanned += expressCharges.length;
  }

  await runAnomalies(db, invoiceId);
  report.invoicesRebuilt += 1;
  report.flags.push(...diffFindings(findingsBefore, await loadFindings(db, invoiceId)));
}

export function emptyReport(dryRun: boolean): ReresolveReport {
  return {
    fuelStopsScanned: 0,
    expressChargesScanned: 0,
    changes: [],
    invoicesRebuilt: 0,
    flags: [],
    stopMoves: [],
    dryRun,
  };
}

/**
 * The assignment write paths' form: re-resolves the stops in `period` and
 * rebuilds their invoices' flags on the caller's own transaction, so a change
 * and its consequences commit or roll back together.
 */
export async function reresolveInTransaction(db: PoolClient, period: ReresolvePeriod): Promise<ReresolveReport> {
  const report = emptyReport(period.dryRun ?? false);
  for (const invoiceId of await invoicesInScope(db, period)) {
    await reresolveInvoice(db, invoiceId, period, report);
  }
  return report;
}

/**
 * D14's explicit re-resolution job: re-derives `fuel_stops.truck_id`/
 * `driver_id` and `express_charges.driver_id`/`match_status` for stops in a
 * period (and, with `driverId`, one driver's), wrapping the same resolvers
 * `importInvoice` uses at import time (`resolveTruckForStop`,
 * `resolveExpressDriver`) so the two never drift apart. `unit_raw`/
 * `driver_name_raw` are read, never written.
 *
 * Each invoice runs in one transaction — re-resolve, then its flags rebuilt
 * from the stops as they now stand (T-78) — so a failure leaves that invoice
 * exactly as it was. `dryRun` rolls every invoice back and returns the diff.
 * Running it twice with no intervening assignment/alias edit writes nothing the
 * second time: the resolvers recompute the same values, and the rebuild
 * writes the same set of flags.
 */
export async function reresolve(pool: Pool, period: ReresolvePeriod = {}): Promise<ReresolveReport> {
  const report = emptyReport(period.dryRun ?? false);
  const invoiceIds = await invoicesInScope(pool, period);

  for (const invoiceId of invoiceIds) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await reresolveInvoice(client, invoiceId, period, report);
      await client.query(period.dryRun ? "ROLLBACK" : "COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return report;
}
