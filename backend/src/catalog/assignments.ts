import type { Pool } from "pg";

export interface TruckAssignmentForMatch {
  driverId: string;
  truckId: string;
  /** Calendar date the assignment starts, inclusive. */
  effectiveFrom: Date;
  /** Calendar date the assignment ends, inclusive; `null` means current. */
  effectiveTo: Date | null;
}

export interface AssignmentResolution {
  driverId: string | null;
  truckId: string | null;
}

function toUtcDateNumber(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Hop 2: `driverId` + `at` → the truck in force at that instant, at
 * calendar-day granularity (`effective_from`/`effective_to` are `date`, not
 * `timestamptz`). Bounds are inclusive on both ends, matching the schema's
 * `EXCLUDE USING gist (... daterange(effective_from, effective_to, '[]') ...)`
 * constraint (migrations/0003_actuals_schema.sql) — that constraint only prevents
 * one driver's ranges from overlapping if a reassignment's old row ends the
 * day *before* the new row starts, so a half-open reading of `effective_to`
 * would leave that last day belonging to neither assignment.
 */
export function resolveTruckAtInstant(
  driverId: string | null,
  assignments: readonly TruckAssignmentForMatch[],
  at: Date,
): string | null {
  if (!driverId) {
    return null;
  }
  const atDate = toUtcDateNumber(at);
  const assignment = assignments.find((a) => {
    if (a.driverId !== driverId) {
      return false;
    }
    if (atDate < toUtcDateNumber(a.effectiveFrom)) {
      return false;
    }
    if (a.effectiveTo !== null && atDate > toUtcDateNumber(a.effectiveTo)) {
      return false;
    }
    return true;
  });
  return assignment?.truckId ?? null;
}

/**
 * `resolveAssignment(cardId, at)` — the whole actuals half leans on this
 * (T-26 step 26.2). Two hops, not one (D19): `cardId` → `driverId` is
 * `fuel_cards.driver_id`, permanent and untimed; `driverId` + `at` →
 * `truckId` is `resolveTruckAtInstant` above. Getting the truck from the
 * *current* assignment instead of the one in force at `at` would corrupt
 * history silently the moment a driver is reassigned — every past stop
 * would start resolving to the new truck.
 */
export function resolveAssignmentFromRows(
  card: { driverId: string | null } | undefined,
  assignments: readonly TruckAssignmentForMatch[],
  at: Date,
): AssignmentResolution {
  const driverId = card?.driverId ?? null;
  return { driverId, truckId: resolveTruckAtInstant(driverId, assignments, at) };
}

interface FuelCardDriverRow {
  driver_id: string | null;
}

interface TruckAssignmentQueryRow {
  truck_id: string;
}

/**
 * DB-backed form: one indexed query per hop. Hop 1 hits `fuel_cards`' primary
 * key; hop 2 hits `truck_assignments_driver (driver_id, effective_from)`. The
 * `AT TIME ZONE 'UTC'` cast pins the calendar-day comparison to UTC so it
 * matches `resolveTruckAtInstant`'s `getUTCFullYear`/`getUTCMonth`/`getUTCDate`
 * regardless of the session's timezone setting.
 */
export async function resolveAssignment(
  pool: Pool,
  cardId: string,
  at: Date,
): Promise<AssignmentResolution> {
  const { rows: cardRows } = await pool.query<FuelCardDriverRow>(
    "SELECT driver_id FROM fuel_cards WHERE id = $1",
    [cardId],
  );
  const driverId = cardRows[0]?.driver_id ?? null;
  if (!driverId) {
    return { driverId: null, truckId: null };
  }

  const { rows: assignmentRows } = await pool.query<TruckAssignmentQueryRow>(
    `SELECT truck_id FROM truck_assignments
      WHERE driver_id = $1
        AND effective_from <= ($2::timestamptz AT TIME ZONE 'UTC')::date
        AND (effective_to IS NULL OR effective_to >= ($2::timestamptz AT TIME ZONE 'UTC')::date)`,
    [driverId, at],
  );
  return { driverId, truckId: assignmentRows[0]?.truck_id ?? null };
}
