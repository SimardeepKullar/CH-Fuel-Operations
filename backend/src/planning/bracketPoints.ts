import type { Pool } from "pg";
import type { LatLng } from "../domain/planResponse.js";
import { CorridorError } from "./corridor.js";
import { bracketFor, type DetourSubject } from "./detour.js";

/**
 * §15.4.1: the point at each fraction of a stored route, in the order asked.
 *
 * Units: this statement crosses no conversion edge. It takes fractions, not distances, so there is
 * no `* 1609.344` and no geography function — `ST_LineInterpolatePoint` works on the geometry, the
 * same planar fraction `ST_LineLocatePoint` gave the corridor query its `frac`. Miles become a
 * fraction by dividing by `distance_miles` in TypeScript, the inverse of the corridor's
 * `frac * distance_miles`, so a bracket point lands where the offset says it does.
 *
 * `WITH ORDINALITY` carries the caller's order through `unnest`; the interpolation is computed once
 * per point, not twice for the two coordinates.
 */
export const BRACKET_POINTS_SQL = `
SELECT t.ord::int AS ord, ST_Y(p.pt) AS lat, ST_X(p.pt) AS lng
FROM routes r
CROSS JOIN LATERAL unnest($2::float8[]) WITH ORDINALITY AS t(frac, ord)
CROSS JOIN LATERAL (SELECT ST_LineInterpolatePoint(r.line::geometry, t.frac) AS pt) p
WHERE r.id = $1
ORDER BY t.ord`;

interface PointRow {
  ord: number;
  lat: number | null;
  lng: number | null;
}

/**
 * The points at `fractions` (each 0 to 1) along a stored route. Throws `CorridorError` for a route
 * that does not exist or has no geometry — `routes.line` is nullable (§17), and "no geometry" must
 * not read as "no points".
 */
export async function pointsAlongRoute(pool: Pool, routeId: string, fractions: readonly number[]): Promise<LatLng[]> {
  for (const fraction of fractions) {
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
      throw new RangeError(`a fraction along the route must be between 0 and 1, got ${fraction}`);
    }
  }
  if (fractions.length === 0) {
    return [];
  }

  const { rows } = await pool.query<PointRow>(BRACKET_POINTS_SQL, [routeId, [...fractions]]);
  if (rows.length === 0) {
    throw new CorridorError("ROUTE_NOT_FOUND", `route ${routeId} does not exist`);
  }
  return rows.map((row) => {
    if (row.lat === null || row.lng === null) {
      throw new CorridorError("ROUTE_GEOMETRY_MISSING", `route ${routeId} has no stored geometry`);
    }
    return { lat: row.lat, lng: row.lng };
  });
}

/** What a corridor candidate contributes: where it is, how far along the route, and how far off it. */
export interface BracketCandidate {
  id: string;
  lat: number;
  lng: number;
  offsetAlongRouteMiles: number;
  perpOffsetMiles: number;
}

/**
 * Each candidate paired with the two route points that bracket it (`bracketFor`, clamped at the
 * route's ends), from **one** query for all 2N points, in candidate order.
 */
export async function buildDetourSubjects(
  pool: Pool,
  route: { routeId: string; routeDistanceMiles: number },
  candidates: readonly BracketCandidate[],
): Promise<DetourSubject[]> {
  const brackets = candidates.map((c) => bracketFor(c.offsetAlongRouteMiles, route.routeDistanceMiles));
  const points = await pointsAlongRoute(
    pool,
    route.routeId,
    brackets.flatMap((b) => [b.beforeMiles / route.routeDistanceMiles, b.afterMiles / route.routeDistanceMiles]),
  );
  return candidates.map((c, i) => ({
    id: c.id,
    location: { lat: c.lat, lng: c.lng },
    before: points[2 * i]!,
    after: points[2 * i + 1]!,
    arcMiles: brackets[i]!.arcMiles,
    perpOffsetMiles: c.perpOffsetMiles,
  }));
}
