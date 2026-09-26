import { buildPlan, diagnoseInfeasible, prepareLane, type Step } from "./model.js";
import type { OptimizerResult, OptimizerStrategy } from "./types.js";

/**
 * A reference baseline, never the recommendation (§15.2, §22.3). It exists so the
 * DP has something to be measured against; running both and diffing is how a
 * future strategy is shown to be better.
 *
 * The rule is NEAREST CHEAPER: at each stop, look ahead along the legal targets in
 * order of distance and head for the first one priced below here, buying just
 * enough to reach it. If nothing ahead is cheaper, fill the tank and go to the
 * nearest legal target. The destination counts as a $0 target, so the last stop
 * buys only what the final leg needs.
 *
 * It is NOT "cheapest within range". That rule looks right in review and is wrong:
 * it skips a cheaper station that sits between here and the cheapest one, and pays
 * this station's price for fuel it could have bought at the intermediate one.
 *
 * It obeys the same hard constraints and the same 2-gallon fuel model as the DP
 * (leg cap and floor, reserve, arrival level, `maxStops`, a visited stop buys at
 * least one bucket), so every plan it returns is a plan the DP considered. That is
 * what makes "dp_v1 is never dearer" a theorem rather than a coincidence. It can
 * still dead-end where the DP does not: it commits to a target without looking past it.
 */
function solve(input: Parameters<OptimizerStrategy["solve"]>[0]): OptimizerResult {
  const lane = prepareLane(input);
  const { destination, capLevel, reserveLevel, minArrivalLevel, maxStops } = lane;

  const steps: Step[] = [];
  let node = 0;
  let level = lane.startLevel;

  while (node !== destination) {
    const stopsIncludingHere = steps.length + (node === 0 ? 0 : 1);
    // At a station the tank can be topped up to the cap; at the origin, only what is already aboard.
    const ceiling = node === 0 ? level : capLevel;

    /** The leg to `j` if it is legal and the fuel can cover it, with the level needed on departure. */
    const evaluate = (j: number) => {
      if (!lane.legAllowed(node, j)) return null;
      const toDestination = j === destination;
      if (!toDestination && maxStops !== null && stopsIncludingHere + 1 > maxStops) return null;
      const burn = lane.burnLevels((lane.positions[j] ?? 0) - (lane.positions[node] ?? 0));
      const required = burn + (toDestination ? minArrivalLevel : reserveLevel);
      return required > ceiling ? null : { node: j, burn, required };
    };

    let nearest: ReturnType<typeof evaluate> = null;
    let cheaper: ReturnType<typeof evaluate> = null;
    for (let j = node + 1; j <= destination; j++) {
      const target = evaluate(j);
      if (!target) continue;
      nearest ??= target;
      if ((lane.prices[j] ?? Infinity) < (lane.prices[node] ?? Infinity)) {
        cheaper = target;
        break;
      }
    }

    // Nothing is bought at the origin, so it has no price to be cheaper than. Take the
    // destination outright when it is in reach (no stop at all), else the nearest legal station.
    const target = node === 0 ? (evaluate(destination) ?? nearest) : (cheaper ?? nearest);
    if (!target) {
      return diagnoseInfeasible(lane);
    }

    let departureLevel = level;
    if (node !== 0) {
      // A visited stop buys at least one bucket (§5.1: the cap runs between purchases).
      if (level >= capLevel) {
        return diagnoseInfeasible(lane);
      }
      departureLevel = cheaper ? Math.max(level + 1, target.required) : capLevel;
      steps.push({ node, arrivalLevel: level, departureLevel });
    }

    level = departureLevel - target.burn;
    node = target.node;
  }

  return buildPlan(lane, steps, level);
}

export const greedyOptimizer: OptimizerStrategy = {
  id: "greedy_v1",
  description: "Nearest-cheaper refuelling. A comparison baseline, not the recommendation.",
  solve,
};
