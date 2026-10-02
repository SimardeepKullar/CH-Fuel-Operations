import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const realMigrationsDir = path.join(dirname, "../../../migrations/real");
const realCaPdfPath = path.join(dirname, "../../../data/bvd-invoices/BVD_invoice_999217.pdf");
const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRealRoster = existsSync(path.join(realMigrationsDir, "0005_fleet_roster_seed.sql"));
const hasRealCaInvoice = existsSync(realCaPdfPath);

/** Migrates a fresh scoped schema from `dir`; the caller ends the pool and drops the schema. */
async function migratedSchema(dir: string, prefix: string) {
  const schema = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema},public`,
  });
  await runMigrations(pool, dir);
  return {
    pool,
    async drop() {
      await pool.end();
      await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await adminPool.end();
    },
  };
}

/** Row counts across the roster tables — the shape both migration sets must share. */
async function rosterCounts(pool: Pool) {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM drivers) AS drivers,
            (SELECT count(*) FROM fuel_cards) AS cards,
            (SELECT count(*) FROM fuel_cards WHERE driver_id IS NOT NULL) AS cards_with_driver,
            (SELECT count(*) FROM trucks) AS trucks,
            (SELECT count(*) FROM truck_assignments) AS assignments,
            (SELECT count(*) FROM truck_assignments WHERE effective_to IS NULL) AS current_assignments,
            (SELECT array_agg(unit_number ORDER BY unit_number) FROM trucks) AS units`,
  );
  return rows[0];
}

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

  it("seeds 48 drivers, 48 cards (each with its driver) and 47 trucks with 42 current truck assignments", async () => {
    // The US invoice's 27 cards/drivers/trucks (26 current assignments, not
    // 27: TAYLOR handed truck 1019 off to FINN GRAY on 2026-09-07 and the
    // seed does not give TAYLOR a new truck, so 28 assignment rows hold two
    // superseded ones), plus T-62's CA additions: 21 cards and drivers, 20
    // trucks and 16 assignments — the other 5 new drivers get none.
    expect(await counts()).toEqual({
      drivers: 48,
      cards: 48,
      cardsWithDriver: 48,
      trucks: 47,
      currentAssignments: 42,
    });
  });

  it("assigns the 16 single-unit CA drivers from 2026-09-03 and leaves the 5 multi- or shared-unit ones unassigned (T-62)", async () => {
    const { rows } = await scopedPool.query<{ card_number: string; units: string[] }>(
      `SELECT fc.card_number,
              COALESCE(array_agg(t.unit_number ORDER BY t.unit_number)
                       FILTER (WHERE t.id IS NOT NULL), '{}') AS units
         FROM fuel_cards fc
         LEFT JOIN truck_assignments ta ON ta.driver_id = fc.driver_id
         LEFT JOIN trucks t ON t.id = ta.truck_id
        WHERE fc.card_number BETWEEN '9000028' AND '9000048'
        GROUP BY fc.card_number
        ORDER BY fc.card_number`,
    );
    expect(rows).toHaveLength(21);
    const unassigned = rows.filter((r) => r.units.length === 0).map((r) => r.card_number);
    // 067/1017/056; 1002/062; 062; 031; 031.
    expect(unassigned).toEqual(["9000030", "9000032", "9000033", "9000042", "9000047"]);
    expect(rows.filter((r) => r.units.length === 1)).toHaveLength(16);

    const dates = await scopedPool.query<{ effective_from: string }>(
      `SELECT DISTINCT to_char(ta.effective_from, 'YYYY-MM-DD') AS effective_from
         FROM truck_assignments ta
         JOIN fuel_cards fc ON fc.driver_id = ta.driver_id
        WHERE fc.card_number BETWEEN '9000028' AND '9000048'`,
    );
    expect(dates.rows).toEqual([{ effective_from: "2026-09-03" }]);
  });

  it("adds 074 as a truck without assigning it — its CA driver keeps their existing truck (T-62)", async () => {
    const { rows } = await scopedPool.query<{ count: string }>(
      `SELECT count(*) FROM truck_assignments ta
         JOIN trucks t ON t.id = ta.truck_id
        WHERE t.unit_number = '074'`,
    );
    expect(rows[0]!.count).toBe("0");
    expect((await scopedPool.query("SELECT 1 FROM trucks WHERE unit_number = '074'")).rowCount).toBe(1);
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

describe.skipIf(!hasDatabase || !hasRealRoster)("0005 real vs synthetic parity (integration, local real roster only)", () => {
  it("both sets produce identical counts and identical unit numbers (T-62)", async () => {
    const synthetic = await migratedSchema(migrationsDir, "test_roster_synthetic");
    const real = await migratedSchema(realMigrationsDir, "test_roster_real");
    try {
      expect(await rosterCounts(real.pool)).toEqual(await rosterCounts(synthetic.pool));
    } finally {
      await synthetic.drop();
      await real.drop();
    }
  });
});

describe.skipIf(!hasDatabase || !hasRealRoster || !hasRealCaInvoice)(
  "0005 against the real CA invoice 999217 (integration, local fixture only)",
  () => {
    // Card numbers are read off the PDF's "Transactions for card" lines
    // directly: the invoice parser cannot read a CN invoice until T-61.
    async function cardNumbersOn999217(): Promise<string[]> {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: await readFile(realCaPdfPath) });
      try {
        const { text } = await parser.getText();
        const cards = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => /^Transactions for card/i.test(line))
          .map((line) => line.split(/[\t ]+/).at(-1)!);
        return [...new Set(cards)];
      } finally {
        await parser.destroy();
      }
    }

    it("every one of its 34 cards resolves to a driver (T-62)", async () => {
      const cards = await cardNumbersOn999217();
      expect(cards).toHaveLength(34);

      const real = await migratedSchema(realMigrationsDir, "test_roster_999217");
      try {
        const { rows } = await real.pool.query<{ card_number: string }>(
          `SELECT card_number FROM fuel_cards
            WHERE card_number = ANY($1::text[]) AND driver_id IS NOT NULL`,
          [cards],
        );
        // Compare counts, not lists: a failure must not print card numbers.
        expect(rows.length).toBe(34);
      } finally {
        await real.drop();
      }
    }, 30_000);
  },
);
