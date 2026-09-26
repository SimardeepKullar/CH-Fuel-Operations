import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runResolveCli } from "../../src/cli/resolve.js";
import { ingestFile } from "../../src/ingest/ingestFile.js";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

// The real price sheets are gitignored — see the root .gitignore. Tests that
// assert their exact figures skip when they are absent, as CI's checkout is.
const REAL_AUGUST = new URL("../../../data/bvd-prices/pcn-usd-9206810-981.csv", import.meta.url);
const hasRealData = existsSync(REAL_AUGUST);
// The sample sheet's own #306 (Dandridge, TN) — an invented BVD SITE, as the sheet is synthetic.
const SAMPLE_STORE_306_SITE_REF = "71444";

// The real store #306: LOVES #306, Dandridge, TN, site_ref 42284 — the one
// station T-08's operator-export join could not place (BUILD-PLAN 9.2). It is
// temporarily closed (Love's omits it from the export) and stays unresolved in
// the dev DB; these tests use it to exercise the manual-entry path.
const STORE_306_SITE_REF = "42284";
// OpenStreetMap node 6616599586 — brand=Love's, ref=306, hgv=yes, 1058 Deep
// Springs Road, Dandridge TN 37725. An approved source per CLAUDE.md
// ("operator export, OSM, or the Census gazetteer" — never a provider geocode).
const STORE_306_OSM_LAT = 36.0119881;
const STORE_306_OSM_LON = -83.5323062;

function meta(effectiveDate: string): string {
  return `"Company Id: ",981," ","Company Name: ","2043733 ONTARIO INC."," ",DBA,"CH LOGISTIX"," ","Effective Date: ",${effectiveDate}`;
}
const header =
  'SITE,NAME,CITY,STATE,PROD,COST,"FEDERAL TAX","STATE TAX","SALES TAX",FREIGHT,OTHER,"TOTAL COST","RETAIL PRICE","YOUR PRICE",SAVINGS';

function validRow(
  site: string,
  name: string,
  opts: { city?: string; state?: string } = {},
): string {
  return [
    site,
    `"${name}"`,
    opts.city ?? "Clanton",
    opts.state ?? "AL",
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

function makeCsv(effectiveDate: string, rows: string[]): Buffer {
  return Buffer.from([meta(effectiveDate), header, ...rows].join("\n"), "utf8");
}

describe.skipIf(!hasDatabase)("runResolveCli (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    schema = `test_resolve_cli_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  describe("gazetteer subcommand", () => {
    it("resolves an unresolved station whose city matches a seeded centroid", async () => {
      await ingestFile(
        scopedPool,
        makeCsv("2026-08-22", [validRow("9001", "LOVES #900", { city: "ELOY", state: "AZ" })]),
        { sourceFilename: "a.csv" },
      );
      await scopedPool.query(
        `INSERT INTO place_centroids (state_usps, name_normalized, name_raw, geom, uncertainty_miles, source)
         VALUES ('AZ', 'Eloy', 'Eloy city',
                 ST_SetSRID(ST_MakePoint(-111.5527, 32.7548), 4326)::geography, 3.748,
                 'census_gazetteer_2024_place')`,
      );

      const exitCode = await runResolveCli(["gazetteer"], scopedPool);
      expect(exitCode).toBe(0);
      expect(errorSpy).not.toHaveBeenCalled();

      const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toContain("scanned:           1");
      expect(printed).toContain("resolved:          1");

      const { rows } = await scopedPool.query(
        `SELECT resolution, resolution_source, uncertainty_miles, city_normalized, geom IS NOT NULL AS has_geom
         FROM stations WHERE site_ref = '9001'`,
      );
      expect(rows[0].resolution).toBe("city");
      expect(rows[0].resolution_source).toBe("gazetteer");
      expect(Number(rows[0].uncertainty_miles)).toBe(3.748);
      expect(rows[0].city_normalized).toBe("Eloy");
      expect(rows[0].has_geom).toBe(true);
    });

    it("leaves a station unresolved and names it when no centroid matches", async () => {
      await ingestFile(
        scopedPool,
        makeCsv("2026-08-22", [
          validRow("9002", "LOVES #901", { city: "NOWHERESVILLE", state: "AZ" }),
        ]),
        { sourceFilename: "b.csv" },
      );

      const exitCode = await runResolveCli(["gazetteer"], scopedPool);
      expect(exitCode).toBe(0);

      const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toContain("still unresolved:  9002");

      const { rows } = await scopedPool.query(
        `SELECT resolution FROM stations WHERE site_ref = '9002'`,
      );
      expect(rows[0].resolution).toBe("unresolved");
    });
  });

  describe("manual subcommand", () => {
    it("resolves a named station exactly, recording its source and resolved_at", async () => {
      await ingestFile(
        scopedPool,
        makeCsv("2026-08-22", [
          validRow(STORE_306_SITE_REF, "LOVES #306", { city: "Dandridge", state: "TN" }),
        ]),
        { sourceFilename: "c.csv" },
      );

      // Read the clock the database itself will stamp `resolved_at` with.
      // Comparing against the host's clock made this flaky by a millisecond
      // or two, since Postgres runs in a container with its own clock.
      const { rows: clock } = await scopedPool.query<{ now: Date }>("SELECT now() AS now");
      const before = clock[0]!.now;
      const exitCode = await runResolveCli(
        [
          "manual",
          STORE_306_SITE_REF,
          String(STORE_306_OSM_LAT),
          String(STORE_306_OSM_LON),
          "osm",
          "osm_verified",
        ],
        scopedPool,
      );
      expect(exitCode).toBe(0);
      expect(errorSpy).not.toHaveBeenCalled();

      const { rows } = await scopedPool.query(
        `SELECT resolution, uncertainty_miles, resolution_source, resolved_at, truck_accessible,
                ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon
         FROM stations WHERE site_ref = $1`,
        [STORE_306_SITE_REF],
      );
      expect(rows[0].resolution).toBe("exact");
      expect(Number(rows[0].uncertainty_miles)).toBe(0);
      expect(rows[0].resolution_source).toBe("osm");
      expect(rows[0].truck_accessible).toBe("osm_verified");
      expect(new Date(rows[0].resolved_at).getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(Number(rows[0].lat)).toBeCloseTo(STORE_306_OSM_LAT, 5);
      expect(Number(rows[0].lon)).toBeCloseTo(STORE_306_OSM_LON, 5);
    });

    it("exits non-zero with the reason on stderr for an unknown site_ref", async () => {
      const exitCode = await runResolveCli(
        ["manual", "does-not-exist", "36", "-83", "osm"],
        scopedPool,
      );
      expect(exitCode).not.toBe(0);
      expect(errorSpy).toHaveBeenCalled();
    });

    it("rejects non-numeric coordinates before touching the database", async () => {
      const exitCode = await runResolveCli(
        ["manual", STORE_306_SITE_REF, "not-a-number", "-83", "osm"],
        scopedPool,
      );
      expect(exitCode).not.toBe(0);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  /**
   * A price sheet ends up fully resolved: the operator export places every
   * station but #306, and one manual entry closes that last gap.
   */
  async function expectFullyResolved(sheet: Buffer, filename: string, rows: number, unmatchedSiteRef: string) {
    await ingestFile(scopedPool, sheet, { sourceFilename: filename });

    // Simulates T-08's operator-export tier (a separate, already-merged
    // ticket run via scripts/resolve_from_operator.py) resolving every
    // matched station, leaving only #306 for this ticket to close.
    await scopedPool.query(
      `UPDATE stations SET resolution = 'exact', uncertainty_miles = 0,
                            resolution_source = 'operator_export', resolved_at = now(),
                            truck_accessible = 'operator_verified',
                            geom = ST_SetSRID(ST_MakePoint(-97.5, 35.4), 4326)::geography
       WHERE site_ref <> $1`,
      [unmatchedSiteRef],
    );

    const before = await scopedPool.query(`SELECT count(*) FROM stations WHERE geom IS NULL`);
    expect(before.rows[0].count).toBe("1");

    const exitCode = await runResolveCli(
      [
        "manual",
        unmatchedSiteRef,
        String(STORE_306_OSM_LAT),
        String(STORE_306_OSM_LON),
        "osm",
        "osm_verified",
      ],
      scopedPool,
    );
    expect(exitCode).toBe(0);

    const after = await scopedPool.query(`SELECT count(*) FROM stations WHERE geom IS NOT NULL`);
    expect(after.rows[0].count).toBe(String(rows));
    const stillUnresolved = await scopedPool.query(
      `SELECT count(*) FROM stations WHERE resolution = 'unresolved'`,
    );
    expect(stillUnresolved.rows[0].count).toBe("0");
  }

  it("the sample sheet ends up 12/12 resolved: 11 via tier 1, store #306 via manual entry", async () => {
    await expectFullyResolved(
      readFileSync(new URL("../fixtures/bvd-prices/sample.csv", import.meta.url)),
      "sample.csv",
      12,
      SAMPLE_STORE_306_SITE_REF,
    );
  });

  it.skipIf(!hasRealData)(
    "the real August sheet ends up 605/605 resolved: 604 via tier 1, store #306 via manual entry",
    async () => {
      await expectFullyResolved(
        readFileSync(REAL_AUGUST),
        "pcn-usd-9206810-981.csv",
        605,
        STORE_306_SITE_REF,
      );
    },
    20000,
  );
});
