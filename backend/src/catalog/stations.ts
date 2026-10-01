import type { Pool } from "pg";
import type { StationResolution } from "../db/types.js";
import type { StationLocationSummary } from "../domain/planResponse.js";

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type StationMapResolution = Extract<StationResolution, "exact" | "city">;

export interface ListStationsOptions {
  bbox: BoundingBox;
  /** `undefined` = both tiers. `unresolved` is never a valid filter value —
   * an unresolved station has no `geom` to plot in the first place. */
  resolution?: StationMapResolution;
  page: number;
  pageSize: number;
}

export interface StationsPage {
  stations: StationLocationSummary[];
  page: number;
  pageSize: number;
  total: number;
}

interface StationListRow {
  id: string;
  name_raw: string;
  store_number: number | null;
  city_raw: string;
  state_usps: string;
  resolution: StationMapResolution;
  uncertainty_miles: string;
  truck_accessible: StationLocationSummary["truckAccessible"];
  lat: number;
  lng: number;
}

/**
 * `GET /stations?bbox=&resolution=` (T-18 step 18.2) — the map's sheet
 * layer, every priced station in view rather than just corridor candidates.
 * `resolution = 'unresolved'` is excluded unconditionally: it carries no
 * `geom`, so it is never a candidate for plotting regardless of the filter.
 *
 * The bbox test runs in `geometry`, not `geography` (T-23 follow-up bug):
 * `ST_Intersects(s.geom, ST_MakeEnvelope(...)::geography)` silently drops
 * real matches once the envelope gets large — verified against the live
 * database, a continental-US-sized box returned 600 of 604 resolved
 * stations, and the 4 missing ones were nowhere near the edge (south
 * Texas, well inside the box). PostGIS's geography cast can flip which
 * side of a big envelope counts as "inside"; a plain lat/lng bounding box
 * has no geodesic meaning anyway, so comparing in `geometry` is the
 * correct tool here, not a workaround. `stations_geom_gix` (a geography
 * GIST index) no longer serves this filter, but `stations` is a few
 * hundred rows, not a table a sequential scan needs help with.
 */
export async function listStations(pool: Pool, options: ListStationsOptions): Promise<StationsPage> {
  const { bbox, resolution, page, pageSize } = options;
  const offset = (page - 1) * pageSize;

  const params: [number, number, number, number, StationMapResolution | null] = [
    bbox.west,
    bbox.south,
    bbox.east,
    bbox.north,
    resolution ?? null,
  ];
  // US only (T-60, D29): this is the planner's sheet layer, and CA directory
  // stations are actuals-only. A fixed literal, never a parameter.
  const whereClause = `s.country = 'US'
       AND s.resolution <> 'unresolved'
       AND ($5::text IS NULL OR s.resolution = $5)
       AND ST_Intersects(s.geom::geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))`;

  const [{ rows: countRows }, { rows }] = await Promise.all([
    pool.query<{ total: string }>(`SELECT count(*) AS total FROM stations s WHERE ${whereClause}`, params),
    pool.query<StationListRow>(
      `SELECT s.id, s.name_raw, s.store_number, s.city_raw, s.state_usps,
              s.resolution, COALESCE(s.uncertainty_miles, 0) AS uncertainty_miles,
              s.truck_accessible,
              ST_Y(s.geom::geometry) AS lat, ST_X(s.geom::geometry) AS lng
       FROM stations s
       WHERE ${whereClause}
       ORDER BY s.id
       LIMIT $6 OFFSET $7`,
      [...params, pageSize, offset],
    ),
  ]);

  return {
    stations: rows.map(
      (row): StationLocationSummary => ({
        id: row.id,
        name: row.name_raw,
        storeNumber: row.store_number,
        city: row.city_raw,
        state: row.state_usps,
        location: { lat: row.lat, lng: row.lng },
        resolution: row.resolution,
        uncertaintyMiles: Number(row.uncertainty_miles),
        truckAccessible: row.truck_accessible,
      }),
    ),
    page,
    pageSize,
    total: Number(countRows[0]!.total),
  };
}

export interface StationPriceHistoryEntry {
  validOn: string;
  pumpUsdPerGal: number | null;
  iftaNetUsdPerGal: number | null;
  totalCostUsdPerGal: number | null;
}

export interface StationPriceHistory {
  station: { id: string; name: string; storeNumber: number | null; city: string; state: string };
  /** Oldest first, one row per sheet the station was priced on. */
  prices: StationPriceHistoryEntry[];
}

interface StationIdentityRow {
  id: string;
  name_raw: string;
  store_number: number | null;
  city_raw: string;
  state_usps: string;
}

interface PriceHistoryRow {
  valid_on: string;
  price_pump: string | null;
  price_ifta_net: string | null;
  total_cost: string | null;
}

/**
 * `GET /stations/{id}/prices` (T-18 step 18.2) — the sheet-price history for
 * one station, every basis at once so the caller does not need to know which
 * `priceBasis` a plan used to render it. Distinct from `/stations/{id}/
 * billed-prices` (A8.9): that reads what the fleet was actually billed
 * (`fuel_stops`/`fuel_stop_lines`); this reads BVD's published sheet price
 * (`station_prices`) — the two datasets CLAUDE.md keeps separate.
 */
export async function getStationPriceHistory(pool: Pool, id: string): Promise<StationPriceHistory | null> {
  const { rows: stationRows } = await pool.query<StationIdentityRow>(
    "SELECT id, name_raw, store_number, city_raw, state_usps FROM stations WHERE id = $1",
    [id],
  );
  const station = stationRows[0];
  if (!station) {
    return null;
  }

  const { rows } = await pool.query<PriceHistoryRow>(
    `SELECT to_char(valid_on, 'YYYY-MM-DD') AS valid_on, price_pump, price_ifta_net, total_cost
     FROM station_prices
     WHERE station_id = $1 AND product_type = 'highway_diesel'
     ORDER BY valid_on ASC`,
    [id],
  );

  return {
    station: {
      id: station.id,
      name: station.name_raw,
      storeNumber: station.store_number,
      city: station.city_raw,
      state: station.state_usps,
    },
    prices: rows.map((row) => ({
      validOn: row.valid_on,
      pumpUsdPerGal: row.price_pump === null ? null : Number(row.price_pump),
      iftaNetUsdPerGal: row.price_ifta_net === null ? null : Number(row.price_ifta_net),
      totalCostUsdPerGal: row.total_cost === null ? null : Number(row.total_cost),
    })),
  };
}
