import { LEG_TOLERANCE_MILES } from "../optimizer/model.js";
import type { OptimizerInfeasible, OptimizerInput, OptimizerPlan, OptimizerStrategy } from "../optimizer/types.js";

/**
 * A leg that fell under the floor the plan was asked to respect. The final leg is
 * never listed: nothing is bought at the destination, so it has no floor (§5.1).
 */
export interface ShortLeg {
  /** `null` is the origin. */
  fromCandidateId: string | null;
  toCandidateId: string;
  legMiles: number;
  /** The floor the leg fell under. */
  requiredMiles: number;
}

export type RelaxedResult =
  | { result: OptimizerPlan; minLegRelaxed: false }
  | { result: OptimizerPlan; minLegRelaxed: true; shortLegs: ShortLeg[] }
  | { result: OptimizerInfeasible; minLegRelaxed: false };

/**
 * The legs of `plan` under `floorMiles`, by the plan's own leg figures. Exported for
 * the validation loop, which re-derives the list against the real routed legs.
 */
export function findShortLegs(plan: Pick<OptimizerPlan, "stops">, floorMiles: number): ShortLeg[] {
  const short: ShortLeg[] = [];
  let previous: string | null = null;
  for (const stop of plan.stops) {
    if (stop.legMiles < floorMiles - LEG_TOLERANCE_MILES) {
      short.push({ fromCandidateId: previous, toCandidateId: stop.candidateId, legMiles: stop.legMiles, requiredMiles: floorMiles });
    }
    previous = stop.candidateId;
  }
  return short;
}

/**
 * §5.1's two passes. Solve at the requested floor; if that is infeasible, solve
 * again with no floor and report which legs fall short of it. A plan with a 280-mile
 * leg and a clear warning is more use to a dispatcher than a dead end.
 *
 * This is the planning service's retry, deliberately outside `solve()`: a strategy
 * answers one question about one input and never decides to ask a different one.
 *
 * - Feasible at the floor: returned as is, `minLegRelaxed: false`, nothing to disclaim.
 * - A floor of 0 was already requested: there is no second pass to run.
 * - Feasible only without the floor: relaxed if any leg is actually short. A strategy
 *   that fails at the floor and then lands on a plan with no short leg has nothing to
 *   disclaim, so it is not called relaxed.
 * - Infeasible both ways: the first pass's reason is kept, since that is the lane's
 *   answer to the question that was asked.
 */
export function solveWithRelaxation(strategy: OptimizerStrategy, input: OptimizerInput): RelaxedResult {
  const first = strategy.solve(input);
  if (first.kind === "plan") {
    return { result: first, minLegRelaxed: false };
  }

  const floorMiles = input.fuel.minLegMiles;
  if (floorMiles <= 0) {
    return { result: first, minLegRelaxed: false };
  }

  const second = strategy.solve({ ...input, fuel: { ...input.fuel, minLegMiles: 0 } });
  if (second.kind === "infeasible") {
    return { result: first, minLegRelaxed: false };
  }

  const shortLegs = findShortLegs(second, floorMiles);
  return shortLegs.length > 0 ? { result: second, minLegRelaxed: true, shortLegs } : { result: second, minLegRelaxed: false };
}
