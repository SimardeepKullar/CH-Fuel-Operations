import { describe, expect, it } from "vitest";
import { filterByEstimate } from "./detourEstimate.js";
import { DEFAULT_CORRIDOR_MILES, resolvePlanDefaults, type TruckProfileDefaults } from "./planDefaults.js";

const profile: TruckProfileDefaults = {
  maxLegMiles: 500,
  minLegMiles: 300,
  tankGallons: 150,
  reserveFraction: 0.15,
};

const base = {
  maxLegMiles: null,
  minLegMiles: null,
  corridorMiles: null,
  startFuelGallons: null,
  minArrivalGallons: null,
};

describe("resolvePlanDefaults (T-16 step 16.1)", () => {
  it("defaults maxLegMiles and minLegMiles from the truck profile when omitted", () => {
    const resolved = resolvePlanDefaults(base, profile);
    expect(resolved.maxLegMiles).toBe(500);
    expect(resolved.minLegMiles).toBe(300);
  });

  it("keeps an explicit maxLegMiles/minLegMiles instead of the profile's", () => {
    const resolved = resolvePlanDefaults({ ...base, maxLegMiles: 450, minLegMiles: 0 }, profile);
    expect(resolved.maxLegMiles).toBe(450);
    // 0 is a real, valid floor (no minimum leg at all) — not "missing".
    expect(resolved.minLegMiles).toBe(0);
  });

  it("defaults corridorMiles to DEFAULT_CORRIDOR_MILES when omitted, with no profile column involved", () => {
    const resolved = resolvePlanDefaults(base, profile);
    expect(resolved.corridorMiles).toBe(DEFAULT_CORRIDOR_MILES);
  });

  it("keeps an explicit corridorMiles, including 0", () => {
    expect(resolvePlanDefaults({ ...base, corridorMiles: 40 }, profile).corridorMiles).toBe(40);
    expect(resolvePlanDefaults({ ...base, corridorMiles: 0 }, profile).corridorMiles).toBe(0);
  });

  it("defaults startFuelGallons to tank capacity and minArrivalGallons to the reserve level", () => {
    const resolved = resolvePlanDefaults(base, profile);
    expect(resolved.startFuelGallons).toBe(150);
    expect(resolved.minArrivalGallons).toBeCloseTo(22.5, 10);
  });

  it("keeps an explicit startFuelGallons/minArrivalGallons, including 0", () => {
    const resolved = resolvePlanDefaults({ ...base, startFuelGallons: 0, minArrivalGallons: 0 }, profile);
    expect(resolved.startFuelGallons).toBe(0);
    expect(resolved.minArrivalGallons).toBe(0);
  });
});

/**
 * §15.1's two-stage split, proven by composing the two independent filters
 * rather than by inspecting types: `corridorMiles` decides whether a station
 * is considered at all (here, simply being in the candidate set — the
 * corridor query's own job, T-13); `maxDetourMiles` is a later, independent
 * cap that can still reject a station the corridor screening accepted.
 */
describe("corridorMiles vs maxDetourMiles: two stages, not one", () => {
  it("a corridor candidate can be considered and then rejected by the detour cap", () => {
    // Well inside a generous corridor (25 mi), but its estimated detour
    // (2 * 3 * 1.35 = 8.1 mi) exceeds a tight per-stop cap of 2 mi.
    const corridorCandidate = { id: "in-corridor", perpOffsetMiles: 3 };
    expect(corridorCandidate.perpOffsetMiles).toBeLessThan(DEFAULT_CORRIDOR_MILES);

    const { kept, dropped } = filterByEstimate([corridorCandidate], 2);

    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ id: "in-corridor", reason: "detour_estimate_over_cap" });
    expect(dropped[0]!.estimatedDetourMiles).toBeCloseTo(8.1, 10);
  });

  it("a tight corridorMiles never substitutes for the detour cap: raising maxDetourMiles alone reinstates the station", () => {
    const corridorCandidate = { id: "in-corridor", perpOffsetMiles: 3 };

    const capped = filterByEstimate([corridorCandidate], 2);
    const uncapped = filterByEstimate([corridorCandidate], null);

    expect(capped.kept.map((c) => c.id)).toEqual([]);
    expect(uncapped.kept.map((c) => c.id)).toEqual(["in-corridor"]);
  });
});
