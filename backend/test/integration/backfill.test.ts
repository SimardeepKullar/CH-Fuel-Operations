import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backfillFiles, type BackfillFile } from "../../src/ingest/backfill.js";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

function validRow(site: string, name: string): string {
  return [
    site,
    `"${name}"`,
    "Clanton",
    "AL",
    "ULSD",
    "4.5215",
    "0.2483",
    "0.3175",
    "0",
    "0.1187",
    "0.02",
    "5.226",
    "5.689",
    "5.226",
    "0.463",
  ].join(",");
}

function makeCsv(effectiveDate: string, rows: string[]): string {
  const meta =
    `"Company Id: ",981," ","Company Name: ","2043733 ONTARIO INC."," ",DBA,"CH LOGISTIX"," ","Effective Date: ",${effectiveDate}`;
  const header =
    'SITE,NAME,CITY,STATE,PROD,COST,"FEDERAL TAX","STATE TAX","SALES TAX",FREIGHT,OTHER,"TOTAL COST","RETAIL PRICE","YOUR PRICE",SAVINGS';
  return [meta, header, ...rows].join("\n");
}

const malformedCsv = () =>
  [
    '"Company Id: ",981," ","Company Name: ","2043733 ONTARIO INC."," ",DBA,"CH LOGISTIX"," ","Effective Date: ",2026-01-02',
    "SITE,NAME,CITY,STATE,PRODUCT_TYPO,COST", // wrong header shape entirely
    "1277,LOVES #368,Clanton,AL,ULSD,4.5215",
  ].join("\n");

function writeTempDir(files: Array<{ name: string; contents: string }>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ch-backfill-"));
  for (const file of files) {
    writeFileSync(path.join(dir, file.name), file.contents);
  }
  return dir;
}

async function makeScopedPool(): Promise<{ adminPool: Pool; scopedPool: Pool; schema: string }> {
  const schema = `test_backfill_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const scopedPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema},public`,
  });
  await runMigrations(scopedPool, migrationsDir);
  return { adminPool, scopedPool, schema };
}

async function dropScopedPool(adminPool: Pool, scopedPool: Pool, schema: string): Promise<void> {
  await scopedPool.end();
  await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await adminPool.end();
}

describe.skipIf(!hasDatabase)("backfillFiles (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    ({ adminPool, scopedPool, schema } = await makeScopedPool());
  });

  afterEach(async () => {
    await dropScopedPool(adminPool, scopedPool, schema);
  });

  it("completes the batch with 2 succeeding and 1 failing when the middle file is malformed", async () => {
    const dir = writeTempDir([
      { name: "day1.csv", contents: makeCsv("2026-01-01", [validRow("1001", "LOVES #100")]) },
      { name: "day2.csv", contents: malformedCsv() },
      { name: "day3.csv", contents: makeCsv("2026-01-03", [validRow("1003", "LOVES #300")]) },
    ]);
    const files: BackfillFile[] = [
      { filename: "day1.csv", path: path.join(dir, "day1.csv") },
      { filename: "day2.csv", path: path.join(dir, "day2.csv") },
      { filename: "day3.csv", path: path.join(dir, "day3.csv") },
    ];

    const result = await backfillFiles(scopedPool, files, { label: "test batch" });

    expect(result.fileCount).toBe(3);
    expect(result.files).toHaveLength(3);
    expect(result.files[0]).toMatchObject({ filename: "day1.csv", status: "completed" });
    expect(result.files[1]).toMatchObject({ filename: "day2.csv", status: "failed" });
    expect(result.files[1]?.error).toBeTruthy();
    expect(result.files[2]).toMatchObject({ filename: "day3.csv", status: "completed" });

    const batch = await scopedPool.query(
      "SELECT file_count, completed_at FROM import_batches WHERE id = $1",
      [result.batchId],
    );
    expect(batch.rows[0].file_count).toBe(3);
    expect(batch.rows[0].completed_at).not.toBeNull();

    const imports = await scopedPool.query("SELECT count(*) FROM price_imports");
    expect(imports.rows[0].count).toBe("2");
  });

  it("produces byte-identical database state regardless of processing order", async () => {
    const dir = writeTempDir([
      {
        name: "d1.csv",
        contents: makeCsv("2026-01-01", [
          validRow("1001", "LOVES #100"),
          validRow("1002", "LOVES #200"),
        ]),
      },
      {
        name: "d2.csv",
        contents: makeCsv("2026-01-02", [
          validRow("1001", "LOVES #100"),
          validRow("1002", "LOVES #200"),
        ]),
      },
      {
        name: "d3.csv",
        contents: makeCsv("2026-01-03", [
          validRow("1001", "LOVES #100"),
          validRow("1002", "LOVES #200"),
        ]),
      },
    ]);
    const inOrder: BackfillFile[] = [
      { filename: "d1.csv", path: path.join(dir, "d1.csv") },
      { filename: "d2.csv", path: path.join(dir, "d2.csv") },
      { filename: "d3.csv", path: path.join(dir, "d3.csv") },
    ];
    const shuffled: BackfillFile[] = [inOrder[2]!, inOrder[0]!, inOrder[1]!];

    const { adminPool: adminPool2, scopedPool: scopedPool2, schema: schema2 } =
      await makeScopedPool();
    try {
      await backfillFiles(scopedPool, inOrder, { label: "in order" });
      await backfillFiles(scopedPool2, shuffled, { label: "shuffled" });

      const normalize = async (pool: Pool) => {
        const stations = await pool.query(
          "SELECT site_ref, name_raw, city_raw, state_usps FROM stations ORDER BY site_ref",
        );
        const prices = await pool.query(
          `SELECT s.site_ref, sp.valid_on, sp.your_price, sp.raw_product
             FROM station_prices sp
             JOIN stations s ON s.id = sp.station_id
            ORDER BY s.site_ref, sp.valid_on`,
        );
        return { stations: stations.rows, prices: prices.rows };
      };

      const a = await normalize(scopedPool);
      const b = await normalize(scopedPool2);
      expect(a).toEqual(b);
    } finally {
      await dropScopedPool(adminPool2, scopedPool2, schema2);
    }
  });

  it("counts the files in the batch row correctly", async () => {
    const dir = writeTempDir([
      { name: "a.csv", contents: makeCsv("2026-01-01", [validRow("1001", "LOVES #100")]) },
      { name: "b.csv", contents: makeCsv("2026-01-02", [validRow("1002", "LOVES #200")]) },
    ]);
    const files: BackfillFile[] = [
      { filename: "a.csv", path: path.join(dir, "a.csv") },
      { filename: "b.csv", path: path.join(dir, "b.csv") },
    ];

    const result = await backfillFiles(scopedPool, files);

    const batch = await scopedPool.query(
      "SELECT file_count FROM import_batches WHERE id = $1",
      [result.batchId],
    );
    expect(batch.rows[0].file_count).toBe(2);
  });
});
