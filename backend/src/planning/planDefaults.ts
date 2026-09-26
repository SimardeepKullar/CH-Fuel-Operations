import type { CreatePlanRequest } from "../domain/planResponse.js";

/**
 * The screening radius used when a request omits `corridorMiles`. Wide enough
 * that a plausible cheap station is never excluded before `maxDetourMiles`
 * gets a chance to weigh in — the whole point of splitting the two
 * parameters (§15.1) is that screening should over-include, not pre-judge.
 * Unlike `maxLegMiles`/`minLegMiles`, this has no `trucks` column: it
 * is a routing search parameter, not a fact about the truck, so one fixed
 * default serves every truck.
 */
export const DEFAULT_CORRIDOR_MILES = 25;

/** The `trucks` columns this module reads defaults from (T-56 — was `truck_profiles` before the merge). */
export interface TruckProfileDefaults {
  maxLegMiles: number;
  minLegMiles: number;
  tankGallons: number;
  reserveFraction: number;
}

export interface ResolvedPlanFuelParams {
  maxLegMiles: number;
  minLegMiles: number;
  corridorMiles: number;
  startFuelGallons: number;
  minArrivalGallons: number;
}

/**
 * Resolves every "null = the truck profile's default" field on
 * `CreatePlanRequest` (§14) against the chosen profile.
 *
 * `maxDetourMiles` and `maxStops` are deliberately excluded: their `null`
 * means "no cap" / "no limit," a real value in its own right, not a
 * placeholder for a default — resolving either here would be exactly the
 * bug CLAUDE.md's nulls-are-meaningful rule exists to prevent.
 *
 * `??`, not `||`: a request that explicitly asks for `0` (zero extra fuel to
 * start with, a zero-mile floor) must keep that `0`, not be read as missing.
 */
export function resolvePlanDefaults(
  request: Pick<CreatePlanRequest, "maxLegMiles" | "minLegMiles" | "corridorMiles" | "startFuelGallons" | "minArrivalGallons">,
  profile: TruckProfileDefaults,
): ResolvedPlanFuelParams {
  return {
    maxLegMiles: request.maxLegMiles ?? profile.maxLegMiles,
    minLegMiles: request.minLegMiles ?? profile.minLegMiles,
    corridorMiles: request.corridorMiles ?? DEFAULT_CORRIDOR_MILES,
    startFuelGallons: request.startFuelGallons ?? profile.tankGallons,
    minArrivalGallons: request.minArrivalGallons ?? profile.reserveFraction * profile.tankGallons,
  };
}
