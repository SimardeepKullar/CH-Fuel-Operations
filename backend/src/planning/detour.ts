import type { LatLng } from "../domain/planResponse.js";
import { RoutingProviderError, type MatrixResult, type RoutingProvider, type TruckSpec } from "../routing/provider.js";
import { estimateDetourMiles, type DetourExclusion } from "./detourEstimate.js";

/** §15.4.1: `before` and `after` sit this far either side of a station's position on the route. */
export const BRACKET_MILES = 10;

/**
 * The most origins (and destinations) one matrix call is given. Two N x N calls stay inside the
 * provider's per-request limit while N fits; past it the pairs are chunked. Measured 2026-09-21
 * (§15.4.1, T-14 step 14.3): ORS allows 3,500 routes a request (`ORS_MATRIX_MAX_ROUTES`), so the
 * largest square is 59, but 50 x 50 is the size actually seen to work, so that is the side used.
 * K = 40 needs no chunking; only a lane long enough for `stratifiedTopK` to widen K past 50 does.
 */
export const MAX_MATRIX_SIDE = 50;

export interface Bracket {
  /** Miles along the route. */
  beforeMiles: number;
  afterMiles: number;
  /** `afterMiles - beforeMiles`: the route's own length between the two, which the provider is never asked for. */
  arcMiles: number;
}

/**
 * Where the bracket for a station at `offsetMiles` along a route `routeMiles` long begins and ends.
 *
 * Ten miles either side, clamped to the route: near the origin `before` is the origin itself, near
 * the destination `after` is the destination, and on a route under twenty miles both are. The arc
 * that comes back is the *clamped* one — subtracting a fixed 20 miles at the ends would report a
 * negative detour for a station that costs nothing.
 *
 * The offsets are on the same `fraction x distance_miles` scale as `offsetAlongRouteMiles`, so the
 * arc and the offsets agree with each other even though that scale is approximate (§15.4.1).
 */
export function bracketFor(offsetMiles: number, routeMiles: number, bracketMiles = BRACKET_MILES): Bracket {
  if (!Number.isFinite(routeMiles) || routeMiles <= 0) {
    throw new RangeError(`routeMiles must be a positive number, got ${routeMiles}`);
  }
  if (!Number.isFinite(offsetMiles)) {
    throw new RangeError(`offsetMiles must be a finite number, got ${offsetMiles}`);
  }
  if (!Number.isFinite(bracketMiles) || bracketMiles <= 0) {
    throw new RangeError(`bracketMiles must be a positive number, got ${bracketMiles}`);
  }
  const at = Math.min(Math.max(offsetMiles, 0), routeMiles);
  const beforeMiles = Math.max(0, at - bracketMiles);
  const afterMiles = Math.min(routeMiles, at + bracketMiles);
  return { beforeMiles, afterMiles, arcMiles: afterMiles - beforeMiles };
}

/** A station and the two route points that bracket it, ready to measure. */
export interface DetourSubject {
  id: string;
  /** The station itself. */
  location: LatLng;
  before: LatLng;
  after: LatLng;
  /** From `bracketFor`. */
  arcMiles: number;
  /** Straight-line distance from the route, for the estimate kept beside the measurement. */
  perpOffsetMiles: number;
}

export interface DetourMeasurement {
  id: string;
  /** §15.4.1 stage 1. Never overwritten by the measurement: the gap between the two is the evidence for the 1.35. */
  estimatedDetourMiles: number;
  /** `d(before -> station) + d(station -> after) - arc`, as measured. Negative when the router beat the stored polyline. */
  rawDetourMiles: number;
  /** `rawDetourMiles` floored at 0: what the optimiser costs. */
  measuredDetourMiles: number;
  /** Measured extra time, floored at 0, against the route's own average speed (the route has no per-point time). */
  detourHours: number;
  arcMiles: number;
}

export interface MeasureDetoursInput {
  provider: Pick<RoutingProvider, "name" | "matrix">;
  truckSpec: TruckSpec;
  subjects: readonly DetourSubject[];
  routeDistanceMiles: number;
  routeDurationSeconds: number;
  maxMatrixSide?: number;
}

export interface MeasureDetoursResult {
  /** In subject order. */
  measurements: DetourMeasurement[];
  /** Subjects with no measurable detour, in subject order — never a 0-mile detour. */
  exclusions: DetourExclusion[];
  matrixCalls: number;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The diagonal of an N x N matrix result: cell `[k][k]` is the k-th pair. Only the diagonal is the
 * pair we want; the other cells cost nothing extra, since the provider bills by call, not by pair.
 */
function diagonal<T>(result: MatrixResult, key: "distanceMiles" | "durationSeconds", size: number, provider: string): Array<T | null> {
  const rows = result[key] as unknown[][];
  if (!Array.isArray(rows) || rows.length !== size || rows.some((row) => !Array.isArray(row) || row.length !== size)) {
    throw new RoutingProviderError(provider, 200, undefined, `matrix ${key} is not the ${size} x ${size} that was asked for`);
  }
  return rows.map((row, k) => (row[k] ?? null) as T | null);
}

/**
 * §15.4.1: `detour = d(before -> station) + d(station -> after) - d(before -> after)`.
 *
 * `d(before -> after)` is `arcMiles`, the route's own length, and is never requested. The other two
 * legs point in opposite directions, so they are **two N x N matrix calls** — never one 2N x 2N grid,
 * which is past what the provider accepts. When N exceeds `maxMatrixSide` the subjects are cut into
 * blocks and each block gets its own pair of calls (2 x ceil(N / side) in all); a block's calls are
 * still N x N, so no call is ever larger than the side.
 *
 * A null cell is an unreachable pair. It is not zero miles: that station is returned in `exclusions`
 * as `detour_unmeasurable`, so it is neither kept with a made-up detour nor silently dropped.
 *
 * Calls run one after another, not together: the guard meters per call and a matrix call is the
 * scarcest thing this project spends.
 *
 * No database, no clock; the provider is injected.
 */
export async function measureDetours(input: MeasureDetoursInput): Promise<MeasureDetoursResult> {
  const { provider, truckSpec, subjects, routeDistanceMiles, routeDurationSeconds } = input;
  const side = input.maxMatrixSide ?? MAX_MATRIX_SIDE;
  if (!Number.isInteger(side) || side < 1) {
    throw new RangeError(`maxMatrixSide must be a positive integer, got ${side}`);
  }
  if (!Number.isFinite(routeDistanceMiles) || routeDistanceMiles <= 0) {
    throw new RangeError(`routeDistanceMiles must be a positive number, got ${routeDistanceMiles}`);
  }
  if (!Number.isFinite(routeDurationSeconds) || routeDurationSeconds < 0) {
    throw new RangeError(`routeDurationSeconds must be a non-negative number, got ${routeDurationSeconds}`);
  }
  const secondsPerMile = routeDurationSeconds / routeDistanceMiles;

  const measurements: DetourMeasurement[] = [];
  const exclusions: DetourExclusion[] = [];
  let matrixCalls = 0;

  for (let start = 0; start < subjects.length; start += side) {
    const block = subjects.slice(start, start + side);
    const stations = block.map((s) => s.location);

    const inbound = await provider.matrix({ origins: block.map((s) => s.before), destinations: stations, truckSpec });
    const outbound = await provider.matrix({ origins: stations, destinations: block.map((s) => s.after), truckSpec });
    matrixCalls += 2;

    const beforeMiles = diagonal<number>(inbound, "distanceMiles", block.length, provider.name);
    const beforeSeconds = diagonal<number>(inbound, "durationSeconds", block.length, provider.name);
    const afterMiles = diagonal<number>(outbound, "distanceMiles", block.length, provider.name);
    const afterSeconds = diagonal<number>(outbound, "durationSeconds", block.length, provider.name);

    block.forEach((subject, k) => {
      const estimatedDetourMiles = estimateDetourMiles(subject.perpOffsetMiles);
      const legs = [beforeMiles[k], afterMiles[k], beforeSeconds[k], afterSeconds[k]].map(finiteOrNull);
      if (legs.some((leg) => leg === null)) {
        exclusions.push({ id: subject.id, reason: "detour_unmeasurable", estimatedDetourMiles });
        return;
      }
      const [toStation, fromStation, secondsToStation, secondsFromStation] = legs as [number, number, number, number];
      const rawDetourMiles = toStation + fromStation - subject.arcMiles;
      const detourSeconds = secondsToStation + secondsFromStation - subject.arcMiles * secondsPerMile;
      measurements.push({
        id: subject.id,
        estimatedDetourMiles,
        rawDetourMiles,
        measuredDetourMiles: Math.max(0, rawDetourMiles),
        detourHours: Math.max(0, detourSeconds) / 3600,
        arcMiles: subject.arcMiles,
      });
    });
  }

  return { measurements, exclusions, matrixCalls };
}

/** How far the estimate sat from the measurement across a candidate set. Every figure is estimate vs measurement, in miles. */
export interface DetourEstimateError {
  /** Candidates measured; unmeasurable ones have nothing to compare against. */
  count: number;
  meanAbsoluteErrorMiles: number | null;
  /** `estimate - measured`, averaged: negative when the estimate runs low. */
  meanSignedErrorMiles: number | null;
  /** The largest amount by which the estimate was below the measurement; 0 when it never was. */
  worstUnderestimateMiles: number | null;
  /** The largest amount by which the estimate was above the measurement; 0 when it never was. */
  worstOverestimateMiles: number | null;
}

/**
 * §15.4.1: the estimate-versus-measurement comparison, the only evidence that the 1.35 multiplier
 * is badly chosen. Compares against `rawDetourMiles`, not the floored value, so a router beating
 * the polyline shows as an overestimate instead of being hidden by the floor.
 *
 * Nothing measured is `null`, never a perfect zero.
 */
export function detourEstimateError(
  measurements: readonly Pick<DetourMeasurement, "estimatedDetourMiles" | "rawDetourMiles">[],
): DetourEstimateError {
  if (measurements.length === 0) {
    return {
      count: 0,
      meanAbsoluteErrorMiles: null,
      meanSignedErrorMiles: null,
      worstUnderestimateMiles: null,
      worstOverestimateMiles: null,
    };
  }
  const errors = measurements.map((m) => m.estimatedDetourMiles - m.rawDetourMiles);
  return {
    count: errors.length,
    meanAbsoluteErrorMiles: errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length,
    meanSignedErrorMiles: errors.reduce((sum, e) => sum + e, 0) / errors.length,
    worstUnderestimateMiles: Math.max(0, ...errors.map((e) => -e)),
    worstOverestimateMiles: Math.max(0, ...errors),
  };
}
