import { describe, expect, it } from "vitest";
import { expectPlan, lane, once, seededRandom, violations, type LaneSpec } from "../../test/support/optimizer.js";
import { dynamicProgrammingOptimizer, solveWithStats } from "./dp_v1.js";
import { greedyOptimizer } from "./greedy_v1.js";
import type { OptimizerInput, OptimizerResult } from "./types.js";

/** Solves, and insists every plan returned is a legal one by the independent checker. */
function solve(spec: LaneSpec): OptimizerResult {
  const input = lane(spec);
  const result = dynamicProgrammingOptimizer.solve(input);
  if (result.kind === "plan") {
    expect(violations(input, result), "every dp_v1 plan must be a legal plan").toEqual([]);
  }
  return result;
}

const miles = (result: OptimizerResult) => expectPlan(result).stops.map((s) => s.positionMiles);

// TRUCK (test/support/optimizer.ts): 150 gal tank, 5 mpg, so 100 miles = 20 gal =
// 10 buckets; reserve and arrival minimum 30 gal = 15 buckets. Hand-derived figures
// below are in gallons.

describe("dp_v1", () => {
  it("identifies itself", () => {
    expect(dynamicProgrammingOptimizer.id).toBe("dp_v1");
    expect(dynamicProgrammingOptimizer.description).toMatch(/exact/i);
  });

  describe("§15.6: degenerate lanes", () => {
    it("a single candidate that works: a plan, and the stop buys what the last leg needs", () => {
      // 350 @3.50, destination at 700. Arrive at 350 with 80 gal; the last 350 miles
      // burn 70 and must leave 30, so depart with 100: buy 20.
      const plan = expectPlan(solve({ distance: 700, stations: [[350, 3.5]] }));
      expect(plan.stops).toHaveLength(1);
      expect(plan.stops[0]).toMatchObject({ arrivalGallons: 80, purchaseGallons: 20, departureGallons: 100 });
      expect(plan.totalCostUsd).toBeCloseTo(70, 9);
    });

    it("a single candidate that cannot work: infeasible, no crash", () => {
      // 100 miles out is under the 300 floor, and the destination is 600 beyond it.
      expect(solve({ distance: 700, stations: [[100, 3]] })).toMatchObject({ kind: "infeasible", code: "LEG_GAP" });
    });

    it("zero candidates on a lane past the cap: infeasible with a structured reason", () => {
      expect(solve({ distance: 700 })).toEqual({
        kind: "infeasible",
        code: "LEG_GAP",
        detail: { gapStartMiles: 0, gapEndMiles: 700, gapMiles: 700, maxLegMiles: 500, minLegMiles: 300 },
      });
    });

    it("zero candidates on a lane within the cap: a plan with no stops, not an error", () => {
      // The ticket's "zero candidates -> infeasible" only holds when the trip needs a stop.
      const plan = expectPlan(solve({ distance: 400 }));
      expect(plan.stops).toEqual([]);
      expect(plan.totalCostUsd).toBe(0);
      expect(plan.destinationArrivalGallons).toBe(70); // 150 - 80 burned
    });

    it("a zero-length trip is a plan with no stops", () => {
      expect(expectPlan(solve({ distance: 0 })).stops).toEqual([]);
    });
  });

  describe("§15.6: a candidate at mile 0 — the origin already counts as a fill", () => {
    it("is not selectable under the floor: a leg of 0 miles is under 300", () => {
      expect(miles(solve({ distance: 800, stations: [[0, 1.0], [400, 3.5]] }))).toEqual([400]);
    });

    it("is selectable once the floor is lifted, and tops up a part-empty tank", () => {
      // Start with 60 gal: without the mile-0 fill the 400-mile leg (80 gal) is impossible.
      // Fill to the 150-gal cap at $1.00 (90 gal); arrive at 400 with 70, need 110 for the last 400 miles: buy 40.
      const plan = expectPlan(
        solve({ distance: 800, stations: [[0, 1.0], [400, 3.5]], fuel: { minLegMiles: 0, startGallons: 60 } }),
      );
      expect(plan.stops.map((s) => [s.positionMiles, s.legMiles, s.purchaseGallons])).toEqual([
        [0, 0, 90],
        [400, 400, 40],
      ]);
    });
  });

  describe("§15.6: price trends", () => {
    it("rising prices: fills early", () => {
      // 300 @3.0, 600 @3.2, 900 @3.4, destination 1150. Every stop is forced (no leg can skip one).
      // Fill to 150 at the cheapest; buy at 600 just enough that 900 need only take the forced bucket.
      const plan = expectPlan(solve({ distance: 1150, stations: [[300, 3.0], [600, 3.2], [900, 3.4]] }));
      expect(plan.stops.map((s) => s.purchaseGallons)).toEqual([60, 48, 2]);
      expect(plan.stops[0]?.departureGallons).toBe(150);
      expect(plan.totalCostUsd).toBeCloseTo(60 * 3.0 + 48 * 3.2 + 2 * 3.4, 9);
    });

    it("falling prices: the minimum until the cheap station", () => {
      // 300 @3.4, 600 @3.2, 900 @3.0. One bucket at the dearest; just enough at the middle to reach the cheapest.
      const plan = expectPlan(solve({ distance: 1150, stations: [[300, 3.4], [600, 3.2], [900, 3.0]] }));
      expect(plan.stops.map((s) => s.purchaseGallons)).toEqual([2, 58, 50]);
      expect(plan.totalCostUsd).toBeCloseTo(2 * 3.4 + 58 * 3.2 + 50 * 3.0, 9);
    });
  });

  describe("§15.6: leg bounds are inclusive at the bound and exclusive one mile past it", () => {
    it.each([
      ["500 from the origin", [[500, 3]], 900, true],
      ["501 from the origin", [[501, 3]], 900, false],
      ["500 between stops", [[300, 3], [800, 3]], 1100, true],
      ["501 between stops", [[300, 3], [801, 3]], 1100, false],
    ] as const)("cap: %s is %s", (_label, stations, distance, accepted) => {
      const result = solve({ distance, stations });
      expect(result.kind).toBe(accepted ? "plan" : "infeasible");
      if (accepted) expect(miles(result)).toEqual(stations.map(([m]) => m));
      else expect(result).toMatchObject({ code: "LEG_GAP" });
    });

    it.each([
      ["300 from the origin", [[300, 3]], 700, true],
      ["299 from the origin", [[299, 3]], 700, false],
      ["300 between stops", [[400, 3], [700, 3]], 1100, true],
      ["299 between stops", [[400, 3], [699, 3]], 1100, false],
    ] as const)("floor: %s is %s", (_label, stations, distance, accepted) => {
      const result = solve({ distance, stations });
      expect(result.kind).toBe(accepted ? "plan" : "infeasible");
      if (accepted) expect(miles(result)).toEqual(stations.map(([m]) => m));
    });

    it("a station 200 miles out that is cheapest but violates the floor is not selectable", () => {
      const withFloor = expectPlan(solve({ distance: 800, stations: [[200, 2.0], [350, 3.5]] }));
      expect(withFloor.stops.map((s) => s.positionMiles)).toEqual([350]);

      // The floor is the only thing keeping it out: lift it and the cheap station is used.
      const noFloor = expectPlan(solve({ distance: 800, stations: [[200, 2.0], [350, 3.5]], fuel: { minLegMiles: 0 } }));
      expect(noFloor.stops.map((s) => s.positionMiles)).toContain(200);
      expect(noFloor.totalCostUsd).toBeLessThan(withFloor.totalCostUsd);
    });
  });

  describe("§5.1 / §15.6: the final leg has NO floor", () => {
    // The classic off-by-one: the 300-mile floor applied to the leg into the destination.
    it.each([
      ["200 miles", 700, 500],
      ["100 miles", 600, 500],
      ["10 miles", 510, 500],
      ["1 mile", 501, 500],
    ])("a final leg of %s is ACCEPTED", (_label, distance, stationMile) => {
      const plan = expectPlan(solve({ distance, stations: [[stationMile, 3.5]] }));
      expect(plan.finalLegMiles).toBe(distance - stationMile);
      expect(plan.finalLegMiles).toBeLessThan(300);
    });

    it("the same 299 miles is accepted at the end of a trip and rejected in the middle of one", () => {
      expect(solve({ distance: 699, stations: [[400, 3]] }).kind).toBe("plan"); // 400 -> destination: 299
      expect(solve({ distance: 1100, stations: [[400, 3], [699, 3]] }).kind).toBe("infeasible"); // 400 -> 699: 299
    });

    it("still needs the cap and the arrival level on that leg", () => {
      // Destination 501 past the last stop: over the cap.
      expect(solve({ distance: 801, stations: [[300, 3]] })).toMatchObject({ kind: "infeasible", code: "LEG_GAP" });
    });
  });

  describe("§15.6: destination exactly 500 miles from the last stop", () => {
    it("is accepted at 500", () => {
      expect(expectPlan(solve({ distance: 800, stations: [[300, 3]] })).finalLegMiles).toBe(500);
    });

    it("is rejected at 501, unless arrival within the cap is not required", () => {
      expect(solve({ distance: 801, stations: [[300, 3]] }).kind).toBe("infeasible");
      const relaxed = expectPlan(solve({ distance: 801, stations: [[300, 3]], fuel: { requireArrivalWithinMaxLeg: false } }));
      expect(relaxed.finalLegMiles).toBe(501);
    });
  });

  describe("§15.3: a 967-mile route admits one stop only in miles 467-500", () => {
    // The scope's own worked example, on the realistic 6.5-mpg truck.
    const REAL = { tankGallons: 150, avgMpg: 6.5, reserveFraction: 0.15, minArrivalGallons: 22.5, startGallons: 150 };

    it.each([
      [466, false],
      [467, true],
      [480, true],
      [500, true],
      [501, false],
    ])("a lone station at mile %s: feasible=%s", (mile, feasible) => {
      const result = solve({ distance: 967, stations: [[mile, 3.5]], fuel: REAL });
      expect(result.kind).toBe(feasible ? "plan" : "infeasible");
    });
  });

  describe("§15.6: the arrival reserve", () => {
    it("forces a larger purchase at the last stop when the arrival minimum rises", () => {
      // 400 @3.00, destination 700. Arrive at 400 with 70 gal; the last 300 miles burn 60.
      const at = (minArrivalGallons: number) =>
        expectPlan(solve({ distance: 700, stations: [[400, 3.0]], fuel: { minArrivalGallons } })).stops[0]?.purchaseGallons;
      expect(at(30)).toBe(20); // depart with 90
      expect(at(60)).toBe(50); // depart with 120
      expect(at(60)).toBeGreaterThan(at(30) ?? Infinity);
    });

    it("rejects a plan that would arrive under the minimum, however cheap", () => {
      // 100 gal tank: a 500-mile trip burns 100 gal and leaves nothing.
      expect(solve({ distance: 500, fuel: { tankGallons: 100, startGallons: 100 } })).toMatchObject({
        kind: "infeasible",
        code: "FUEL_INFEASIBLE",
      });
    });

    it("never lets an intermediate arrival fall under the reserve", () => {
      // 0.4 x 150 = 60 gal reserve. A 500-mile leg burns 100 gal from a full 150: arrives with 50 < 60.
      expect(solve({ distance: 900, stations: [[500, 3]], fuel: { reserveFraction: 0.4, minArrivalGallons: 0 } })).toMatchObject({
        kind: "infeasible",
      });
    });
  });

  describe("§5.4 / §15.6: carrying fuel forward past an expensive mandatory stop", () => {
    // The case that separates the DP from a shortest path over stop positions.
    // 350 @$3.00 is cheap; 700 @$5.00 is dear but unavoidable (no leg can skip it: the
    // destination is 900, and 350 -> 900 is 550). A plan that buys only what each leg needs
    // pays $5.00 for 40 gal at the dear stop. The DP instead buys, at $3.00, exactly the
    // surplus that spares the dear stop: it arrives at 700 already holding what the last
    // 200 miles need, so the forced stop buys one bucket and nothing more.
    const plan = once(() => expectPlan(solve({ distance: 900, stations: [[350, 3.0], [700, 5.0]] })));

    it("buys the surplus at the cheap station, and no more than that", () => {
      // Arrive at 350 with 80 gal. Depart with 138: 68 left at 700, and 70 covers the last 200 miles + reserve.
      // A full tank (150) would be 12 gal of $3.00 fuel nobody needs.
      expect(plan().stops[0]).toMatchObject({ arrivalGallons: 80, purchaseGallons: 58, departureGallons: 138 });
    });

    it("buys the minimum at the expensive mandatory stop", () => {
      expect(plan().stops[1]?.purchaseGallons).toBe(2);
    });

    it("beats what buying only what each leg needs would cost", () => {
      // Myopic: at 350 buy 20 gal (enough to reach 700 with the reserve), then 40 gal at $5.00.
      const myopic = 20 * 3.0 + 40 * 5.0;
      expect(plan().totalCostUsd).toBeCloseTo(58 * 3.0 + 2 * 5.0, 9);
      expect(plan().totalCostUsd).toBeLessThan(myopic);
    });

    it("carries surplus only as far as the tank allows", () => {
      // A 40-gal tank at 5 mpg cannot bank enough to matter: it must buy at the dear stop.
      const small = expectPlan(
        solve({ distance: 900, stations: [[350, 3.0], [700, 5.0]], fuel: { tankGallons: 100, startGallons: 100, minArrivalGallons: 20, reserveFraction: 0.2 } }),
      );
      expect(small.stops[1]?.purchaseGallons).toBeGreaterThan(2);
    });
  });

  describe("§15.6: maxStops", () => {
    // Two cheap stops (320, 640 @$3.00) versus one dear stop (500 @$4.50).
    const stations = [[320, 3.0], [500, 4.5], [640, 3.0]] as const;

    it("unbounded, it takes the cheap pair", () => {
      const plan = expectPlan(solve({ distance: 1000, stations }));
      expect(plan.stops.map((s) => s.positionMiles)).toEqual([320, 640]);
      expect(plan.totalCostUsd).toBeCloseTo(80 * 3.0, 9);
    });

    it("maxStops 2 is not binding here", () => {
      expect(miles(solve({ distance: 1000, stations, maxStops: 2 }))).toEqual([320, 640]);
    });

    it("maxStops 1 binds: the single dear stop, and it costs more", () => {
      const capped = expectPlan(solve({ distance: 1000, stations, maxStops: 1 }));
      expect(capped.stops).toHaveLength(1);
      expect(capped.stops[0]?.positionMiles).toBe(500);
      expect(capped.totalCostUsd).toBeCloseTo(80 * 4.5, 9);
    });

    it("maxStops 0 on a lane that needs a stop is infeasible, and says how many it needs", () => {
      expect(solve({ distance: 1000, stations, maxStops: 0 })).toEqual({
        kind: "infeasible",
        code: "MAX_STOPS_EXCEEDED",
        detail: { maxStops: 0, minStopsRequired: 1 },
      });
    });

    it("nulls are meaningful: null is no cap, 0 is a real cap of zero stops", () => {
      // The same lane, differing only in null vs 0. Coercing null to 0 would flip the first.
      expect(solve({ distance: 700, stations: [[400, 3]], maxStops: null }).kind).toBe("plan");
      expect(solve({ distance: 700, stations: [[400, 3]], maxStops: 0 }).kind).toBe("infeasible");
      // And 0 on a lane that needs no stop is still a plan.
      expect(expectPlan(solve({ distance: 400, stations: [[200, 3]], maxStops: 0 })).stops).toEqual([]);
    });
  });

  describe("§5.2: the stop penalty", () => {
    // 300 @4.00, 500 @3.95, 600 @3.00, destination 700, and $60 a stop (60 min x $60/h).
    const stations = [[300, 4.0], [500, 3.95], [600, 3.0]] as const;

    it("with no penalty, the cheap second stop is worth making", () => {
      const plan = expectPlan(solve({ distance: 700, stations }));
      expect(plan.stops.map((s) => s.positionMiles)).toEqual([300, 600]);
      expect(plan.totalCostUsd).toBeCloseTo(2 * 4.0 + 18 * 3.0, 9);
    });

    it("with a $60 stop penalty it makes one stop instead of two", () => {
      const plan = expectPlan(solve({ distance: 700, stations, cost: { driverCostPerHour: 60, fixedStopMinutes: 60 } }));
      expect(plan.stops.map((s) => s.positionMiles)).toEqual([500]);
      expect(plan.stops[0]).toMatchObject({ penaltyUsd: 60, fuelCostUsd: expect.closeTo(20 * 3.95, 9) });
      expect(plan.totalCostUsd).toBeCloseTo(20 * 3.95 + 60, 9);
      expect(plan.totalFuelCostUsd).toBeCloseTo(20 * 3.95, 9);
    });

    it("charges a detour at cost per mile, so a nearer-the-road station wins", () => {
      // Two stations at nearly the same mile; the cheaper one is 20 miles off the road.
      const near = { mile: 450, price: 3.2 };
      const off = { mile: 400, price: 3.0, detourMiles: 20 };
      const free = expectPlan(solve({ distance: 700, stations: [off, near] }));
      expect(free.stops[0]?.positionMiles).toBe(400);
      const charged = expectPlan(solve({ distance: 700, stations: [off, near], cost: { costPerMile: 2 } }));
      expect(charged.stops[0]?.positionMiles).toBe(450);
      expect(charged.stops[0]?.penaltyUsd).toBe(0);
    });
  });

  describe("ties", () => {
    it("on a flat-price lane it makes the fewest stops, not an arbitrary set", () => {
      // Found by sweeping 3,000 random flat-price lanes with the tiebreak removed: this is the
      // one where equal-cost plans of 2 and 3 stops tied and the search kept the 3. Every stop
      // set costs the same here, so only the tiebreak decides. Two stops is the minimum: one
      // would need a station at mile 629 or later that is also within 500 of the origin.
      const stations = [56, 146, 271, 281, 505, 695, 769, 929, 955, 1082].map((mile) => [mile, 3.3] as const);
      const plan = expectPlan(solve({ distance: 1129, stations, fuel: { minLegMiles: 0 } }));
      expect(plan.stops).toHaveLength(2);
    });

    it("does not depend on the order candidates arrive in", () => {
      const stations = [[300, 3.4], [600, 3.2], [900, 3.0], [450, 3.3]] as const;
      const shape = (r: OptimizerResult) => expectPlan(r).stops.map((s) => [s.positionMiles, s.purchaseGallons]);
      const forward = shape(solve({ distance: 1150, stations }));
      expect(shape(solve({ distance: 1150, stations: [...stations].reverse() }))).toEqual(forward);
    });
  });

  it("does not mutate its input", () => {
    const input = lane({ distance: 1150, stations: [[900, 3.0], [300, 3.4], [600, 3.2]] });
    const snapshot = structuredClone(input);
    dynamicProgrammingOptimizer.solve(input);
    expect(input).toEqual(snapshot);
  });

  it("is synchronous", () => {
    expect(dynamicProgrammingOptimizer.solve(lane({ distance: 100 }))).not.toBeInstanceOf(Promise);
  });
});

// ---------------------------------------------------------------------------
// An oracle that shares no code with dp_v1: enumerate every subset of stations,
// and for each fixed stop sequence find the cheapest purchases by a plain
// forward pass over fuel levels. Exponential, so only for small lanes.
// ---------------------------------------------------------------------------

const B = 2;

function oracleMinCost(input: OptimizerInput): number | null {
  const { fuel, cost, maxStops } = input;
  const stations = [...input.candidates].sort((a, b) => a.positionMiles - b.positionMiles);
  const cap = Math.floor(fuel.tankGallons / B);
  const start = Math.min(Math.floor(fuel.startGallons / B), cap);
  const reserve = Math.ceil((fuel.reserveFraction * fuel.tankGallons) / B - 1e-9);
  const minArrival = Math.ceil(fuel.minArrivalGallons / B - 1e-9);
  const burn = (d: number) => Math.max(0, Math.ceil(d / (fuel.avgMpg * B) - 1e-9));
  const penalty = (c: (typeof stations)[number]) =>
    (cost.fixedStopMinutes / 60) * cost.driverCostPerHour + c.detourMiles * cost.costPerMile + c.detourHours * cost.driverCostPerHour;

  let best: number | null = null;
  for (let mask = 0; mask < 1 << stations.length; mask++) {
    const seq = stations.filter((_, i) => mask & (1 << i));
    if (maxStops !== null && seq.length > maxStops) continue;

    let level = new Map<number, number>([[start, 0]]);
    let prev = 0;
    let ok = true;
    for (const stop of seq) {
      const d = stop.positionMiles - prev;
      if (d > fuel.maxLegMiles + 1e-6 || d < fuel.minLegMiles - 1e-6) {
        ok = false;
        break;
      }
      const next = new Map<number, number>();
      for (const [dep, c] of level) {
        const arrival = dep - burn(d);
        if (arrival < reserve) continue;
        for (let out = arrival + 1; out <= cap; out++) {
          const total = c + (out - arrival) * B * stop.unitPriceUsd + penalty(stop);
          if (total < (next.get(out) ?? Infinity)) next.set(out, total);
        }
      }
      level = next;
      prev = stop.positionMiles;
    }
    if (!ok) continue;
    const finalLeg = input.totalDistanceMiles - prev;
    if (fuel.requireArrivalWithinMaxLeg && finalLeg > fuel.maxLegMiles + 1e-6) continue;
    for (const [dep, c] of level) {
      if (dep - burn(finalLeg) >= minArrival && c < (best ?? Infinity)) best = c;
    }
  }
  return best;
}

/** A random lane. Money values are chosen so real costs differ by at least $0.0002 or not at all. */
function randomLane(random: () => number, size: { maxStations: number; maxDistance: number; smallTank: boolean }): OptimizerInput {
  const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)] as T;
  const distance = Math.round(50 + random() * size.maxDistance);
  const count = Math.floor(random() * (size.maxStations + 1));
  const detoured = random() < 0.3;
  const stations = Array.from({ length: count }, () => ({
    mile: Math.round(random() * distance),
    price: Math.round((3 + random() * 1.5) * 1e4) / 1e4,
    detourMiles: detoured ? pick([0, 0, 2, 5]) : 0,
  }));
  const tank = size.smallTank ? pick([60, 70, 90]) : pick([150, 200, 250]);
  return lane({
    distance,
    stations,
    fuel: {
      tankGallons: tank,
      avgMpg: size.smallTank ? pick([8, 10, 12]) : pick([5, 6.5, 7.5]),
      reserveFraction: pick([0, 0.15, 0.2]),
      minLegMiles: pick([0, 300, 300]),
      startGallons: pick([tank, tank, tank * 0.5]),
      minArrivalGallons: pick([0, 10, 25]),
      requireArrivalWithinMaxLeg: pick([true, true, true, false]),
    },
    cost: { costPerMile: pick([0, 0, 0.5]), driverCostPerHour: pick([0, 0, 60]), fixedStopMinutes: pick([0, 20, 30]) },
    maxStops: pick([null, null, null, 0, 1, 2, 3]),
  });
}

describe("dp_v1 is exact: it matches an exhaustive oracle", () => {
  it("finds the same minimum cost, and the same feasibility, on 150 random small lanes", () => {
    const random = seededRandom(20260920);
    let planned = 0;
    for (let i = 0; i < 150; i++) {
      const input = randomLane(random, { maxStations: 6, maxDistance: 1400, smallTank: true });
      const expected = oracleMinCost(input);
      const actual = dynamicProgrammingOptimizer.solve(input);
      const context = `lane #${i}: ${JSON.stringify(input)}`;
      if (expected === null) {
        expect(actual.kind, context).toBe("infeasible");
      } else {
        planned++;
        expect(actual.kind, context).toBe("plan");
        const plan = expectPlan(actual);
        expect(violations(input, plan), context).toEqual([]);
        expect(plan.totalCostUsd, context).toBeCloseTo(expected, 6);
      }
    }
    // A sweep that is all "infeasible" proves nothing.
    expect(planned).toBeGreaterThan(40);
  });
});

describe("dp_v1 never costs more than greedy_v1", () => {
  it("across 300 random lanes, and every plan from either strategy is legal", () => {
    const random = seededRandom(7);
    let bothPlanned = 0;
    let dpStrictlyCheaper = 0;
    for (let i = 0; i < 300; i++) {
      const input = randomLane(random, { maxStations: 40, maxDistance: 3000, smallTank: false });
      const context = `lane #${i}: ${JSON.stringify(input)}`;
      const dp = dynamicProgrammingOptimizer.solve(input);
      const greedy = greedyOptimizer.solve(input);
      if (dp.kind === "plan") expect(violations(input, dp), context).toEqual([]);
      if (greedy.kind === "plan") {
        expect(violations(input, greedy), context).toEqual([]);
        // Greedy's plan is one the DP considered, so the DP must find a plan too.
        expect(dp.kind, context).toBe("plan");
      }
      if (dp.kind === "plan" && greedy.kind === "plan") {
        bothPlanned++;
        // Tolerance below the $0.0002 quantum of a priced bucket.
        expect(dp.totalCostUsd, context).toBeLessThanOrEqual(greedy.totalCostUsd + 5e-5);
        if (dp.totalCostUsd < greedy.totalCostUsd - 1e-4) dpStrictlyCheaper++;
      }
    }
    expect(bothPlanned).toBeGreaterThan(60);
    // The comparison would be vacuous if greedy were always as good.
    expect(dpStrictlyCheaper).toBeGreaterThan(5);
  });

  it("strictly, on a lane where nearest-cheaper makes a stop the DP declines", () => {
    // With a $60 stop penalty, greedy hops 300 -> 600 (cheaper each time); the DP makes one stop at 500.
    const input = lane({
      distance: 700,
      stations: [[300, 4.0], [500, 3.95], [600, 3.0]],
      cost: { driverCostPerHour: 60, fixedStopMinutes: 60 },
    });
    const dp = expectPlan(dynamicProgrammingOptimizer.solve(input));
    const greedy = expectPlan(greedyOptimizer.solve(input));
    expect(greedy.stops).toHaveLength(2);
    expect(dp.stops).toHaveLength(1);
    expect(dp.totalCostUsd).toBeCloseTo(20 * 3.95 + 60, 9); // 139
    expect(greedy.totalCostUsd).toBeCloseTo(2 * 4.0 + 18 * 3.0 + 120, 9); // 182
  });
});

describe("dp_v1 cost model (§15.3, step 12.4)", () => {
  // The worst case for Phase B: every station within one leg of every other, floor lifted, so
  // every pair is a legal transition. A 150-gal tank is 76 levels, the spec's B = 75.
  const dense = (n: number, maxStops: number | null = null) =>
    lane({
      distance: 900,
      stations: Array.from({ length: n }, (_, i) => [(i / n) * 480, 3 + ((i * 37) % 100) / 100] as const),
      fuel: { minLegMiles: 0 },
      maxStops,
    });

  it("solves n = 80, B = 75 well under 100 ms", () => {
    const input = dense(80);
    solveWithStats(input); // warm up: the first call pays for JIT, not for the algorithm
    const started = performance.now();
    const { result } = solveWithStats(input);
    const elapsed = performance.now() - started;
    expect(result.kind).toBe("plan");
    expect(elapsed).toBeLessThan(100);
  });

  it("stays inside the scope's n^2 x B bound at n = 80", () => {
    const { stats } = solveWithStats(dense(80));
    expect(stats.relaxations).toBeGreaterThan(0);
    expect(stats.relaxations).toBeLessThanOrEqual(80 * 80 * 75);
  });

  it("doubling n roughly quadruples the work: O(n^2), not cubic", () => {
    // Counted, not timed: at a few milliseconds a wall-clock ratio is scheduler noise, while
    // an accidental extra loop over stations would still show as 8x here.
    const small = solveWithStats(dense(80)).stats.relaxations;
    const double = solveWithStats(dense(160)).stats.relaxations;
    const ratio = double / small;
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(4.5);
  });

  it("a stop ceiling multiplies the state space by maxStops + 1 and no more", () => {
    const uncapped = solveWithStats(dense(80)).stats.relaxations;
    const capped = solveWithStats(dense(80, 3)).stats.relaxations;
    expect(capped).toBeLessThanOrEqual(uncapped * 4);
    expect(capped).toBeGreaterThan(uncapped);
  });

  it("solves n = 80 under a stop ceiling well under 100 ms too", () => {
    const input = dense(80, 4);
    solveWithStats(input);
    const started = performance.now();
    solveWithStats(input);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
