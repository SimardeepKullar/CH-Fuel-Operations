import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { importInvoice } from "../../src/invoice/importInvoice.js";
import { runAnomalies } from "../../src/anomaly/runAnomalies.js";
import { parseInvoicePdf } from "../../src/invoice/parseInvoicePdf.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const fixturesDir = path.join(dirname, "../fixtures/invoices");
const hasDatabase = Boolean(process.env.DATABASE_URL);

const ANOMALY_CASES_CSV = () => readFileSync(path.join(fixturesDir, "anomaly-cases.csv"));
const IMBALANCED_CSV = () => readFileSync(path.join(fixturesDir, "sample-redacted-imbalanced.csv"));

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

    // The fixture's six cards. Each has a driver, so none is off the roster
    // (T-85). Only 3000002 (the unitMismatch case) needs a resolved truck
    // assignment — the others have none, which the other rules don't need.
    await scopedPool.query(
      `INSERT INTO fuel_cards (card_number) VALUES
         ('3000001'), ('3000002'), ('3000003'), ('3000004'), ('3000005'), ('3000006')`,
    );
    const { rows: driverRows } = await scopedPool.query<{ id: string }>(
      "INSERT INTO drivers (display_name) VALUES ('DRIVER MISMATCH') RETURNING id",
    );
    const driverId = driverRows[0]!.id;
    await scopedPool.query("UPDATE fuel_cards SET driver_id = $1 WHERE card_number = '3000002'", [driverId]);
    for (const card of ["3000001", "3000003", "3000004", "3000005", "3000006"]) {
      await scopedPool.query(
        `WITH d AS (INSERT INTO drivers (display_name) VALUES ($1) RETURNING id)
         UPDATE fuel_cards SET driver_id = (SELECT id FROM d) WHERE card_number = $2`,
        [`DRIVER ${card}`, card],
      );
    }
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
    // never quarantines, and the other four rules don't need one).
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
    const result = await importInvoice(scopedPool, ANOMALY_CASES_CSV(), { sourceFilename: "invoice_700001.csv" });
    expect(result.status).toBe("imported");
    if (result.status !== "imported") {
      throw new Error("fixture did not promote");
    }
    return result.invoiceId;
  }

  it("produces the expected flag count on import: one per rule plus No truck on file per truckless stop, ten total, asserted as a number", async () => {
    await importCases();

    const { rows } = await scopedPool.query<{ count: string }>("SELECT count(*) FROM anomalies");
    expect(rows[0]?.count).toBe("10");

    const { rows: byRule } = await scopedPool.query<{ rule: string; count: string }>(
      "SELECT rule, count(*) FROM anomalies GROUP BY rule ORDER BY rule",
    );
    expect(byRule).toEqual([
      { rule: "charges_no_fuel", count: "1" },
      // Cards 3000001 and 3000003-6 have a driver but no assignment (beforeEach).
      { rule: "no_truck_on_file", count: "6" },
      { rule: "sub_gallon", count: "1" },
      { rule: "too_close", count: "1" },
      { rule: "unit_mismatch", count: "1" },
    ]);
  });

  it("a unit entered without its leading zero is not a mismatch; '0' on the same truck still is", async () => {
    const invoiceId = await importCases();
    const { rows: base } = await scopedPool.query<{ card_id: string; driver_id: string }>(
      "SELECT card_id, driver_id FROM fuel_stops WHERE invoice_id = $1 AND driver_id IS NOT NULL LIMIT 1",
      [invoiceId],
    );
    const { rows: truck } = await scopedPool.query<{ id: string }>(
      "SELECT id FROM trucks WHERE unit_number = '050'", // seeded by the roster migration
    );
    const insertStop = async (authCode: string, unitRaw: string): Promise<string> => {
      const { rows } = await scopedPool.query<{ id: string }>(
        `INSERT INTO fuel_stops
           (invoice_id, base_auth_code, occurred_at, card_id, truck_id, driver_id, unit_raw, driver_name_raw, total)
         VALUES ($1, $2, '2026-02-03T10:00:00Z', $3, $4, $5, $6, 'DRIVER', 10)
         RETURNING id`,
        [invoiceId, authCode, base[0]!.card_id, truck[0]!.id, base[0]!.driver_id, unitRaw],
      );
      return rows[0]!.id;
    };
    const padless = await insertStop("T79-PADLESS", "50");
    const wrong = await insertStop("T79-ZERO", "0");

    await runAnomalies(scopedPool, invoiceId);

    const { rows } = await scopedPool.query<{ subject_id: string }>(
      "SELECT subject_id FROM anomalies WHERE rule = 'unit_mismatch' AND subject_id = ANY($1::uuid[])",
      [[padless, wrong]],
    );
    expect(rows.map((r) => r.subject_id)).toEqual([wrong]);
  });

  async function findings(): Promise<string[]> {
    const { rows } = await scopedPool.query<{ rule: string; subject_id: string; detail: unknown }>(
      "SELECT rule, subject_id, detail FROM anomalies ORDER BY rule, subject_id",
    );
    return rows.map((r) => JSON.stringify([r.rule, r.subject_id, r.detail]));
  }

  it("re-running with nothing changed writes the same set — no duplicates, none lost", async () => {
    const invoiceId = await importCases(); // runs the engine once, via importInvoice
    const before = await findings();

    const result = await runAnomalies(scopedPool, invoiceId); // run it again directly

    expect(before).toHaveLength(10);
    expect(await findings()).toEqual(before);
    expect(result).toMatchObject({ inserted: 10, removed: 10 });
  });

  it("a stale Unit mismatch is removed once the entered unit matches", async () => {
    const invoiceId = await importCases();
    const { rows } = await scopedPool.query<{ id: string }>(
      "SELECT subject_id AS id FROM anomalies WHERE rule = 'unit_mismatch'",
    );
    expect(rows).toHaveLength(1);

    await scopedPool.query("UPDATE fuel_stops SET unit_raw = '205' WHERE id = $1", [rows[0]!.id]);
    await runAnomalies(scopedPool, invoiceId);

    expect((await scopedPool.query("SELECT 1 FROM anomalies WHERE rule = 'unit_mismatch'")).rowCount).toBe(0);
    expect((await scopedPool.query("SELECT count(*) FROM anomalies")).rows[0]!.count).toBe("9");
  });

  it("a truckless stop is No truck on file with its reason and entered unit, never also a Unit mismatch", async () => {
    await importCases();

    const { rows } = await scopedPool.query<{ detail: { reason: string; unitRaw: string }; severity: string }>(
      "SELECT detail, severity FROM anomalies WHERE rule = 'no_truck_on_file'",
    );
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.severity === "amber" && r.detail.reason === "no_assignment")).toBe(true);
    expect(rows.every((r) => typeof r.detail.unitRaw === "string")).toBe(true);

    const { rows: both } = await scopedPool.query(
      `SELECT 1 FROM anomalies a JOIN anomalies b ON a.subject_id = b.subject_id
        WHERE a.rule = 'no_truck_on_file' AND b.rule = 'unit_mismatch'`,
    );
    expect(both).toHaveLength(0);
  });

  it("a stop on a card with no driver is No truck on file with reason no_driver", async () => {
    const invoiceId = await importCases();
    const { rows: card } = await scopedPool.query<{ id: string }>(
      "INSERT INTO fuel_cards (card_number) VALUES ('3000099') RETURNING id",
    );
    const { rows: stop } = await scopedPool.query<{ id: string }>(
      `INSERT INTO fuel_stops (invoice_id, base_auth_code, occurred_at, card_id, unit_raw, driver_name_raw, total)
       VALUES ($1, 'T78-NODRIVER', '2026-02-03T10:00:00Z', $2, '031', 'PAT LEFT', 10) RETURNING id`,
      [invoiceId, card[0]!.id],
    );

    await runAnomalies(scopedPool, invoiceId);

    const { rows } = await scopedPool.query<{ detail: unknown }>(
      "SELECT detail FROM anomalies WHERE rule = 'no_truck_on_file' AND subject_id = $1",
      [stop[0]!.id],
    );
    expect(rows.map((r) => r.detail)).toEqual([{ reason: "no_driver", unitRaw: "031" }]);
  });

  it("No truck on file is removed once the stop has a truck", async () => {
    const invoiceId = await importCases();
    const { rows } = await scopedPool.query<{ id: string }>(
      "SELECT subject_id AS id FROM anomalies WHERE rule = 'no_truck_on_file' LIMIT 1",
    );
    const { rows: truck } = await scopedPool.query<{ id: string }>("SELECT id FROM trucks WHERE unit_number = '205'");
    await scopedPool.query("UPDATE fuel_stops SET truck_id = $1 WHERE id = $2", [truck[0]!.id, rows[0]!.id]);

    await runAnomalies(scopedPool, invoiceId);

    expect(
      (await scopedPool.query("SELECT 1 FROM anomalies WHERE rule = 'no_truck_on_file' AND subject_id = $1", [rows[0]!.id]))
        .rowCount,
    ).toBe(0);
    expect((await scopedPool.query("SELECT count(*) FROM anomalies WHERE rule = 'no_truck_on_file'")).rows[0]!.count).toBe("5");
  });

  it("rolls back the delete when an insert fails — the earlier findings stay", async () => {
    const invoiceId = await importCases();
    const before = await findings();
    // Fail an insert after the delete has run: NOT VALID leaves the existing
    // rows alone and refuses only the new ones.
    await scopedPool.query(
      "ALTER TABLE anomalies ADD CONSTRAINT t78_no_no_truck CHECK (rule <> 'no_truck_on_file') NOT VALID",
    );

    await expect(runAnomalies(scopedPool, invoiceId)).rejects.toThrow();

    await scopedPool.query("ALTER TABLE anomalies DROP CONSTRAINT t78_no_no_truck");
    expect(await findings()).toEqual(before);
  });

  it("flags a fuel stop whose line printed no driver name, red, and only that one (T-127)", async () => {
    const pdf = readFileSync(path.join(fixturesDir, "edge-fuel-blank-driver.pdf"));
    const result = await importInvoice(scopedPool, pdf, { sourceFilename: "edge-fuel-blank-driver.pdf" }, { parse: parseInvoicePdf });
    expect(result.status).toBe("imported");

    const { rows } = await scopedPool.query<{ base_auth_code: string; severity: string; detail: unknown }>(
      `SELECT fs.base_auth_code, a.severity, a.detail FROM anomalies a
       JOIN fuel_stops fs ON fs.id = a.subject_id
       WHERE a.rule = 'driver_not_entered'`,
    );
    expect(rows).toEqual([{ base_auth_code: "B500002", severity: "red", detail: { reason: "no_driver_name" } }]);
  });

  it("a quarantined invoice produces zero anomalies", async () => {
    const result = await importInvoice(scopedPool, IMBALANCED_CSV(), { sourceFilename: "invoice_100002.csv" });
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
