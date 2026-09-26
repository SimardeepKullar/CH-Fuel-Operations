import type { Pool } from "pg";
import type { StationResolution, TruckAccessible } from "../db/types.js";

/** Which column of `station_prices` is the unit price (§14 `priceBasis`). */
export type PriceBasis = "pump" | "ifta_net" | "total_cost";

export interface CorridorRequest {
  routeId: string;
  /** Straight-line screening radius, miles. The SQL converts to PostGIS's metres. */
  radiusMiles: number;
  priceBasis: PriceBasis;
  /** `YYYY-MM-DD`. Always explicit — there is no "current" — and recorded on the
   * plan as `price_as_of` (§15.4). */
  validOn: string;
}

interface CorridorStationBase {
  id: string;
  nameRaw: string;
  storeNumber: number | null;
  cityRaw: string;
  stateUsps: string;
  resolution: Exclude<StationResolution, "unresolved">;
  uncertaintyMiles: number;
  truckAccessible: Exclude<TruckAccessible, "excluded">;
  lat: number;
  lng: number;
  /** Miles along the route: the line's fraction scaled to the provider's
   * `distance_miles`, so it is in the same units the optimiser's legs are. */
  offsetAlongRouteMiles: number;
  /** Straight-line distance from the route. Feeds the detour estimate (§15.4.1). */
  perpOffsetMiles: number;
}

/** A corridor station with a usable price on `validOn`. */
export interface CorridorCandidate extends CorridorStationBase {
  priceId: string;
  unitPriceUsd: number;
}

/**
 * Why a corridor station has no candidate price. Two different facts:
 * `no_price_on_date` is BVD not listing the station that day; `price_basis_null`
 * is a row that exists but lacks the chosen basis (e.g. `total_cost`).
 */
export type CorridorExclusionReason = "no_price_on_date" | "price_basis_null";

/** In the corridor, but not plannable — named so it is never mistaken for a
 * station that was never near the route. */
export interface CorridorExclusion extends CorridorStationBase {
  reason: CorridorExclusionReason;
}

export interface CorridorResult {
  routeDistanceMiles: number;
  /** Ordered by `offsetAlongRouteMiles`. */
  candidates: CorridorCandidate[];
  /** Ordered by `offsetAlongRouteMiles`. */
  exclusions: CorridorExclusion[];
}

export type CorridorErrorCode = "ROUTE_NOT_FOUND" | "ROUTE_GEOMETRY_MISSING";

export class CorridorError extends Error {
  constructor(
    public readonly code: CorridorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CorridorError";
  }
}

/**
 * §15.4. Exported so the GIST-index test can `EXPLAIN` the exact statement that
 * runs, not a copy of it.
 *
 * Deviations from the scope's sketch, each deliberate:
 * - `station_prices.product_type` is filtered directly; there is no
 *   `product_codes` join (§15.4 a).
 * - The price is a `LEFT JOIN LATERAL`, so an unpriced station survives with a
 *   NULL price and is reported as an exclusion (§15.4 b).
 * - The lateral has an `ORDER BY`: `UNIQUE (station_id, raw_product, valid_on)`
 *   permits two raw products mapping to `highway_diesel`, and an unordered
 *   `LIMIT 1` would pick between them arbitrarily.
 * - `truck_accessible <> 'excluded'` — the scope leaves it out of the sketch, but
 *   a station marked excluded must not be planned against.
 * - `s.id` breaks position ties so the order is deterministic.
 *
 * Units: storage is miles, PostGIS geography is metres, and this statement is the
 * seam. The radius *parameter* is scaled up (`$2 * 1609.344`), never the column,
 * so `ST_DWithin` can still use `stations_geom_gix`; the returned perpendicular
 * distance is scaled down. The offset along the route needs no conversion —
 * `frac * distance_miles` is already miles.
 */
export const CORRIDOR_SQL = `
WITH route AS (SELECT line, distance_miles FROM routes WHERE id = $1),
corridor AS (
  SELECT s.id, s.name_raw, s.store_number, s.city_raw, s.state_usps,
         s.resolution, COALESCE(s.uncertainty_miles, 0) AS uncertainty_miles,
         s.truck_accessible, s.geom,
         ST_LineLocatePoint(r.line::geometry, s.geom::geometry) AS frac,
         ST_Distance(s.geom, r.line) / 1609.344 AS perp_offset_miles,
         r.distance_miles
  FROM stations s CROSS JOIN route r
  WHERE s.resolution <> 'unresolved'
    AND s.truck_accessible <> 'excluded'
    AND ST_DWithin(s.geom, r.line, $2::float8 * 1609.344)
)
SELECT c.id, c.name_raw, c.store_number, c.city_raw, c.state_usps,
       c.resolution, c.uncertainty_miles, c.truck_accessible,
       c.perp_offset_miles,
       ST_Y(c.geom::geometry) AS lat,
       ST_X(c.geom::geometry) AS lng,
       c.frac * c.distance_miles AS offset_along_route_miles,
       sp.id AS price_id,
       CASE $3::text
         WHEN 'pump'       THEN sp.price_pump
         WHEN 'ifta_net'   THEN sp.price_ifta_net
         WHEN 'total_cost' THEN sp.total_cost
       END AS unit_price
FROM corridor c
LEFT JOIN LATERAL (
  SELECT sp.* FROM station_prices sp
  WHERE sp.station_id = c.id
    AND sp.product_type = 'highway_diesel'
    AND sp.valid_on = $4::date
  ORDER BY sp.id
  LIMIT 1
) sp ON true
ORDER BY offset_along_route_miles, c.id`;

interface CorridorRow {
  id: string;
  name_raw: string;
  store_number: number | null;
  city_raw: string;
  state_usps: string;
  resolution: Exclude<StationResolution, "unresolved">;
  uncertainty_miles: string;
  truck_accessible: Exclude<TruckAccessible, "excluded">;
  perp_offset_miles: number;
  lat: number;
  lng: number;
  offset_along_route_miles: number;
  price_id: string | null;
  unit_price: string | null;
}

interface RouteRow {
  distance_miles: string;
  has_line: boolean;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Candidate stations along a stored route, priced for `validOn`.
 *
 * `candidates` have a price; `exclusions` are corridor stations that do not.
 * `resolution = 'unresolved'` stations appear in neither — they are not a data
 * problem on this lane, they are unplaceable anywhere (§11.3).
 *
 * Throws `CorridorError` when the route does not exist or has no geometry —
 * `routes.line` is nullable (§17), and "no geometry" must not read as "no
 * stations".
 */
export async function findCorridor(pool: Pool, request: CorridorRequest): Promise<CorridorResult> {
  const { routeId, radiusMiles, priceBasis, validOn } = request;
  if (!DATE_PATTERN.test(validOn)) {
    throw new RangeError(`validOn must be YYYY-MM-DD, got ${JSON.stringify(validOn)}`);
  }
  if (!Number.isFinite(radiusMiles) || radiusMiles < 0) {
    throw new RangeError(`radiusMiles must be a non-negative number, got ${radiusMiles}`);
  }

  const { rows: routeRows } = await pool.query<RouteRow>(
    "SELECT distance_miles, line IS NOT NULL AS has_line FROM routes WHERE id = $1",
    [routeId],
  );
  const route = routeRows[0];
  if (!route) {
    throw new CorridorError("ROUTE_NOT_FOUND", `route ${routeId} does not exist`);
  }
  if (!route.has_line) {
    throw new CorridorError("ROUTE_GEOMETRY_MISSING", `route ${routeId} has no stored geometry`);
  }

  const { rows } = await pool.query<CorridorRow>(CORRIDOR_SQL, [routeId, radiusMiles, priceBasis, validOn]);

  const candidates: CorridorCandidate[] = [];
  const exclusions: CorridorExclusion[] = [];
  for (const row of rows) {
    const station: CorridorStationBase = {
      id: row.id,
      nameRaw: row.name_raw,
      storeNumber: row.store_number,
      cityRaw: row.city_raw,
      stateUsps: row.state_usps,
      resolution: row.resolution,
      uncertaintyMiles: Number(row.uncertainty_miles),
      truckAccessible: row.truck_accessible,
      lat: row.lat,
      lng: row.lng,
      offsetAlongRouteMiles: row.offset_along_route_miles,
      perpOffsetMiles: row.perp_offset_miles,
    };
    if (row.price_id === null) {
      exclusions.push({ ...station, reason: "no_price_on_date" });
    } else if (row.unit_price === null) {
      exclusions.push({ ...station, reason: "price_basis_null" });
    } else {
      candidates.push({ ...station, priceId: row.price_id, unitPriceUsd: Number(row.unit_price) });
    }
  }

  return { routeDistanceMiles: Number(route.distance_miles), candidates, exclusions };
}
