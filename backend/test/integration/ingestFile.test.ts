import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestFile } from "../../src/ingest/ingestFile.js";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/bvd-prices/${name}`, import.meta.url));

// The real price sheets are gitignored — see the root .gitignore. Tests that
// assert their exact figures skip when they are absent, as CI's checkout is.
const REAL_AUGUST = new URL("../../../data/bvd-prices/pcn-usd-9206810-981.csv", import.meta.url);
const hasRealData = existsSync(REAL_AUGUST);

function validRow(
  site: string,
  name: string,
  opts: { city?: string; state?: string; prod?: string } = {},
): string {
  return [
    site,
    `"${name}"`,
    opts.city ?? "Clanton",
    opts.state ?? "AL",
    opts.prod ?? "ULSD",
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

function makeCsv(effectiveDate: string, rows: string[]): Buffer {
  const meta =
    `"Company Id: ",981," ","Company Name: ","2043733 ONTARIO INC."," ",DBA,"CH LOGISTIX"," ","Effective Date: ",${effectiveDate}`;
  const header =
    'SITE,NAME,CITY,STATE,PROD,COST,"FEDERAL TAX","STATE TAX","SALES TAX",FREIGHT,OTHER,"TOTAL COST","RETAIL PRICE","YOUR PRICE",SAVINGS';
  return Buffer.from([meta, header, ...rows].join("\n"), "utf8");
}

describe.skipIf(!hasDatabase)("ingestFile (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_ingest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  async function expectFullIngest(sheet: Buffer, sourceFilename: string, rows: number) {
    const report = await ingestFile(scopedPool, sheet, { sourceFilename });

    expect(report.deduped).toBe(false);
    expect(report.rowsRead).toBe(rows);
    expect(report.rowsAccepted).toBe(rows);
    expect(report.rowsRejected).toBe(0);

    const stations = await scopedPool.query("SELECT count(*) FROM stations");
    expect(stations.rows[0].count).toBe(String(rows));

    const prices = await scopedPool.query("SELECT count(*) FROM station_prices");
    expect(prices.rows[0].count).toBe(String(rows));

    const imports = await scopedPool.query("SELECT status FROM price_imports");
    expect(imports.rows).toHaveLength(1);
    expect(imports.rows[0].status).toBe("completed");
  }

  it("ingests the sample sheet into 12 stations, 12 price rows, one completed import", async () => {
    await expectFullIngest(fixture("sample.csv"), "sample.csv", 12);
  });

  it.skipIf(!hasRealData)(
    "ingests the real August sheet into 605 stations, 605 price rows, one completed import",
    async () => {
      await expectFullIngest(readFileSync(REAL_AUGUST), "pcn-usd-9206810-981.csv", 605);
    },
    20000,
  );

  it("quarantines each bad row of edge-rejections.csv with its own reason code and promotes the rest", async () => {
    const report = await ingestFile(scopedPool, fixture("edge-rejections.csv"), {
      sourceFilename: "edge-rejections.csv",
    });

    expect(report.rowsRead).toBe(8);
    expect(report.rowsAccepted).toBe(3);
    expect(report.rowsRejected).toBe(5);

    const rejections = await scopedPool.query(
      "SELECT line_number, site_ref, code FROM import_rejections ORDER BY line_number",
    );
    expect(rejections.rows).toEqual([
      { line_number: 4, site_ref: "8102", code: "UNMAPPED_PRODUCT" },
      { line_number: 6, site_ref: "8104", code: "INVALID_STATE" },
      { line_number: 7, site_ref: "8105", code: "NUMERIC_PARSE_ERROR" },
      { line_number: 8, site_ref: "8106", code: "PRICE_INVARIANT_VIOLATION" },
      { line_number: 9, site_ref: "8107", code: "SCHEMA_ERROR" },
    ]);

    const stations = await scopedPool.query("SELECT site_ref FROM stations ORDER BY site_ref");
    expect(stations.rows.map((r) => r.site_ref)).toEqual(["8101", "8103", "8108"]);
  });

  it.each([
    ["edge-bad-header.csv", /unexpected header shape/],
    ["edge-missing-effective-date.csv", /"Effective Date" not found/],
    ["edge-short-row.csv", /line 4: expected 15 columns, got 14/],
  ])("throws on %s before anything is written — no import, no station, no price", async (name, message) => {
    await expect(ingestFile(scopedPool, fixture(name), { sourceFilename: name })).rejects.toThrow(message);

    for (const table of ["price_imports", "stations", "station_prices", "import_rejections"]) {
      const { rows } = await scopedPool.query(`SELECT count(*) FROM ${table}`);
      expect(rows[0].count, table).toBe("0");
    }
  });

  it("keeps city_raw and derives city_normalized for every dirty city in edge-format.csv", async () => {
    await ingestFile(scopedPool, fixture("edge-format.csv"), { sourceFilename: "edge-format.csv" });

    const stations = await scopedPool.query(
      "SELECT city_raw, city_normalized FROM stations ORDER BY site_ref",
    );
    expect(stations.rows).toEqual([
      { city_raw: "ELOY", city_normalized: "Eloy" },
      { city_raw: "TRUTH OR CONSEQUENCES", city_normalized: "Truth or Consequences" },
      { city_raw: "Mt Juliet", city_normalized: "Mount Juliet" },
      { city_raw: "Mc Calla", city_normalized: "McCalla" },
      { city_raw: "Milton", city_normalized: "Milton" },
    ]);
  });

  it("returns the existing import unchanged and writes nothing on re-ingest", async () => {
    const buffer = makeCsv("2026-08-22", [validRow("1277", "LOVES #368")]);

    const first = await ingestFile(scopedPool, buffer, { sourceFilename: "a.csv" });
    const second = await ingestFile(scopedPool, buffer, { sourceFilename: "a.csv" });

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.rowsAccepted).toBe(first.rowsAccepted);
    expect(second.rowsRead).toBe(first.rowsRead);

    const imports = await scopedPool.query("SELECT count(*) FROM price_imports");
    expect(imports.rows[0].count).toBe("1");

    const stations = await scopedPool.query("SELECT count(*) FROM stations");
    expect(stations.rows[0].count).toBe("1");

    const prices = await scopedPool.query("SELECT count(*) FROM station_prices");
    expect(prices.rows[0].count).toBe("1");
  });

  it("promotes the good rows and records one import_rejections row when one row is bad", async () => {
    const buffer = makeCsv("2026-08-22", [
      validRow("1001", "LOVES #100"),
      validRow("1002", "LOVES #200", { prod: "DYED" }),
      validRow("1003", "LOVES #300"),
    ]);

    const report = await ingestFile(scopedPool, buffer, { sourceFilename: "b.csv" });

    expect(report.rowsRead).toBe(3);
    expect(report.rowsAccepted).toBe(2);
    expect(report.rowsRejected).toBe(1);

    const rejections = await scopedPool.query(
      "SELECT code, site_ref FROM import_rejections",
    );
    expect(rejections.rows).toHaveLength(1);
    expect(rejections.rows[0].code).toBe("UNMAPPED_PRODUCT");
    expect(rejections.rows[0].site_ref).toBe("1002");

    const stations = await scopedPool.query("SELECT count(*) FROM stations");
    expect(stations.rows[0].count).toBe("2");
  });

  it("creates a new station for a new site_ref and updates last_seen_at for an existing one, without duplicating", async () => {
    const fileA = makeCsv("2026-08-22", [validRow("1111", "LOVES #400")]);
    await ingestFile(scopedPool, fileA, { sourceFilename: "day1.csv" });

    const before = await scopedPool.query(
      "SELECT last_seen_at FROM stations WHERE site_ref = '1111'",
    );
    expect(before.rows).toHaveLength(1);

    const fileB = makeCsv("2026-08-23", [validRow("1111", "LOVES #400")]);
    await ingestFile(scopedPool, fileB, { sourceFilename: "day2.csv" });

    const after = await scopedPool.query(
      "SELECT last_seen_at FROM stations WHERE site_ref = '1111'",
    );
    expect(after.rows).toHaveLength(1);
    expect(new Date(after.rows[0].last_seen_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.rows[0].last_seen_at).getTime(),
    );
  });

  it("stores city_normalized from normalizeCity(), never overwriting city_raw", async () => {
    const buffer = makeCsv("2026-08-22", [
      validRow("1277", "LOVES #368", { city: "ELOY", state: "AZ" }),
    ]);
    await ingestFile(scopedPool, buffer, { sourceFilename: "dirty-city.csv" });

    const stations = await scopedPool.query(
      "SELECT city_raw, city_normalized FROM stations WHERE site_ref = '1277'",
    );
    expect(stations.rows).toHaveLength(1);
    expect(stations.rows[0].city_raw).toBe("ELOY");
    expect(stations.rows[0].city_normalized).toBe("Eloy");
  });

  it("produces no stdout output", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const buffer = makeCsv("2026-08-22", [validRow("1277", "LOVES #368")]);
    await ingestFile(scopedPool, buffer, { sourceFilename: "quiet.csv" });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("names new stations, unmapped products and stations absent from this sheet", async () => {
    const fileA = makeCsv("2026-08-22", [
      validRow("1001", "LOVES #100"),
      validRow("1002", "LOVES #200"),
    ]);
    await ingestFile(scopedPool, fileA, { sourceFilename: "dayA.csv" });

    const fileB = makeCsv("2026-08-23", [
      validRow("1001", "LOVES #100"),
      validRow("1003", "LOVES #300"),
      validRow("1004", "LOVES #400", { prod: "DYED" }),
    ]);
    const report = await ingestFile(scopedPool, fileB, { sourceFilename: "dayB.csv" });

    expect(report.newStations).toEqual(["1003"]);
    expect(report.unmappedProducts).toEqual(["DYED"]);
    expect(report.vanishedStations).toEqual(["1002"]);
  });
});
