import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import type { PriceSheetSummary } from "../../src/catalog/priceSheets.js";
import { runBackfillCli } from "../../src/cli/backfill.js";
import { ingestFile } from "../../src/ingest/ingestFile.js";
import { scopedSchema, teardown } from "./support/actualsFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

// Same composition trick as backfillCli.test.ts: the committed sample sheet,
// re-dated into a temp directory, with a byte-identical " (1)" duplicate of
// one day and a gap left in the sequence.
const sampleSheet = () => readFileSync(new URL("../fixtures/bvd-prices/sample.csv", import.meta.url), "utf8");
const withEffectiveDate = (csv: string, date: string) =>
  csv.replace(/("Effective Date: ",)\d{4}-\d{2}-\d{2}/, `$1${date}`);

function sampleJanuaryDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ch-price-sheets-"));
  const day = (date: string) => withEffectiveDate(sampleSheet(), date);
  writeFileSync(path.join(dir, "pcn-usd-9000001-981.csv"), day("2026-01-01"));
  writeFileSync(path.join(dir, "pcn-usd-9000002-981.csv"), day("2026-01-02"));
  writeFileSync(path.join(dir, "pcn-usd-9000002-981 (1).csv"), day("2026-01-02"));
  writeFileSync(path.join(dir, "pcn-usd-9000004-981.csv"), day("2026-01-04"));
  return dir;
}

// The real price sheets are gitignored — only present on a dev machine that
// has run `npm run ingest`/`backfill` against data/bvd-prices/. CI has neither.
const REAL_DIR = new URL("../../../data/bvd-prices/", import.meta.url);
const REAL_AUGUST_FILENAME = "pcn-usd-9206810-981.csv";
const REAL_JANUARY_DIR = new URL("2026-01/", REAL_DIR);

interface Scenario {
  label: string;
  available: boolean;
  augustFilename: string;
  augustSheet(): Buffer;
  januaryDir(): string;
  expected: {
    augustRowCount: number;
    augustStationCount: number;
    januaryRowCount: number;
    januaryStationCount: number;
    januaryDistinctDates: number;
    gap: string;
    totalEntries: number;
  };
}

const scenarios: readonly Scenario[] = [
  {
    label: "sample sheet",
    available: true,
    augustFilename: "sample.csv",
    augustSheet: () => readFileSync(new URL("../fixtures/bvd-prices/sample.csv", import.meta.url)),
    januaryDir: sampleJanuaryDir,
    expected: {
      augustRowCount: 12,
      augustStationCount: 12,
      januaryRowCount: 12,
      januaryStationCount: 12,
      januaryDistinctDates: 3,
      gap: "2026-01-03",
      totalEntries: 4,
    },
  },
  {
    label: "real data/bvd-prices",
    available: existsSync(new URL(REAL_AUGUST_FILENAME, REAL_DIR)) && existsSync(REAL_JANUARY_DIR),
    augustFilename: REAL_AUGUST_FILENAME,
    augustSheet: () => readFileSync(new URL(REAL_AUGUST_FILENAME, REAL_DIR)),
    januaryDir: () => fileURLToPath(REAL_JANUARY_DIR),
    expected: {
      augustRowCount: 605,
      augustStationCount: 605,
      januaryRowCount: 594,
      januaryStationCount: 594,
      januaryDistinctDates: 30,
      gap: "2026-01-11",
      totalEntries: 31,
    },
  },
];

describe.skipIf(!hasDatabase)("GET /price-sheets (integration, T-18 step 18.1)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let app: App;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_price_sheets"));
    app = createApp({ pool });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await teardown(adminPool, pool, schema);
  });

  async function getSheets(): Promise<PriceSheetSummary[]> {
    const response = await app.handle(new Request("http://localhost/api/v1/price-sheets"));
    expect(response.status).toBe(200);
    return (await response.json()) as PriceSheetSummary[];
  }

  for (const dataset of scenarios) {
    it.skipIf(!dataset.available)(
      `lists August plus the January backfill newest first, with the right stationCount per sheet and no placeholder for the gap [${dataset.label}]`,
      async () => {
        const { expected } = dataset;
        await ingestFile(pool, dataset.augustSheet(), { sourceFilename: dataset.augustFilename });
        const exitCode = await runBackfillCli([dataset.januaryDir()], pool);
        expect(exitCode).toBe(0);
        expect(errorSpy).not.toHaveBeenCalled();

        const sheets = await getSheets();

        expect(sheets).toHaveLength(expected.totalEntries);
        const dates = sheets.map((s) => s.effectiveOn);
        expect(dates).toEqual(dates.toSorted().reverse());

        const august = sheets.find((s) => s.effectiveOn === "2026-08-22");
        expect(august).toBeDefined();
        expect(august!.rowCount).toBe(expected.augustRowCount);
        expect(august!.stationCount).toBe(expected.augustStationCount);

        const january = sheets.filter((s) => s.effectiveOn.startsWith("2026-01"));
        expect(january).toHaveLength(expected.januaryDistinctDates);
        for (const sheet of january) {
          expect(sheet.rowCount).toBe(expected.januaryRowCount);
          expect(sheet.stationCount).toBe(expected.januaryStationCount);
        }

        // The missing day is simply absent — no placeholder row.
        expect(sheets.some((s) => s.effectiveOn === expected.gap)).toBe(false);
      },
      180000,
    );
  }

  it("a fresh database with no imports at all returns an empty list, not an error", async () => {
    const sheets = await getSheets();
    expect(sheets).toEqual([]);
  });
});
