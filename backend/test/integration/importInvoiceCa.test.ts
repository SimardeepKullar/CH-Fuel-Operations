import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OverviewResult } from "../../src/actuals/overview.js";
import type { ListTransactionsResult } from "../../src/actuals/transactions.js";
import { createApp } from "../../src/api/app.js";
import type { HealthStatus } from "../../src/catalog/health.js";
import { runMigrations } from "../../src/db/migrate.js";
import { importInvoice } from "../../src/invoice/importInvoice.js";
import { parseInvoicePdf } from "../../src/invoice/parseInvoicePdf.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const fixturesDir = path.join(dirname, "../fixtures/invoices");
const hasDatabase = Boolean(process.env.DATABASE_URL);

const CA_PDF = () => readFileSync(path.join(fixturesDir, "sample-ca.pdf"));
const US_PDF = () => readFileSync(path.join(fixturesDir, "sample-redacted.pdf"));

/**
 * T-61 step 61.4: the synthetic CA invoice end to end, in CI. It is drawn in
 * the CA layout from T-62's synthetic roster, so every card resolves against
 * migrations/synthetic. Exact figures throughout — integer cents and
 * ten-thousandths, compared as the strings Postgres returns.
 */
describe.skipIf(!hasDatabase)("importInvoice — a CA invoice (integration, T-61)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_import_ca_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` });
    await runMigrations(pool, migrationsDir);
  });

  afterEach(async () => {
    await pool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  const importCa = () => importInvoice(pool, CA_PDF(), { sourceFilename: "sample-ca.pdf" }, { parse: parseInvoicePdf });

  it("imports with no quarantine, as CAD in litres, keeping the printed period", async () => {
    const result = await importCa();
    expect(result.status).toBe("imported");
    const { rows } = await pool.query(
      `SELECT currency, qty_unit, grand_total, status, period_start::text, period_end::text FROM invoices`,
    );
    expect(rows).toEqual([
      { currency: "CAD", qty_unit: "L", grand_total: "3839.54", status: "imported", period_start: "2026-08-01", period_end: "2026-09-09" },
    ]);
    expect((await pool.query("SELECT count(*) FROM invoice_rejections")).rows[0].count).toBe("0");
  });

  it("stores litres, CAD per litre and every tax column exactly as printed", async () => {
    await importCa();
    const { rows } = await pool.query(
      `SELECT fsl.qty, fsl.retail_per_unit, fsl.billed_per_unit, fsl.pre_tax_amount, fsl.hst, fsl.gst, fsl.pst, fsl.qst, fsl.amount
       FROM fuel_stop_lines fsl JOIN fuel_stops fs ON fs.id = fsl.fuel_stop_id
       WHERE fs.base_auth_code = 'A700000101'`,
    );
    expect(rows).toEqual([
      { qty: "300.00", retail_per_unit: "2.4990", billed_per_unit: "2.2427", pre_tax_amount: "595.40", hst: "77.40", gst: "0.00", pst: "0.00", qst: "0.00", amount: "672.80" },
    ]);
    const totals = await pool.query(
      `SELECT product_code, qty, pre_tax_amount, hst, discount, amount FROM invoice_totals ORDER BY product_code`,
    );
    expect(totals.rows).toEqual([
      { product_code: "DF", qty: "20.01", pre_tax_amount: "27.25", hst: "3.54", discount: "0.00", amount: "30.79" },
      { product_code: "S", qty: "0.00", pre_tax_amount: null, hst: "0.00", discount: null, amount: "26.00" },
      { product_code: "TA", qty: "1705.65", pre_tax_amount: "3309.52", hst: "430.23", discount: "522.67", amount: "3739.75" },
    ]);
  });

  it("satisfies Pre Tax + HST + GST + PST + QST = Final AMT on every stored line, and sums to the printed grand total", async () => {
    await importCa();
    const mismatched = await pool.query(
      "SELECT count(*) FROM fuel_stop_lines WHERE pre_tax_amount + hst + gst + pst + qst <> amount",
    );
    expect(mismatched.rows[0].count).toBe("0");
    const sum = await pool.query(
      `SELECT (SELECT SUM(amount) FROM fuel_stop_lines) + (SELECT SUM(total) FROM express_charges) AS total`,
    );
    expect(sum.rows[0].total).toBe("3839.54");
    expect((await pool.query("SELECT count(*) FROM fuel_stops")).rows[0].count).toBe("8");
    expect((await pool.query("SELECT count(*) FROM fuel_stop_lines")).rows[0].count).toBe("9");
  });

  it("judges litres in gallons: the 3.00 L diesel stop is flagged sub-gallon, the 0.01 L DEF stop is not", async () => {
    await importCa();
    const { rows } = await pool.query<{ base_auth_code: string; detail: unknown }>(
      `SELECT fs.base_auth_code, a.detail FROM anomalies a JOIN fuel_stops fs ON fs.id = a.subject_id
       WHERE a.rule = 'sub_gallon'`,
    );
    expect(rows).toEqual([
      {
        base_auth_code: "A700000104",
        detail: { productCode: "TA", qty: "3.00", qtyUnit: "L", amount: "6.52", currency: "CAD", minGallons: "1.00" },
      },
    ]);
  });

  it("imports the transaction after the printed period end, its printed wall clock stored as UTC", async () => {
    // Pinned (T-61): BVD prints a wall-clock timestamp with no zone, and the
    // importer stores it as that instant in UTC, as for every US invoice. So
    // 2026-09-10 00:45:19 lands on 09-10 in UTC — after the printed period
    // end, 09-09 23:59:59 — and the printed period is never a filter on what
    // imports. T-63's actual range reads these UTC dates.
    await importCa();
    const { rows } = await pool.query(
      `SELECT to_char(fs.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS at_utc,
              (fs.occurred_at AT TIME ZONE 'UTC')::date > i.period_end AS after_period_end
       FROM fuel_stops fs JOIN invoices i ON i.id = fs.invoice_id
       WHERE fs.base_auth_code = 'A700000108'`,
    );
    expect(rows).toEqual([{ at_utc: "2026-09-10 00:45:19", after_period_end: true }]);
  });

  it("resolves the five unassigned CA drivers' stops to a driver and no truck (T-62)", async () => {
    await importCa();
    const { rows } = await pool.query<{ card_number: string; has_driver: boolean; has_truck: boolean }>(
      `SELECT fc.card_number, fs.driver_id IS NOT NULL AS has_driver, fs.truck_id IS NOT NULL AS has_truck
       FROM fuel_stops fs JOIN fuel_cards fc ON fc.id = fs.card_id
       WHERE fc.card_number IN ('9000030', '9000032', '9000033', '9000042', '9000047')
       ORDER BY fc.card_number`,
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.has_driver && !r.has_truck)).toBe(true);
    const unresolved = await pool.query("SELECT count(*) FROM fuel_stops WHERE driver_id IS NULL");
    expect(unresolved.rows[0].count).toBe("0");
  });

  it("flags the existing driver who entered 074 with a unit mismatch, and the CAD scale stop as charges-no-fuel", async () => {
    await importCa();
    const { rows } = await pool.query<{ rule: string; base_auth_code: string }>(
      `SELECT a.rule, fs.base_auth_code FROM anomalies a JOIN fuel_stops fs ON fs.id = a.subject_id
       WHERE a.rule IN ('unit_mismatch', 'charges_no_fuel') ORDER BY a.rule, fs.base_auth_code`,
    );
    expect(rows).toContainEqual({ rule: "unit_mismatch", base_auth_code: "A700000105" });
    expect(rows).toContainEqual({ rule: "charges_no_fuel", base_auth_code: "A700000103" });
  });

  it("raises no price-above-published finding on a CA stop — there is no Canadian published price", async () => {
    await importCa();
    expect((await pool.query("SELECT count(*) FROM anomalies WHERE rule = 'price_above_published'")).rows[0].count).toBe("0");
  });

  describe("no US screen shows a CA figure before T-63", () => {
    const app = () => createApp({ authRequired: false, pool });

    it("/overview for the CA invoice's printed start reports no invoice, no spend and no trend point", async () => {
      await importCa();
      const response = await app().handle(new Request("http://localhost/api/v1/overview?period=2026-08-01"));
      expect(response.status).toBe(200);
      const body = (await response.json()) as OverviewResult;
      expect(body.kpis.invoiceId).toBeNull();
      expect(body.kpis.total.amountUsd).toBe(0);
      expect(body.trend).toEqual([]);
      expect(body.topSpendByDriver).toEqual([]);
      expect(body.anomalyDigest).toEqual([]);
    });

    it("/transactions for the CA invoice's printed start returns no rows", async () => {
      await importCa();
      const response = await app().handle(new Request("http://localhost/api/v1/transactions?period=2026-08-01"));
      expect(response.status).toBe(200);
      const body = (await response.json()) as ListTransactionsResult;
      expect(body.rows).toEqual([]);
      expect(body.total).toBe(0);
    });

    it("with a US invoice beside it, /overview and /transactions for the US period carry US figures only", async () => {
      // The US fixture's own cards and units, as importInvoice.test.ts seeds them.
      await pool.query("INSERT INTO fuel_cards (card_number) VALUES ('1000001'), ('1000002'), ('1000003') ON CONFLICT DO NOTHING");
      await pool.query("INSERT INTO trucks (unit_number) VALUES ('101'), ('102') ON CONFLICT DO NOTHING");
      const us = await importInvoice(pool, US_PDF(), { sourceFilename: "sample-redacted.pdf" }, { parse: parseInvoicePdf });
      expect(us.status).toBe("imported");
      await importCa();

      const overview = (await (await app().handle(new Request("http://localhost/api/v1/overview?period=2026-01-05"))).json()) as OverviewResult;
      expect(overview.kpis.total.amountUsd).toBe(840.67);
      expect(overview.trend.map((p) => p.period)).toEqual(["2026-01-05"]);

      const transactions = (await (
        await app().handle(new Request("http://localhost/api/v1/transactions?period=2026-01-05&pageSize=200"))
      ).json()) as ListTransactionsResult;
      expect(transactions.total).toBe(3);
      expect(transactions.rows.every((r) => r.baseAuthCode.startsWith("B1"))).toBe(true);

      const health = (await (await app().handle(new Request("http://localhost/api/v1/health"))).json()) as HealthStatus;
      expect(health.latestInvoicePeriod).toBe("2026-01-05");
    });
  });
});
