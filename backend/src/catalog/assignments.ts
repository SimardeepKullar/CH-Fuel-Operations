import type { Pool, PoolClient } from "pg";
import { isUuid } from "../actuals/ids.js";
import { emptyReport, reresolveInTransaction, windowPeriod, type FlagChange, type ReresolveReport } from "../resolve/reresolve.js";
import { changedWindow } from "./assignmentWindow.js";

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
  pool: Pool | PoolClient,
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

// ─── Write paths (T-78) ──────────────────────────────────────────────────
//
// The only writers of `truck_assignments` after the roster seed. Each runs in
// one transaction; a rejected or failed change leaves every row as it was.
// Calendar dates travel as 'YYYY-MM-DD' text, never a JS `Date`, so a
// session timezone cannot move a boundary by a day.

export type AssignmentRejection =
  | "invalid_dates"
  | "driver_not_found"
  | "truck_not_found"
  | "assignment_not_found"
  | "truck_inactive"
  | "same_truck"
  | "from_not_after_open_start"
  | "second_open_assignment"
  | "overlap";

/** A change the roster's own rules refuse — a reason the caller can show,
 * not a failure. Anything else thrown is a genuine error. */
export class AssignmentRejected extends Error {
  constructor(
    readonly reason: AssignmentRejection,
    message: string,
  ) {
    super(message);
    this.name = "AssignmentRejected";
  }
}

export interface AssignmentRow {
  id: string;
  driverId: string;
  truckId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export type AssignmentChange =
  | { kind: "reassign"; driverId: string; truckId: string; from: string }
  | { kind: "editDates"; assignmentId: string; effectiveFrom: string; effectiveTo: string | null };

export interface AssignmentPreview {
  /** The affected driver's assignment rows before and after the change. */
  assignments: { before: AssignmentRow[]; after: AssignmentRow[] };
  /** Stops whose truck would change (`before` → `after`, as truck ids). */
  stops: ReresolveReport["stopMoves"];
  /** Flags that would clear, appear or change on the stops that move. */
  flags: { cleared: FlagChange[]; appeared: FlagChange[]; changed: FlagChange[] };
}

/** What a write did: the row it wrote and the re-resolve that followed it. */
export interface AssignmentWriteResult {
  assignmentId: string;
  report: ReresolveReport;
}

interface RawAssignmentRow {
  id: string;
  driver_id: string;
  truck_id: string;
  effective_from: string;
  effective_to: string | null;
}

const ASSIGNMENT_COLUMNS = `id, driver_id, truck_id,
       to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
       to_char(effective_to, 'YYYY-MM-DD') AS effective_to`;

function toAssignmentRow(row: RawAssignmentRow): AssignmentRow {
  return {
    id: row.id,
    driverId: row.driver_id,
    truckId: row.truck_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

function requireDate(value: string, label: string): void {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AssignmentRejected("invalid_dates", `${label} must be a calendar date (YYYY-MM-DD), got "${value}"`);
  }
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Locks the driver row, so two writes to one driver's assignments run one
 * after the other even when the driver has no open row to lock. */
async function lockDriver(client: PoolClient, driverId: string): Promise<void> {
  const { rows } = isUuid(driverId)
    ? await client.query("SELECT id FROM drivers WHERE id = $1 FOR UPDATE", [driverId])
    : { rows: [] };
  if (rows.length === 0) {
    throw new AssignmentRejected("driver_not_found", `no driver ${driverId}`);
  }
}

async function loadDriverAssignments(db: Pool | PoolClient, driverId: string): Promise<AssignmentRow[]> {
  const { rows } = await db.query<RawAssignmentRow>(
    `SELECT ${ASSIGNMENT_COLUMNS} FROM truck_assignments
      WHERE driver_id = $1 ORDER BY effective_from, id`,
    [driverId],
  );
  return rows.map(toAssignmentRow);
}

/** Maps the constraint a write tripped to the reason the caller can show. */
function rejectionFor(err: unknown): AssignmentRejected | null {
  const code = (err as { code?: string } | null)?.code;
  if (code === "23P01") {
    return new AssignmentRejected("overlap", "the dates overlap another assignment of this driver");
  }
  if (code === "23505") {
    return new AssignmentRejected("second_open_assignment", "the driver already has an open assignment");
  }
  if (code === "23514") {
    return new AssignmentRejected("invalid_dates", "the assignment would end before it starts");
  }
  return null;
}

async function reassignInTransaction(
  client: PoolClient,
  input: { driverId: string; truckId: string; from: string },
): Promise<string> {
  const { driverId, truckId, from } = input;
  requireDate(from, "from");
  await lockDriver(client, driverId);

  const { rows: truckRows } = isUuid(truckId)
    ? await client.query<{ is_active: boolean }>("SELECT is_active FROM trucks WHERE id = $1", [truckId])
    : { rows: [] };
  if (truckRows.length === 0) {
    throw new AssignmentRejected("truck_not_found", `no truck ${truckId}`);
  }
  if (!truckRows[0]!.is_active) {
    throw new AssignmentRejected("truck_inactive", "that truck is decommissioned");
  }

  const { rows: openRows } = await client.query<RawAssignmentRow>(
    `SELECT ${ASSIGNMENT_COLUMNS} FROM truck_assignments
      WHERE driver_id = $1 AND effective_to IS NULL FOR UPDATE`,
    [driverId],
  );
  const open = openRows[0];
  try {
    if (open) {
      if (open.truck_id === truckId) {
        throw new AssignmentRejected(
          "same_truck",
          "that is already the driver's current truck — edit its dates instead of reassigning",
        );
      }
      if (from <= open.effective_from) {
        throw new AssignmentRejected(
          "from_not_after_open_start",
          `the current assignment starts ${open.effective_from}; move its dates instead of reassigning from ${from}`,
        );
      }
      await client.query("UPDATE truck_assignments SET effective_to = $2::date - 1 WHERE id = $1", [open.id, from]);
    }
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO truck_assignments (driver_id, truck_id, effective_from, effective_to)
       VALUES ($1, $2, $3::date, NULL) RETURNING id`,
      [driverId, truckId, from],
    );
    return rows[0]!.id;
  } catch (err) {
    throw rejectionFor(err) ?? err;
  }
}

async function editDatesInTransaction(
  client: PoolClient,
  input: { assignmentId: string; effectiveFrom: string; effectiveTo: string | null },
): Promise<string> {
  const { assignmentId, effectiveFrom, effectiveTo } = input;
  requireDate(effectiveFrom, "effectiveFrom");
  if (effectiveTo !== null) {
    requireDate(effectiveTo, "effectiveTo");
    if (effectiveTo < effectiveFrom) {
      throw new AssignmentRejected("invalid_dates", "an assignment cannot end before it starts");
    }
  }

  const { rows } = isUuid(assignmentId)
    ? await client.query<{ driver_id: string }>("SELECT driver_id FROM truck_assignments WHERE id = $1", [assignmentId])
    : { rows: [] };
  const driverId = rows[0]?.driver_id;
  if (!driverId) {
    throw new AssignmentRejected("assignment_not_found", `no assignment ${assignmentId}`);
  }
  await lockDriver(client, driverId);

  if (effectiveTo === null) {
    const { rows: others } = await client.query(
      "SELECT 1 FROM truck_assignments WHERE driver_id = $1 AND effective_to IS NULL AND id <> $2",
      [driverId, assignmentId],
    );
    if (others.length > 0) {
      throw new AssignmentRejected("second_open_assignment", "the driver already has another open assignment");
    }
  }
  try {
    await client.query(
      "UPDATE truck_assignments SET effective_from = $2::date, effective_to = $3::date WHERE id = $1",
      [assignmentId, effectiveFrom, effectiveTo],
    );
  } catch (err) {
    throw rejectionFor(err) ?? err;
  }
  return driverId;
}

interface AppliedChange {
  assignmentId: string;
  driverId: string;
  before: AssignmentRow[];
  after: AssignmentRow[];
  report: ReresolveReport;
}

async function driverOfAssignment(client: PoolClient, assignmentId: string): Promise<string> {
  const { rows } = isUuid(assignmentId)
    ? await client.query<{ driver_id: string }>("SELECT driver_id FROM truck_assignments WHERE id = $1", [assignmentId])
    : { rows: [] };
  if (!rows[0]) {
    throw new AssignmentRejected("assignment_not_found", `no assignment ${assignmentId}`);
  }
  return rows[0].driver_id;
}

/**
 * The change, then its consequences, on the caller's transaction: the stops
 * whose truck can differ (only the driver's, only the days whose truck changed
 * — a stop before the change keeps its truck and flags) are re-resolved and
 * their invoices' flags rebuilt. Nothing here commits.
 */
async function applyChange(client: PoolClient, change: AssignmentChange): Promise<AppliedChange> {
  const driverId = change.kind === "reassign" ? change.driverId : await driverOfAssignment(client, change.assignmentId);
  await lockDriver(client, driverId);
  const before = await loadDriverAssignments(client, driverId);

  const assignmentId =
    change.kind === "reassign"
      ? await reassignInTransaction(client, change)
      : (await editDatesInTransaction(client, change), change.assignmentId);

  const after = await loadDriverAssignments(client, driverId);
  const window = changedWindow(before, after);
  const report = window ? await reresolveInTransaction(client, windowPeriod(driverId, window)) : emptyReport(false);
  return { assignmentId, driverId, before, after, report };
}

/**
 * A *new* truck for a driver from `from` (a `YYYY-MM-DD` day), which may be in
 * the past. Closes the driver's open row the day before and opens the new one;
 * a driver with no open row just gets the new row. Rejects (as
 * `AssignmentRejected`) an unknown or inactive truck, the open row's own truck
 * (that is a date edit) and a `from` on or before the open row's start.
 *
 * In the same transaction, re-resolves the driver's stops from `from` on and
 * rebuilds their invoices' flags — stops before `from` are untouched.
 */
export async function reassignTruck(
  pool: Pool,
  input: { driverId: string; truckId: string; from: string },
): Promise<AssignmentWriteResult> {
  return inTransaction(pool, async (client) => {
    const { assignmentId, report } = await applyChange(client, { kind: "reassign", ...input });
    return { assignmentId, report };
  });
}

/**
 * Moves an existing row's start or end, either direction. The schema's
 * exclusion constraint refuses an overlap with the driver's other rows; a gap
 * is allowed (its stops become "No truck on file"). Re-resolves the stops on
 * the days whose truck changed, and rebuilds their flags, in the same transaction.
 */
export async function editAssignmentDates(
  pool: Pool,
  input: { assignmentId: string; effectiveFrom: string; effectiveTo: string | null },
): Promise<AssignmentWriteResult> {
  return inTransaction(pool, async (client) => {
    const { assignmentId, report } = await applyChange(client, { kind: "editDates", ...input });
    return { assignmentId, report };
  });
}

/**
 * Runs the same change a write would — rows, re-resolve and flag rebuild —
 * inside a transaction it always rolls back, and returns the diff: the rows
 * before and after, the stops whose truck changes and the flags that clear and
 * appear. Rejects exactly as the real write does. It informs; it does not block.
 */
export async function previewAssignmentChange(pool: Pool, change: AssignmentChange): Promise<AssignmentPreview> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { before, after, report } = await applyChange(client, change);
    return {
      assignments: { before, after },
      stops: report.stopMoves,
      flags: {
        cleared: report.flags.filter((f) => f.change === "cleared"),
        appeared: report.flags.filter((f) => f.change === "appeared"),
        changed: report.flags.filter((f) => f.change === "changed"),
      },
    };
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
