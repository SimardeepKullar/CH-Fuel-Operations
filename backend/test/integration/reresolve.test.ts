import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { getCardByNumber } from "../../src/catalog/cards.js";
import { reresolve } from "../../src/resolve/reresolve.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

interface Fixture {
  fuelStopId: string;
  originalTruckId: string;
  correctedTruckId: string;
  driverId: string;
}

async function seedFuelStop(pool: Pool): Promise<Fixture> {
  const card = await getCardByNumber(pool, "9000005"); // JORDAN -> truck 072
  const { rows: driverRows } = await pool.query<{ id: string }>(
    "SELECT driver_id AS id FROM fuel_cards WHERE id = $1",
    [card!.id],
  );
  const driverId = driverRows[0]!.id;
  const { rows: originalTruckRows } = await pool.query<{ id: string }>(
    "SELECT id FROM trucks WHERE unit_number = '072'",
  );
  const originalTruckId = originalTruckRows[0]!.id;

  const { rows: invoiceRows } = await pool.query<{ id: string }>(
    `INSERT INTO invoices (invoice_number, period_start, period_end, billing_week_end, invoice_date, due_date, currency, qty_unit, grand_total, status, file_sha256)
     VALUES ('re-resolve-test', '2026-09-01', '2026-09-07', '2026-09-07', '2026-09-08', '2026-09-09', 'USD', 'gal', 100.00, 'imported', repeat('a', 64))
     RETURNING id`,
  );

  const { rows: fuelStopRows } = await pool.query<{ id: string }>(
    `INSERT INTO fuel_stops
       (invoice_id, base_auth_code, occurred_at, card_id, truck_id, driver_id, unit_raw, driver_name_raw, total)
     VALUES ($1, 'B900001-TA', '2026-09-03T05:35:00Z', $2, $3, $4, '072', 'JORDAN', 100.00)
     RETURNING id`,
    [invoiceRows[0]!.id, card!.id, originalTruckId, driverId],
  );

  // A late correction: the truck actually assigned to JORDAN for this
  // period turns out to be a different unit than originally recorded.
  const { rows: correctedTruckRows } = await pool.query<{ id: string }>(
    "INSERT INTO trucks (unit_number) VALUES ('9999') RETURNING id",
  );

  return {
    fuelStopId: fuelStopRows[0]!.id,
    originalTruckId,
    correctedTruckId: correctedTruckRows[0]!.id,
    driverId,
  };
}

describe.skipIf(!hasDatabase)("reresolve (integration, T-29)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_reresolve_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("does not change a stored stop when an assignment is edited — only the job does that", async () => {
    const fixture = await seedFuelStop(scopedPool);

    await scopedPool.query("UPDATE truck_assignments SET truck_id = $1 WHERE driver_id = $2", [
      fixture.correctedTruckId,
      fixture.driverId,
    ]);

    const { rows } = await scopedPool.query<{ truck_id: string }>(
      "SELECT truck_id FROM fuel_stops WHERE id = $1",
      [fixture.fuelStopId],
    );
    expect(rows[0]?.truck_id).toBe(fixture.originalTruckId);
  });

  it("re-resolves affected stops when run, and names the change in its diff", async () => {
    const fixture = await seedFuelStop(scopedPool);
    await scopedPool.query("UPDATE truck_assignments SET truck_id = $1 WHERE driver_id = $2", [
      fixture.correctedTruckId,
      fixture.driverId,
    ]);

    const report = await reresolve(scopedPool);

    expect(report.changes).toEqual([
      expect.objectContaining({
        subjectType: "fuel_stop",
        subjectId: fixture.fuelStopId,
        field: "truck_id",
        before: fixture.originalTruckId,
        after: fixture.correctedTruckId,
      }),
    ]);

    const { rows } = await scopedPool.query<{ truck_id: string }>(
      "SELECT truck_id FROM fuel_stops WHERE id = $1",
      [fixture.fuelStopId],
    );
    expect(rows[0]?.truck_id).toBe(fixture.correctedTruckId);
  });

  it("is a no-op on a second run with no intervening edit", async () => {
    const fixture = await seedFuelStop(scopedPool);
    await scopedPool.query("UPDATE truck_assignments SET truck_id = $1 WHERE driver_id = $2", [
      fixture.correctedTruckId,
      fixture.driverId,
    ]);

    await reresolve(scopedPool);
    const second = await reresolve(scopedPool);

    expect(second.changes).toEqual([]);
  });

  it("never touches unit_raw while re-resolving truck_id", async () => {
    const fixture = await seedFuelStop(scopedPool);
    await scopedPool.query("UPDATE truck_assignments SET truck_id = $1 WHERE driver_id = $2", [
      fixture.correctedTruckId,
      fixture.driverId,
    ]);

    await reresolve(scopedPool);

    const { rows } = await scopedPool.query<{ unit_raw: string }>(
      "SELECT unit_raw FROM fuel_stops WHERE id = $1",
      [fixture.fuelStopId],
    );
    expect(rows[0]?.unit_raw).toBe("072");
  });
});
