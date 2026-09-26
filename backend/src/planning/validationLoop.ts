import type { LatLng } from "../domain/planResponse.js";
import type { OptimizerInfeasible, OptimizerInput, OptimizerStrategy } from "../optimizer/types.js";
import { RoutingProviderError, type RouteResult, type RoutingProvider, type TruckSpec } from "../routing/provider.js";
import { realizePlan, rescaleLane, type LegViolation, type ValidatedPlan } from "./realLane.js";
import { findShortLegs, solveWithRelaxation, type ShortLeg } from "./relaxation.js";

/** §15.5: converges on the first or second pass almost always, so a third is the last resort. Also a cap on ORS calls per plan. */
export const MAX_VALIDATION_ITERATIONS = 3;

export interface ValidationLoopInput {
  /** Only `route` is used, and only ever with the plan's stops as vias. */
  provider: Pick<RoutingProvider, "name" | "route">;
  strategy: OptimizerStrategy;
  /** The baseline lane: distances along the direct route. Never modified. */
  lane: OptimizerInput;
  /** Where each candidate is, by candidate id; a via point is a station's own coordinate. */
  locations: ReadonlyMap<string, LatLng>;
  origin: LatLng;
  destination: LatLng;
  truckSpec: TruckSpec;
  /** The direct route's duration, for a plan that stops nowhere and so needs no new route. */
  baselineDurationSeconds: number;
  departAt?: Date;
}

interface ValidatedPlanBase {
  kind: "plan";
  plan: ValidatedPlan;
  /** The route that was checked, to persist as the optimised route. `null` for a plan with no stops: it is the direct route. */
  route: RouteResult | null;
  /** How many times the optimiser ran. */
  iterations: number;
  /** How many times the provider was called. */
  routeCalls: number;
}

/**
 * `MIN_LEG_RELAXED` data: set only when the second pass ran *and* a leg of the real
 * route is actually under the floor, so `shortLegs` is never empty.
 */
export type ValidatedPlanResult =
  | (ValidatedPlanBase & { minLegRelaxed: false })
  | (ValidatedPlanBase & { minLegRelaxed: true; shortLegs: ShortLeg[] });

/**
 * §15.5 step 4's exit: the loop's own failure, distinct from the optimiser's. Every
 * attempt is kept so a dispatcher (or a developer) can see what it flip-flopped between.
 */
export interface NoStablePlan {
  kind: "infeasible";
  code: "NO_STABLE_PLAN";
  detail: {
    iterations: number;
    routeCalls: number;
    attempts: Array<{ stopIds: string[]; violations: LegViolation[] }>;
  };
}

export type ValidationLoopResult = ValidatedPlanResult | OptimizerInfeasible | NoStablePlan;

function sameStops(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * §15.5, the mandatory loop: the 500-mile cap verified against measured distances.
 *
 * Everything upstream measures along the baseline polyline, and a stop inserted as a
 * via can change which highway the router picks. So, up to `MAX_VALIDATION_ITERATIONS`
 * times:
 *
 *  1. solve (with §5.1's relaxation) on the current lane;
 *  2. route through the chosen stops, in position order;
 *  3. replay the plan over the real legs, re-checking the cap and the reserve;
 *  4. clean → done, with distances, fuel and costs rebuilt from the real route.
 *     Violated → rescale the *baseline* lane by what was measured (`rescaleLane`) and
 *     go round again. If the solver picks the stops that just failed there is nothing
 *     new to measure, so it stops there rather than spending a route call to be told
 *     the same thing.
 *
 * A plan with no stops needs no route: it is the direct route, already measured.
 *
 * Each pass is one ORS call, so a plan costs at most three. A stable lane costs one.
 * The optimiser and the provider both stay behind their own seams: `strategy` is pure,
 * `provider` is injected, and nothing here reads a clock or a database.
 *
 * Returns the optimiser's own infeasibility untouched when the lane has no plan, and
 * `NO_STABLE_PLAN` only when the loop ran out of passes. Provider failures propagate.
 */
export async function runValidationLoop(input: ValidationLoopInput): Promise<ValidationLoopResult> {
  const { provider, strategy, lane, locations } = input;
  const attempts: NoStablePlan["detail"]["attempts"] = [];
  const noStable = (iterations: number, routeCalls: number): NoStablePlan => ({
    kind: "infeasible",
    code: "NO_STABLE_PLAN",
    detail: { iterations, routeCalls, attempts },
  });

  let working = lane;
  let routed: { stopIds: string[]; route: RouteResult } | null = null;
  let routeCalls = 0;

  for (let iteration = 1; iteration <= MAX_VALIDATION_ITERATIONS; iteration++) {
    const solved = solveWithRelaxation(strategy, working);
    if (solved.result.kind === "infeasible") {
      return solved.result;
    }
    const plan = solved.result;
    const stopIds = plan.stops.map((s) => s.candidateId);

    let route: RouteResult | null = null;
    let fresh = false;
    if (stopIds.length > 0) {
      if (routed && sameStops(routed.stopIds, stopIds)) {
        route = routed.route;
      } else {
        const via = stopIds.map((id) => {
          const at = locations.get(id);
          if (!at) throw new Error(`no location for candidate ${id}`);
          return at;
        });
        route = await provider.route({
          origin: input.origin,
          destination: input.destination,
          via,
          truckSpec: input.truckSpec,
          ...(input.departAt ? { departAt: input.departAt } : {}),
        });
        routeCalls++;
        fresh = true;
        if (route.legs.length !== stopIds.length + 1) {
          throw new RoutingProviderError(
            provider.name,
            200,
            undefined,
            `routing through ${stopIds.length} stops returned ${route.legs.length} legs, expected ${stopIds.length + 1}`,
          );
        }
      }
    }

    const legs = route
      ? route.legs
      : [{ distanceMiles: lane.totalDistanceMiles, durationSeconds: input.baselineDurationSeconds }];
    const { plan: real, violations } = realizePlan(lane, plan, legs);

    if (violations.length === 0) {
      const base = { kind: "plan", plan: real, route, iterations: iteration, routeCalls } as const;
      if (solved.minLegRelaxed) {
        const shortLegs = findShortLegs(real, lane.fuel.minLegMiles);
        if (shortLegs.length > 0) return { ...base, minLegRelaxed: true, shortLegs };
      }
      return { ...base, minLegRelaxed: false };
    }

    attempts.push({ stopIds, violations });
    if (!fresh || !route) {
      return noStable(iteration, routeCalls);
    }
    routed = { stopIds, route };
    working = rescaleLane(lane, stopIds, route.legs);
  }

  return noStable(MAX_VALIDATION_ITERATIONS, routeCalls);
}
