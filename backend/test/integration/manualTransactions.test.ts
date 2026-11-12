import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOverview } from "../../src/actuals/overview.js";
import { runMigrations } from "../../src/db/migrate.js";
import { importInvoice } from "../../src/invoice/importInvoice.js";
import { parseInvoicePdf } from "../../src/invoice/parseInvoicePdf.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const fixture = (name: string) => readFileSync(path.join(dirname, "../fixtures/invoices", name));
const hasDatabase = Boolean(process.env.DATABASE_URL);

/** T-128: a Manual Transactions credit imports, is stored as printed, and
 * counts in the week — Overview's other charges tie to BVD's bill. */
describe.skipIf(!hasDatabase)("Manual Transactions (integration, T-128)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_manual_tx_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` });
    await runMigrations(scopedPool, migrationsDir);
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("imports the credit, stores it as printed, and nets it into Overview's other charges", async () => {
    const result = await importInvoice(scopedPool, fixture("edge-manual-credit.pdf"), { sourceFilename: "edge-manual-credit.pdf" }, { parse: parseInvoicePdf });
    expect(result.status).toBe("imported");
    if (result.status !== "imported") throw new Error("fixture did not import");

    const { rows } = await scopedPool.query(
      `SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS occurred_at, amount, fee, total, description
       FROM manual_transactions WHERE invoice_id = $1`,
      [result.invoiceId],
    );
    expect(rows).toEqual([
      { occurred_at: "2026-01-06T00:00:00", amount: "-150.00", fee: "0.00", total: "-150.00", description: "CREDIT FOR A SAMPLE ADVANCE" },
    ]);

    const overview = await getOverview(scopedPool, "2026-01-07");
    const other = overview.us!.kpis.otherCharges;
    expect(other.manual).toBe(-150);
    expect(other.express).toBe(53);
    // Integer cents: scale + express + manual, the Final AMT the bill prints for them.
    expect(Math.round(other.total * 100)).toBe(Math.round(other.scale * 100) + 5300 - 15000);
  });

  it("an invoice with no manual section stores none and reports zero", async () => {
    const result = await importInvoice(scopedPool, fixture("sample-redacted.pdf"), { sourceFilename: "sample-redacted.pdf" }, { parse: parseInvoicePdf });
    expect(result.status).toBe("imported");
    expect((await scopedPool.query("SELECT 1 FROM manual_transactions")).rowCount).toBe(0);
  });

  it("the table refuses a row whose amount + fee is not its total", async () => {
    const result = await importInvoice(scopedPool, fixture("edge-manual-credit.pdf"), { sourceFilename: "edge-manual-credit.pdf" }, { parse: parseInvoicePdf });
    if (result.status !== "imported") throw new Error("fixture did not import");
    await expect(
      scopedPool.query(
        "INSERT INTO manual_transactions (invoice_id, occurred_at, amount, fee, total) VALUES ($1, now(), -100, 0, -99)",
        [result.invoiceId],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

const realInvoice = (n: string) => path.join(dirname, `../../../data/bvd-invoices/BVD_invoice_${n}.pdf`);
const FAILED_UPLOADS = ["949661", "941875", "945798", "854048"];
const hasRealUploads = FAILED_UPLOADS.every((n) => existsSync(realInvoice(n)));

/** The four real invoices whose uploads failed before T-126..T-128. Totals and
 * counts only — no driver name or card number here (T-58). */
describe.skipIf(!hasDatabase || !hasRealUploads)("the four failed uploads import (integration, local fixtures only)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_failed_uploads_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` });
    await runMigrations(scopedPool, path.join(dirname, "../../../migrations/real"));
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("imports each one, stores 854048's credit, and flags 945798's blank driver red", async () => {
    for (const n of FAILED_UPLOADS) {
      const result = await importInvoice(scopedPool, readFileSync(realInvoice(n)), { sourceFilename: `BVD_invoice_${n}.pdf` }, { parse: parseInvoicePdf });
      expect([n, result.status]).toEqual([n, "imported"]);
    }
    const { rows: manual } = await scopedPool.query(
      `SELECT i.invoice_number, m.total FROM manual_transactions m JOIN invoices i ON i.id = m.invoice_id`,
    );
    expect(manual).toEqual([{ invoice_number: "854048", total: "-11400.00" }]);
    const { rows: flagged } = await scopedPool.query(
      `SELECT i.invoice_number, fs.base_auth_code, a.severity FROM anomalies a
       JOIN fuel_stops fs ON fs.id = a.subject_id JOIN invoices i ON i.id = fs.invoice_id
       WHERE a.rule = 'driver_not_entered'`,
    );
    expect(flagged).toEqual([{ invoice_number: "945798", base_auth_code: "A161767301", severity: "red" }]);
  });
});
