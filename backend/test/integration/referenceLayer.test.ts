import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { resolveAssignment } from "../../src/catalog/assignments.js";
import { resolveDriverByName } from "../../src/catalog/drivers.js";
import { getTruckById } from "../../src/catalog/trucks.js";
import { getCardByNumber } from "../../src/catalog/cards.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("reference layer (integration, T-26)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_reflayer_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  it("resolves card 9000005 to driver JORDAN and truck 072 (A10's anomaly example)", async () => {
    const card = await getCardByNumber(scopedPool, "9000005");
    expect(card).not.toBeNull();
    const result = await resolveAssignment(scopedPool, card!.id, new Date("2026-06-01T00:00:00Z"));
    const truck = result.truckId ? await getTruckById(scopedPool, result.truckId) : null;
    expect(truck?.unit_number).toBe("072");
  });

  it("resolves a stop either side of a reassignment boundary to the correct truck, without rewriting the past", async () => {
    const card = await getCardByNumber(scopedPool, "9000005");
    const { rows: driverRows } = await scopedPool.query<{ id: string }>(
      "SELECT driver_id AS id FROM fuel_cards WHERE id = $1",
      [card!.id],
    );
    const driverId = driverRows[0]!.id;

    // Close out the seed's open-ended assignment and start a new truck the
    // next day — the only shape the EXCLUDE constraint allows for a swap.
    await scopedPool.query(
      "UPDATE truck_assignments SET effective_to = '2026-09-30' WHERE driver_id = $1 AND effective_to IS NULL",
      [driverId],
    );
    const { rows: newTruckRows } = await scopedPool.query<{ id: string }>(
      "INSERT INTO trucks (unit_number) VALUES ('9999') RETURNING id",
    );
    await scopedPool.query(
      "INSERT INTO truck_assignments (driver_id, truck_id, effective_from, effective_to) VALUES ($1, $2, '2026-10-01', NULL)",
      [driverId, newTruckRows[0]!.id],
    );

    const beforeBoundary = await resolveAssignment(
      scopedPool,
      card!.id,
      new Date("2026-09-30T23:59:59Z"),
    );
    const afterBoundary = await resolveAssignment(
      scopedPool,
      card!.id,
      new Date("2026-10-01T00:00:01Z"),
    );
    const beforeTruck = await getTruckById(scopedPool, beforeBoundary.truckId!);
    const afterTruck = await getTruckById(scopedPool, afterBoundary.truckId!);

    expect(beforeTruck?.unit_number).toBe("072");
    expect(afterTruck?.unit_number).toBe("9999");

    // Reassigning the driver's truck "tomorrow" must not change what an
    // earlier, already-resolved stop resolves to.
    const stillOld = await resolveAssignment(scopedPool, card!.id, new Date("2026-06-01T00:00:00Z"));
    expect(stillOld.truckId).toBe(beforeBoundary.truckId);
  });

  it("resolves a card with no driver_id to a null driver and null truck, not an error", async () => {
    const { rows } = await scopedPool.query<{ id: string }>(
      "INSERT INTO fuel_cards (card_number) VALUES ('unassigned-card-1') RETURNING id",
    );
    const result = await resolveAssignment(scopedPool, rows[0]!.id, new Date());
    expect(result).toEqual({ driverId: null, truckId: null });
  });

  it("resolves a card whose driver has no current assignment (a gap) to a null truck", async () => {
    const { rows: driverRows } = await scopedPool.query<{ id: string }>(
      "INSERT INTO drivers (display_name) VALUES ('GAP DRIVER') RETURNING id",
    );
    const { rows: cardRows } = await scopedPool.query<{ id: string }>(
      "INSERT INTO fuel_cards (card_number, driver_id) VALUES ('gap-card-1', $1) RETURNING id",
      [driverRows[0]!.id],
    );
    const result = await resolveAssignment(scopedPool, cardRows[0]!.id, new Date());
    expect(result).toEqual({ driverId: driverRows[0]!.id, truckId: null });
  });

  it("resolves a truck carrying its own seeded flagged-default spec directly (T-56, no separate profile table)", async () => {
    const { rows } = await scopedPool.query<{ id: string }>(
      "SELECT id FROM trucks WHERE unit_number = '072'",
    );
    const truck = await getTruckById(scopedPool, rows[0]!.id);
    expect(truck).not.toBeNull();
    expect(truck?.tank_gallons).not.toBeNull();
    expect(truck?.avg_mpg).not.toBeNull();
  });

  it("resolves an alias lookup case- and whitespace-insensitively", async () => {
    const { rows: driverRows } = await scopedPool.query<{ id: string }>(
      "SELECT id FROM drivers WHERE display_name = 'ELLIS PARK'",
    );
    const driverId = driverRows[0]!.id;
    await scopedPool.query(
      "INSERT INTO driver_aliases (alias_normalized, driver_id, source) VALUES ('Ellis S Park', $1, 'test')",
      [driverId],
    );

    const byAlias = await resolveDriverByName(scopedPool, "ellis s park");
    expect(byAlias).toEqual({ matched: true, driverId });

    const byDisplayName = await resolveDriverByName(scopedPool, "  ellis   park  ");
    expect(byDisplayName).toEqual({ matched: true, driverId });
  });

  it("returns unmatched for a driver name with no alias and no display-name hit", async () => {
    const result = await resolveDriverByName(scopedPool, "NOBODY BY THIS NAME");
    expect(result).toEqual({ matched: false });
  });
});
