import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOverview } from "../../src/actuals/overview.js";
import { loadRollupSums } from "../../src/actuals/rollup.js";
import { listTransactions } from "../../src/actuals/transactions.js";
import { runMigrations } from "../../src/db/migrate.js";
import { importInvoice } from "../../src/invoice/importInvoice.js";
import { parseInvoicePdf } from "../../src/invoice/parseInvoicePdf.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const fixture = (name: string) => readFileSync(path.join(dirname, "../fixtures/invoices", name));
const hasDatabase = Boolean(process.env.DATABASE_URL);

/** T-129: a DE line (packaged DEF) imports with its raw code as printed, and
 * Overview's DEF figure counts it beside DF. */
describe.skipIf(!hasDatabase)("Product code DE (integration, T-129)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_de_def_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  it("imports the DE line under its own code and counts it in Overview's DEF", async () => {
    const result = await importInvoice(scopedPool, fixture("edge-de-def.pdf"), { sourceFilename: "edge-de-def.pdf" }, { parse: parseInvoicePdf });
    expect(result.status).toBe("imported");
    if (result.status !== "imported") throw new Error("fixture did not import");
    expect(result.report.reconcile.balanced).toBe(true);

    const { rows } = await scopedPool.query(
      `SELECT fsl.product_code, fsl.qty, fsl.amount FROM fuel_stop_lines fsl
       JOIN fuel_stops fs ON fs.id = fsl.fuel_stop_id
       WHERE fs.invoice_id = $1 AND fsl.product_code IN ('DF', 'DE') ORDER BY fsl.product_code`,
      [result.invoiceId],
    );
    expect(rows).toEqual([
      { product_code: "DE", qty: "0.00", amount: "24.99" },
      { product_code: "DF", qty: "5.00", amount: "22.50" },
    ]);

    const def = (await getOverview(scopedPool, "2026-01-07")).us!.kpis.def;
    // DF 22.50 + DE 24.99, in integer cents; DE adds money but no quantity.
    expect(Math.round(def.amount * 100)).toBe(2250 + 2499);
    expect(def.qty).toBe(5);
  });

  it("the one DEF filter, sent as DF or DE, finds the DE-only stop beside the DF ones (T-130)", async () => {
    const result = await importInvoice(scopedPool, fixture("edge-de-def.pdf"), { sourceFilename: "edge-de-def.pdf" }, { parse: parseInvoicePdf });
    if (result.status !== "imported") throw new Error("fixture did not import");

    const codesOf = async (product: string) => {
      const list = await listTransactions(
        scopedPool,
        { product },
        { field: "occurred_at", direction: "asc" },
        { page: 1, pageSize: 200 },
        { includeLines: true },
      );
      return list.rows.map((r) => (r.lines ?? []).map((l) => l.productCode).filter((c) => c === "DF" || c === "DE").sort().join("+"));
    };
    const viaDf = await codesOf("DF");
    expect(viaDf).toContain("DE");
    expect(viaDf.some((c) => c.includes("DF"))).toBe(true);
    expect(await codesOf("DE")).toEqual(viaDf);

    // The per-driver/truck DEF quantity counts both codes too; DE adds no quantity.
    const sums = await loadRollupSums(scopedPool, result.invoiceId, "driver");
    const defQty = [...sums.values()].reduce((n, s) => n + s.defQty, 0);
    expect(defQty).toBe(5);
  });
});
