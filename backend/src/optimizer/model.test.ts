import { describe, expect, it } from "vitest";
import { lane } from "../../test/support/optimizer.js";
import { BUCKET_GALLONS, diagnoseInfeasible, prepareLane } from "./model.js";

describe("prepareLane: fuel levels", () => {
  // TRUCK: 150 gal tank, 5 mpg, 0.2 reserve, 2-gallon buckets.
  const prepared = prepareLane(lane({ distance: 900 }));

  it("uses 2-gallon buckets", () => {
    expect(BUCKET_GALLONS).toBe(2);
  });

  it("expresses tank, start, reserve and arrival in buckets", () => {
    expect(prepared.capLevel).toBe(75);
    expect(prepared.startLevel).toBe(75);
    expect(prepared.reserveLevel).toBe(15);
    expect(prepared.minArrivalLevel).toBe(15);
  });

  it("rounds a fractional capacity DOWN, so a bucket that does not fit is never bought", () => {
    expect(prepareLane(lane({ distance: 900, fuel: { tankGallons: 151, startGallons: 151 } })).capLevel).toBe(75);
  });

  it("rounds the reserve and the arrival minimum UP, so discretisation only ever adds margin", () => {
    // 0.15 x 150 = 22.5 gal -> 11.25 buckets -> 12.
    const p = prepareLane(lane({ distance: 900, fuel: { reserveFraction: 0.15, minArrivalGallons: 22.5 } }));
    expect(p.reserveLevel).toBe(12);
    expect(p.minArrivalLevel).toBe(12);
  });

  it("rounds the start fuel DOWN", () => {
    expect(prepareLane(lane({ distance: 900, fuel: { startGallons: 99.9 } })).startLevel).toBe(49);
  });
});

describe("prepareLane: burn is rounded so arrival fuel rounds DOWN", () => {
  const prepared = prepareLane(lane({ distance: 900 }));

  it.each([
    [0, 0],
    [100, 10], // exactly 20 gal = 10 buckets: no phantom extra bucket from float noise
    [300, 30],
    [500, 50],
    [101, 11], // 20.2 gal -> 10.1 buckets -> arrives a whole bucket lower
    [100 + 1e-11, 10], // float noise from summed legs: still exactly 10
    [1, 1],
  ])("%s miles burns %s buckets", (miles, buckets) => {
    expect(prepared.burnLevels(miles)).toBe(buckets);
  });

  it("never yields a negative or -0 burn", () => {
    expect(Object.is(prepared.burnLevels(0), 0)).toBe(true);
  });
});

describe("prepareLane: leg bounds", () => {
  // Candidates at 0 (origin), 300, 500, 501 and the destination at 1000.
  const prepared = prepareLane(lane({ distance: 1000, stations: [[300, 3], [500, 3], [501, 3]] }));
  const [origin, a, b, c] = [0, 1, 2, 3];
  const dest = prepared.destination;

  it("accepts a leg of exactly the cap and rejects one mile over", () => {
    expect(prepared.legAllowed(origin, b)).toBe(true); // 500
    expect(prepared.legAllowed(origin, c)).toBe(false); // 501
  });

  it("accepts a leg of exactly the floor and rejects one mile under", () => {
    expect(prepared.legAllowed(origin, a)).toBe(true); // 300
    expect(prepareLane(lane({ distance: 1000, stations: [[299, 3]] })).legAllowed(0, 1)).toBe(false);
  });

  it("applies no floor to the destination", () => {
    const short = prepareLane(lane({ distance: 310, stations: [[300, 3]] }));
    expect(short.legAllowed(1, short.destination)).toBe(true); // a 10-mile final leg
    expect(prepared.legAllowed(b, dest)).toBe(true); // 500: the cap still admits it
  });

  it("still caps the destination leg unless arrival within the cap is not required", () => {
    expect(prepared.legAllowed(origin, dest)).toBe(false); // 1000
    const relaxed = prepareLane(lane({ distance: 1000, fuel: { requireArrivalWithinMaxLeg: false } }));
    expect(relaxed.legAllowed(0, relaxed.destination)).toBe(true);
  });

  it("sorts candidates by position, so an unsorted input cannot change the answer", () => {
    const sorted = prepareLane(lane({ distance: 1000, stations: [[500, 3], [300, 4]] }));
    expect(sorted.positions).toEqual([0, 300, 500, 1000]);
  });
});

describe("prepareLane: malformed input is a RangeError, not a plan", () => {
  it.each([
    ["a negative distance", lane({ distance: -1 })],
    ["a NaN distance", lane({ distance: Number.NaN })],
    ["a zero tank", lane({ distance: 100, fuel: { tankGallons: 0 } })],
    ["a zero mpg", lane({ distance: 100, fuel: { avgMpg: 0 } })],
    ["a reserve of 1", lane({ distance: 100, fuel: { reserveFraction: 1 } })],
    ["a floor above the cap", lane({ distance: 100, fuel: { minLegMiles: 501 } })],
    ["a start above the tank", lane({ distance: 100, fuel: { startGallons: 151 } })],
    ["a negative arrival minimum", lane({ distance: 100, fuel: { minArrivalGallons: -1 } })],
    ["a fractional maxStops", lane({ distance: 100, maxStops: 1.5 })],
    ["a negative maxStops", lane({ distance: 100, maxStops: -1 })],
    ["a candidate past the destination", lane({ distance: 100, stations: [[101, 3]] })],
    ["a candidate before the origin", lane({ distance: 100, stations: [[-1, 3]] })],
    ["a negative price", lane({ distance: 100, stations: [[50, -3]] })],
    ["a NaN price", lane({ distance: 100, stations: [[50, Number.NaN]] })],
    ["a negative detour", lane({ distance: 100, stations: [{ mile: 50, price: 3, detourMiles: -1 }] })],
  ])("rejects %s", (_label, input) => {
    expect(() => prepareLane(input)).toThrow(RangeError);
  });

  it("accepts maxStops 0 and null as different things", () => {
    expect(prepareLane(lane({ distance: 100, maxStops: 0 })).maxStops).toBe(0);
    expect(prepareLane(lane({ distance: 100, maxStops: null })).maxStops).toBeNull();
  });
});

describe("diagnoseInfeasible", () => {
  it("names a leg gap: no station where the cap needs one", () => {
    // Reachable through 300; nothing until 1088.
    const prepared = prepareLane(lane({ distance: 1200, stations: [[300, 3], [1088, 3]], fuel: { minLegMiles: 0 } }));
    const result = diagnoseInfeasible(prepared);
    expect(result).toEqual({
      kind: "infeasible",
      code: "LEG_GAP",
      detail: { gapStartMiles: 300, gapEndMiles: 1088, gapMiles: 788, maxLegMiles: 500, minLegMiles: 0 },
    });
  });

  it("reports the whole trip as the gap when there are no candidates", () => {
    const result = diagnoseInfeasible(prepareLane(lane({ distance: 700 })));
    expect(result).toMatchObject({ code: "LEG_GAP", detail: { gapStartMiles: 0, gapEndMiles: 700, gapMiles: 700 } });
  });

  it("reports MAX_STOPS_EXCEEDED, with the fewest stops that would work", () => {
    // 1100 miles needs at least two stops at a 500-mile cap.
    const prepared = prepareLane(lane({ distance: 1100, stations: [[400, 3], [800, 3]], maxStops: 1 }));
    expect(diagnoseInfeasible(prepared)).toEqual({
      kind: "infeasible",
      code: "MAX_STOPS_EXCEEDED",
      detail: { maxStops: 1, minStopsRequired: 2 },
    });
  });

  it("reports FUEL_INFEASIBLE when the legs exist but the tank cannot cover them", () => {
    // A 500-mile leg burns 100 gal; with 100 gal in the tank there is nothing left for the reserve.
    const prepared = prepareLane(lane({ distance: 500, fuel: { tankGallons: 100, startGallons: 100 } }));
    expect(diagnoseInfeasible(prepared)).toMatchObject({ code: "FUEL_INFEASIBLE" });
  });
});
