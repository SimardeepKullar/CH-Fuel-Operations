import { buildPlan, diagnoseInfeasible, prepareLane, STOP_TIEBREAK_USD, type Step } from "./model.js";
import type { OptimizerInput, OptimizerResult, OptimizerStrategy } from "./types.js";

/**
 * §15.3: an exact DP over `(station, fuel level)`, in 2-gallon buckets.
 *
 * `arrival[node][layer][level]` is the cheapest way to arrive at `node` holding
 * `level` buckets. `layer` is the number of stops made so far, and exists only
 * when `maxStops` is set (§15.3's third dimension); without a cap there is one
 * layer and the count is not tracked.
 *
 * Each station is relaxed in two phases, which is what keeps it cheap:
 *
 *   A. Purchase, in place: a linear pass over levels turns arrival costs into
 *      departure costs. Buying moves `f -> f + 1` at `BUCKET x price`.
 *   B. Drive: from each departure level, relax every later node whose leg is
 *      within the cap and floor. The leg burns a whole number of buckets, rounded
 *      UP, so arrival fuel is rounded DOWN and discretisation never manufactures
 *      range that is not there. The transition into the destination ignores the
 *      floor: nothing is bought there (§5.1).
 *
 * Deviation from §15.3 as written: a visited station buys at least one bucket.
 * §15.3 lets Phase A leave the level unchanged, but then a stop that buys nothing
 * would still reset the leg counter, and a truck could cross 800 miles on "stops"
 * that never fuel it — breaking §5.1's cap on distance between PURCHASES. A stop
 * the plan does not need is simply not made.
 *
 * Bookkeeping is flat typed arrays indexed by `(node, layer, level)`.
 */

/** What a solve did, besides its answer. Exposed so tests can check the cost model without a clock. */
export interface DpStats {
  /** Phase B inner iterations: the O(n^2 B) term. */
  relaxations: number;
}

export function solveWithStats(input: OptimizerInput): { result: OptimizerResult; stats: DpStats } {
  const lane = prepareLane(input);
  const { n, destination, capLevel, startLevel, reserveLevel, minArrivalLevel, maxStops, positions, prices, penalties } = lane;

  const capped = maxStops !== null;
  const layers = capped ? maxStops + 1 : 1;
  const width = capLevel + 1;
  const size = (n + 2) * layers * width;
  const slot = (node: number, layer: number, level: number) => (node * layers + layer) * width + level;

  // Cheapest cost to arrive at (node, layer, level), and where that arrival came from.
  const arrival = new Float64Array(size).fill(Infinity);
  const fromNode = new Int32Array(size).fill(-1);
  const fromLayer = new Int32Array(size).fill(-1);
  const fromLevel = new Int32Array(size).fill(-1);
  // Cheapest departure from (station, layer, level) came from arriving at this level.
  const boughtFrom = new Int32Array(size).fill(-1);

  const departure = new Float64Array(width);
  let relaxations = 0;

  /** Phase B: drive from `node` (departing at `layer` with `departure[level]`) to every later node it can reach. */
  const drive = (node: number, layer: number) => {
    for (let j = node + 1; j <= destination; j++) {
      if (!lane.legAllowed(node, j)) continue;
      const toDestination = j === destination;
      const nextLayer = capped && !toDestination ? layer + 1 : layer;
      if (nextLayer >= layers) continue;

      const burn = lane.burnLevels((positions[j] ?? 0) - (positions[node] ?? 0));
      const lowest = burn + (toDestination ? minArrivalLevel : reserveLevel);
      for (let level = lowest; level <= capLevel; level++) {
        relaxations++;
        const cost = departure[level] ?? Infinity;
        if (cost === Infinity) continue;
        const to = slot(j, nextLayer, level - burn);
        if (cost < (arrival[to] ?? Infinity)) {
          arrival[to] = cost;
          fromNode[to] = node;
          fromLayer[to] = layer;
          fromLevel[to] = level;
        }
      }
    }
  };

  // The origin is a virtual node: it departs with the start fuel and cannot buy.
  departure.fill(Infinity);
  departure[startLevel] = 0;
  drive(0, 0);

  for (let node = 1; node <= n; node++) {
    const price = prices[node] ?? Infinity;
    // The tiebreak is search-only; the reported penalty is `penalties[node]` alone.
    const stopCost = (penalties[node] ?? 0) + STOP_TIEBREAK_USD;
    const bucketCost = price * 2; // BUCKET_GALLONS
    for (let layer = capped ? 1 : 0; layer < layers; layer++) {
      // Phase A. `held` is the cheapest way to be at the current level having already bought here.
      departure.fill(Infinity);
      let held = Infinity;
      let heldFrom = -1;
      for (let level = 1; level <= capLevel; level++) {
        const arrived = arrival[slot(node, layer, level - 1)] ?? Infinity;
        const startNow = arrived + stopCost; // begin buying at level - 1
        if (startNow < held) {
          held = startNow;
          heldFrom = level - 1;
        }
        if (held === Infinity) continue;
        held += bucketCost;
        departure[level] = held;
        boughtFrom[slot(node, layer, level)] = heldFrom;
      }
      drive(node, layer);
    }
  }

  // The cheapest way to arrive: fuel left over at the destination is worth nothing.
  let bestCost = Infinity;
  let bestSlot = -1;
  for (let layer = 0; layer < layers; layer++) {
    for (let level = minArrivalLevel; level <= capLevel; level++) {
      const s = slot(destination, layer, level);
      if ((arrival[s] ?? Infinity) < bestCost) {
        bestCost = arrival[s] ?? Infinity;
        bestSlot = s;
      }
    }
  }
  if (bestSlot < 0) {
    return { result: diagnoseInfeasible(lane), stats: { relaxations } };
  }

  // Walk the predecessors back to the origin.
  const steps: Step[] = [];
  const destinationLevel = bestSlot % width;
  let cursor = bestSlot;
  for (;;) {
    const node = fromNode[cursor] ?? -1;
    const layer = fromLayer[cursor] ?? -1;
    const departureLevel = fromLevel[cursor] ?? -1;
    if (node < 0) {
      throw new Error("dp_v1: broken predecessor chain");
    }
    if (node === 0) break;
    const arrivalLevel = boughtFrom[slot(node, layer, departureLevel)] ?? -1;
    if (arrivalLevel < 0) {
      throw new Error("dp_v1: broken purchase chain");
    }
    steps.push({ node, arrivalLevel, departureLevel });
    cursor = slot(node, layer, arrivalLevel);
  }
  steps.reverse();

  return { result: buildPlan(lane, steps, destinationLevel), stats: { relaxations } };
}

export const dynamicProgrammingOptimizer: OptimizerStrategy = {
  id: "dp_v1",
  description: "Exact DP over (station, fuel level) in 2-gallon buckets. The default.",
  solve: (input) => solveWithStats(input).result,
};
