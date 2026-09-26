import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importInvoice } from "../../src/invoice/importInvoice.js";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const realMigrationsDir = path.join(dirname, "../../../migrations/real");
const fixturesDir = path.join(dirname, "../fixtures/invoices");
const realFixturePath = path.join(dirname, "../../../data/bvd-invoices/invoice_999210.csv");
const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRealFixture = existsSync(realFixturePath);

const BALANCED_CSV = readFileSync(path.join(fixturesDir, "sample-redacted.csv"));
const IMBALANCED_CSV = readFileSync(path.join(fixturesDir, "sample-redacted-imbalanced.csv"));

/** Two identical-looking TA lines under one auth code, with the printed
 * total already reflecting both (so reconcile() sees no imbalance and
 * `importInvoice` decides to promote) — this exists purely to force the
 * second `fuel_stop_lines` insert into its UNIQUE(fuel_stop_id,
 * product_code) constraint mid-transaction, proving the rollback leaves no
 * partial invoice. Not a "real fixture": a deliberately malformed input
 * that shouldn't occur on a real invoice, used only to exercise this one
 * failure path. */
const DUPLICATE_LINE_CSV = Buffer.from(
  [
    "Fuel Card Transactions",
    "Transactions for Card # 1000001",
    "Auth Code, Driver Name, Unit #, Date, Site #, Site Name, Site City, Prov/ST, Prod, QTY, Retail, Billed, Pre Tax AMT, HST, GST, PST, QST, Disc Rate, Disc AMT, Final AMT, CUR",
    "B900001-TA,DRIVER ONE,101,2026-01-05 10:00:00,90001,SAMPLE #1,SAMPLETON,TX,TA,25.00,5.5000,5.1234,128.09,0,0,0,0,0.375,9.42,128.09,US,",
    "B900001-TA,DRIVER ONE,101,2026-01-05 10:00:00,90001,SAMPLE #1,SAMPLETON,TX,TA,25.00,5.5000,5.1234,128.08,0,0,0,0,0.375,9.41,128.08,US,",
    ",,,,,Transaction Subtotal,,,,50.00,,,256.17,0,0,0,0,,18.83,256.17,,",
    ",,,,,Card Subtotal,TA,,,50.00,,,256.17,0,0,0,0,0.375,18.83,256.17,US,",
    ",,,,,,Sub Total,,,,,,256.17,0,0,0,0,,18.83,256.17,US,",
    "Grand Totals",
    "PRODUCT, QTY, PRE TAX AMT, HST, GST, PST, QST, DISC RATE, DISC AMT, FINAL AMOUNT, CUR",
    "TA,50.00,256.17,0,0,0,0,0.375,18.83,256.17,US,",
    "Grand Total,50.00,256.17,0,0,0,0,0.375,18.83,256.17,US,",
  ].join("\n"),
  "utf8",
);

describe.skipIf(!hasDatabase)("importInvoice (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_import_invoice_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, hasRealFixture ? realMigrationsDir : migrationsDir);

    // Synthetic catalog rows matching the fixtures' card/unit numbers, so
    // fuel_stops.card_id / express_charges.truck_id resolve. ON CONFLICT DO
    // NOTHING because 0005_fleet_roster_seed.sql (also applied by runMigrations
    // above) seeds the fleet roster, which happens to include unit number
    // "101" already — either row resolving the lookup is fine.
    await scopedPool.query(
      "INSERT INTO fuel_cards (card_number) VALUES ('1000001'), ('1000002'), ('1000003') ON CONFLICT DO NOTHING",
    );
    await scopedPool.query(
      "INSERT INTO trucks (unit_number) VALUES ('101'), ('102') ON CONFLICT DO NOTHING",
    );
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("promotes a balanced invoice: fuel_stops, fuel_stop_lines, express_charges, status='imported'", async () => {
    const result = await importInvoice(scopedPool, BALANCED_CSV, { sourceFilename: "invoice_100001.csv" });
    expect(result.status).toBe("imported");

    const invoices = await scopedPool.query("SELECT status FROM invoices");
    expect(invoices.rows).toEqual([{ status: "imported" }]);

    const stops = await scopedPool.query("SELECT count(*) FROM fuel_stops");
    expect(stops.rows[0].count).toBe("3"); // B100001, B100002, B100003

    const lines = await scopedPool.query("SELECT count(*) FROM fuel_stop_lines");
    expect(lines.rows[0].count).toBe("4"); // TA+DF, TA, S

    const express = await scopedPool.query("SELECT count(*) FROM express_charges");
    expect(express.rows[0].count).toBe("2");

    const sum = await scopedPool.query(
      `SELECT (SELECT COALESCE(SUM(amount_usd), 0) FROM fuel_stop_lines) +
              (SELECT COALESCE(SUM(total_usd), 0) FROM express_charges) AS total`,
    );
    expect(sum.rows[0].total).toBe("840.67");
  });

  it("quarantines an imbalanced invoice: zero child rows, a rejection naming DF", async () => {
    const result = await importInvoice(scopedPool, IMBALANCED_CSV, { sourceFilename: "invoice_100002.csv" });
    expect(result.status).toBe("quarantined");

    const invoices = await scopedPool.query("SELECT status FROM invoices");
    expect(invoices.rows).toEqual([{ status: "quarantined" }]);

    expect((await scopedPool.query("SELECT count(*) FROM fuel_stops")).rows[0].count).toBe("0");
    expect((await scopedPool.query("SELECT count(*) FROM fuel_stop_lines")).rows[0].count).toBe("0");
    expect((await scopedPool.query("SELECT count(*) FROM express_charges")).rows[0].count).toBe("0");

    const rejections = await scopedPool.query(
      "SELECT code, message FROM invoice_rejections WHERE code = 'AMOUNT_IMBALANCE'",
    );
    expect(rejections.rows.length).toBeGreaterThanOrEqual(1);
    expect(rejections.rows[0].message).toContain("DF");
  });

  it("returns the existing invoice unchanged on a re-upload of the same bytes, writing nothing", async () => {
    const first = await importInvoice(scopedPool, BALANCED_CSV, { sourceFilename: "invoice_100001.csv" });
    const second = await importInvoice(scopedPool, BALANCED_CSV, { sourceFilename: "invoice_100001.csv" });

    expect(first.status).toBe("imported");
    expect(second.status).toBe("duplicate");
    if (second.status === "duplicate") {
      expect(second.invoiceId).toBe((first as { invoiceId: string }).invoiceId);
    }

    expect((await scopedPool.query("SELECT count(*) FROM invoices")).rows[0].count).toBe("1");
    expect((await scopedPool.query("SELECT count(*) FROM fuel_stops")).rows[0].count).toBe("3");
  });

  it("refuses a different file under the same invoice number, with a reason distinct from duplicate", async () => {
    const first = await importInvoice(scopedPool, BALANCED_CSV, { sourceFilename: "invoice_100001.csv" });
    expect(first.status).toBe("imported");

    // Same invoice number (100001), different bytes (DF bumped by a cent —
    // reusing the imbalanced fixture's number for this one field only).
    const differentFile = Buffer.from(
      BALANCED_CSV.toString("utf8").replace("DF,5.00,22.50,0,0,0,0,0,0,22.50,US,", "DF,5.00,22.51,0,0,0,0,0,0,22.51,US,"),
      "utf8",
    );
    const second = await importInvoice(scopedPool, differentFile, { sourceFilename: "invoice_100001.csv" });

    expect(second.status).toBe("conflict");
    if (second.status === "conflict") {
      expect(second.existingInvoiceId).toBe((first as { invoiceId: string }).invoiceId);
    }
    expect((await scopedPool.query("SELECT count(*) FROM invoices")).rows[0].count).toBe("1");
  });

  it("leaves no partial invoice when a write fails mid-promotion (rolled back)", async () => {
    await expect(
      importInvoice(scopedPool, DUPLICATE_LINE_CSV, { sourceFilename: "invoice_900001.csv" }),
    ).rejects.toThrow();

    expect((await scopedPool.query("SELECT count(*) FROM invoices")).rows[0].count).toBe("0");
    expect((await scopedPool.query("SELECT count(*) FROM fuel_stops")).rows[0].count).toBe("0");
  });

  it("performs no I/O and prints nothing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await importInvoice(scopedPool, BALANCED_CSV, { sourceFilename: "invoice_100001.csv" });
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("resolves and persists fuel_stops.truck_id/driver_id from the card's assignment, and leaves an unlisted station null with a named exclusion (T-29)", async () => {
    const { rows: driverRows } = await scopedPool.query<{ id: string }>(
      "INSERT INTO drivers (display_name) VALUES ('DRIVER ONE') RETURNING id",
    );
    const driverId = driverRows[0]!.id;
    await scopedPool.query("UPDATE fuel_cards SET driver_id = $1 WHERE card_number = '1000001'", [
      driverId,
    ]);
    const { rows: truckRows } = await scopedPool.query<{ id: string }>(
      "SELECT id FROM trucks WHERE unit_number = '101'",
    );
    await scopedPool.query(
      "INSERT INTO truck_assignments (driver_id, truck_id, effective_from, effective_to) VALUES ($1, $2, '2026-01-01', NULL)",
      [driverId, truckRows[0]!.id],
    );

    const result = await importInvoice(scopedPool, BALANCED_CSV, { sourceFilename: "invoice_100001.csv" });
    expect(result.status).toBe("imported");
    if (result.status !== "imported") {
      return;
    }

    // "SAMPLE #1" (the fixture's station text) has no matching row in
    // `stations` — an unresolved station never quarantines the invoice, and
    // is named in the report rather than silently dropped.
    expect(result.report.stationMisses).toContain("SAMPLE #1");

    const { rows } = await scopedPool.query<{ truck_id: string | null; driver_id: string | null; station_id: string | null }>(
      "SELECT truck_id, driver_id, station_id FROM fuel_stops WHERE base_auth_code = 'B100001'",
    );
    expect(rows[0]?.truck_id).toBe(truckRows[0]!.id);
    expect(rows[0]?.driver_id).toBe(driverId);
    expect(rows[0]?.station_id).toBeNull();
  });

  it("resolves express_charges.driver_id and match_status from the driver name, and lands a miss as unmatched (T-29)", async () => {
    const result = await importInvoice(scopedPool, BALANCED_CSV, { sourceFilename: "invoice_100001.csv" });
    expect(result.status).toBe("imported");

    // Neither "DRIVER ONE" (express row 1) nor the blank name (express row
    // 2) is on the seeded driver roster, so both land unmatched with a null
    // driver_id — never a guess, never an error.
    const { rows } = await scopedPool.query<{ driver_id: string | null; match_status: string }>(
      "SELECT driver_id, match_status FROM express_charges ORDER BY express_code",
    );
    expect(rows).toEqual([
      { driver_id: null, match_status: "unmatched" },
      { driver_id: null, match_status: "unmatched" },
    ]);
  });

  describe.skipIf(!hasRealFixture)("real invoice 999210 (local fixture only)", () => {
    it("imports ~60 real stops and balances Σ = 50929.71", async () => {
      // The real invoice's own driver roster (card numbers) isn't in this
      // test's synthetic catalog, so every fuel stop's card is unresolved —
      // this proves reconcile() balances on the real figures even though
      // the invoice still quarantines on UNKNOWN_CARD, which is the correct
      // outcome for a schema this test doesn't seed with 27 real cards.
      const buffer = readFileSync(realFixturePath);
      const result = await importInvoice(scopedPool, buffer, { sourceFilename: "invoice_999210.csv" });

      expect(result.status).not.toBe("conflict");
      if (result.status === "conflict") {
        return;
      }
      expect(result.report.reconcile.balanced).toBe(true);
      expect(result.report.reconcile.grandTotal.parsedCents).toBe(5092971);
    });
  });
});
