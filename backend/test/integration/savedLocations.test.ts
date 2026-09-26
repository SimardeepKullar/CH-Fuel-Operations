import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import {
  GEOCODE_CACHE_TTL_MS,
  getCachedLocationAndTouch,
  purgeExpiredLocations,
  saveGeocodedLocation,
} from "../../src/catalog/savedLocations.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("saved_locations cache (integration, T-15)", () => {
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

  it("returns undefined on a miss, writing nothing", async () => {
    const cached = await getCachedLocationAndTouch(pool, "233 s wacker dr chicago il 60606", NOON);
    expect(cached).toBeUndefined();
    const { rows } = await pool.query(`SELECT * FROM saved_locations`);
    expect(rows).toEqual([]);
  });

  it("stores a fresh geocode with expires_at ~30 days out and use_count = 1", async () => {
    await saveGeocodedLocation(
      pool,
      {
        addressRaw: "233 S Wacker Dr, Chicago, IL 60606",
        addressNorm: "233 s wacker dr chicago il 60606",
        matchedLabel: "233 South Wacker Drive, Central, Chicago, IL, USA",
        location: { lat: 41.878658, lng: -87.635868 },
        source: "ors",
      },
      NOON,
    );

    const { rows } = await pool.query<{
      address_raw: string;
      matched_label: string;
      use_count: number;
      expires_at: Date;
      geocode_source: string;
    }>(`SELECT address_raw, matched_label, use_count, expires_at, geocode_source FROM saved_locations`);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.address_raw).toBe("233 S Wacker Dr, Chicago, IL 60606");
    expect(rows[0]!.matched_label).toBe("233 South Wacker Drive, Central, Chicago, IL, USA");
    expect(rows[0]!.use_count).toBe(1);
    expect(rows[0]!.geocode_source).toBe("ors");
    expect(rows[0]!.expires_at.getTime()).toBe(NOON.getTime() + GEOCODE_CACHE_TTL_MS);
  });

  it("a hit returns the cached row and increments use_count, with no provider call needed", async () => {
    const addressNorm = "233 s wacker dr chicago il 60606";
    await saveGeocodedLocation(
      pool,
      {
        addressRaw: "233 S Wacker Dr, Chicago, IL 60606",
        addressNorm,
        matchedLabel: "233 South Wacker Drive, Central, Chicago, IL, USA",
        location: { lat: 41.878658, lng: -87.635868 },
        source: "ors",
      },
      NOON,
    );

    const soonAfter = new Date(NOON.getTime() + 60_000);
    const first = await getCachedLocationAndTouch(pool, addressNorm, soonAfter);
    expect(first).toEqual({
      addressRaw: "233 S Wacker Dr, Chicago, IL 60606",
      matchedLabel: "233 South Wacker Drive, Central, Chicago, IL, USA",
      location: { lat: 41.878658, lng: -87.635868 },
    });

    const second = await getCachedLocationAndTouch(pool, addressNorm, soonAfter);
    expect(second).toBeDefined();

    const { rows } = await pool.query<{ use_count: number }>(
      `SELECT use_count FROM saved_locations WHERE address_norm = $1`,
      [addressNorm],
    );
    expect(rows[0]!.use_count).toBe(3); // 1 on insert + 2 hits
  });

  it("an expired row is not served stale — treated exactly like a miss", async () => {
    const addressNorm = "233 s wacker dr chicago il 60606";
    await saveGeocodedLocation(
      pool,
      {
        addressRaw: "233 S Wacker Dr, Chicago, IL 60606",
        addressNorm,
        matchedLabel: "233 South Wacker Drive, Central, Chicago, IL, USA",
        location: { lat: 41.878658, lng: -87.635868 },
        source: "ors",
      },
      NOON,
    );

    const past31Days = new Date(NOON.getTime() + 31 * 24 * 60 * 60 * 1000);
    const cached = await getCachedLocationAndTouch(pool, addressNorm, past31Days);
    expect(cached).toBeUndefined();

    // Not served stale, but the row itself is untouched by a mere lookup.
    const { rows } = await pool.query<{ use_count: number }>(
      `SELECT use_count FROM saved_locations WHERE address_norm = $1`,
      [addressNorm],
    );
    expect(rows[0]!.use_count).toBe(1);
  });

  it("is expired at exactly expires_at, not just after it", async () => {
    const addressNorm = "233 s wacker dr chicago il 60606";
    await saveGeocodedLocation(
      pool,
      {
        addressRaw: "233 S Wacker Dr, Chicago, IL 60606",
        addressNorm,
        matchedLabel: "233 South Wacker Drive, Central, Chicago, IL, USA",
        location: { lat: 41.878658, lng: -87.635868 },
        source: "ors",
      },
      NOON,
    );
    const exactExpiry = new Date(NOON.getTime() + GEOCODE_CACHE_TTL_MS);
    expect(await getCachedLocationAndTouch(pool, addressNorm, exactExpiry)).toBeUndefined();

    const justBefore = new Date(exactExpiry.getTime() - 1);
    expect(await getCachedLocationAndTouch(pool, addressNorm, justBefore)).toBeDefined();
  });

  it("re-geocoding an expired row refreshes coordinates in place, keeps address_raw, and keeps use_count incrementing rather than resetting", async () => {
    const addressNorm = "233 s wacker dr chicago il 60606";
    await saveGeocodedLocation(
      pool,
      {
        addressRaw: "233 S Wacker Dr, Chicago, IL 60606",
        addressNorm,
        matchedLabel: "old match",
        location: { lat: 1, lng: 1 },
        source: "ors",
      },
      NOON,
    );
    const past31Days = new Date(NOON.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(await getCachedLocationAndTouch(pool, addressNorm, past31Days)).toBeUndefined();

    await saveGeocodedLocation(
      pool,
      {
        addressRaw: "different capitalisation should not overwrite address_raw",
        addressNorm,
        matchedLabel: "new match",
        location: { lat: 41.878658, lng: -87.635868 },
        source: "ors",
      },
      past31Days,
    );

    const { rows } = await pool.query<{
      address_raw: string;
      matched_label: string;
      use_count: number;
      expires_at: Date;
    }>(`SELECT address_raw, matched_label, use_count, expires_at FROM saved_locations WHERE address_norm = $1`, [
      addressNorm,
    ]);
    expect(rows).toHaveLength(1); // refreshed in place, not a second row
    expect(rows[0]!.address_raw).toBe("233 S Wacker Dr, Chicago, IL 60606"); // never overwritten
    expect(rows[0]!.matched_label).toBe("new match");
    expect(rows[0]!.use_count).toBe(2); // kept incrementing, not reset to 1
    expect(rows[0]!.expires_at.getTime()).toBe(past31Days.getTime() + GEOCODE_CACHE_TTL_MS);

    const fresh = await getCachedLocationAndTouch(pool, addressNorm, past31Days);
    expect(fresh?.location).toEqual({ lat: 41.878658, lng: -87.635868 });
  });

  it("purgeExpiredLocations deletes only rows past their cap", async () => {
    await saveGeocodedLocation(
      pool,
      { addressRaw: "expired one", addressNorm: "expired one", matchedLabel: "x", location: { lat: 1, lng: 1 }, source: "ors" },
      NOON,
    );
    const later = new Date(NOON.getTime() + 60_000);
    await saveGeocodedLocation(
      pool,
      { addressRaw: "still fresh", addressNorm: "still fresh", matchedLabel: "y", location: { lat: 2, lng: 2 }, source: "ors" },
      later,
    );

    // Between the two rows' expiries: past "expired one"'s (NOON + 30d), before "still fresh"'s (later + 30d).
    const betweenExpiries = new Date(NOON.getTime() + GEOCODE_CACHE_TTL_MS + 30_000);
    await purgeExpiredLocations(pool, betweenExpiries);

    const { rows } = await pool.query<{ address_norm: string }>(`SELECT address_norm FROM saved_locations`);
    expect(rows.map((r) => r.address_norm)).toEqual(["still fresh"]);
  });

  it("never touches stations — no statement issued by the cache path references the stations table", async () => {
    const queries: string[] = [];
    const originalQuery = pool.query.bind(pool);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pool as any).query = (...args: any[]) => {
      const text = typeof args[0] === "string" ? args[0] : (args[0]?.text ?? "");
      queries.push(text);
      return originalQuery(...(args as Parameters<typeof originalQuery>));
    };

    await saveGeocodedLocation(
      pool,
      { addressRaw: "x", addressNorm: "x", matchedLabel: "x", location: { lat: 1, lng: 1 }, source: "ors" },
      NOON,
    );
    await getCachedLocationAndTouch(pool, "x", NOON);
    await purgeExpiredLocations(pool, NOON);

    expect(queries.some((q) => /\bstations\b/i.test(q))).toBe(false);
  });
});
