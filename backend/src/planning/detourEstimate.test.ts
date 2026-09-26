import { describe, expect, it } from "vitest";
import { DETOUR_FLOOR_MILES, DETOUR_MULTIPLIER, estimateDetourMiles, filterByEstimate } from "./detourEstimate.js";

describe("estimateDetourMiles (§15.4.1 stage 1)", () => {
  it("treats a station 0.1 mi off the route as on it", () => {
    expect(estimateDetourMiles(0.1)).toBe(0);
  });

  it("puts a station 0.5 mi off the route at 1.35 mi: out and back at 1.35x", () => {
    expect(estimateDetourMiles(0.5)).toBeCloseTo(1.35, 10);
  });

  it("never falls as the offset grows", () => {
    const offsets = [0, 0.05, 0.1, 0.123, 0.124, 0.125, 0.25, 0.5, 1, 2.5, 5, 12.5, 25];
    const estimates = offsets.map(estimateDetourMiles);
    for (let i = 1; i < estimates.length; i++) {
      expect(estimates[i]!).toBeGreaterThanOrEqual(estimates[i - 1]!);
    }
  });

  describe("the 200 m floor", () => {
    it("is 0.124 mi, and 0 applies strictly below it", () => {
      expect(DETOUR_FLOOR_MILES).toBe(0.124);
      expect(estimateDetourMiles(0.123999)).toBe(0);
    });

    it("starts costing at the floor itself, so the estimate steps up rather than ramping from 0", () => {
      expect(estimateDetourMiles(DETOUR_FLOOR_MILES)).toBeCloseTo(2 * DETOUR_FLOOR_MILES * DETOUR_MULTIPLIER, 10);
    });

    it("is 0 for a station exactly on the route", () => {
      expect(estimateDetourMiles(0)).toBe(0);
    });
  });

  it("scales linearly past the floor: doubling the offset doubles the estimate", () => {
    expect(estimateDetourMiles(4)).toBeCloseTo(2 * estimateDetourMiles(2), 10);
  });

  it("rejects an offset that is not a non-negative finite number", () => {
    expect(() => estimateDetourMiles(-0.1)).toThrow(RangeError);
    expect(() => estimateDetourMiles(Number.NaN)).toThrow(RangeError);
    expect(() => estimateDetourMiles(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("filterByEstimate", () => {
  const at = (id: string, perpOffsetMiles: number) => ({ id, perpOffsetMiles });

  it("filters nothing when there is no cap: null is not 0", () => {
    const candidates = [at("a", 0.05), at("b", 3), at("c", 30)];
    const { kept, dropped } = filterByEstimate(candidates, null);
    expect(kept).toEqual(candidates);
    expect(dropped).toEqual([]);
  });

  it("treats a cap of 0 as a real cap: only stations under the 200 m floor survive", () => {
    const { kept, dropped } = filterByEstimate([at("on", 0.1), at("off", 0.5)], 0);
    expect(kept.map((c) => c.id)).toEqual(["on"]);
    expect(dropped).toEqual([{ id: "off", reason: "detour_estimate_over_cap", estimatedDetourMiles: estimateDetourMiles(0.5) }]);
  });

  it("drops a station whose estimate exceeds the cap and names it, keeping one exactly at the cap", () => {
    const cap = estimateDetourMiles(2);
    const { kept, dropped } = filterByEstimate([at("under", 1.8), at("at", 2), at("over", 2.1)], cap);
    expect(kept.map((c) => c.id)).toEqual(["under", "at"]);
    expect(dropped.map((d) => [d.id, d.reason])).toEqual([["over", "detour_estimate_over_cap"]]);
  });

  it("keeps the order it was given and leaves the input alone", () => {
    const candidates = [at("c", 0.1), at("a", 9), at("b", 0.2)];
    const { kept } = filterByEstimate(candidates, 1);
    expect(kept.map((c) => c.id)).toEqual(["c", "b"]);
    expect(candidates.map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("rejects a negative or non-finite cap", () => {
    expect(() => filterByEstimate([], -1)).toThrow(RangeError);
    expect(() => filterByEstimate([], Number.NaN)).toThrow(RangeError);
  });
});
