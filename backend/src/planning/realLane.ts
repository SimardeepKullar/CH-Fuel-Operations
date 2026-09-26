import { LEG_TOLERANCE_MILES } from "../optimizer/model.js";
import type { OptimizerInput, OptimizerPlan, PlannedStop } from "../optimizer/types.js";
import type { RouteLeg } from "../routing/provider.js";

/** Gallons; far below the 2-gallon bucket the optimiser works in. */
const GALLON_TOLERANCE = 1e-6;

/**
 * §15.5 step 4: the DP's next input once a route through some stops has been
 * measured. Real distances exist only for the stops that were routed; every other
 * candidate is placed by scaling its baseline position within the segment between
 * the two routed stops around it, so the anchors sit exactly at their measured
 * distance and the rest keep their order between them.
 *
 * Always rescale from the *baseline* lane with the latest route's anchors. Compounding
 * one rescale onto the last would carry a stale route's stretch into a lane it no
 * longer describes.
 *
 * This is a model, not a measurement: a station in a segment that measured long is
 * assumed to sit proportionally further along. It only chooses what the DP tries next;
 * whatever it picks is routed and checked against real legs before it is believed.
 *
 * `stopIds` are in route order; `legs` are that route's legs, so `legs.length` is
 * `stopIds.length + 1`. Pure; returns a new input.
 */
export function rescaleLane(lane: OptimizerInput, stopIds: readonly string[], legs: readonly Pick<RouteLeg, "distanceMiles">[]): OptimizerInput {
  if (legs.length !== stopIds.length + 1) {
    throw new RangeError(`${stopIds.length} stops need ${stopIds.length + 1} legs, got ${legs.length}`);
  }
  const byId = new Map(lane.candidates.map((c) => [c.id, c]));
  const baselineCum = [0];
  for (const id of stopIds) {
    const stop = byId.get(id);
    if (!stop) throw new RangeError(`stop ${id} is not a candidate of this lane`);
    baselineCum.push(stop.positionMiles);
  }
  baselineCum.push(lane.totalDistanceMiles);

  const realCum = [0];
  for (const leg of legs) realCum.push((realCum[realCum.length - 1] ?? 0) + leg.distanceMiles);
  const anchorReal = new Map(stopIds.map((id, i) => [id, realCum[i + 1] ?? 0]));

  const candidates = lane.candidates.map((c) => {
    const anchored = anchorReal.get(c.id);
    if (anchored !== undefined) return { ...c, positionMiles: anchored };

    let segment = 0;
    while (segment < legs.length - 1 && c.positionMiles > (baselineCum[segment + 1] ?? 0)) segment++;
    const baseStart = baselineCum[segment] ?? 0;
    const baseLength = (baselineCum[segment + 1] ?? 0) - baseStart;
    const realStart = realCum[segment] ?? 0;
    const realEnd = realCum[segment + 1] ?? 0;
    const along = baseLength > 0 ? (c.positionMiles - baseStart) * ((realEnd - realStart) / baseLength) : 0;
    return { ...c, positionMiles: Math.min(realEnd, Math.max(realStart, realStart + along)) };
  });

  return { ...lane, totalDistanceMiles: realCum[realCum.length - 1] ?? 0, candidates };
}

export type LegViolation =
  | { kind: "LEG_OVER_CAP"; legIndex: number; /** `null` is the destination. */ toCandidateId: string | null; legMiles: number; maxLegMiles: number }
  | { kind: "BELOW_RESERVE"; candidateId: string; arrivalGallons: number; requiredGallons: number }
  | { kind: "BELOW_MIN_ARRIVAL"; arrivalGallons: number; requiredGallons: number };

/**
 * A stop as the routed legs bear it out. `positionMiles` and `legMiles` are the real
 * cumulative and leg distances (the baseline position stays beside them, never
 * overwritten), and `arrivalGallons` is exact, not the optimiser's bucketed figure.
 */
export interface ValidatedStop extends PlannedStop {
  baselinePositionMiles: number;
  legDurationSeconds: number;
  cumulativeDurationSeconds: number;
}

export interface ValidatedPlan {
  stops: ValidatedStop[];
  startGallons: number;
  finalLegMiles: number;
  finalLegDurationSeconds: number;
  destinationArrivalGallons: number;
  totalGallons: number;
  totalFuelCostUsd: number;
  /** Fuel plus every stop's penalty. */
  totalCostUsd: number;
  totalDistanceMiles: number;
  totalDurationSeconds: number;
}

/**
 * §15.5 steps 3 and 5. Replays `plan` over the routed `legs`: re-checks the cap and
 * the reserve against real distances, and rebuilds distances, arrival fuel, purchases
 * and costs from them.
 *
 * Each stop's *departure* level is the DP's and is held fixed; the purchase is what it
 * takes to get there from the real arrival, and the cost follows from that. Holding the
 * purchase fixed instead would let a leg that measured long quietly break the reserve
 * at the next stop. A stop that arrives with more than the DP planned to leave with buys
 * nothing rather than a negative amount.
 *
 * Only the cap and the reserve are violations. The 300-mile floor is a planning policy
 * applied when the DP picks stops, not re-checked here; a real leg a little under it is
 * reported through `findShortLegs` only when the relaxed pass ran.
 *
 * `input` is the *baseline* lane, even when `plan` came from a rescaled one: that is where
 * `baselinePositionMiles` is read from. `plan` and `legs` must describe the same stops:
 * `legs.length` is `plan.stops.length + 1`.
 */
export function realizePlan(
  input: OptimizerInput,
  plan: OptimizerPlan,
  legs: readonly RouteLeg[],
): { plan: ValidatedPlan; violations: LegViolation[] } {
  if (legs.length !== plan.stops.length + 1) {
    throw new RangeError(`${plan.stops.length} stops need ${plan.stops.length + 1} legs, got ${legs.length}`);
  }
  const { fuel } = input;
  const baselineMiles = new Map(input.candidates.map((c) => [c.id, c.positionMiles]));
  const reserveGallons = fuel.reserveFraction * fuel.tankGallons;
  const violations: LegViolation[] = [];
  const stops: ValidatedStop[] = [];

  let miles = 0;
  let seconds = 0;
  let departure = plan.startGallons;
  let totalGallons = 0;
  let totalFuelCostUsd = 0;
  let totalPenaltyUsd = 0;

  plan.stops.forEach((stop, i) => {
    const leg = legs[i] as RouteLeg;
    miles += leg.distanceMiles;
    seconds += leg.durationSeconds;
    if (leg.distanceMiles > fuel.maxLegMiles + LEG_TOLERANCE_MILES) {
      violations.push({ kind: "LEG_OVER_CAP", legIndex: i, toCandidateId: stop.candidateId, legMiles: leg.distanceMiles, maxLegMiles: fuel.maxLegMiles });
    }
    const arrivalGallons = departure - leg.distanceMiles / fuel.avgMpg;
    if (arrivalGallons < reserveGallons - GALLON_TOLERANCE) {
      violations.push({ kind: "BELOW_RESERVE", candidateId: stop.candidateId, arrivalGallons, requiredGallons: reserveGallons });
    }
    const departureGallons = Math.max(stop.departureGallons, arrivalGallons);
    const purchaseGallons = departureGallons - arrivalGallons;
    const fuelCostUsd = purchaseGallons * stop.unitPriceUsd;

    stops.push({
      ...stop,
      positionMiles: miles,
      baselinePositionMiles: baselineMiles.get(stop.candidateId) ?? stop.positionMiles,
      legMiles: leg.distanceMiles,
      legDurationSeconds: leg.durationSeconds,
      cumulativeDurationSeconds: seconds,
      arrivalGallons,
      purchaseGallons,
      departureGallons,
      fuelCostUsd,
    });
    departure = departureGallons;
    totalGallons += purchaseGallons;
    totalFuelCostUsd += fuelCostUsd;
    totalPenaltyUsd += stop.penaltyUsd;
  });

  const finalLeg = legs[legs.length - 1] as RouteLeg;
  miles += finalLeg.distanceMiles;
  seconds += finalLeg.durationSeconds;
  // Same rule as the DP's last transition: the cap binds it only when arrival within a leg is required.
  if (fuel.requireArrivalWithinMaxLeg && finalLeg.distanceMiles > fuel.maxLegMiles + LEG_TOLERANCE_MILES) {
    violations.push({ kind: "LEG_OVER_CAP", legIndex: legs.length - 1, toCandidateId: null, legMiles: finalLeg.distanceMiles, maxLegMiles: fuel.maxLegMiles });
  }
  const destinationArrivalGallons = departure - finalLeg.distanceMiles / fuel.avgMpg;
  if (destinationArrivalGallons < fuel.minArrivalGallons - GALLON_TOLERANCE) {
    violations.push({ kind: "BELOW_MIN_ARRIVAL", arrivalGallons: destinationArrivalGallons, requiredGallons: fuel.minArrivalGallons });
  }

  return {
    plan: {
      stops,
      startGallons: plan.startGallons,
      finalLegMiles: finalLeg.distanceMiles,
      finalLegDurationSeconds: finalLeg.durationSeconds,
      destinationArrivalGallons,
      totalGallons,
      totalFuelCostUsd,
      totalCostUsd: totalFuelCostUsd + totalPenaltyUsd,
      totalDistanceMiles: miles,
      totalDurationSeconds: seconds,
    },
    violations,
  };
}
