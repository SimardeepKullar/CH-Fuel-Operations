import type { OptimizerCandidate, OptimizerInfeasible, OptimizerInput, OptimizerPlan, PlannedStop } from "./types.js";

/**
 * The fuel model both strategies share, so they answer the same question and a
 * diff between them means something. Fuel is a whole number of 2-gallon buckets
 * ("levels"); every rounding below errs toward the truck having LESS fuel than
 * it really does, so discretisation can never manufacture range (§15.3).
 */

/** §15.3: finer than the ±10% real-world MPG error. A 150-gallon tank is 75 buckets. */
export const BUCKET_GALLONS = 2;

/**
 * Distances are floats — a database `numeric(9,3)` read back, then summed and
 * subtracted (legs, offset differences) — so a leg that is "exactly 500 miles" can
 * come out a few ulps either side of 500. A leg within this of a bound is on the
 * bound. It is ~1.6 mm, far below the 0.001 mi (1.6 m) a stored distance resolves.
 */
export const LEG_TOLERANCE_MILES = 1e-6;

/** Guards `floor`/`ceil` of a quotient that is an integer in exact arithmetic. */
const LEVEL_EPSILON = 1e-9;

/**
 * Added to each stop's cost inside the search only, never reported. With no stop
 * penalty every stop set costs the same on a flat-price lane, and an optimiser
 * that breaks that tie arbitrarily hands the dispatcher extra stops for nothing.
 * It cannot change which plan is cheapest: prices are 4dp and a purchase is a
 * whole 2-gallon bucket, so real costs differ by at least $0.0002, and this is
 * $0.000001 a stop.
 */
export const STOP_TIEBREAK_USD = 1e-6;

/** One node of the search graph: index 0 is the origin, `n + 1` the destination. */
export interface Lane {
  input: OptimizerInput;
  /** Candidates sorted by position (then id); node `i` is `candidates[i - 1]`. */
  candidates: OptimizerCandidate[];
  /** Station count. */
  n: number;
  /** Node index of the destination: `n + 1`. */
  destination: number;
  /** Miles from the origin, indexed by node. */
  positions: number[];
  /** USD/gal by node; the origin is `Infinity` (nothing can be bought there). */
  prices: number[];
  /** §5.2's penalty per stop, by node, exactly as configured. */
  penalties: number[];
  capLevel: number;
  startLevel: number;
  /** The lowest level allowed on arrival at a station. */
  reserveLevel: number;
  /** The lowest level allowed on arrival at the destination. */
  minArrivalLevel: number;
  maxStops: number | null;
  /** Buckets burned over `miles`, rounded UP so arrival fuel rounds DOWN. */
  burnLevels(miles: number): number;
  /** Whether a leg from node `from` to node `to` respects the cap and floor. */
  legAllowed(from: number, to: number): boolean;
}

function assertFinite(value: number, label: string, min = 0): void {
  if (!Number.isFinite(value) || value < min) {
    throw new RangeError(`${label} must be a finite number >= ${min}, got ${value}`);
  }
}

/** Validates the input and derives everything a strategy needs from it. Throws `RangeError` on a malformed input. */
export function prepareLane(input: OptimizerInput): Lane {
  const { fuel, cost, totalDistanceMiles, maxStops } = input;
  assertFinite(totalDistanceMiles, "totalDistanceMiles");
  assertFinite(fuel.tankGallons, "fuel.tankGallons", Number.MIN_VALUE);
  assertFinite(fuel.avgMpg, "fuel.avgMpg", Number.MIN_VALUE);
  if (!Number.isFinite(fuel.reserveFraction) || fuel.reserveFraction < 0 || fuel.reserveFraction >= 1) {
    throw new RangeError(`fuel.reserveFraction must be in [0, 1), got ${fuel.reserveFraction}`);
  }
  assertFinite(fuel.maxLegMiles, "fuel.maxLegMiles", Number.MIN_VALUE);
  assertFinite(fuel.minLegMiles, "fuel.minLegMiles");
  if (fuel.minLegMiles > fuel.maxLegMiles) {
    throw new RangeError(`fuel.minLegMiles (${fuel.minLegMiles}) exceeds fuel.maxLegMiles (${fuel.maxLegMiles})`);
  }
  assertFinite(fuel.startGallons, "fuel.startGallons");
  if (fuel.startGallons > fuel.tankGallons) {
    throw new RangeError(`fuel.startGallons (${fuel.startGallons}) exceeds fuel.tankGallons (${fuel.tankGallons})`);
  }
  assertFinite(fuel.minArrivalGallons, "fuel.minArrivalGallons");
  assertFinite(cost.costPerMile, "cost.costPerMile");
  assertFinite(cost.driverCostPerHour, "cost.driverCostPerHour");
  assertFinite(cost.fixedStopMinutes, "cost.fixedStopMinutes");
  if (maxStops !== null && (!Number.isInteger(maxStops) || maxStops < 0)) {
    throw new RangeError(`maxStops must be null or a non-negative integer, got ${maxStops}`);
  }

  for (const c of input.candidates) {
    assertFinite(c.positionMiles, `candidate ${c.id} positionMiles`);
    if (c.positionMiles > totalDistanceMiles) {
      throw new RangeError(`candidate ${c.id} at mile ${c.positionMiles} is past the destination at mile ${totalDistanceMiles}`);
    }
    assertFinite(c.unitPriceUsd, `candidate ${c.id} unitPriceUsd`);
    assertFinite(c.detourMiles, `candidate ${c.id} detourMiles`);
    assertFinite(c.detourHours, `candidate ${c.id} detourHours`);
  }

  const candidates = [...input.candidates].sort(
    (a, b) => a.positionMiles - b.positionMiles || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const n = candidates.length;
  const destination = n + 1;

  const positions = [0, ...candidates.map((c) => c.positionMiles), totalDistanceMiles];
  const prices = [Infinity, ...candidates.map((c) => c.unitPriceUsd), 0];
  const fixedStopCost = (cost.fixedStopMinutes / 60) * cost.driverCostPerHour;
  const penalties = [
    0,
    ...candidates.map((c) => fixedStopCost + c.detourMiles * cost.costPerMile + c.detourHours * cost.driverCostPerHour),
    0,
  ];

  const capLevel = Math.floor(fuel.tankGallons / BUCKET_GALLONS + LEVEL_EPSILON);
  const startLevel = Math.min(Math.floor(fuel.startGallons / BUCKET_GALLONS + LEVEL_EPSILON), capLevel);
  const reserveLevel = Math.ceil((fuel.reserveFraction * fuel.tankGallons) / BUCKET_GALLONS - LEVEL_EPSILON);
  const minArrivalLevel = Math.ceil(fuel.minArrivalGallons / BUCKET_GALLONS - LEVEL_EPSILON);

  const gallonsPerMile = 1 / fuel.avgMpg;
  const minLeg = fuel.minLegMiles - LEG_TOLERANCE_MILES;
  const maxLeg = fuel.maxLegMiles + LEG_TOLERANCE_MILES;

  return {
    input,
    candidates,
    n,
    destination,
    positions,
    prices,
    penalties,
    capLevel,
    startLevel,
    reserveLevel: Math.max(0, reserveLevel),
    minArrivalLevel: Math.max(0, minArrivalLevel),
    maxStops,
    burnLevels(miles) {
      // arrival = floor(departure - burn), and departure is a whole level, so the
      // burn is what gets rounded: up.
      return Math.max(0, Math.ceil((miles * gallonsPerMile) / BUCKET_GALLONS - LEVEL_EPSILON));
    },
    legAllowed(from, to) {
      const miles = (positions[to] ?? 0) - (positions[from] ?? 0);
      if (to === destination) {
        // §5.1: nothing is bought at the destination, so there is no floor on this leg.
        return !fuel.requireArrivalWithinMaxLeg || miles <= maxLeg;
      }
      return miles >= minLeg && miles <= maxLeg;
    },
  };
}

/** One purchase in a strategy's answer, before it is turned into a `PlannedStop`. */
export interface Step {
  /** Station node index, 1..n. */
  node: number;
  arrivalLevel: number;
  departureLevel: number;
}

/**
 * Turns a strategy's steps into the result both strategies return. Totals are
 * summed here from the stops rather than carried out of a search, so the numbers
 * reported always agree with the stops listed.
 */
export function buildPlan(lane: Lane, steps: readonly Step[], destinationArrivalLevel: number): OptimizerPlan {
  const stops: PlannedStop[] = [];
  let previousMiles = 0;
  let totalGallons = 0;
  let totalFuelCostUsd = 0;
  let totalPenaltyUsd = 0;

  for (const step of steps) {
    const candidate = lane.candidates[step.node - 1];
    if (!candidate) {
      throw new Error(`step names node ${step.node}, but the lane has ${lane.n} stations`);
    }
    const purchaseGallons = (step.departureLevel - step.arrivalLevel) * BUCKET_GALLONS;
    const fuelCostUsd = purchaseGallons * candidate.unitPriceUsd;
    const penaltyUsd = lane.penalties[step.node] ?? 0;
    stops.push({
      candidateId: candidate.id,
      positionMiles: candidate.positionMiles,
      legMiles: candidate.positionMiles - previousMiles,
      unitPriceUsd: candidate.unitPriceUsd,
      arrivalGallons: step.arrivalLevel * BUCKET_GALLONS,
      purchaseGallons,
      departureGallons: step.departureLevel * BUCKET_GALLONS,
      fuelCostUsd,
      penaltyUsd,
    });
    previousMiles = candidate.positionMiles;
    totalGallons += purchaseGallons;
    totalFuelCostUsd += fuelCostUsd;
    totalPenaltyUsd += penaltyUsd;
  }

  return {
    kind: "plan",
    stops,
    startGallons: lane.startLevel * BUCKET_GALLONS,
    finalLegMiles: lane.input.totalDistanceMiles - previousMiles,
    destinationArrivalGallons: destinationArrivalLevel * BUCKET_GALLONS,
    totalGallons,
    totalFuelCostUsd,
    totalCostUsd: totalFuelCostUsd + totalPenaltyUsd,
  };
}

/**
 * Says why no plan exists, from the leg bounds alone first: fuel and stop-count
 * are only blamed once the road itself is shown to be crossable.
 *
 * A heuristic strategy can be infeasible where the DP is not; this names the
 * lane's own obstruction, not the strategy's dead end.
 */
export function diagnoseInfeasible(lane: Lane): OptimizerInfeasible {
  const { n, destination, positions, input } = lane;
  const { maxLegMiles, minLegMiles } = input.fuel;

  // Fewest stops to reach each node considering only the leg bounds.
  const fewest: number[] = [0];
  for (let j = 1; j <= n + 1; j++) {
    let best = Infinity;
    for (let i = 0; i < j; i++) {
      const from = fewest[i] ?? Infinity;
      if (from !== Infinity && lane.legAllowed(i, j)) {
        best = Math.min(best, j === destination ? from : from + 1);
      }
    }
    fewest.push(best);
  }

  const toDestination = fewest[destination] ?? Infinity;
  if (toDestination === Infinity) {
    let furthest = 0;
    for (let i = 0; i <= n; i++) {
      if ((fewest[i] ?? Infinity) !== Infinity) furthest = Math.max(furthest, positions[i] ?? 0);
    }
    let gapEnd = positions[destination] ?? 0;
    for (let j = 1; j <= destination; j++) {
      const position = positions[j] ?? 0;
      if (position > furthest + maxLegMiles + LEG_TOLERANCE_MILES) {
        gapEnd = position;
        break;
      }
    }
    return {
      kind: "infeasible",
      code: "LEG_GAP",
      detail: { gapStartMiles: furthest, gapEndMiles: gapEnd, gapMiles: gapEnd - furthest, maxLegMiles, minLegMiles },
    };
  }

  if (lane.maxStops !== null && toDestination > lane.maxStops) {
    return {
      kind: "infeasible",
      code: "MAX_STOPS_EXCEEDED",
      detail: { maxStops: lane.maxStops, minStopsRequired: toDestination },
    };
  }

  return {
    kind: "infeasible",
    code: "FUEL_INFEASIBLE",
    detail: {
      startGallons: input.fuel.startGallons,
      tankGallons: input.fuel.tankGallons,
      reserveGallons: input.fuel.reserveFraction * input.fuel.tankGallons,
      minArrivalGallons: input.fuel.minArrivalGallons,
    },
  };
}
