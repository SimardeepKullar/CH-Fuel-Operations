import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("0005_fleet_roster_seed.sql (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_actuals_seed_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  async function counts() {
    const { rows } = await scopedPool.query<{
      drivers: string;
      cards: string;
      cards_with_driver: string;
      trucks: string;
      current_assignments: string;
    }>(
      `SELECT (SELECT count(*) FROM drivers) AS drivers,
              (SELECT count(*) FROM fuel_cards) AS cards,
              (SELECT count(*) FROM fuel_cards WHERE driver_id IS NOT NULL) AS cards_with_driver,
              (SELECT count(*) FROM trucks) AS trucks,
              (SELECT count(*) FROM truck_assignments WHERE effective_to IS NULL) AS current_assignments`,
    );
    const row = rows[0];
    if (!row) throw new Error("count query returned no rows");
    return {
      drivers: Number(row.drivers),
      cards: Number(row.cards),
      cardsWithDriver: Number(row.cards_with_driver),
      trucks: Number(row.trucks),
      currentAssignments: Number(row.current_assignments),
    };
  }

  it("seeds 27 drivers, 27 cards (each with its driver) and 27 trucks with 26 current truck assignments", async () => {
    // 26, not 27: TAYLOR handed truck 1019 off to FINN GRAY on 2026-09-07
    // (real invoice data) and the seed does not give TAYLOR a new truck, so
    // 27 drivers produce 28 assignment rows (two are TAYLOR's and KIT
    // BARNES's superseded historical rows) but only 26 are current.
    expect(await counts()).toEqual({
      drivers: 27,
      cards: 27,
      cardsWithDriver: 27,
      trucks: 27,
      currentAssignments: 26,
    });
  });

  it("re-running the seed file does not duplicate any row", async () => {
    const before = await counts();
    const sql = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(migrationsDir, "0005_fleet_roster_seed.sql"), "utf8"),
    );
    await scopedPool.query(sql);
    expect(await counts()).toEqual(before);
  });

  it("resolves card 9000005 to truck 072 and driver JORDAN (A10's anomaly example, T-29's own test)", async () => {
    const { rows } = await scopedPool.query<{
      unit_number: string;
      display_name: string;
    }>(
      `SELECT t.unit_number, d.display_name
         FROM fuel_cards fc
         JOIN drivers d ON d.id = fc.driver_id
         JOIN truck_assignments ta ON ta.driver_id = d.id AND ta.effective_to IS NULL
         JOIN trucks t ON t.id = ta.truck_id
        WHERE fc.card_number = '9000005'`,
    );
    expect(rows[0]).toEqual({ unit_number: "072", display_name: "JORDAN" });
  });
});
