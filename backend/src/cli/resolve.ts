import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { matchStationsToGazetteer, type PlaceCentroid, type StationForGazetteerMatch } from "../resolution/gazetteer.js";
import { getPool } from "../db/pool.js";
import type { TruckAccessible } from "../db/types.js";

const DEFAULT_SUPPLIER = "BVD";

export interface GazetteerResolveReport {
  scanned: number;
  resolved: number;
  stillUnresolved: string[];
}

interface UnresolvedStationRow {
  id: string;
  site_ref: string;
  city_raw: string;
  state_usps: string;
}

interface PlaceCentroidRow {
  state_usps: string;
  name_normalized: string;
  uncertainty_miles: string;
  lat: string;
  lon: string;
}

/**
 * Tier 3: resolves every `unresolved` station whose (state, normalized
 * city) matches a `place_centroids` row. Takes no argv, prints nothing —
 * `runResolveCli` is the only caller that touches stdout (CLAUDE.md).
 */
export async function resolveViaGazetteer(
  pool: Pool,
  opts: { supplier?: string } = {},
): Promise<GazetteerResolveReport> {
  const supplier = opts.supplier ?? DEFAULT_SUPPLIER;

  const { rows: unresolvedRows } = await pool.query<UnresolvedStationRow>(
    `SELECT id, site_ref, city_raw, state_usps FROM stations
     WHERE supplier = $1 AND resolution = 'unresolved'`,
    [supplier],
  );
  if (unresolvedRows.length === 0) {
    return { scanned: 0, resolved: 0, stillUnresolved: [] };
  }

  const states = [...new Set(unresolvedRows.map((row) => row.state_usps))];
  const { rows: centroidRows } = await pool.query<PlaceCentroidRow>(
    `SELECT state_usps, name_normalized, uncertainty_miles,
            ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon
     FROM place_centroids
     WHERE state_usps = ANY($1)`,
    [states],
  );
  const centroids: PlaceCentroid[] = centroidRows.map((row) => ({
    stateUsps: row.state_usps,
    nameNormalized: row.name_normalized,
    uncertaintyMiles: Number(row.uncertainty_miles),
    latitude: Number(row.lat),
    longitude: Number(row.lon),
  }));

  const stations: StationForGazetteerMatch[] = unresolvedRows.map((row) => ({
    id: row.id,
    cityRaw: row.city_raw,
    stateUsps: row.state_usps,
  }));
  const results = matchStationsToGazetteer(stations, centroids);

  const client = await pool.connect();
  let resolved = 0;
  const stillUnresolved: string[] = [];
  try {
    await client.query("BEGIN");
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const row = unresolvedRows[i]!;
      if (!result.match) {
        stillUnresolved.push(row.site_ref);
        continue;
      }
      await client.query(
        `UPDATE stations
         SET resolution = 'city',
             uncertainty_miles = $1,
             resolution_source = 'gazetteer',
             resolved_at = now(),
             city_normalized = $2,
             geom = ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
         WHERE id = $5`,
        [
          result.match.uncertaintyMiles,
          result.cityNormalized,
          result.match.longitude,
          result.match.latitude,
          row.id,
        ],
      );
      resolved++;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { scanned: unresolvedRows.length, resolved, stillUnresolved };
}

export interface ManualResolveOptions {
  siteRef: string;
  latitude: number;
  longitude: number;
  source: string;
  truckAccessible?: TruckAccessible;
  supplier?: string;
}

export interface ManualResolveResult {
  siteRef: string;
  resolutionSource: string;
  resolvedAt: Date;
}

/**
 * A single station's coordinates from an approved, non-provider source —
 * the operator export, OSM, or the Census gazetteer (CLAUDE.md). Always
 * `resolution = 'exact'`: a manually-entered point carries no meaningful
 * uncertainty of its own, unlike a gazetteer city centroid.
 */
export async function resolveManually(
  pool: Pool,
  opts: ManualResolveOptions,
): Promise<ManualResolveResult> {
  const supplier = opts.supplier ?? DEFAULT_SUPPLIER;
  const truckAccessible = opts.truckAccessible ?? "unverified";

  const { rows } = await pool.query<{ id: string; resolved_at: Date }>(
    `UPDATE stations
     SET resolution = 'exact',
         uncertainty_miles = 0,
         resolution_source = $1,
         resolved_at = now(),
         truck_accessible = $2,
         geom = ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
     WHERE supplier = $5 AND site_ref = $6
     RETURNING id, resolved_at`,
    [opts.source, truckAccessible, opts.longitude, opts.latitude, supplier, opts.siteRef],
  );

  const row = rows[0];
  if (!row) {
    throw new Error(`no station found for supplier ${supplier}, site_ref ${opts.siteRef}`);
  }
  return { siteRef: opts.siteRef, resolutionSource: opts.source, resolvedAt: row.resolved_at };
}

function printGazetteerReport(report: GazetteerResolveReport): void {
  console.log(`scanned:           ${report.scanned}`);
  console.log(`resolved:          ${report.resolved}`);
  if (report.stillUnresolved.length > 0) {
    console.log(`still unresolved:  ${report.stillUnresolved.join(", ")}`);
  }
}

/** argv and stdout, nothing else — same split as `cli/ingest.ts` and `cli/backfill.ts`. */
export async function runResolveCli(argv: string[], pool: Pool): Promise<number> {
  const [subcommand, ...rest] = argv;

  if (subcommand === "gazetteer") {
    try {
      printGazetteerReport(await resolveViaGazetteer(pool));
      return 0;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  if (subcommand === "manual") {
    const [siteRef, latStr, lonStr, source, truckAccessible] = rest;
    if (!siteRef || !latStr || !lonStr || !source) {
      console.error("usage: resolve manual <site_ref> <lat> <lon> <source> [truck_accessible]");
      return 1;
    }
    const latitude = Number(latStr);
    const longitude = Number(lonStr);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      console.error(`invalid coordinates: ${latStr}, ${lonStr}`);
      return 1;
    }
    try {
      const result = await resolveManually(pool, {
        siteRef,
        latitude,
        longitude,
        source,
        truckAccessible: truckAccessible as TruckAccessible | undefined,
      });
      console.log(
        `resolved ${result.siteRef} manually from ${result.resolutionSource} ` +
          `at ${result.resolvedAt.toISOString()}`,
      );
      return 0;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  console.error("usage: resolve <gazetteer|manual> ...");
  return 1;
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  const pool = getPool();
  runResolveCli(process.argv.slice(2), pool)
    .then(async (exitCode) => {
      process.exitCode = exitCode;
      await pool.end();
    })
    .catch(async (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
      await pool.end();
    });
}
