import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { GeocodeError, resolveAddress, resolveLocation } from "../../src/catalog/geocode.js";
import type { GeocodeCandidate, GeocodeResult, GeocodeQuery, GeocodingProvider } from "../../src/routing/geocodeProvider.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

function candidate(overrides: Partial<GeocodeCandidate> = {}): GeocodeCandidate {
  return {
    location: { lat: 41.878658, lng: -87.635868 },
    label: "233 South Wacker Drive, Central, Chicago, IL, USA",
    confidence: 1,
    layer: "address",
    matchType: "exact",
    regionCode: "IL",
    countryCode: "USA",
    ...overrides,
  };
}

/** A fake provider so this suite spends no live geocoding calls — `orsGeocoder.test.ts` and `geocode.test.ts` already cover the real adapter offline against recorded fixtures. */
class FakeGeocodingProvider implements GeocodingProvider {
  readonly name = "ors" as const;
  calls: GeocodeQuery[] = [];
  private results: GeocodeResult[];

  constructor(results: GeocodeResult[]) {
    this.results = results;
  }

  async geocode(query: GeocodeQuery): Promise<GeocodeResult> {
    this.calls.push(query);
    const result = this.results[this.calls.length - 1] ?? this.results[this.results.length - 1]!;
    return result;
  }
}

function resultWith(...candidates: GeocodeCandidate[]): GeocodeResult {
  return { candidates, attribution: "https://openrouteservice.org/terms-of-service/#attribution-geocode", providerRaw: {} };
}

describe.skipIf(!hasDatabase)("resolveLocation / resolveAddress (integration, T-15)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_schema_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(pool, migrationsDir);
  });

  afterEach(async () => {
    await pool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  const NOON = new Date("2026-09-15T12:00:00Z");

  it("{lat,lng} bypasses geocoding entirely — no provider call, no database row", async () => {
    const geocoder = new FakeGeocodingProvider([resultWith(candidate())]);

    const result = await resolveLocation({ lat: 41.8781, lng: -87.6298 }, "origin", { pool, geocoder, now: NOON });

    expect(result).toEqual({
      label: null,
      location: { lat: 41.8781, lng: -87.6298 },
      source: "coordinates",
      attribution: null,
    });
    expect(geocoder.calls).toEqual([]);
    const { rows } = await pool.query(`SELECT * FROM saved_locations`);
    expect(rows).toEqual([]);
  });

  it("a miss geocodes once and caches with the provider's attribution", async () => {
    const geocoder = new FakeGeocodingProvider([resultWith(candidate())]);

    const result = await resolveAddress("233 S Wacker Dr, Chicago, IL 60606", "origin", { pool, geocoder, now: NOON });

    expect(geocoder.calls).toHaveLength(1);
    expect(result).toEqual({
      label: "233 South Wacker Drive, Central, Chicago, IL, USA",
      location: { lat: 41.878658, lng: -87.635868 },
      source: "geocoded",
      attribution: "https://openrouteservice.org/terms-of-service/#attribution-geocode",
    });

    const { rows } = await pool.query(`SELECT * FROM saved_locations`);
    expect(rows).toHaveLength(1);
  });

  it("a hit makes no provider call and still carries attribution", async () => {
    const geocoder = new FakeGeocodingProvider([resultWith(candidate())]);
    await resolveAddress("233 S Wacker Dr, Chicago, IL 60606", "origin", { pool, geocoder, now: NOON });
    expect(geocoder.calls).toHaveLength(1);

    const soonAfter = new Date(NOON.getTime() + 60_000);
    const result = await resolveAddress("233 S. Wacker Dr., Chicago, IL 60606", "origin", {
      pool,
      geocoder,
      now: soonAfter,
    });

    expect(geocoder.calls).toHaveLength(1); // still just the one call from the first request
    expect(result.source).toBe("cache");
    expect(result.location).toEqual({ lat: 41.878658, lng: -87.635868 });
    expect(result.attribution).toBe("https://openrouteservice.org/terms-of-service/#attribution-geocode");
  });

  it("two spellings of the same address are one cache row (address normalisation)", async () => {
    const geocoder = new FakeGeocodingProvider([resultWith(candidate())]);
    await resolveAddress("233 S Wacker Dr, Chicago, IL 60606", "origin", { pool, geocoder, now: NOON });
    await resolveAddress("233   South   Wacker   Drive,  Chicago,  Illinois  60606", "origin", {
      pool,
      geocoder,
      now: NOON,
    });

    expect(geocoder.calls).toHaveLength(1);
    const { rows } = await pool.query(`SELECT * FROM saved_locations`);
    expect(rows).toHaveLength(1);
  });

  it("an expired row is re-geocoded, not served stale", async () => {
    const geocoder = new FakeGeocodingProvider([
      resultWith(candidate()),
      resultWith(candidate({ location: { lat: 41.9, lng: -87.7 }, label: "updated match" })),
    ]);
    await resolveAddress("233 S Wacker Dr, Chicago, IL 60606", "origin", { pool, geocoder, now: NOON });

    const past31Days = new Date(NOON.getTime() + 31 * 24 * 60 * 60 * 1000);
    const result = await resolveAddress("233 S Wacker Dr, Chicago, IL 60606", "origin", {
      pool,
      geocoder,
      now: past31Days,
    });

    expect(geocoder.calls).toHaveLength(2);
    expect(result.source).toBe("geocoded");
    expect(result.label).toBe("updated match");
  });

  it("a rejected geocode is never cached", async () => {
    const geocoder = new FakeGeocodingProvider([resultWith()]); // no_match

    await expect(
      resolveAddress("zzzqxv1234nonexistentplace", "origin", { pool, geocoder, now: NOON }),
    ).rejects.toBeInstanceOf(GeocodeError);

    const { rows } = await pool.query(`SELECT * FROM saved_locations`);
    expect(rows).toEqual([]);
  });

  it("never writes to or reads from stations — no statement issued by the resolver references the stations table", async () => {
    await pool.query(
      `INSERT INTO stations
         (supplier, site_ref, name_raw, store_number, city_raw, city_normalized, state_usps,
          geom, resolution, truck_accessible)
       VALUES ('BVD', 'REF1', 'LOVES #1', 1, 'Testville', 'TESTVILLE', 'TX',
               ST_SetSRID(ST_MakePoint(-97, 33), 4326)::geography, 'exact', 'operator_verified')`,
    );
    const before = await pool.query(`SELECT ST_AsText(geom) AS geom FROM stations`);

    const queries: string[] = [];
    const originalQuery = pool.query.bind(pool);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pool as any).query = (...args: any[]) => {
      const text = typeof args[0] === "string" ? args[0] : (args[0]?.text ?? "");
      queries.push(text);
      return originalQuery(...(args as Parameters<typeof originalQuery>));
    };

    const geocoder = new FakeGeocodingProvider([resultWith(candidate())]);
    await resolveAddress("233 S Wacker Dr, Chicago, IL 60606", "origin", { pool, geocoder, now: NOON });

    expect(queries.some((q) => /\bstations\b/i.test(q))).toBe(false);

    const after = await pool.query(`SELECT ST_AsText(geom) AS geom FROM stations`);
    expect(after.rows).toEqual(before.rows);
  });
});
