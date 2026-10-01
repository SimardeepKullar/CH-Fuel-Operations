import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { ingestFile } from "../../src/ingest/ingestFile.js";
import { resolveStation } from "../../src/resolve/resolveStation.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dirname, "../../..");
const migrationsDir = path.join(repoRoot, "migrations/synthetic");
const loaderScript = path.join(repoRoot, "scripts/resolve_from_operator.py");
const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * The directory load is `scripts/resolve_from_operator.py` (T-60 step 60.3),
 * so this suite runs the real script. CI installs no Python (ci.yml), so it
 * also skips when no interpreter with the loader's imports is on PATH — the
 * pure mapping it shares with operatorExport.ts is asserted there, in CI.
 */
function findPython(): string | null {
  for (const exe of ["python", "python3"]) {
    const probe = spawnSync(exe, ["-c", "import pandas, psycopg2"], { encoding: "utf8" });
    if (probe.status === 0) return exe;
  }
  return null;
}
const python = hasDatabase ? findPython() : null;

/** DATABASE_URL pointed at a scoped schema, via libpq's `options` URI parameter. */
function scopedUrl(schema: string): string {
  const base = process.env.DATABASE_URL!;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}options=${encodeURIComponent(`-c search_path=${schema},public`)}`;
}

interface LoaderReport {
  total_stations?: number;
  unmatched?: string[];
  bvd_directory: { directory_stations: number; inserted: number; updated: number; skipped: string[] };
}

function runLoader(schema: string, args: string[]): LoaderReport {
  const result = spawnSync(python!, [loaderScript, "--no-fixture", ...args], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: scopedUrl(schema) },
  });
  if (result.status !== 0) {
    throw new Error(`loader exited ${result.status}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as LoaderReport;
}

/** Every column but `last_seen_at`, which a re-load refreshes by design. */
async function snapshot(pool: Pool, country: string): Promise<unknown[]> {
  const { rows } = await pool.query(
    `SELECT to_jsonb(s) - 'last_seen_at' AS row FROM stations s
     WHERE country = $1 ORDER BY site_ref`,
    [country],
  );
  return rows.map((r) => r.row);
}

describe.skipIf(!hasDatabase || !python)("BVD directory load (integration, T-60)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_directory_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);
    await ingestFile(
      scopedPool,
      readFileSync(path.join(repoRoot, "backend/test/fixtures/bvd-prices/sample.csv")),
      { sourceFilename: "sample.csv" },
    );
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("inserts 91 CA stations, names the skipped row, and a second run changes nothing", async () => {
    const usBefore = await snapshot(scopedPool, "US");

    const first = runLoader(schema, ["--directory-only"]);
    expect(first.bvd_directory).toEqual({
      directory_stations: 91,
      inserted: 91,
      updated: 0,
      skipped: ["BVD Nisku"],
    });
    const caAfterFirst = await snapshot(scopedPool, "CA");
    expect(caAfterFirst).toHaveLength(91);

    const second = runLoader(schema, ["--directory-only"]);
    expect(second.bvd_directory).toMatchObject({ inserted: 0, updated: 91 });
    expect(await snapshot(scopedPool, "CA")).toEqual(caAfterFirst);

    // The Love's rows the price sheet created are untouched by either run.
    expect(await snapshot(scopedPool, "US")).toEqual(usBefore);
  });

  it("writes each CA row as the directory's own placement", async () => {
    runLoader(schema, ["--directory-only"]);
    const { rows } = await scopedPool.query(
      `SELECT name_raw, city_raw, state_usps, country, resolution, uncertainty_miles,
              resolution_source, truck_accessible, store_number, operator_attrs,
              ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon
       FROM stations WHERE supplier = 'BVD' AND site_ref = '58156'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name_raw: "BVD Comber",
      city_raw: "Comber",
      state_usps: "ON",
      country: "CA",
      resolution: "exact",
      uncertainty_miles: "0.000",
      resolution_source: "bvd_directory",
      truck_accessible: "unverified",
      store_number: null,
      lat: 42.23884,
      lon: -82.54973,
    });
    expect(Object.keys(rows[0].operator_attrs).sort()).toEqual(
      ["Address", "CatScale", "DEFAtPump", "Exit", "Highway", "PostalCode", "Status", "StoreId", "TruckParking"],
    );
  });

  it("resolveStation finds Comber by its invoice Site #", async () => {
    runLoader(schema, ["--directory-only"]);
    const { rows } = await scopedPool.query<{ id: string }>(
      "SELECT id FROM stations WHERE supplier = 'BVD' AND site_ref = '58156'",
    );
    expect(await resolveStation(scopedPool, "58156", "BVD COMBER")).toBe(rows[0]!.id);
  });

  it("the Love's join stays US-only once CA rows exist", async () => {
    runLoader(schema, ["--directory-only"]);
    const report = runLoader(schema, []);
    // sample.csv's 12 US stations — not 12 + 91 — and only #306 unmatched.
    expect(report.total_stations).toBe(12);
    expect(report.unmatched).toEqual(["LOVES #306"]);
    const { rows } = await scopedPool.query(
      "SELECT count(*)::int AS n FROM stations WHERE country = 'CA' AND brand_normalized IS NOT NULL",
    );
    expect(rows[0].n).toBe(0);
  });

  it("a Site # already held by a US station fails the load and moves nothing", async () => {
    await scopedPool.query(
      `INSERT INTO stations (supplier, site_ref, name_raw, city_raw, city_normalized, state_usps)
       VALUES ('BVD', '58156', 'LOVES #999', 'Dallas', 'Dallas', 'TX')`,
    );
    expect(() => runLoader(schema, ["--directory-only"])).toThrow(/collides with a non-CA station/);
    const { rows } = await scopedPool.query("SELECT count(*)::int AS n FROM stations WHERE country = 'CA'");
    expect(rows[0].n).toBe(0);
    const { rows: us } = await scopedPool.query(
      "SELECT state_usps, geom FROM stations WHERE site_ref = '58156'",
    );
    expect(us).toEqual([{ state_usps: "TX", geom: null }]);
  });
});
