import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runImportInvoiceCli } from "../../src/cli/importInvoice.js";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
// Real-fixture-only file: points at the real roster directly, not synthetic.
const migrationsDir = path.join(dirname, "../../../migrations/real");
const realFixturePath = path.join(dirname, "../../../data/bvd-invoices/invoice_999210.csv");
const realPdfPath = path.join(dirname, "../../../data/bvd-invoices/BVD_invoice_999210.pdf");
const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRealFixture = existsSync(realFixturePath);

/**
 * T-31: `npm run import-invoice -- ./data/bvd-invoices/invoice_999210.csv` end to
 * end, then every figure checked against the database directly in SQL —
 * never against application code, so these prove the data, not the code
 * path that wrote it (BUILD-PLAN-v2.md Step 31.2).
 *
 * Migrations 0001-0006 (via `runMigrations`) seed the real 27-card/driver/
 * truck roster (0004, §A19), so every card and every present unit number on
 * this real invoice resolves — nothing here is a synthetic stand-in.
 *
 * Two figures in this file are empirically measured against the real file
 * with the schema fix from this ticket applied, not copied from
 * PROJECT-SCOPE-v2.md's A5 table:
 *   - The anomaly count. A5 states "3", predating T-30's engine. It was
 *     measured as 84 while 0005's driver/truck pairing was still a guess
 *     ("plausible, not verified" — see that migration's original comment);
 *     now that 0005 pairs every card/driver/truck from the real invoice
 *     itself, it measures 26 — the false-positive `unit_mismatch` findings
 *     from the wrong pairing are gone, leaving the genuine anomalies (a
 *     handful of real data-entry errors, plus every other rule's hits,
 *     unaffected by this fix). A future change to the fixture or the rules
 *     is expected to change this number again; that isn't a regression in
 *     this test's own logic.
 *   - Receipt status. A5's "48 of 60 confirmed" reflects a human checking
 *     Samsara/a spreadsheet — external to the CSV. `importInvoice()` never
 *     writes `receipt_checks` (T-35's `POST /receipt-checks` does), so
 *     every stop is `'pending'` immediately after import. The 48/60 figure
 *     belongs to T-33's Overview endpoint, once T-35 exists to produce it.
 */
describe.skipIf(!hasDatabase || !hasRealFixture)("invoice 999210 import (integration, local fixture only)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    schema = `test_invoice_999210_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("imports via the CLI and prints the report", async () => {
    const exitCode = await runImportInvoiceCli([realFixturePath], scopedPool);

    expect(exitCode).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("holds exactly one invoice, every stop, every line and every express row", async () => {
    await runImportInvoiceCli([realFixturePath], scopedPool);

    expect((await scopedPool.query("SELECT count(*) FROM invoices")).rows[0].count).toBe("1");
    expect((await scopedPool.query("SELECT status FROM invoices")).rows[0].status).toBe("imported");

    const stops = await scopedPool.query<{ count: string }>("SELECT count(*) FROM fuel_stops");
    expect(Number(stops.rows[0]!.count)).toBeGreaterThanOrEqual(60);
    expect(Number(stops.rows[0]!.count)).toBe(66);

    // Every fuel_stop_lines row and every express_charges row traces back to
    // this one invoice — nothing orphaned, nothing from a different import.
    const orphanLines = await scopedPool.query(
      `SELECT count(*) FROM fuel_stop_lines fsl
       JOIN fuel_stops fs ON fs.id = fsl.fuel_stop_id
       WHERE fs.invoice_id != (SELECT id FROM invoices)`,
    );
    expect(orphanLines.rows[0]!.count).toBe("0");

    expect((await scopedPool.query("SELECT count(*) FROM express_charges")).rows[0]!.count).toBe("6");
  });

  it("Σ fuel_stop_lines.amount + Σ express_charges.total = 50929.71", async () => {
    await runImportInvoiceCli([realFixturePath], scopedPool);

    const { rows } = await scopedPool.query<{ total: string }>(
      `SELECT (SELECT COALESCE(SUM(amount), 0) FROM fuel_stop_lines) +
              (SELECT COALESCE(SUM(total), 0) FROM express_charges) AS total`,
    );
    expect(rows[0]!.total).toBe("50929.71");
  });

  it("Σ gallons WHERE product_code='TA' = 8733.11, DF = 174.43", async () => {
    await runImportInvoiceCli([realFixturePath], scopedPool);

    const ta = await scopedPool.query<{ g: string }>(
      "SELECT COALESCE(SUM(qty), 0) AS g FROM fuel_stop_lines WHERE product_code = 'TA'",
    );
    expect(ta.rows[0]!.g).toBe("8733.11");

    const df = await scopedPool.query<{ g: string }>(
      "SELECT COALESCE(SUM(qty), 0) AS g FROM fuel_stop_lines WHERE product_code = 'DF'",
    );
    expect(df.rows[0]!.g).toBe("174.43");
  });

  it("gallons-weighted average billed price for TA rounds to 5.55, distinct from the unweighted mean", async () => {
    await runImportInvoiceCli([realFixturePath], scopedPool);

    const weighted = await scopedPool.query<{ avg: string }>(
      `SELECT round(SUM(qty * billed_per_unit) / SUM(qty), 2) AS avg
       FROM fuel_stop_lines WHERE product_code = 'TA'`,
    );
    expect(weighted.rows[0]!.avg).toBe("5.55");

    const unweighted = await scopedPool.query<{ avg: string }>(
      `SELECT round(AVG(billed_per_unit), 2) AS avg
       FROM fuel_stop_lines WHERE product_code = 'TA'`,
    );
    expect(unweighted.rows[0]!.avg).not.toBe(weighted.rows[0]!.avg);
  });

  it("invoice_totals.discount is BVD's printed Disc AMT (T-33 follow-up), not recomputed from retail/billed", async () => {
    await runImportInvoiceCli([realFixturePath], scopedPool);

    const { rows } = await scopedPool.query<{ product_code: string; discount: string | null }>(
      "SELECT product_code, discount FROM invoice_totals ORDER BY product_code",
    );
    expect(rows).toEqual([
      { product_code: "DF", discount: "0.00" },
      { product_code: "S", discount: null },
      { product_code: "TA", discount: "5088.61" },
    ]);
  });

  it("every fuel_stop is receipt_status='pending' — importInvoice() never writes receipt_checks", async () => {
    await runImportInvoiceCli([realFixturePath], scopedPool);

    const { rows } = await scopedPool.query<{ receipt_status: string; count: string }>(
      "SELECT receipt_status, count(*) FROM fuel_stops GROUP BY receipt_status",
    );
    expect(rows).toEqual([{ receipt_status: "pending", count: "66" }]);

    expect((await scopedPool.query("SELECT count(*) FROM receipt_checks")).rows[0]!.count).toBe("0");
  });

  it("imports the emailed PDF of the same invoice, with the tractor and driver the CSV cannot carry", async () => {
    const exitCode = await runImportInvoiceCli([realPdfPath], scopedPool);
    expect(exitCode).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();

    // Same invoice, same money — the PDF balances to the same printed totals.
    const { rows: totals } = await scopedPool.query<{ total: string }>(
      `SELECT (SELECT COALESCE(SUM(amount), 0) FROM fuel_stop_lines) +
              (SELECT COALESCE(SUM(total), 0) FROM express_charges) AS total`,
    );
    expect(totals[0]!.total).toBe("50929.71");

    // Every real express row prints a tractor; only the driver is ever blank.
    const { rows: express } = await scopedPool.query<{ n: string }>(
      "SELECT count(*) AS n FROM express_charges WHERE unit_raw IS NOT NULL",
    );
    expect(express[0]!.n).toBe("6");

    const { rows: blankDriver } = await scopedPool.query<{ n: string }>(
      "SELECT count(*) AS n FROM express_charges WHERE driver_name_raw IS NULL",
    );
    expect(blankDriver[0]!.n).toBe("1");
  });

  it("anomaly count matches T-30's engine against the real file (measured, not A5's stale figure)", async () => {
    await runImportInvoiceCli([realFixturePath], scopedPool);

    // 12, not 26 — T-40A retired the def_ratio rule, so its findings on this
    // invoice no longer count. T-40F then narrowed sub_gallon to diesel
    // (TA) only, dropping this invoice's one sub-gallon DEF line
    // (0.46 gal) from 13 to 12.
    expect((await scopedPool.query("SELECT count(*) FROM anomalies")).rows[0]!.count).toBe("12");
  });

  it("every stop and every express charge has a resolved truck or a named exclusion — none guessed", async () => {
    await runImportInvoiceCli([realFixturePath], scopedPool);

    // Every real card on this invoice resolves (0004 seeds all 27), and
    // every real card's driver has a truck_assignments row, so no fuel stop
    // is left with a null truck_id on this file.
    expect(
      (await scopedPool.query("SELECT count(*) FROM fuel_stops WHERE truck_id IS NULL")).rows[0]!.count,
    ).toBe("0");

    // A present unit number always resolves to a truck: unit_raw not null
    // with truck_id null is the guessed/inconsistent state this invariant
    // forbids, and it is structurally impossible to reach (an unresolved
    // present unit quarantines the whole invoice before any row is written).
    expect(
      (
        await scopedPool.query(
          "SELECT count(*) FROM express_charges WHERE truck_id IS NULL AND unit_raw IS NOT NULL",
        )
      ).rows[0]!.count,
    ).toBe("0");

    // This import is of the CSV export, which has no tractor column at all,
    // so every express row legitimately has a null unit_raw and truck_id.
    // That is a property of the file, not a resolution failure — importing
    // the PDF of the same invoice resolves all six (see below).
    expect(
      (
        await scopedPool.query(
          "SELECT count(*) FROM express_charges WHERE truck_id IS NULL AND unit_raw IS NULL",
        )
      ).rows[0]!.count,
    ).toBe("6");
  });
});
