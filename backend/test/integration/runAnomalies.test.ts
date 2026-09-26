import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { importInvoice } from "../../src/invoice/importInvoice.js";
import { runAnomalies } from "../../src/anomaly/runAnomalies.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const fixturesDir = path.join(dirname, "../fixtures/invoices");
const hasDatabase = Boolean(process.env.DATABASE_URL);

const ANOMALY_CASES_CSV = readFileSync(path.join(fixturesDir, "anomaly-cases.csv"));
const IMBALANCED_CSV = readFileSync(path.join(fixturesDir, "sample-redacted-imbalanced.csv"));

describe.skipIf(!hasDatabase)("runAnomalies (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_run_anomalies_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);

    // The fixture's six cards. Only 3000002 (the unitMismatch case) needs a
    // driver and a resolved truck assignment — every other card is left
    // with no assignment on purpose, which the other five rules don't need.
    await scopedPool.query(
      `INSERT INTO fuel_cards (card_number) VALUES
         ('3000001'), ('3000002'), ('3000003'), ('3000004'), ('3000005'), ('3000006')`,
    );
    const { rows: driverRows } = await scopedPool.query<{ id: string }>(
      "INSERT INTO drivers (display_name) VALUES ('DRIVER MISMATCH') RETURNING id",
    );
    const driverId = driverRows[0]!.id;
    await scopedPool.query("UPDATE fuel_cards SET driver_id = $1 WHERE card_number = '3000002'", [driverId]);
    const { rows: truckRows } = await scopedPool.query<{ id: string }>(
      "INSERT INTO trucks (unit_number) VALUES ('205') RETURNING id",
    );
    await scopedPool.query(
      "INSERT INTO truck_assignments (driver_id, truck_id, effective_from, effective_to) VALUES ($1, $2, '2026-01-01', NULL)",
      [driverId, truckRows[0]!.id],
    );

    // Card 3000003's pair (the tooClose case) only groups by station once
    // "LOVES #275" resolves to a real `stations` row — every other card's
    // station text is left unresolved on purpose (T-29: a station miss
    // never quarantines, and the other five rules don't need one).
    await scopedPool.query(
      `INSERT INTO stations (supplier, site_ref, name_raw, city_raw, city_normalized, state_usps)
       VALUES ('BVD', '40275', 'LOVES #275', 'SPRINGFIELD', 'SPRINGFIELD', 'MO')`,
    );
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  async function importCases(): Promise<string> {
    const result = await importInvoice(scopedPool, ANOMALY_CASES_CSV, { sourceFilename: "invoice_700001.csv" });
    expect(result.status).toBe("imported");
    if (result.status !== "imported") {
      throw new Error("fixture did not promote");
    }
    return result.invoiceId;
  }

  it("produces the expected flag count on import: one anomaly per rule, five total, asserted as a number", async () => {
    await importCases();

    const { rows } = await scopedPool.query<{ count: string }>("SELECT count(*) FROM anomalies");
    expect(rows[0]?.count).toBe("5");

    const { rows: byRule } = await scopedPool.query<{ rule: string; count: string }>(
      "SELECT rule, count(*) FROM anomalies GROUP BY rule ORDER BY rule",
    );
    expect(byRule).toEqual([
      { rule: "charges_no_fuel", count: "1" },
      { rule: "def_ratio", count: "1" },
      { rule: "sub_gallon", count: "1" },
      { rule: "too_close", count: "1" },
      { rule: "unit_mismatch", count: "1" },
    ]);
  });

  it("re-running produces no duplicates", async () => {
    const invoiceId = await importCases(); // runs the engine once, via importInvoice
    await runAnomalies(scopedPool, invoiceId); // run it again directly

    const { rows } = await scopedPool.query<{ count: string }>("SELECT count(*) FROM anomalies");
    expect(rows[0]?.count).toBe("5");
  });

  it("a dismissed anomaly stays dismissed after a re-run", async () => {
    const invoiceId = await importCases();
    await scopedPool.query("UPDATE anomalies SET dismissed_at = now() WHERE rule = 'sub_gallon'");

    await runAnomalies(scopedPool, invoiceId);

    const { rows } = await scopedPool.query<{ dismissed_at: Date | null }>(
      "SELECT dismissed_at FROM anomalies WHERE rule = 'sub_gallon'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dismissed_at).not.toBeNull();
  });

  it("changing a threshold in the database changes the outcome with no code change", async () => {
    const invoiceId = await importCases();
    const before = await scopedPool.query<{ count: string }>("SELECT count(*) FROM anomalies");
    expect(before.rows[0]?.count).toBe("5");

    // Card 3000006 (the negative control) sits at a 3% DEF ratio — below the
    // seeded 5% threshold, so it isn't flagged yet. Tightening the threshold
    // below 3% must flag it on the very next run, with zero code changes.
    await scopedPool.query(
      "UPDATE anomaly_thresholds SET config = '{\"maxRatio\": 0.02, \"fuelProductCode\": \"TA\", \"defProductCode\": \"DF\"}' WHERE rule = 'def_ratio'",
    );
    await runAnomalies(scopedPool, invoiceId);

    const after = await scopedPool.query<{ count: string }>("SELECT count(*) FROM anomalies");
    expect(after.rows[0]?.count).toBe("6");

    const { rows: defRatioRows } = await scopedPool.query<{ count: string }>(
      "SELECT count(*) FROM anomalies WHERE rule = 'def_ratio'",
    );
    expect(defRatioRows[0]?.count).toBe("2");
  });

  it("a quarantined invoice produces zero anomalies", async () => {
    const result = await importInvoice(scopedPool, IMBALANCED_CSV, { sourceFilename: "invoice_100002.csv" });
    expect(result.status).toBe("quarantined");
    if (result.status !== "quarantined") {
      throw new Error("fixture did not quarantine");
    }

    const { rows } = await scopedPool.query<{ count: string }>(
      "SELECT count(*) FROM anomalies WHERE subject_id IN (SELECT id FROM fuel_stops WHERE invoice_id = $1)",
      [result.invoiceId],
    );
    expect(rows[0]?.count).toBe("0");

    const total = await scopedPool.query<{ count: string }>("SELECT count(*) FROM anomalies");
    expect(total.rows[0]?.count).toBe("0");
  });
});
