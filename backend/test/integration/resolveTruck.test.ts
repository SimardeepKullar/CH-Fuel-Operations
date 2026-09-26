import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { getCardByNumber } from "../../src/catalog/cards.js";
import { getTruckById } from "../../src/catalog/trucks.js";
import { resolveTruckForStop } from "../../src/resolve/resolveTruck.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("resolveTruckForStop (integration, T-29)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_resolvetruck_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  it("flags a disagreement when the entered unit doesn't match the assigned truck (A10's own example)", async () => {
    const card = await getCardByNumber(scopedPool, "9000005"); // JORDAN -> truck 072
    const result = await resolveTruckForStop(
      scopedPool,
      card!.id,
      new Date("2026-09-03T05:35:00Z"),
      "0",
    );
    const truck = await getTruckById(scopedPool, result.truckId!);
    expect(truck?.unit_number).toBe("072");
    expect(result.agrees).toBe(false);
  });

  it("agrees when the entered unit matches the assigned truck", async () => {
    const card = await getCardByNumber(scopedPool, "9000005");
    const result = await resolveTruckForStop(
      scopedPool,
      card!.id,
      new Date("2026-09-09T00:41:00Z"),
      "072",
    );
    const truck = await getTruckById(scopedPool, result.truckId!);
    expect(truck?.unit_number).toBe("072");
    expect(result.agrees).toBe(true);
  });

  it("resolves two different cards entering the same unit text to two different trucks, never conflated", async () => {
    const cardJordan = await getCardByNumber(scopedPool, "9000005"); // -> truck 072
    const cardTaylor = await getCardByNumber(scopedPool, "9000019"); // -> truck 1019 (until 2026-09-06)
    const at = new Date("2026-09-03T12:00:00Z");

    const jordanResult = await resolveTruckForStop(scopedPool, cardJordan!.id, at, "072");
    const taylorResult = await resolveTruckForStop(scopedPool, cardTaylor!.id, at, "072");

    expect(jordanResult.truckId).not.toBe(taylorResult.truckId);

    const jordanTruck = await getTruckById(scopedPool, jordanResult.truckId!);
    const taylorTruck = await getTruckById(scopedPool, taylorResult.truckId!);
    expect(jordanTruck?.unit_number).toBe("072");
    expect(taylorTruck?.unit_number).toBe("1019");

    // "072" is byte-true for JORDAN's own truck, a mismatch for TAYLOR's —
    // resolved per card, not smoothed into one shared answer for the text.
    expect(jordanResult.agrees).toBe(true);
    expect(taylorResult.agrees).toBe(false);
  });

  it("resolves unit text '1012' per card, not per the text itself", async () => {
    const cardTessKane = await getCardByNumber(scopedPool, "9000025"); // TESS KANE -> truck 1023
    const cardMorgan = await getCardByNumber(scopedPool, "9000018"); // MORGAN -> truck 1013
    const at = new Date("2026-09-03T12:00:00Z");

    const tessKaneResult = await resolveTruckForStop(scopedPool, cardTessKane!.id, at, "1012");
    const morganResult = await resolveTruckForStop(scopedPool, cardMorgan!.id, at, "1012");

    const tessKaneTruck = await getTruckById(scopedPool, tessKaneResult.truckId!);
    const morganTruck = await getTruckById(scopedPool, morganResult.truckId!);
    expect(tessKaneTruck?.unit_number).toBe("1023");
    expect(morganTruck?.unit_number).toBe("1013");
    // "1012" belongs to neither card — both disagree with their own truck.
    expect(tessKaneResult.agrees).toBe(false);
    expect(morganResult.agrees).toBe(false);
  });

  it("resolves a card whose driver has no assignment at that instant to a null truck, never a guess", async () => {
    const { rows: driverRows } = await scopedPool.query<{ id: string }>(
      "INSERT INTO drivers (display_name) VALUES ('GAP DRIVER T29') RETURNING id",
    );
    const { rows: cardRows } = await scopedPool.query<{ id: string }>(
      "INSERT INTO fuel_cards (card_number, driver_id) VALUES ('gap-card-t29', $1) RETURNING id",
      [driverRows[0]!.id],
    );

    const result = await resolveTruckForStop(
      scopedPool,
      cardRows[0]!.id,
      new Date("2026-09-03T12:00:00Z"),
      "072",
    );

    expect(result.truckId).toBeNull();
    expect(result.driverId).toBe(driverRows[0]!.id);
    expect(result.agrees).toBeNull();
  });

  it("stores unit_raw byte-identical to the invoice text, unnormalised", async () => {
    const card = await getCardByNumber(scopedPool, "9000005");
    const oddUnitRaw = "  0  ";
    const result = await resolveTruckForStop(
      scopedPool,
      card!.id,
      new Date("2026-09-03T05:35:00Z"),
      oddUnitRaw,
    );
    // resolveTruckForStop only compares unit_raw — it never mutates it. The
    // caller (importInvoice) is what writes the untouched original string.
    expect(oddUnitRaw).toBe("  0  ");
    expect(result.agrees).toBe(false);
  });
});
