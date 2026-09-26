import type { Pool } from "pg";
import { resolveExpressDriver } from "./resolveDriver.js";
import { resolveTruckForStop } from "./resolveTruck.js";

export interface ReresolvePeriod {
  from?: Date;
  to?: Date;
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

export interface ReresolveReport {
  fuelStopsScanned: number;
  expressChargesScanned: number;
  changes: ReresolveChange[];
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

function periodClause(period: ReresolvePeriod, params: unknown[]): string {
  const clauses: string[] = [];
  if (period.from) {
    params.push(period.from);
    clauses.push(`occurred_at >= $${params.length}`);
  }
  if (period.to) {
    params.push(period.to);
    clauses.push(`occurred_at <= $${params.length}`);
  }
  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

/**
 * D14's explicit re-resolution job: re-derives `fuel_stops.truck_id`/
 * `driver_id` and `express_charges.driver_id`/`match_status` for stops in a
 * period, wrapping the same resolvers `importInvoice` uses at import time
 * (`resolveTruckForStop`, `resolveExpressDriver`) so the two never drift
 * apart. `unit_raw`/`driver_name_raw` are read, never written — history
 * changes only when this job runs, never as a side effect of reading a
 * stop (D14). Running it twice with no intervening assignment/alias edit
 * writes nothing the second time, since the resolvers recompute the same
 * values.
 */
export async function reresolve(pool: Pool, period: ReresolvePeriod = {}): Promise<ReresolveReport> {
  const changes: ReresolveChange[] = [];

  const fuelStopParams: unknown[] = [];
  const { rows: fuelStops } = await pool.query<FuelStopForReresolve>(
    `SELECT id, card_id, occurred_at, unit_raw, truck_id, driver_id
       FROM fuel_stops
       ${periodClause(period, fuelStopParams)}`,
    fuelStopParams,
  );

  for (const stop of fuelStops) {
    const resolution = await resolveTruckForStop(pool, stop.card_id, stop.occurred_at, stop.unit_raw);

    if (resolution.truckId !== stop.truck_id) {
      await pool.query("UPDATE fuel_stops SET truck_id = $1 WHERE id = $2", [resolution.truckId, stop.id]);
      changes.push({
        subjectType: "fuel_stop",
        subjectId: stop.id,
        field: "truck_id",
        before: stop.truck_id,
        after: resolution.truckId,
      });
    }
    if (resolution.driverId !== stop.driver_id) {
      await pool.query("UPDATE fuel_stops SET driver_id = $1 WHERE id = $2", [resolution.driverId, stop.id]);
      changes.push({
        subjectType: "fuel_stop",
        subjectId: stop.id,
        field: "driver_id",
        before: stop.driver_id,
        after: resolution.driverId,
      });
    }
  }

  const expressParams: unknown[] = [];
  const { rows: expressCharges } = await pool.query<ExpressChargeForReresolve>(
    `SELECT id, driver_name_raw, driver_id, match_status
       FROM express_charges
       ${periodClause(period, expressParams)}`,
    expressParams,
  );

  for (const charge of expressCharges) {
    const resolution = await resolveExpressDriver(pool, charge.driver_name_raw);

    if (resolution.driverId !== charge.driver_id) {
      await pool.query("UPDATE express_charges SET driver_id = $1 WHERE id = $2", [
        resolution.driverId,
        charge.id,
      ]);
      changes.push({
        subjectType: "express_charge",
        subjectId: charge.id,
        field: "driver_id",
        before: charge.driver_id,
        after: resolution.driverId,
      });
    }
    if (resolution.matchStatus !== charge.match_status) {
      await pool.query("UPDATE express_charges SET match_status = $1 WHERE id = $2", [
        resolution.matchStatus,
        charge.id,
      ]);
      changes.push({
        subjectType: "express_charge",
        subjectId: charge.id,
        field: "match_status",
        before: charge.match_status,
        after: resolution.matchStatus,
      });
    }
  }

  return { fuelStopsScanned: fuelStops.length, expressChargesScanned: expressCharges.length, changes };
}
