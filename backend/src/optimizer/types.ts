/**
 * §13.1. The optimiser seam: a strategy is a pure function from a lane to a plan.
 *
 * Everything here is miles and gallons, as is everything upstream of it: the
 * corridor query and the routing adapter convert at their own edges, so no strategy
 * ever sees a metre. Returns are numbers, never display strings.
 */

/** A priced station the optimiser may stop at. */
export interface OptimizerCandidate {
  id: string;
  /** Miles along the route from the origin. */
  positionMiles: number;
  /** USD per gallon, on whichever price basis the plan chose. 4dp in storage; never rounded here. */
  unitPriceUsd: number;
  /** Extra miles driven to reach this station, off the route. 0 for a station on it. */
  detourMiles: number;
  /** Extra hours driven to reach this station. 0 for a station on the route. */
  detourHours: number;
}

export interface OptimizerFuel {
  tankGallons: number;
  avgMpg: number;
  /** Fraction of the tank that must remain at every arrival. */
  reserveFraction: number;
  /** Hard cap between fuel purchases (§5.1). */
  maxLegMiles: number;
  /**
   * Hard floor between fuel purchases (§5.1). Never applies to the final leg. The
   * two-pass relaxation to 0 is the planning service's job, not the strategy's.
   */
  minLegMiles: number;
  startGallons: number;
  /** Fuel that must remain on arrival at the destination. */
  minArrivalGallons: number;
  /** When false, the last fill need not be within `maxLegMiles` of the destination. */
  requireArrivalWithinMaxLeg: boolean;
}

export interface OptimizerCost {
  costPerMile: number;
  driverCostPerHour: number;
  fixedStopMinutes: number;
}

export interface OptimizerInput {
  totalDistanceMiles: number;
  /** Order is not trusted: a strategy sorts by position. */
  candidates: readonly OptimizerCandidate[];
  fuel: OptimizerFuel;
  cost: OptimizerCost;
  /**
   * `null` is "no cap". It is not `0`, which is a real request for a plan with no
   * stops at all. Required rather than optional so a caller cannot drop it by accident.
   */
  maxStops: number | null;
}

/**
 * One fuel purchase. Fuel is tracked in 2-gallon buckets, rounded down on arrival
 * (§15.3), so `arrivalGallons` is a conservative figure — never more than the truck
 * will really have. The planning service re-derives real figures from the routed
 * legs (§15.5); these are the optimiser's own bookkeeping.
 */
export interface PlannedStop {
  candidateId: string;
  positionMiles: number;
  /** Miles since the previous stop, or since the origin for the first. */
  legMiles: number;
  unitPriceUsd: number;
  arrivalGallons: number;
  purchaseGallons: number;
  departureGallons: number;
  /** `purchaseGallons × unitPriceUsd`. */
  fuelCostUsd: number;
  /** §5.2's stop penalty for this stop. 0 at the v1 defaults. */
  penaltyUsd: number;
}

export interface OptimizerPlan {
  kind: "plan";
  stops: PlannedStop[];
  /** Fuel at the origin, as bucketed. Not the input figure when that was not a whole bucket. */
  startGallons: number;
  /** Last fill (or the origin, with no stops) to the destination. */
  finalLegMiles: number;
  destinationArrivalGallons: number;
  totalGallons: number;
  totalFuelCostUsd: number;
  /** Fuel plus every stop's penalty: the quantity the strategy minimised. */
  totalCostUsd: number;
}

/**
 * - `LEG_GAP` — the leg bounds alone rule out every route to the destination,
 *   whatever the fuel. `gapStartMiles` is the furthest point reachable and
 *   `gapEndMiles` the next station (or the destination) beyond a full leg from it.
 *   Read it as "no station in between" only when `minLegMiles` is 0: at a higher
 *   floor the stretch may hold stations that sit too close to be a legal stop.
 * - `MAX_STOPS_EXCEEDED` — reachable, but not within `maxStops`.
 * - `FUEL_INFEASIBLE` — the legs exist but the tank, reserve or arrival level cannot
 *   be met along them.
 */
export type InfeasibleCode = OptimizerInfeasible["code"];

export type OptimizerInfeasible =
  | {
      kind: "infeasible";
      code: "LEG_GAP";
      detail: { gapStartMiles: number; gapEndMiles: number; gapMiles: number; maxLegMiles: number; minLegMiles: number };
    }
  | { kind: "infeasible"; code: "MAX_STOPS_EXCEEDED"; detail: { maxStops: number; minStopsRequired: number } }
  | {
      kind: "infeasible";
      code: "FUEL_INFEASIBLE";
      detail: { startGallons: number; tankGallons: number; reserveGallons: number; minArrivalGallons: number };
    };

export type OptimizerResult = OptimizerPlan | OptimizerInfeasible;

export interface OptimizerStrategy {
  /** Persisted to `plans.optimizer_strategy`. Never renamed: history depends on it. */
  readonly id: string;
  readonly description: string;
  /**
   * Pure and synchronous: no database, no HTTP, no clock. The return type is a
   * value, not a promise, so a strategy cannot do I/O here without changing the
   * seam. Throws `RangeError` only for malformed input (a programming error);
   * "no plan exists" is a result, never an exception.
   */
  solve(input: OptimizerInput): OptimizerResult;
}
