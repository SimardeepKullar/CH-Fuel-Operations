import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import type { PeriodWeek } from "../../src/api/routes/periods.js";
import type { ListTransactionsResult } from "../../src/actuals/transactions.js";
import { runMigrations } from "../../src/db/migrate.js";
import { importInvoice } from "../../src/invoice/importInvoice.js";
import { parseInvoicePdf } from "../../src/invoice/parseInvoicePdf.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dirname, "../../..");
// Real-fixture-only file: migrates the real roster, as invoice999217.test.ts does.
const migrationsDir = path.join(repoRoot, "migrations/real");
const usPdfPath = path.join(repoRoot, "data/bvd-invoices/BVD_invoice_999210.pdf");
const caPdfPath = path.join(repoRoot, "data/bvd-invoices/BVD_invoice_999217.pdf");
const loaderScript = path.join(repoRoot, "scripts/resolve_from_operator.py");
const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRealFixtures =
  existsSync(usPdfPath) && existsSync(caPdfPath) && existsSync(path.join(migrationsDir, "0005_fleet_roster_seed.sql"));

function findPython(): string | null {
  for (const exe of ["python", "python3"]) {
    const probe = spawnSync(exe, ["-c", "import pandas, psycopg2"], { encoding: "utf8" });
    if (probe.status === 0) return exe;
  }
  return null;
}
const python = hasDatabase && hasRealFixtures ? findPython() : null;

function scopedUrl(schema: string): string {
  const base = process.env.DATABASE_URL!;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}options=${encodeURIComponent(`-c search_path=${schema},public`)}`;
}

/**
 * T-63's definition of done, on the real pair: 999210 (US) and 999217 (CA)
 * share the billing week ending 2026-09-09, and only 999217 prints a range that
 * is not the one its transactions ran. Counts, dates and totals only — no card
 * number or driver name appears here or in anything a failure can print (T-58).
 */
describe.skipIf(!hasDatabase || !hasRealFixtures || !python)("billing weeks on the real 999210 + 999217 (integration, local fixtures only)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let app: App;

  const get = async <T>(pathAndQuery: string): Promise<T> => {
    const response = await app.handle(new Request(`http://localhost/api/v1${pathAndQuery}`));
    expect(response.status, pathAndQuery).toBe(200);
    return (await response.json()) as T;
  };

  beforeAll(async () => {
    schema = `test_billing_weeks_real_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
    for (const [file, name] of [[usPdfPath, "BVD_invoice_999210.pdf"], [caPdfPath, "BVD_invoice_999217.pdf"]] as const) {
      const result = await importInvoice(pool, readFileSync(file), { sourceFilename: name }, { parse: parseInvoicePdf });
      if (result.status !== "imported") {
        throw new Error(`${name} did not import: ${result.status}`);
      }
    }
    app = createApp({ pool, authRequired: false });
  }, 90_000);

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool?.end();
  });

  it("lands both invoices in one week ending 2026-09-09, with datesDiffer on 999217 only", async () => {
    const { weeks } = await get<{ weeks: PeriodWeek[] }>("/periods");
    expect(weeks.map((w) => w.weekEnd)).toEqual(["2026-09-09"]);
    expect(weeks[0]!.invoices).toEqual([
      expect.objectContaining({
        invoiceNumber: "999210",
        currency: "USD",
        printedStart: "2026-09-03",
        printedEnd: "2026-09-09",
        datesDiffer: false,
      }),
      expect.objectContaining({
        invoiceNumber: "999217",
        currency: "CAD",
        printedStart: "2026-08-01",
        printedEnd: "2026-09-09",
        // Its transactions run Sep 3 – Sep 10 (UTC): the one after the printed end is real.
        actualStart: "2026-09-03",
        actualEnd: "2026-09-10",
        datesDiffer: true,
      }),
    ]);
  });

  it("/transactions?week=2026-09-09&currency=CAD is 999217's 59 fuel stops alone, in litres and CAD", async () => {
    const ca = await get<ListTransactionsResult>("/transactions?week=2026-09-09&currency=CAD&pageSize=200");
    expect(ca.total).toBe(59);
    expect(ca.rows.every((r) => r.currency === "CAD" && r.qtyUnit === "L")).toBe(true);

    const gallons = await get<ListTransactionsResult>("/transactions?week=2026-09-09&currency=CAD&pageSize=200&units=imperial");
    expect(gallons.total).toBe(59);
    expect(gallons.rows.every((r) => r.qtyUnit === "gal" && r.currency === "CAD")).toBe(true);
    // Same money, row for row; the quantity is the litres divided by 3.785411784.
    for (const row of ca.rows) {
      const converted = gallons.rows.find((r) => r.id === row.id)!;
      expect(converted.total).toBe(row.total);
      if (row.qty !== null) expect(converted.qty).toBeCloseTo(row.qty / 3.785411784, 3);
    }
  });

  it("the US side of the same week is 999210's 66 stops in gallons, and the week holds both", async () => {
    const us = await get<ListTransactionsResult>("/transactions?week=2026-09-09&currency=USD&pageSize=200");
    expect(us.total).toBe(66);
    expect(us.rows.every((r) => r.currency === "USD" && r.qtyUnit === "gal")).toBe(true);
    expect((await get<ListTransactionsResult>("/transactions?week=2026-09-09&pageSize=1")).total).toBe(125);
  });
});
