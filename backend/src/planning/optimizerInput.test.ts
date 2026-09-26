import { describe, expect, it } from "vitest";
import { lane } from "../../test/support/optimizer.js";
import { dynamicProgrammingOptimizer } from "../optimizer/dp_v1.js";
import { toOptimizerLane } from "./optimizerInput.js";

const corridor = (routeMiles: number, stations: [id: string, miles: number, price: number][]) => ({
  routeDistanceMiles: routeMiles,
  candidates: stations.map(([id, miles, price]) => ({ id, offsetAlongRouteMiles: miles, unitPriceUsd: price })),
});

describe("toOptimizerLane: the corridor-to-optimiser mapping", () => {
  it("passes the route length and every offset through as miles, unconverted", () => {
    const result = toOptimizerLane(corridor(900, [["a", 350.125, 3.5], ["b", 700, 4.25]]));
    expect(result.totalDistanceMiles).toBe(900);
    expect(result.candidates.map((c) => c.positionMiles)).toEqual([350.125, 700]);
  });

  it("carries the id and the price through untouched: 4dp is never rounded to 2dp", () => {
    const [candidate] = toOptimizerLane(corridor(900, [["station-1", 350, 3.4567]])).candidates;
    expect(candidate).toMatchObject({ id: "station-1", unitPriceUsd: 3.4567 });
  });

  it("carries no detour when none were measured: a lane that has not been costed", () => {
    const [candidate] = toOptimizerLane(corridor(900, [["a", 350, 3.5]])).candidates;
    expect(candidate).toMatchObject({ detourMiles: 0, detourHours: 0 });
  });

  describe("with measured detours (T-14)", () => {
    const measured = new Map([
      ["a", { measuredDetourMiles: 0.5, detourHours: 0.008 }],
      ["b", { measuredDetourMiles: 3, detourHours: 0.05 }],
    ]);

    it("gives each candidate its own measured detour, in miles and hours", () => {
      const result = toOptimizerLane(corridor(900, [["a", 350, 3.5], ["b", 700, 4.25]]), measured);
      expect(result.candidates).toEqual([
        { id: "a", positionMiles: 350, unitPriceUsd: 3.5, detourMiles: 0.5, detourHours: 0.008 },
        { id: "b", positionMiles: 700, unitPriceUsd: 4.25, detourMiles: 3, detourHours: 0.05 },
      ]);
    });

    it("leaves out a candidate with no measurement instead of treating it as on the route", () => {
      const result = toOptimizerLane(corridor(900, [["a", 350, 3.5], ["unmeasured", 500, 3.1], ["b", 700, 4.25]]), measured);
      expect(result.candidates.map((c) => c.id)).toEqual(["a", "b"]);
    });

    it("keeps a measured 0 as 0", () => {
      const result = toOptimizerLane(
        corridor(900, [["a", 350, 3.5]]),
        new Map([["a", { measuredDetourMiles: 0, detourHours: 0 }]]),
      );
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({ detourMiles: 0, detourHours: 0 });
    });

    it("does not touch the measurements", () => {
      const snapshot = structuredClone([...measured]);
      toOptimizerLane(corridor(900, [["a", 350, 3.5]]), measured);
      expect([...measured]).toEqual(snapshot);
    });
  });

  it("returns the lane's own shape and does not touch the corridor", () => {
    const input = corridor(900, [["a", 350, 3.5]]);
    const snapshot = structuredClone(input);
    const result = toOptimizerLane(input);
    expect(input).toEqual(snapshot);
    expect(Object.keys(result).sort()).toEqual(["candidates", "totalDistanceMiles"]);
  });

  it("handles an empty corridor", () => {
    expect(toOptimizerLane(corridor(400, [])).candidates).toEqual([]);
  });
});

describe("toOptimizerLane feeding dp_v1", () => {
  const solve = (distance: number, stationMiles: number[]) =>
    dynamicProgrammingOptimizer.solve({
      ...lane({ distance: 0 }),
      ...toOptimizerLane(corridor(distance, stationMiles.map((m, i) => [`s${i}`, m, 3.5] as [string, number, number]))),
    });

  it("plans a lane whose gaps sit exactly on the 300 and 500 mile bounds", () => {
    expect(solve(1100, [316, 816]).kind).toBe("plan");
    expect(solve(1100, [334, 634]).kind).toBe("plan");
  });

  it("still rejects a genuine 501-mile gap and a genuine 299-mile gap", () => {
    expect(solve(1100, [316, 817]).kind).toBe("infeasible");
    expect(solve(1100, [334, 633]).kind).toBe("infeasible");
  });
});
