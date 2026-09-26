import type { LatLng } from "../domain/planResponse.js";

/**
 * §16's physical spec fields, passed to the provider so it can route around
 * bridges and weight limits the truck cannot legally use. Nullable fields mean
 * "not specified" — the provider decides its own default, never `0`.
 */
export interface TruckSpec {
  grossWeightKg: number | null;
  heightCm: number | null;
  widthCm: number | null;
  lengthCm: number | null;
  axleCount: number | null;
  hazmatClass: string | null;
}

/**
 * Distances are miles (CLAUDE.md: storage and internals are miles). The
 * adapter converts a provider's native unit once, on the way in, so nothing
 * downstream sees metres.
 */
export interface RouteLeg {
  distanceMiles: number;
  durationSeconds: number;
}

/**
 * `legs` is mandatory. T-13's validation loop needs per-leg distances from
 * the final waypointed route, and an adapter that cannot supply them is
 * unusable regardless of its other qualities (§8.4).
 */
export interface RouteResult {
  polyline: string;
  distanceMiles: number;
  durationSeconds: number;
  legs: RouteLeg[];
  providerRaw: unknown;
}

export interface RouteRequest {
  origin: LatLng;
  destination: LatLng;
  via?: LatLng[];
  truckSpec: TruckSpec;
  departAt?: Date;
}

export interface MatrixResult {
  /** `null` is an unreachable pair, never 0 miles. */
  distanceMiles: Array<Array<number | null>>;
  durationSeconds: number[][];
}

export interface MatrixRequest {
  origins: LatLng[];
  destinations: LatLng[];
  truckSpec: TruckSpec;
}

/**
 * §8.4. Adopting HERE is one new adapter file plus one case in the factory —
 * nothing downstream (corridor query, optimiser, validation loop, API) knows
 * which provider produced a route.
 */
export interface RoutingProvider {
  readonly name: "ors" | "here" | "google" | "graphhopper";

  route(req: RouteRequest): Promise<RouteResult>;

  matrix(req: MatrixRequest): Promise<MatrixResult>;
}

/**
 * A provider's non-2xx response, mapped to a typed shape instead of a throw
 * of the raw body — every adapter's HTTP failures look the same to callers.
 */
export class RoutingProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    public readonly code: string | number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "RoutingProviderError";
  }
}
