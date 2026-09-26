import type { OptimizerCandidate, OptimizerInput } from "../optimizer/types.js";
import type { CorridorCandidate, CorridorResult } from "./corridor.js";
import type { DetourMeasurement } from "./detour.js";

/**
 * The geometry half of `OptimizerInput`, built from a corridor result; the planning
 * service adds `fuel`, `cost` and `maxStops` from the truck profile and the request.
 *
 * Both sides are miles, so this is a mapping, not a conversion — it exists to fix
 * which corridor fields the optimiser sees and where each candidate's detour comes from.
 */
export type OptimizerLane = Pick<OptimizerInput, "totalDistanceMiles" | "candidates">;

type CorridorLike = Pick<CorridorResult, "routeDistanceMiles"> & {
  candidates: readonly Pick<CorridorCandidate, "id" | "offsetAlongRouteMiles" | "unitPriceUsd">[];
};

/** What the optimiser costs from a measurement: the floored detour, never the raw or the estimate. */
export type MeasuredDetour = Pick<DetourMeasurement, "measuredDetourMiles" | "detourHours">;

/**
 * With `detours` (T-14's `measureDetours`), each candidate carries its own measured detour, and a
 * candidate with no measurement is **left out**, not treated as sitting on the route: an
 * unmeasurable station is named in `exclusions` upstream, and a made-up 0-mile detour would make it
 * the cheapest stop on the lane. A measured 0 stays 0.
 *
 * Without `detours` the lane has not been costed and every candidate is treated as on the route —
 * only for a caller that has deliberately not measured (a fixture, a baseline).
 */
export function toOptimizerLane(
  corridor: CorridorLike,
  detours?: ReadonlyMap<string, MeasuredDetour>,
): OptimizerLane {
  const candidates: OptimizerCandidate[] = [];
  for (const c of corridor.candidates) {
    const measured = detours?.get(c.id);
    if (detours && !measured) {
      continue;
    }
    candidates.push({
      id: c.id,
      positionMiles: c.offsetAlongRouteMiles,
      unitPriceUsd: c.unitPriceUsd,
      detourMiles: measured?.measuredDetourMiles ?? 0,
      detourHours: measured?.detourHours ?? 0,
    });
  }
  return { totalDistanceMiles: corridor.routeDistanceMiles, candidates };
}
