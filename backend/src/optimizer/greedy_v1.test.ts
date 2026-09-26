import { describe, expect, it } from "vitest";
import { expectPlan, lane, once, violations } from "../../test/support/optimizer.js";
import { greedyOptimizer } from "./greedy_v1.js";

const solve = (spec: Parameters<typeof lane>[0]) => {
  const input = lane(spec);
  const result = greedyOptimizer.solve(input);
  if (result.kind === "plan") {
    expect(violations(input, result), "every greedy plan must be a legal plan").toEqual([]);
  }
  return result;
};

// TRUCK (test/support/optimizer.ts): 150 gal tank, 5 mpg, so 100 miles = 20 gal =
// 10 buckets; reserve and arrival minimum 30 gal = 15 buckets.

describe("greedy_v1", () => {
  it("identifies itself", () => {
    expect(greedyOptimizer.id).toBe("greedy_v1");
    expect(greedyOptimizer.description).toMatch(/baseline/i);
  });

  describe("monotonically rising prices: it fills early", () => {
    const plan = once(() => expectPlan(solve({ distance: 1150, stations: [[300, 3.0], [600, 3.2], [900, 3.4]] })));

    it("fills the tank while nothing cheaper lies ahead", () => {
      expect(plan().stops.map((s) => s.departureGallons)).toEqual([150, 150, expect.any(Number)]);
    });

    it("buys only the forced minimum where the destination is the next cheaper thing", () => {
      // At 900 the tank already holds enough for the last 250 miles; a visited stop still buys one bucket.
      expect(plan().stops[2]?.purchaseGallons).toBe(2);
    });
  });

  describe("monotonically falling prices: it buys the minimum until the cheap station", () => {
    // 300 @3.4, 600 @3.2, 900 @3.0, destination at 1150.
    const plan = once(() => expectPlan(solve({ distance: 1150, stations: [[300, 3.4], [600, 3.2], [900, 3.0]] })));

    it("buys one bucket at the dearest station, because the next one is cheaper and already reachable", () => {
      expect(plan().stops[0]?.purchaseGallons).toBe(2);
    });

    it("buys the rest at the cheaper stations, as little as each next leg needs", () => {
      // Arrive at 600 with 32 gal; reaching 900 with the 30-gal reserve needs 90 -> buy 58.
      expect(plan().stops[1]?.purchaseGallons).toBe(58);
      // Arrive at 900 with 30 gal; the last 250 miles need 30 + 50 -> buy 50.
      expect(plan().stops[2]?.purchaseGallons).toBe(50);
      expect(plan().totalCostUsd).toBeCloseTo(2 * 3.4 + 58 * 3.2 + 50 * 3.0, 6);
    });
  });

  describe("§22.3: nearest cheaper, not cheapest within range", () => {
    // Start low (60 gal) so what greedy buys at the first stop actually shows its rule.
    //   50 @4.00   the first stop: nearest eligible from the origin
    //  150 @3.90   the NEAREST cheaper station          <- nearest-cheaper targets this
    //  300 @3.50   the CHEAPEST station within range    <- cheapest-in-range would target this
    // Destination at 800, 500 from the last station.
    const plan = once(() =>
      expectPlan(solve({ distance: 800, stations: [[50, 4.0], [150, 3.9], [300, 3.5]], fuel: { startGallons: 60, minLegMiles: 0 } })),
    );

    it("visits the intermediate cheaper station rather than skipping to the cheapest", () => {
      expect(plan().stops.map((s) => s.positionMiles)).toEqual([50, 150, 300]);
    });

    it("buys at the first stop only what reaches the NEAREST cheaper station", () => {
      // Arrive at 50 with 50 gal; reaching 150 (100 miles = 20 gal) with a 30-gal reserve needs 50: one bucket forced.
      expect(plan().stops[0]?.purchaseGallons).toBe(2);
      // Cheapest-in-range would have bought 30 gal here to reach the 3.50 station directly.
      expect(plan().stops[0]?.purchaseGallons).not.toBe(30);
    });
  });

  it("takes the destination directly when it is within reach of the origin", () => {
    const plan = expectPlan(solve({ distance: 400, stations: [[100, 3.0]], fuel: { minLegMiles: 0 } }));
    expect(plan.stops).toEqual([]);
    expect(plan.totalCostUsd).toBe(0);
    expect(plan.finalLegMiles).toBe(400);
  });

  it("honours the floor: it will not stop at a station closer than the minimum leg", () => {
    const plan = expectPlan(solve({ distance: 700, stations: [[200, 2.0], [400, 3.5]] }));
    expect(plan.stops.map((s) => s.positionMiles)).toEqual([400]);
  });

  it("accepts a final leg under the floor", () => {
    const plan = expectPlan(solve({ distance: 700, stations: [[500, 3.5]] }));
    expect(plan.finalLegMiles).toBe(200);
  });

  describe("when it cannot plan", () => {
    it("reports a leg gap", () => {
      expect(solve({ distance: 700 })).toMatchObject({ kind: "infeasible", code: "LEG_GAP" });
    });

    it("reports MAX_STOPS_EXCEEDED when the stop ceiling binds", () => {
      const result = solve({ distance: 1100, stations: [[400, 3], [800, 3]], maxStops: 1 });
      expect(result).toMatchObject({ kind: "infeasible", code: "MAX_STOPS_EXCEEDED", detail: { maxStops: 1, minStopsRequired: 2 } });
    });

    it("treats maxStops 0 as no stops, and null as no cap", () => {
      expect(solve({ distance: 700, stations: [[400, 3]], maxStops: 0 })).toMatchObject({ kind: "infeasible" });
      expect(solve({ distance: 700, stations: [[400, 3]], maxStops: null })).toMatchObject({ kind: "plan" });
    });
  });

  it("does not depend on candidate order", () => {
    const stations = [[300, 3.4], [600, 3.2], [900, 3.0]] as const;
    const forward = greedyOptimizer.solve(lane({ distance: 1150, stations }));
    const reversed = greedyOptimizer.solve(lane({ distance: 1150, stations: [...stations].reverse() }));
    // Ids embed the input index, so compare positions and money, not ids.
    const shape = (r: typeof forward) => (r.kind === "plan" ? r.stops.map((s) => [s.positionMiles, s.purchaseGallons]) : r);
    expect(shape(reversed)).toEqual(shape(forward));
  });

  it("is synchronous", () => {
    expect(greedyOptimizer.solve(lane({ distance: 100 }))).not.toBeInstanceOf(Promise);
  });
});
