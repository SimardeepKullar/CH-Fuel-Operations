import { describe, expect, it } from "vitest";
import { convertPlanResponseUnits } from "./planResponseUnits.js";
import type { CompletedPlanResponse, InfeasiblePlanResponse } from "./planResponse.js";

const completed: CompletedPlanResponse = {
  planId: "1",
  createdAt: "2026-09-22T12:00:00.000Z",
  units: "imperial",
  origin: { label: "Chicago, IL", location: { lat: 41.85, lng: -87.65 } },
  destination: { label: "Dallas, TX", location: { lat: 32.72, lng: -96.8 } },
  truckId: "t1",
  candidateStations: [
    { id: "c1", name: "LOVES #1", city: "X", state: "TX", location: { lat: 1, lng: 1 }, unitPriceUsd: 5, distanceAlongRouteMiles: 100, detourMiles: 2 },
  ],
  status: "completed",
  priceAsOf: "2026-09-01",
  optimizerStrategy: "dp_v1",
  solveMs: 4000,
  stationsScanned: 5,
  truck: { unitNumber: "t", maxLegMiles: 500 },
  baseline: { polyline: "p", distanceMiles: 700, driveSeconds: 42000, estimatedFuelCostUsd: 700, bounds: { north: 1, south: 0, east: 1, west: 0 } },
  optimized: {
    polyline: "p2",
    distanceMiles: 700,
    driveSeconds: 42000,
    dwellSeconds: 1200,
    totalSeconds: 43200,
    bounds: { north: 1, south: 0, east: 1, west: 0 },
    totalFuelCostUsd: 100,
    totalGallons: 20,
    savingsVsBaselineUsd: 600,
    addedDistanceMiles: 0,
    addedDurationSeconds: 0,
    detourCostUsd: 0,
    costPerMile: 0.6,
  },
  stops: [
    {
      seq: 1,
      stopType: "fuel",
      station: {
        id: "s1",
        name: "LOVES #200",
        storeNumber: 200,
        city: "Testville",
        state: "TX",
        location: { lat: 35, lng: -97 },
        resolution: "exact",
        uncertaintyMiles: 3,
        truckAccessible: "operator_verified",
      },
      legDistanceMiles: 350,
      detourMiles: 0,
      detourSeconds: 0,
      unitPriceUsd: 5,
      arrivalGallons: 80,
      purchaseGallons: 20,
      departureGallons: 100,
      stopCostUsd: 100,
      cumulativeDistanceMiles: 350,
      cumulativeDurationSeconds: 21000,
      arrivalFuelPercent: 53.333333,
    },
  ],
  googleMapsUrl: "",
  disclaimers: [],
  attribution: { routing: "ORS", placeData: "OSM" },
  sentToDriver: false,
  sentToDriverAt: null,
};

const infeasible: InfeasiblePlanResponse = {
  planId: "2",
  createdAt: "2026-09-22T12:00:00.000Z",
  units: "imperial",
  origin: { label: null, location: { lat: 30, lng: -97 } },
  destination: { label: null, location: { lat: 40, lng: -97 } },
  truckId: "t2",
  candidateStations: [],
  status: "infeasible",
  reason: {
    code: "LEG_GAP",
    message: "gap",
    gapStartMile: 0,
    gapEndMile: 700,
    gapMiles: 700,
    maxLegMiles: 500,
    suggestions: [
      { action: "increaseDetour", maxDetourMiles: 20 },
      { action: "increaseMaxLeg", maxLegMiles: 700 },
      { action: "allowOffNetworkStop", note: "note" },
    ],
  },
};

describe("convertPlanResponseUnits", () => {
  it("returns the same response untouched when the units already match", () => {
    expect(convertPlanResponseUnits(completed, "imperial")).toBe(completed);
  });

  it("converts every distance and volume field on a completed plan, leaving dollars and durations alone", () => {
    const metric = convertPlanResponseUnits(completed, "metric") as CompletedPlanResponse;

    expect(metric.units).toBe("metric");
    expect(metric.truck.maxLegMiles).toBeCloseTo(500 * 1.609344, 6);
    expect(metric.baseline.distanceMiles).toBeCloseTo(700 * 1.609344, 6);
    expect(metric.optimized.distanceMiles).toBeCloseTo(700 * 1.609344, 6);
    expect(metric.optimized.totalGallons).toBeCloseTo(20 * 3.785411784, 6);
    expect(metric.stops[0]!.legDistanceMiles).toBeCloseTo(350 * 1.609344, 6);
    expect(metric.stops[0]!.arrivalGallons).toBeCloseTo(80 * 3.785411784, 6);
    expect(metric.stops[0]!.purchaseGallons).toBeCloseTo(20 * 3.785411784, 6);
    expect(metric.stops[0]!.station.uncertaintyMiles).toBeCloseTo(3 * 1.609344, 6);
    expect(metric.candidateStations[0]!.distanceAlongRouteMiles).toBeCloseTo(100 * 1.609344, 6);

    // Dollars, durations, percentages and coordinates are untouched.
    expect(metric.optimized.totalFuelCostUsd).toBe(100);
    expect(metric.stops[0]!.unitPriceUsd).toBe(5);
    expect(metric.stops[0]!.stopCostUsd).toBe(100);
    expect(metric.optimized.driveSeconds).toBe(42000);
    expect(metric.optimized.dwellSeconds).toBe(1200);
    expect(metric.optimized.totalSeconds).toBe(43200);
    expect(metric.optimized.detourCostUsd).toBe(0);
    expect(metric.stops[0]!.arrivalFuelPercent).toBeCloseTo(53.333333, 5);
    expect(metric.baseline.bounds).toEqual(completed.baseline.bounds);

    // The original object is never mutated.
    expect(completed.units).toBe("imperial");
    expect(completed.optimized.distanceMiles).toBe(700);
  });

  it("converts an infeasible plan's gap figures and suggestions, leaving the note-only suggestion alone", () => {
    const metric = convertPlanResponseUnits(infeasible, "metric") as InfeasiblePlanResponse;

    expect(metric.units).toBe("metric");
    expect(metric.reason.gapStartMile).toBeCloseTo(0, 9);
    expect(metric.reason.gapEndMile).toBeCloseTo(700 * 1.609344, 6);
    expect(metric.reason.gapMiles).toBeCloseTo(700 * 1.609344, 6);
    expect(metric.reason.maxLegMiles).toBeCloseTo(500 * 1.609344, 6);
    expect(metric.reason.suggestions[0]).toEqual({ action: "increaseDetour", maxDetourMiles: 20 * 1.609344 });
    expect(metric.reason.suggestions[1]).toEqual({ action: "increaseMaxLeg", maxLegMiles: 700 * 1.609344 });
    expect(metric.reason.suggestions[2]).toEqual({ action: "allowOffNetworkStop", note: "note" });
  });

  it("leaves optional gap fields unset rather than inventing a converted 0", () => {
    const noGap: InfeasiblePlanResponse = {
      ...infeasible,
      reason: { code: "FUEL_INFEASIBLE", message: "m", maxLegMiles: 500, suggestions: [] },
    };
    const metric = convertPlanResponseUnits(noGap, "metric") as InfeasiblePlanResponse;
    expect(metric.reason.gapStartMile).toBeUndefined();
    expect(metric.reason.gapEndMile).toBeUndefined();
    expect(metric.reason.gapMiles).toBeUndefined();
  });
});
