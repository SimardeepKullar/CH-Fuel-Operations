import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runIngestCli } from "../../src/cli/ingest.js";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

function tempCsvPath(rows: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ch-ingest-cli-"));
  const meta =
    `"Company Id: ",981," ","Company Name: ","2043733 ONTARIO INC."," ",DBA,"CH LOGISTIX"," ","Effective Date: ",2026-08-22`;
  const header =
    'SITE,NAME,CITY,STATE,PROD,COST,"FEDERAL TAX","STATE TAX","SALES TAX",FREIGHT,OTHER,"TOTAL COST","RETAIL PRICE","YOUR PRICE",SAVINGS';
  const filePath = path.join(dir, "sheet.csv");
  writeFileSync(filePath, [meta, header, ...rows].join("\n"));
  return filePath;
}

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

describe.skipIf(!hasDatabase)("runIngestCli (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    schema = `test_ingest_cli_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  it("prints the report and exits 0 on a clean import", async () => {
    const filePath = tempCsvPath([validRow("1277", "LOVES #368")]);

    const exitCode = await runIngestCli([filePath], scopedPool);

    expect(exitCode).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("rows accepted:     1");
    expect(printed).toContain("rows rejected:     0");
  });

  it("exits non-zero with the reason on stderr for a malformed file", async () => {
    const exitCode = await runIngestCli(
      [path.join(tmpdir(), "ch-ingest-cli-does-not-exist.csv")],
      scopedPool,
    );

    expect(exitCode).not.toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("exits 0 and says so on a duplicate", async () => {
    const filePath = tempCsvPath([validRow("1277", "LOVES #368")]);

    const first = await runIngestCli([filePath], scopedPool);
    expect(first).toBe(0);
    logSpy.mockClear();

    const second = await runIngestCli([filePath], scopedPool);

    expect(second).toBe(0);
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed.toLowerCase()).toContain("already imported");
  });
});
