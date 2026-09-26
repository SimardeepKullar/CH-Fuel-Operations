import type { Pool } from "pg";
import type { LatLng } from "../domain/planResponse.js";

/** Provider geocodes are capped at 30 days (§17). Exact milliseconds, not a SQL `interval`, so the cap doesn't drift with DST or session timezone. */
export const GEOCODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CachedLocation {
  addressRaw: string;
  matchedLabel: string | null;
  location: LatLng;
}

export interface SaveGeocodedLocationInput {
  addressRaw: string;
  addressNorm: string;
  matchedLabel: string;
  location: LatLng;
  /** `GeocodingProvider.name`, e.g. `"ors"`. */
  source: string;
}

/**
 * The cache hit path (§11.6, T-15 step 15.1). A single `UPDATE ... WHERE
 * expires_at > $now RETURNING` does the lookup, the freshness check and the
 * `use_count` increment in one statement — an expired row simply fails the
 * `WHERE` and is treated exactly like a miss, so there is only one miss path
 * for the caller to handle (§8.3's `reserveProviderCall` uses the same
 * one-statement idiom for the same reason: no separate read-then-write race).
 */
export async function getCachedLocationAndTouch(
  pool: Pool,
  addressNorm: string,
  now: Date,
): Promise<CachedLocation | undefined> {
  const { rows } = await pool.query<{
    address_raw: string;
    matched_label: string | null;
    lat: number;
    lng: number;
  }>(
    `UPDATE saved_locations
     SET use_count = use_count + 1
     WHERE address_norm = $1 AND expires_at > $2
     RETURNING address_raw, matched_label, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng`,
    [addressNorm, now],
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  return {
    addressRaw: row.address_raw,
    matchedLabel: row.matched_label,
    location: { lat: Number(row.lat), lng: Number(row.lng) },
  };
}

/**
 * Inserts a freshly geocoded address, or — on a `address_norm` conflict,
 * meaning the cached row had expired past `getCachedLocationAndTouch`'s
 * `WHERE` — refreshes it in place (decided 2026-09-22). `address_raw` and
 * the dispatcher-set `label` are never overwritten (mirrors `city_raw`'s
 * convention); `matched_label`, the coordinates and the expiry move to the
 * new geocode, and `use_count` keeps incrementing rather than resetting —
 * the row's history is a fact about how often this address is used, not
 * about when it was last geocoded.
 *
 * Two concurrent misses for the same new address both spend a geocoding
 * call and both land here; the second becomes the conflict branch. That is
 * an accepted cost of not holding a lock across an HTTP call (decided
 * 2026-09-22) — the query itself stays a single atomic statement either way.
 */
export async function saveGeocodedLocation(
  pool: Pool,
  input: SaveGeocodedLocationInput,
  now: Date,
): Promise<void> {
  const expiresAt = new Date(now.getTime() + GEOCODE_CACHE_TTL_MS);
  await pool.query(
    `INSERT INTO saved_locations
       (address_raw, address_norm, matched_label, geom, geocode_source, geocoded_at, expires_at, use_count)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, $8, 1)
     ON CONFLICT (address_norm) DO UPDATE
     SET matched_label = EXCLUDED.matched_label,
         geom = EXCLUDED.geom,
         geocode_source = EXCLUDED.geocode_source,
         geocoded_at = EXCLUDED.geocoded_at,
         expires_at = EXCLUDED.expires_at,
         use_count = saved_locations.use_count + 1`,
    [
      input.addressRaw,
      input.addressNorm,
      input.matchedLabel,
      input.location.lng,
      input.location.lat,
      input.source,
      now,
      expiresAt,
    ],
  );
}

/**
 * Deletes rows past their 30-day cap. Called on every cache miss (never on
 * a hit, which is the common case and needs no purge). §17 never permits
 * keeping a provider geocode past its cap; nothing else clears `geom`, which
 * is `NOT NULL`, so a row nobody asks for again would otherwise sit past
 * expiry indefinitely — deleting it is simpler than a nullable-geometry
 * schema change for a table with no reader that needs the row to survive
 * expiry (unlike `routes`, see §17).
 */
export async function purgeExpiredLocations(pool: Pool, now: Date): Promise<void> {
  await pool.query(`DELETE FROM saved_locations WHERE expires_at <= $1`, [now]);
}
