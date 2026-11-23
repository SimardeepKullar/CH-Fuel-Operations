import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOverviewWeeks } from "../../src/actuals/overviewWeeks.js";
import { runMigrations } from "../../src/db/migrate.js";
import { importInvoice } from "../../src/invoice/importInvoice.js";
import { parseInvoicePdf } from "../../src/invoice/parseInvoicePdf.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const fixture = (name: string) => readFileSync(path.join(dirname, "../fixtures/invoices", name));
const hasDatabase = Boolean(process.env.DATABASE_URL);
const cents = (n: number): number => Math.round(n * 100);

/** T-131: a trailer-fuel (TF) line has its own figures on `/overview/weeks`, and
 * diesel + DEF + trailer + other charges is the printed grand total to the cent. */
describe.skipIf(!hasDatabase)("Overview with trailer fuel (integration, T-131)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_ov_trailer_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  it("puts the TF line in trailer, not diesel or other, and the parts add to the grand total", async () => {
    const result = await importInvoice(scopedPool, fixture("edge-trailer-fuel.pdf"), { sourceFilename: "edge-trailer-fuel.pdf" }, { parse: parseInvoicePdf });
    expect(result.status).toBe("imported");
    if (result.status !== "imported") throw new Error("fixture did not import");
    expect(result.report.reconcile.balanced).toBe(true);

    const { rows } = await scopedPool.query<{ grand_total: string; tf_amount: string; ta_qty: string }>(
      `SELECT i.grand_total,
              (SELECT amount FROM invoice_totals WHERE invoice_id = i.id AND product_code = 'TF') AS tf_amount,
              (SELECT qty FROM invoice_totals WHERE invoice_id = i.id AND product_code = 'TA') AS ta_qty
       FROM invoices i WHERE i.id = $1`,
      [result.invoiceId],
    );
    const printed = rows[0]!;

    const { weeks } = await getOverviewWeeks(scopedPool);
    const us = weeks[0]!.us!;
    // 48.60 gal × 5.1234 = 248.997… → 249.00.
    expect(cents(us.trailer)).toBe(24900);
    expect(us.trailer).toBe(Number(printed.tf_amount));
    expect(us.trailerGal).toBe(48.6);
    // Diesel stays tractor-only.
    expect(us.gal).toBe(Number(printed.ta_qty));
    expect(cents(us.total)).toBe(cents(Number(printed.grand_total)));
    expect(cents(us.diesel) + cents(us.def) + cents(us.trailer) + cents(us.other)).toBe(cents(us.total));
  });
});
