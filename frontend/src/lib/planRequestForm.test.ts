import { describe, expect, it } from "vitest";
import { buildCreatePlanRequest, EMPTY_PLAN_FORM, parseNullableInt, parseNullableNumber } from "./planRequestForm";

describe("parseNullableNumber", () => {
  it("reads blank as null, not 0", () => {
    expect(parseNullableNumber("")).toBeNull();
    expect(parseNullableNumber("   ")).toBeNull();
  });

  it("parses a numeric string", () => {
    expect(parseNullableNumber("12.5")).toBe(12.5);
  });
});

describe("parseNullableInt", () => {
  it("reads blank as null, not 0", () => {
    expect(parseNullableInt("")).toBeNull();
  });

  it("truncates a numeric string", () => {
    expect(parseNullableInt("4")).toBe(4);
  });
});

describe("buildCreatePlanRequest", () => {
  const filledForm = {
    ...EMPTY_PLAN_FORM,
    originAddress: "Bakersfield, CA",
    destinationAddress: "Reno, NV",
    truckId: "11111111-1111-1111-1111-111111111111",
  };

  it("every blank Dev Tools field reaches the request as null, not 0", () => {
    const request = buildCreatePlanRequest(filledForm);
    expect(request).not.toBeNull();
    expect(request!.startFuelGallons).toBeNull();
    expect(request!.minArrivalGallons).toBeNull();
    expect(request!.maxLegMiles).toBeNull();
    expect(request!.minLegMiles).toBeNull();
    expect(request!.corridorMiles).toBeNull();
    expect(request!.maxDetourMiles).toBeNull();
    expect(request!.maxStops).toBeNull();
  });

  it("carries the selected truckId (the only truck field, T-56)", () => {
    const request = buildCreatePlanRequest(filledForm);
    expect(request!.truckId).toBe(filledForm.truckId);
  });

  it("a filled-in constraint reaches the request as a real number", () => {
    const request = buildCreatePlanRequest({ ...filledForm, maxDetourMiles: "10", maxStops: "3" });
    expect(request!.maxDetourMiles).toBe(10);
    expect(request!.maxStops).toBe(3);
  });

  it("returns null when a required field (origin, destination, truckId) is missing", () => {
    expect(buildCreatePlanRequest(EMPTY_PLAN_FORM)).toBeNull();
    expect(buildCreatePlanRequest({ ...filledForm, truckId: null })).toBeNull();
  });
});
