import { describe, expect, it } from "vitest";
import { buildDisclaimers, type DisclaimerStop } from "./disclaimers.js";
import type { ShortLeg } from "./relaxation.js";

const verifiedStop: DisclaimerStop = { seq: 1, station: { id: "s1", name: "LOVES #412", truckAccessible: "operator_verified" } };
const unverifiedStop: DisclaimerStop = { seq: 2, station: { id: "s2", name: "LOVES #500", truckAccessible: "unverified" } };

describe("buildDisclaimers (§9.4, §14, Q5)", () => {
  it("every plan carries GOOGLE_LINK_NOT_TRUCK_LEGAL, worded verbatim", () => {
    const disclaimers = buildDisclaimers({ stops: [verifiedStop], priceAsOf: "2026-08-22", minLegRelaxed: false });
    expect(disclaimers).toContainEqual({
      code: "GOOGLE_LINK_NOT_TRUCK_LEGAL",
      message: "The Google Maps link routes between the correct stops but does not check truck restrictions.",
    });
  });

  it("every plan carries PRICE_STALENESS, worded verbatim with priceAsOf", () => {
    const disclaimers = buildDisclaimers({ stops: [verifiedStop], priceAsOf: "2026-08-22", minLegRelaxed: false });
    expect(disclaimers).toContainEqual({
      code: "PRICE_STALENESS",
      message: "Prices reflect the BVD sheet effective 2026-08-22.",
    });
  });

  it("an all-operator-verified plan omits ACCESSIBILITY_UNVERIFIED", () => {
    const disclaimers = buildDisclaimers({ stops: [verifiedStop], priceAsOf: "2026-08-22", minLegRelaxed: false });
    expect(disclaimers.find((d) => d.code === "ACCESSIBILITY_UNVERIFIED")).toBeUndefined();
  });

  it("a plan with an unverified stop carries ACCESSIBILITY_UNVERIFIED, naming it", () => {
    const disclaimers = buildDisclaimers({ stops: [verifiedStop, unverifiedStop], priceAsOf: "2026-08-22", minLegRelaxed: false });
    expect(disclaimers).toContainEqual({
      code: "ACCESSIBILITY_UNVERIFIED",
      message: "Truck accessibility is unverified for: LOVES #500.",
    });
  });

  it("names every unverified stop, not just the first", () => {
    const secondUnverified: DisclaimerStop = { seq: 3, station: { id: "s3", name: "LOVES #600", truckAccessible: "excluded" } };
    const disclaimers = buildDisclaimers({ stops: [unverifiedStop, secondUnverified], priceAsOf: "2026-08-22", minLegRelaxed: false });
    expect(disclaimers).toContainEqual({
      code: "ACCESSIBILITY_UNVERIFIED",
      message: "Truck accessibility is unverified for: LOVES #500, LOVES #600.",
    });
  });

  it("omits MIN_LEG_RELAXED when the second pass never ran", () => {
    const disclaimers = buildDisclaimers({ stops: [verifiedStop], priceAsOf: "2026-08-22", minLegRelaxed: false });
    expect(disclaimers.find((d) => d.code === "MIN_LEG_RELAXED")).toBeUndefined();
  });

  it("carries MIN_LEG_RELAXED only after relaxation, naming the leg number, station and distance", () => {
    const shortLegs: ShortLeg[] = [{ fromCandidateId: null, toCandidateId: "s1", legMiles: 214.3, requiredMiles: 300 }];
    const disclaimers = buildDisclaimers({
      stops: [verifiedStop],
      priceAsOf: "2026-08-22",
      minLegRelaxed: true,
      shortLegs,
    });
    expect(disclaimers).toContainEqual({
      code: "MIN_LEG_RELAXED",
      message:
        "The 300-mile minimum leg length was relaxed because no station fit the requested spacing. Short leg(s): leg 1 into LOVES #412 (214.3 mi).",
    });
  });

  it("names every short leg when more than one falls short", () => {
    const secondStop: DisclaimerStop = { seq: 2, station: { id: "s2b", name: "LOVES #700", truckAccessible: "operator_verified" } };
    const shortLegs: ShortLeg[] = [
      { fromCandidateId: null, toCandidateId: "s1", legMiles: 214.3, requiredMiles: 300 },
      { fromCandidateId: "s1", toCandidateId: "s2b", legMiles: 120, requiredMiles: 300 },
    ];
    const disclaimers = buildDisclaimers({
      stops: [verifiedStop, secondStop],
      priceAsOf: "2026-08-22",
      minLegRelaxed: true,
      shortLegs,
    });
    expect(disclaimers).toContainEqual({
      code: "MIN_LEG_RELAXED",
      message:
        "The 300-mile minimum leg length was relaxed because no station fit the requested spacing. Short leg(s): leg 1 into LOVES #412 (214.3 mi); leg 2 into LOVES #700 (120 mi).",
    });
  });

  it("never names the final leg — §5.1 has no floor on it, so it is never in shortLegs to begin with", () => {
    // The absence of a final-leg entry in `shortLegs` is `findShortLegs`'s own
    // contract (relaxation.ts); this only asserts buildDisclaimers doesn't
    // invent one when given none.
    const disclaimers = buildDisclaimers({ stops: [verifiedStop], priceAsOf: "2026-08-22", minLegRelaxed: true, shortLegs: [] });
    expect(disclaimers.find((d) => d.code === "MIN_LEG_RELAXED")).toBeUndefined();
  });
});
