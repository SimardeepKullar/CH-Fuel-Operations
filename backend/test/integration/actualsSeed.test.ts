import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTruckDetail } from "../../src/actuals/trucks.js";
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

  it("seeds 48 drivers, 48 cards (each with its driver) and 49 trucks with 47 current truck assignments", async () => {
    // 27 US and 21 CA cards and drivers. Every driver but one holds exactly one
    // current assignment (T-78): 47, the one truckless driver being COLE WINTER.
    // The trucks are 27 + 20 from the invoices, plus 1020 and 1021, invented.
    expect(await counts()).toEqual({
      drivers: 48,
      cards: 48,
      cardsWithDriver: 48,
      trucks: 49,
      currentAssignments: 47,
    });
  });

  it("gives every driver at most one open assignment, and exactly one driver none (T-78)", async () => {
    const { rows } = await scopedPool.query<{ display_name: string; open_rows: string }>(
      `SELECT d.display_name,
              count(ta.id) FILTER (WHERE ta.effective_to IS NULL) AS open_rows
         FROM drivers d LEFT JOIN truck_assignments ta ON ta.driver_id = d.id
        GROUP BY d.id, d.display_name
       HAVING count(ta.id) FILTER (WHERE ta.effective_to IS NULL) <> 1`,
    );
    expect(rows).toEqual([{ display_name: "COLE WINTER", open_rows: "0" }]);
  });

  it("has exactly one team truck (two drivers holding it now) — 072 (T-78)", async () => {
    const { rows } = await scopedPool.query<{ unit_number: string; drivers: string }>(
      `SELECT t.unit_number, count(*) AS drivers
         FROM truck_assignments ta JOIN trucks t ON t.id = ta.truck_id
        WHERE ta.effective_to IS NULL
        GROUP BY t.unit_number HAVING count(*) > 1`,
    );
    expect(rows).toEqual([{ unit_number: "072", drivers: "2" }]);
  });

  it("truck detail for the team truck lists both its drivers as current (T-78)", async () => {
    const { rows } = await scopedPool.query<{ id: string }>("SELECT id FROM trucks WHERE unit_number = '072'");

    const detail = await getTruckDetail(scopedPool, rows[0]!.id, { week: "2026-09-09", currency: "USD", units: null });

    expect(detail!.currentDrivers.map((d) => d.driver.displayName).sort()).toEqual(["HARPER LANE", "JORDAN"]);
    expect(detail!.assignments).toHaveLength(2);
  });

  it("has no dated handovers: the only closed assignment is one invented past reassignment (T-78)", async () => {
    const { rows } = await scopedPool.query<{ driver: string; unit_number: string; effective_to: string }>(
      `SELECT d.display_name AS driver, t.unit_number, to_char(ta.effective_to, 'YYYY-MM-DD') AS effective_to
         FROM truck_assignments ta
         JOIN drivers d ON d.id = ta.driver_id JOIN trucks t ON t.id = ta.truck_id
        WHERE ta.effective_to IS NOT NULL`,
    );
    expect(rows).toEqual([{ driver: "SAWYER", unit_number: "1021", effective_to: "2026-03-31" }]);
  });

  it("keeps a borrow a borrow: FINN GRAY's own truck is not the 1019 they entered (T-78)", async () => {
    const { rows } = await scopedPool.query<{ driver: string; unit_number: string }>(
      `SELECT d.display_name AS driver, t.unit_number
         FROM truck_assignments ta
         JOIN drivers d ON d.id = ta.driver_id JOIN trucks t ON t.id = ta.truck_id
        WHERE d.display_name IN ('TAYLOR', 'FINN GRAY', 'KIT BARNES') AND ta.effective_to IS NULL
        ORDER BY d.display_name`,
    );
    expect(rows).toEqual([
      { driver: "FINN GRAY", unit_number: "1020" },
      { driver: "KIT BARNES", unit_number: "101" },
      { driver: "TAYLOR", unit_number: "1019" },
    ]);
  });

  it("assigns the CA drivers from 2026-09-03 and leaves one, COLE WINTER, unassigned (T-62, T-78)", async () => {
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
    expect(unassigned).toEqual(["9000030"]);
    expect(rows.filter((r) => r.units.length === 1)).toHaveLength(20);

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

describe.skipIf(!hasDatabase || !hasRealRoster)("0005 real roster shape (integration, local real roster only)", () => {
  // The real roster is the owner's list and no longer mirrors the synthetic
  // set's size (T-78 step 78.5): one driver per card, one open assignment each.
  it("every driver has one card and exactly one current assignment", async () => {
    const real = await migratedSchema(realMigrationsDir, "test_roster_real");
    try {
      const counts = await rosterCounts(real.pool);
      expect(counts.cards).toBe(counts.drivers);
      expect(counts.cards_with_driver).toBe(counts.drivers);
      expect(counts.assignments).toBe(counts.drivers);
      expect(counts.current_assignments).toBe(counts.drivers);
    } finally {
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

    it("31 of its 34 cards are on the current roster; the others left the fleet (T-85)", async () => {
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
        expect(rows.length).toBe(31);
      } finally {
        await real.drop();
      }
    }, 30_000);
  },
);
