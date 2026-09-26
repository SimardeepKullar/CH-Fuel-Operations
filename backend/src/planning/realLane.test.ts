import { describe, expect, it } from "vitest";
import { expectPlan, lane, TRUCK } from "../../test/support/optimizer.js";
import { dynamicProgrammingOptimizer } from "../optimizer/dp_v1.js";
import { realizePlan, rescaleLane } from "./realLane.js";

const leg = (distanceMiles: number, durationSeconds = distanceMiles * 60) => ({ distanceMiles, durationSeconds });

// TRUCK: 150 gal, 5 mpg, cap 500, floor 300, reserve 30 gal, arrival minimum 30 gal.

describe("rescaleLane", () => {
  const base = lane({
    distance: 800,
    stations: [
      { mile: 100, price: 3.0, id: "early" },
      { mile: 400, price: 3.1, id: "stop" },
      { mile: 600, price: 3.2, id: "late" },
    ],
  });

  it("puts each routed stop exactly at the real cumulative distance, and the destination at the real total", () => {
    const out = rescaleLane(base, ["stop"], [leg(450), leg(380)]);
    expect(out.totalDistanceMiles).toBe(830);
    expect(out.candidates.find((c) => c.id === "stop")?.positionMiles).toBe(450);
  });

  it("scales the candidates between anchors by their segment's real-to-baseline ratio", () => {
    // Segment 1 is 400 baseline miles that measured 500 (x1.25); segment 2 is 400 that measured 380 (x0.95).
    const out = rescaleLane(base, ["stop"], [leg(500), leg(380)]);
    const at = (id: string) => out.candidates.find((c) => c.id === id)?.positionMiles;
    expect(at("early")).toBeCloseTo(125, 9);
    expect(at("late")).toBeCloseTo(500 + 200 * 0.95, 9);
  });

  it("leaves everything but position and total alone, and does not touch its input", () => {
    const before = structuredClone(base);
    const out = rescaleLane(base, ["stop"], [leg(500), leg(380)]);
    expect(base).toEqual(before);
    expect(out.fuel).toEqual(base.fuel);
    expect(out.cost).toEqual(base.cost);
    expect(out.maxStops).toBe(base.maxStops);
    expect(out.candidates.map((c) => [c.id, c.unitPriceUsd, c.detourMiles, c.detourHours])).toEqual(
      base.candidates.map((c) => [c.id, c.unitPriceUsd, c.detourMiles, c.detourHours]),
    );
  });

  it("is the identity when the real legs match the baseline", () => {
    expect(rescaleLane(base, ["stop"], [leg(400), leg(400)])).toEqual(base);
  });

  it("keeps order, and never puts a candidate past the destination", () => {
    const out = rescaleLane(base, ["early", "late"], [leg(90), leg(520), leg(190)]);
    const positions = out.candidates.map((c) => c.positionMiles);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(Math.max(...positions)).toBeLessThanOrEqual(out.totalDistanceMiles);
  });

  it("a candidate sharing an anchor's baseline mile lands on the anchor, not on a different segment", () => {
    const twin = lane({
      distance: 800,
      stations: [
        { mile: 400, price: 3.0, id: "a" },
        { mile: 400, price: 3.4, id: "b" },
      ],
    });
    const out = rescaleLane(twin, ["a"], [leg(450), leg(380)]);
    expect(out.candidates.map((c) => c.positionMiles)).toEqual([450, 450]);
  });

  it("a stopless route rescales nothing but the total", () => {
    const out = rescaleLane(base, [], [leg(790)]);
    expect(out.totalDistanceMiles).toBe(790);
    out.candidates.forEach((c, i) => expect(c.positionMiles).toBeCloseTo([100, 400, 600][i]! * (790 / 800), 9));
  });

  it("rejects a leg count that is not stops + 1, and a stop that is not a candidate", () => {
    expect(() => rescaleLane(base, ["stop"], [leg(800)])).toThrow(RangeError);
    expect(() => rescaleLane(base, ["nope"], [leg(400), leg(400)])).toThrow(RangeError);
  });
});

describe("realizePlan", () => {
  const input = lane({ distance: 800, stations: [{ mile: 400, price: 3.0, id: "A" }] });
  const plan = expectPlan(dynamicProgrammingOptimizer.solve(input));

  it("the DP's own plan is legal on the baseline legs, and comes back with the same figures", () => {
    const { plan: real, violations } = realizePlan(input, plan, [leg(400), leg(400)]);
    expect(violations).toEqual([]);
    expect(real.stops[0]).toMatchObject({ positionMiles: 400, legMiles: 400, arrivalGallons: 70, departureGallons: 110, purchaseGallons: 40 });
    expect(real.totalDistanceMiles).toBe(800);
  });

  it("derives arrival, purchase, cost and totals from the real legs; the departure level is what is held fixed", () => {
    const { plan: real, violations } = realizePlan(input, plan, [leg(410, 24_000), leg(395, 23_000)]);
    expect(violations).toEqual([]);
    const [stop] = real.stops;
    // 150 - 410/5 = 68 on arrival; fill back to the DP's 110, so 42 gallons.
    expect(stop).toMatchObject({
      candidateId: "A",
      positionMiles: 410,
      baselinePositionMiles: 400,
      legMiles: 410,
      legDurationSeconds: 24_000,
      cumulativeDurationSeconds: 24_000,
      arrivalGallons: 68,
      departureGallons: 110,
      purchaseGallons: 42,
    });
    expect(stop?.fuelCostUsd).toBeCloseTo(126, 9);
    expect(real).toMatchObject({
      startGallons: 150,
      finalLegMiles: 395,
      finalLegDurationSeconds: 23_000,
      destinationArrivalGallons: 31,
      totalGallons: 42,
      totalDistanceMiles: 805,
      totalDurationSeconds: 47_000,
    });
    expect(real.totalFuelCostUsd).toBeCloseTo(126, 9);
    expect(real.totalCostUsd).toBeCloseTo(126, 9);
  });

  it("flags a real leg over the cap", () => {
    const { violations } = realizePlan(input, plan, [leg(501), leg(300)]);
    expect(violations).toContainEqual({ kind: "LEG_OVER_CAP", legIndex: 0, toCandidateId: "A", legMiles: 501, maxLegMiles: 500 });
  });

  it("accepts a real leg of exactly the cap", () => {
    expect(realizePlan(input, plan, [leg(500), leg(300)]).violations.filter((v) => v.kind === "LEG_OVER_CAP")).toEqual([]);
  });

  it("flags arriving at a stop under the reserve, though every leg is inside the cap", () => {
    // 110-gallon tank, 33-gallon reserve. 350 miles burns 70 (40 left, fine); a real 450 burns 90 and leaves 20.
    const tight = lane({ distance: 700, stations: [{ mile: 350, price: 3.0, id: "A" }], fuel: { tankGallons: 110, startGallons: 110, reserveFraction: 0.3 } });
    const tightPlan = expectPlan(dynamicProgrammingOptimizer.solve(tight));
    const { violations } = realizePlan(tight, tightPlan, [leg(450), leg(250)]);
    expect(violations).toContainEqual({ kind: "BELOW_RESERVE", candidateId: "A", arrivalGallons: 20, requiredGallons: 33 });
    expect(violations.some((v) => v.kind === "LEG_OVER_CAP")).toBe(false);
  });

  it("flags arriving at the destination under the minimum, keeping the DP's departure level", () => {
    // Departure from A is 110 gal; a 420-mile final leg burns 84 and leaves 26 < 30.
    const { violations } = realizePlan(input, plan, [leg(400), leg(420)]);
    expect(violations).toContainEqual({ kind: "BELOW_MIN_ARRIVAL", arrivalGallons: 26, requiredGallons: 30 });
  });

  it("holds the final leg to the cap only while requireArrivalWithinMaxLeg is set", () => {
    const open = lane({ distance: 800, stations: [{ mile: 400, price: 3.0, id: "A" }], fuel: { requireArrivalWithinMaxLeg: false } });
    const openPlan = expectPlan(dynamicProgrammingOptimizer.solve(open));
    const overCap = (i: typeof input, p: typeof plan) => realizePlan(i, p, [leg(400), leg(510)]).violations.some((v) => v.kind === "LEG_OVER_CAP");
    expect(overCap(input, plan)).toBe(true);
    expect(overCap(open, openPlan)).toBe(false);
  });

  it("no floor applies to a real leg: a short one is not a violation", () => {
    // Decision on 13.2: only cap and reserve are re-checked; the 300-mile floor is a DP-time policy.
    expect(TRUCK.minLegMiles).toBe(300);
    expect(realizePlan(input, plan, [leg(290), leg(210)]).violations).toEqual([]);
  });

  it("a stop whose real arrival already exceeds the DP's departure buys nothing rather than a negative amount", () => {
    const { plan: real } = realizePlan(input, plan, [leg(100), leg(500)]);
    expect(real.stops[0]?.purchaseGallons).toBe(0);
    expect(real.stops[0]?.departureGallons).toBe(130);
  });

  it("a plan with no stops is judged against its one leg", () => {
    const short = lane({ distance: 400 });
    const stopless = expectPlan(dynamicProgrammingOptimizer.solve(short));
    const { plan: real, violations } = realizePlan(short, stopless, [leg(400, 24_000)]);
    expect(violations).toEqual([]);
    expect(real).toMatchObject({ stops: [], finalLegMiles: 400, totalDistanceMiles: 400, totalDurationSeconds: 24_000, totalGallons: 0, destinationArrivalGallons: 70 });
  });

  it("rejects a leg count that is not stops + 1", () => {
    expect(() => realizePlan(input, plan, [leg(800)])).toThrow(RangeError);
  });
});
