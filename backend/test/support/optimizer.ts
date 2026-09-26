import type { OptimizerCandidate, OptimizerInput, OptimizerPlan, OptimizerResult } from "../../src/optimizer/types.js";

/**
 * A truck chosen so the arithmetic is readable, not to be realistic: at 5 mpg,
 * 100 miles burns exactly 20 gallons = 10 buckets, and a 0.2 reserve is exactly
 * 30 gallons = 15 buckets. Nothing here depends on rounding unless a test says so.
 */
export const TRUCK = {
  tankGallons: 150,
  avgMpg: 5,
  reserveFraction: 0.2,
  maxLegMiles: 500,
  minLegMiles: 300,
  startGallons: 150,
  minArrivalGallons: 30,
  requireArrivalWithinMaxLeg: true,
};

export type CandidateSpec =
  | readonly [mile: number, price: number]
  | { mile: number; price: number; id?: string; detourMiles?: number; detourHours?: number };

export interface LaneSpec {
  distance: number;
  /** `[mile, price]` pairs, or an object to set an id or detours. */
  stations?: readonly CandidateSpec[];
  fuel?: Partial<OptimizerInput["fuel"]>;
  cost?: Partial<OptimizerInput["cost"]>;
  maxStops?: number | null;
}

export function candidate(spec: CandidateSpec, index: number): OptimizerCandidate {
  const s = "mile" in spec ? spec : { mile: spec[0], price: spec[1] };
  return {
    id: ("id" in s ? s.id : undefined) ?? `s${index}@${s.mile}`,
    positionMiles: s.mile,
    unitPriceUsd: s.price,
    detourMiles: ("detourMiles" in s ? s.detourMiles : undefined) ?? 0,
    detourHours: ("detourHours" in s ? s.detourHours : undefined) ?? 0,
  };
}

export function lane(spec: LaneSpec): OptimizerInput {
  return {
    totalDistanceMiles: spec.distance,
    candidates: (spec.stations ?? []).map(candidate),
    fuel: { ...TRUCK, ...spec.fuel },
    cost: { costPerMile: 0, driverCostPerHour: 0, fixedStopMinutes: 0, ...spec.cost },
    maxStops: spec.maxStops === undefined ? null : spec.maxStops,
  };
}

/**
 * Defers a solve until a test asks for it. A describe-level `expectPlan(...)` runs
 * during collection, so a regression there fails the whole file to load instead of
 * failing the one test that names it.
 */
export function once<T>(compute: () => T): () => T {
  let cached: { value: T } | undefined;
  return () => (cached ??= { value: compute() }).value;
}

export function expectPlan(result: OptimizerResult): OptimizerPlan {
  if (result.kind !== "plan") {
    throw new Error(`expected a plan, got infeasible ${result.code}: ${JSON.stringify(result.detail)}`);
  }
  return result;
}

const TOL = 1e-9;
const BUCKET = 2;

/**
 * Checks a plan against §5.1 / §15.1 as written, independently of how any
 * strategy built it. Returns the violations; a valid plan returns `[]`.
 *
 * The one thing it takes from the implementation is the bucket size, because
 * "arrival never exceeds what the truck really has" is only testable against a
 * known bucket.
 */
export function violations(input: OptimizerInput, plan: OptimizerPlan): string[] {
  const { fuel, cost } = input;
  const out: string[] = [];
  const reserve = fuel.reserveFraction * fuel.tankGallons;
  let prevMile = 0;
  let prevDeparture = plan.startGallons;
  let purchased = 0;
  let fuelCost = 0;
  let penalties = 0;

  if (plan.startGallons > fuel.startGallons + TOL || plan.startGallons > fuel.tankGallons + TOL) {
    out.push(`start ${plan.startGallons} exceeds the input start or the tank`);
  }
  if (input.maxStops !== null && plan.stops.length > input.maxStops) {
    out.push(`${plan.stops.length} stops exceeds maxStops ${input.maxStops}`);
  }

  plan.stops.forEach((stop, i) => {
    const tag = `stop ${i} (${stop.candidateId})`;
    const source = input.candidates.find((c) => c.id === stop.candidateId);
    if (!source) {
      out.push(`${tag}: not a candidate`);
      return;
    }
    const leg = source.positionMiles - prevMile;
    if (Math.abs(stop.legMiles - leg) > TOL) out.push(`${tag}: legMiles ${stop.legMiles} != ${leg}`);
    if (leg < -TOL) out.push(`${tag}: stops out of order`);
    if (leg > fuel.maxLegMiles + 1e-6) out.push(`${tag}: leg ${leg} exceeds the ${fuel.maxLegMiles}-mile cap`);
    if (leg < fuel.minLegMiles - 1e-6) out.push(`${tag}: leg ${leg} is under the ${fuel.minLegMiles}-mile floor`);

    // Never more fuel than the truck really has; at most one bucket less per leg.
    const realArrival = prevDeparture - leg / fuel.avgMpg;
    if (stop.arrivalGallons > realArrival + TOL) out.push(`${tag}: arrival ${stop.arrivalGallons} manufactures range (real ${realArrival})`);
    if (stop.arrivalGallons < realArrival - BUCKET - TOL) out.push(`${tag}: arrival ${stop.arrivalGallons} is more than a bucket under ${realArrival}`);
    if (stop.arrivalGallons < reserve - TOL) out.push(`${tag}: arrival ${stop.arrivalGallons} is under the ${reserve}-gallon reserve`);

    if (stop.purchaseGallons <= 0) out.push(`${tag}: a visited stop must buy fuel`);
    if (Math.abs(stop.departureGallons - (stop.arrivalGallons + stop.purchaseGallons)) > TOL) out.push(`${tag}: departure != arrival + purchase`);
    if (stop.departureGallons > fuel.tankGallons + TOL) out.push(`${tag}: departure ${stop.departureGallons} overfills the ${fuel.tankGallons}-gallon tank`);

    if (Math.abs(stop.fuelCostUsd - stop.purchaseGallons * source.unitPriceUsd) > 1e-6) out.push(`${tag}: fuelCostUsd is not gallons x price`);
    const penalty =
      (cost.fixedStopMinutes / 60) * cost.driverCostPerHour + source.detourMiles * cost.costPerMile + source.detourHours * cost.driverCostPerHour;
    if (Math.abs(stop.penaltyUsd - penalty) > 1e-6) out.push(`${tag}: penaltyUsd ${stop.penaltyUsd} != ${penalty}`);

    purchased += stop.purchaseGallons;
    fuelCost += stop.fuelCostUsd;
    penalties += stop.penaltyUsd;
    prevMile = source.positionMiles;
    prevDeparture = stop.departureGallons;
  });

  // Final leg: no floor (§5.1). The cap and the arrival level still apply.
  const finalLeg = input.totalDistanceMiles - prevMile;
  if (Math.abs(plan.finalLegMiles - finalLeg) > TOL) out.push(`finalLegMiles ${plan.finalLegMiles} != ${finalLeg}`);
  if (fuel.requireArrivalWithinMaxLeg && finalLeg > fuel.maxLegMiles + 1e-6) out.push(`final leg ${finalLeg} exceeds the cap`);
  const realFinal = prevDeparture - finalLeg / fuel.avgMpg;
  if (plan.destinationArrivalGallons > realFinal + TOL) out.push(`destination arrival ${plan.destinationArrivalGallons} manufactures range`);
  if (plan.destinationArrivalGallons < fuel.minArrivalGallons - TOL) out.push(`destination arrival ${plan.destinationArrivalGallons} is under ${fuel.minArrivalGallons}`);

  if (Math.abs(plan.totalGallons - purchased) > 1e-6) out.push(`totalGallons ${plan.totalGallons} != ${purchased}`);
  if (Math.abs(plan.totalFuelCostUsd - fuelCost) > 1e-6) out.push(`totalFuelCostUsd ${plan.totalFuelCostUsd} != ${fuelCost}`);
  if (Math.abs(plan.totalCostUsd - (fuelCost + penalties)) > 1e-6) out.push(`totalCostUsd ${plan.totalCostUsd} != ${fuelCost + penalties}`);
  return out;
}

/** mulberry32: a small seeded PRNG, so a sweep failure names a reproducible seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
