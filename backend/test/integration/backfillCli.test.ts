import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBackfillCli } from "../../src/cli/backfill.js";
import { ingestFile } from "../../src/ingest/ingestFile.js";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

/** One corpus to backfill: an August sheet that seeds the stations, then a directory of dated sheets. */
interface Scenario {
  label: string;
  available: boolean;
  augustFilename: string;
  augustSheet(): Buffer;
  januaryDir(): string;
  expected: {
    augustRows: number;
    januaryRowsPerFile: number;
    januaryFileCount: number;
    januaryDistinctDates: number;
    januaryGaps: readonly string[];
    duplicatePair: readonly [string, string];
  };
}

// The sample sheet, re-dated into a temp directory: three distinct days with
// 2026-01-03 missing, and a browser-style " (1)" byte-identical copy of one
// day. Built here, not committed, the way backfillInvoices.test.ts composes
// its multi-file scenarios.
const sampleSheet = () => readFileSync(new URL("../fixtures/bvd-prices/sample.csv", import.meta.url), "utf8");
const withEffectiveDate = (csv: string, date: string) =>
  csv.replace(/("Effective Date: ",)\d{4}-\d{2}-\d{2}/, `$1${date}`);

function sampleJanuaryDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ch-backfill-cli-"));
  const day = (date: string) => withEffectiveDate(sampleSheet(), date);
  writeFileSync(path.join(dir, "pcn-usd-9000001-981.csv"), day("2026-01-01"));
  writeFileSync(path.join(dir, "pcn-usd-9000002-981.csv"), day("2026-01-02"));
  writeFileSync(path.join(dir, "pcn-usd-9000002-981 (1).csv"), day("2026-01-02"));
  writeFileSync(path.join(dir, "pcn-usd-9000004-981.csv"), day("2026-01-04"));
  return dir;
}

// The real price sheets are gitignored — see the root .gitignore. The real
// corpus is only exercised on a machine that has the files, as CI's checkout is not.
const REAL_DIR = new URL("../../../data/bvd-prices/", import.meta.url);
const REAL_AUGUST_FILENAME = "pcn-usd-9206810-981.csv";
const REAL_JANUARY_DIR = new URL("2026-01/", REAL_DIR);

const scenarios: readonly Scenario[] = [
  {
    label: "sample sheet",
    available: true,
    augustFilename: "sample.csv",
    augustSheet: () => readFileSync(new URL("../fixtures/bvd-prices/sample.csv", import.meta.url)),
    januaryDir: sampleJanuaryDir,
    expected: {
      augustRows: 12,
      januaryRowsPerFile: 12,
      januaryFileCount: 4,
      januaryDistinctDates: 3,
      januaryGaps: ["2026-01-03"],
      duplicatePair: ["pcn-usd-9000002-981 (1).csv", "pcn-usd-9000002-981.csv"],
    },
  },
  {
    label: "real data/bvd-prices",
    available:
      existsSync(new URL(REAL_AUGUST_FILENAME, REAL_DIR)) && existsSync(REAL_JANUARY_DIR),
    augustFilename: REAL_AUGUST_FILENAME,
    augustSheet: () => readFileSync(new URL(REAL_AUGUST_FILENAME, REAL_DIR)),
    januaryDir: () => fileURLToPath(REAL_JANUARY_DIR),
    expected: {
      augustRows: 605,
      januaryRowsPerFile: 594,
      januaryFileCount: 31,
      januaryDistinctDates: 30,
      januaryGaps: ["2026-01-11"],
      // Byte-identical, SHA-256 84fc7c50…
      duplicatePair: ["pcn-usd-8097639-981 (1).csv", "pcn-usd-8097639-981.csv"],
    },
  },
];

describe.skipIf(!hasDatabase)("runBackfillCli (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    schema = `test_backfill_cli_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  for (const dataset of scenarios) {
    it.skipIf(!dataset.available)(
      `imports every distinct date, skips the byte-identical duplicate, names the gap, stays within the August station set, and is idempotent on re-run [${dataset.label}]`,
      async () => {
        const { expected } = dataset;
        const januaryDir = dataset.januaryDir();
        const augustFilename = dataset.augustFilename;

        await ingestFile(scopedPool, dataset.augustSheet(), { sourceFilename: augustFilename });

        const exitCode = await runBackfillCli([januaryDir], scopedPool);
        expect(exitCode).toBe(0);
        expect(errorSpy).not.toHaveBeenCalled();

        const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
        expect(printed).toContain(`files:             ${expected.januaryFileCount}`);
        expect(printed).toContain(`gaps:              ${expected.januaryGaps.join(", ")}`);

        // Distinct dates from more files: the duplicate never gets its own
        // price_imports row, since ingestFile dedupes on file_sha256.
        const januaryImports = await scopedPool.query<{ effective_date: string }>(
          "SELECT effective_date::text AS effective_date FROM price_imports WHERE source_filename <> $1",
          [augustFilename],
        );
        expect(januaryImports.rows).toHaveLength(expected.januaryDistinctDates);
        expect(new Set(januaryImports.rows.map((r) => r.effective_date)).size).toBe(
          expected.januaryDistinctDates,
        );

        // Byte-identical pair: whichever file is processed second dedupes
        // against the first and never gets its own price_imports row — assert
        // on the pair, not on a specific filename, since directory sort order
        // decides which one goes first.
        const duplicatePairImports = await scopedPool.query(
          "SELECT source_filename FROM price_imports WHERE source_filename = ANY($1)",
          [expected.duplicatePair],
        );
        expect(duplicatePairImports.rows).toHaveLength(1);

        // The same number of price rows on every date.
        const perDate = await scopedPool.query<{ c: string }>(
          `SELECT count(*) AS c FROM station_prices
             WHERE valid_on BETWEEN '2026-01-01' AND '2026-01-31'
             GROUP BY valid_on`,
        );
        expect(perDate.rows).toHaveLength(expected.januaryDistinctDates);
        for (const row of perDate.rows) {
          expect(row.c).toBe(String(expected.januaryRowsPerFile));
        }
        const totalRows = String(expected.januaryRowsPerFile * expected.januaryDistinctDates);
        const total = await scopedPool.query<{ c: string }>(
          `SELECT count(*) AS c FROM station_prices
             WHERE valid_on BETWEEN '2026-01-01' AND '2026-01-31'`,
        );
        expect(total.rows[0]?.c).toBe(totalRows);

        // Every January station was already present from the August set — the
        // station count does not grow past August's.
        const distinctStations = await scopedPool.query<{ c: string }>(
          `SELECT count(DISTINCT station_id) AS c FROM station_prices
             WHERE valid_on BETWEEN '2026-01-01' AND '2026-01-31'`,
        );
        expect(distinctStations.rows[0]?.c).toBe(String(expected.januaryRowsPerFile));
        const stationCount = await scopedPool.query<{ c: string }>(
          "SELECT count(*) AS c FROM stations",
        );
        expect(stationCount.rows[0]?.c).toBe(String(expected.augustRows));

        // Re-running the whole directory changes nothing.
        logSpy.mockClear();
        const secondExitCode = await runBackfillCli([januaryDir], scopedPool);
        expect(secondExitCode).toBe(0);

        const importsAfterRerun = await scopedPool.query<{ c: string }>(
          "SELECT count(*) AS c FROM price_imports",
        );
        // The January dates, plus the one August sheet.
        expect(importsAfterRerun.rows[0]?.c).toBe(String(expected.januaryDistinctDates + 1));

        const totalAfterRerun = await scopedPool.query<{ c: string }>(
          `SELECT count(*) AS c FROM station_prices
             WHERE valid_on BETWEEN '2026-01-01' AND '2026-01-31'`,
        );
        expect(totalAfterRerun.rows[0]?.c).toBe(totalRows);
      },
      180000,
    );
  }
});
