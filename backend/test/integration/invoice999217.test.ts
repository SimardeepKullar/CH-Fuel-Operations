import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { importInvoice, type ImportInvoiceResult } from "../../src/invoice/importInvoice.js";
import { parseInvoicePdf } from "../../src/invoice/parseInvoicePdf.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dirname, "../../..");
// Real-fixture-only file: points at the real roster directly, not synthetic.
const migrationsDir = path.join(repoRoot, "migrations/real");
const realPdfPath = path.join(repoRoot, "data/bvd-invoices/BVD_invoice_999217.pdf");
const loaderScript = path.join(repoRoot, "scripts/resolve_from_operator.py");
const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRealFixture = existsSync(realPdfPath) && existsSync(path.join(migrationsDir, "0005_fleet_roster_seed.sql"));

/** The BVD directory load is the T-60 Python loader, as in directoryLoad.test.ts. */
function findPython(): string | null {
  for (const exe of ["python", "python3"]) {
    const probe = spawnSync(exe, ["-c", "import pandas, psycopg2"], { encoding: "utf8" });
    if (probe.status === 0) return exe;
  }
  return null;
}
const python = hasDatabase && hasRealFixture ? findPython() : null;

function scopedUrl(schema: string): string {
  const base = process.env.DATABASE_URL!;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}options=${encodeURIComponent(`-c search_path=${schema},public`)}`;
}

/**
 * T-61 step 61.5: the real CA invoice 999217, end to end, against the real
 * roster (T-62) and BVD's directory (T-60). Every figure is checked in SQL
 * against the database, never against application code.
 *
 * Counts and totals only — no card number or driver name appears in this
 * file or in any failure it can print (T-58).
 */
describe.skipIf(!hasDatabase || !hasRealFixture || !python)("invoice 999217 import (integration, local fixture only)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let result: ImportInvoiceResult;

  const one = async (sql: string): Promise<unknown> => Object.values((await pool.query(sql)).rows[0] ?? {})[0];

  beforeAll(async () => {
    schema = `test_invoice_999217_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` });
    await runMigrations(pool, migrationsDir);

    const loader = spawnSync(python!, [loaderScript, "--no-fixture", "--directory-only"], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: scopedUrl(schema) },
    });
    if (loader.status !== 0) {
      throw new Error(`directory loader exited ${loader.status}`);
    }

    result = await importInvoice(pool, readFileSync(realPdfPath), { sourceFilename: "BVD_invoice_999217.pdf" }, { parse: parseInvoicePdf });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool?.end();
  });

  it("imports with nothing quarantined", async () => {
    expect(result.status).toBe("imported");
    expect(await one("SELECT count(*) FROM invoice_rejections")).toBe("0");
  });

  it("is stored as CAD in litres, with its printed period and grand total", async () => {
    const { rows } = await pool.query(
      "SELECT currency, qty_unit, grand_total, status, period_start::text, period_end::text FROM invoices",
    );
    expect(rows).toEqual([
      { currency: "CAD", qty_unit: "L", grand_total: "46837.33", status: "imported", period_start: "2026-08-01", period_end: "2026-09-09" },
    ]);
  });

  it("holds 60 lines, 59 fuel stops and 34 cards", async () => {
    expect(await one("SELECT count(*) FROM fuel_stop_lines")).toBe("60");
    expect(await one("SELECT count(*) FROM fuel_stops")).toBe("59");
    expect(await one("SELECT count(DISTINCT card_id) FROM fuel_stops")).toBe("34");
    expect(await one("SELECT count(*) FROM express_charges")).toBe("0");
  });

  it("resolves every stop to one of 9 stations, all Canadian directory rows (T-60)", async () => {
    expect(await one("SELECT count(*) FROM fuel_stops WHERE station_id IS NULL")).toBe("0");
    expect(await one("SELECT count(DISTINCT station_id) FROM fuel_stops")).toBe("9");
    expect(
      await one("SELECT count(*) FROM fuel_stops fs JOIN stations s ON s.id = fs.station_id WHERE s.country <> 'CA'"),
    ).toBe("0");
  });

  it("resolves every stop's card to a driver (T-62)", async () => {
    expect(await one("SELECT count(*) FROM fuel_stops WHERE driver_id IS NULL")).toBe("0");
  });

  it("prints grand total CAD 46,837.33 = pre-tax 41,356.89 + HST 5,376.44 + Scale 104.00", async () => {
    const { rows } = await pool.query(
      `SELECT SUM(pre_tax_amount) FILTER (WHERE product_code IN ('TA', 'TF', 'DF')) AS pre_tax,
              SUM(hst) AS hst,
              SUM(amount) FILTER (WHERE product_code = 'S') AS scale,
              SUM(gst + pst + qst) AS other_tax
       FROM invoice_totals`,
    );
    expect(rows).toEqual([{ pre_tax: "41356.89", hst: "5376.44", scale: "104.00", other_tax: "0.00" }]);
    expect(await one("SELECT SUM(amount) FROM fuel_stop_lines")).toBe("46837.33");
  });

  it("stores TA 21,318.77 L, DF 113.09 L and Scale 104.00, line by line and as printed", async () => {
    const { rows } = await pool.query(
      `SELECT product_code, SUM(qty) AS qty, SUM(amount) AS amount FROM fuel_stop_lines GROUP BY product_code ORDER BY product_code`,
    );
    expect(rows).toEqual([
      { product_code: "DF", qty: "113.09", amount: "174.05" },
      { product_code: "S", qty: "0.00", amount: "104.00" },
      { product_code: "TA", qty: "21318.77", amount: "46559.28" },
    ]);
    const totals = await pool.query("SELECT product_code, qty FROM invoice_totals WHERE product_code IN ('TA', 'DF') ORDER BY product_code");
    expect(totals.rows).toEqual([
      { product_code: "DF", qty: "113.09" },
      { product_code: "TA", qty: "21318.77" },
    ]);
  });

  it("satisfies Pre Tax + HST + GST + PST + QST = Final AMT on every stored line", async () => {
    expect(await one("SELECT count(*) FROM fuel_stop_lines WHERE pre_tax_amount + hst + gst + pst + qst <> amount")).toBe("0");
  });

  it("imports the one transaction printed after the period end, on 2026-09-10 in UTC", async () => {
    expect(
      await one(
        `SELECT count(*) FROM fuel_stops fs JOIN invoices i ON i.id = fs.invoice_id
         WHERE (fs.occurred_at AT TIME ZONE 'UTC')::date > i.period_end`,
      ),
    ).toBe("1");
  });
});
