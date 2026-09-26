import { describe, expect, it } from "vitest";
import type {
  CandidateStation,
  CompletedPlanResponse,
  CreatePlanRequest,
  InfeasiblePlanResponse,
} from "./planResponse.js";

const baseRequest: CreatePlanRequest = {
  origin: { address: "1200 W 35th St, Chicago, IL 60609" },
  destination: { address: "4200 S Lamar Blvd, Dallas, TX 75215" },
  truckId: "11111111-1111-1111-1111-111111111111",
  startFuelGallons: null,
  minArrivalGallons: null,
  maxLegMiles: 500,
  minLegMiles: 300,
  corridorMiles: 25,
  maxDetourMiles: 5,
  maxStops: null,
  priceBasis: "pump",
  driverCostPerHour: 0,
  fixedStopMinutes: 20,
  departAt: null,
};

const candidate: CandidateStation = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "LOVES #221",
  city: "Beatty",
  state: "NV",
  location: { lat: 36.9066, lng: -116.7597 },
  unitPriceUsd: 4.505,
  distanceAlongRouteMiles: 322,
  detourMiles: 0.4,
};

const completed: CompletedPlanResponse = {
  planId: "33333333-3333-3333-3333-333333333333",
  createdAt: "2026-08-22T12:00:00.000Z",
  origin: { label: "Chicago, IL", location: { lat: 41.8508, lng: -87.65 } },
  destination: { label: "Dallas, TX", location: { lat: 32.7157, lng: -96.7969 } },
  truckId: "66666666-6666-6666-6666-666666666666",
  status: "completed",
  units: "imperial",
  priceAsOf: "2026-08-22",
  optimizerStrategy: "dp_v1",
  solveMs: 4200,
  stationsScanned: 12,
  truck: { unitNumber: "860", maxLegMiles: 500 },
  baseline: {
    polyline: "BG0xy",
    distanceMiles: 967.4,
    driveSeconds: 53280,
    estimatedFuelCostUsd: 863.2,
    bounds: { north: 0, south: 0, east: 0, west: 0 },
  },
  optimized: {
    polyline: "BG3ab",
    distanceMiles: 981.2,
    driveSeconds: 55020,
    dwellSeconds: 1200,
    totalSeconds: 56220,
    totalFuelCostUsd: 792.14,
    totalGallons: 163.5,
    savingsVsBaselineUsd: 71.06,
    addedDistanceMiles: 13.8,
    addedDurationSeconds: 1740,
    detourCostUsd: 0.24,
    costPerMile: 0.6,
    bounds: { north: 0, south: 0, east: 0, west: 0 },
  },
  stops: [
    {
      seq: 1,
      stopType: "fuel",
      station: {
        id: "44444444-4444-4444-4444-444444444444",
        name: "LOVES #412",
        storeNumber: 412,
        city: "Effingham",
        state: "IL",
        location: { lat: 39.1123, lng: -88.5434 },
        resolution: "exact",
        uncertaintyMiles: 0,
        truckAccessible: "operator_verified",
      },
      legDistanceMiles: 214.3,
      detourMiles: 0.4,
      detourSeconds: 90,
      unitPriceUsd: 5.193,
      arrivalGallons: 64.2,
      purchaseGallons: 85.8,
      departureGallons: 150.0,
      stopCostUsd: 445.56,
      cumulativeDistanceMiles: 214.7,
      cumulativeDurationSeconds: 12180,
      arrivalFuelPercent: 42.8,
    },
  ],
  candidateStations: [candidate],
  googleMapsUrl: "https://www.google.com/maps/dir/?api=1&origin=…&destination=…",
  disclaimers: [
    { code: "GOOGLE_LINK_NOT_TRUCK_LEGAL", message: "Not truck-legal." },
    { code: "PRICE_STALENESS", message: "Prices as of 2026-08-22." },
  ],
  attribution: {
    routing: "© openrouteservice.org (HeiGIT)",
    placeData: "© OpenStreetMap contributors (ODbL)",
  },
  sentToDriver: false,
  sentToDriverAt: null,
};

const infeasible: InfeasiblePlanResponse = {
  planId: "55555555-5555-5555-5555-555555555555",
  createdAt: "2026-08-22T12:00:00.000Z",
  units: "imperial",
  origin: { label: "Chicago, IL", location: { lat: 41.8508, lng: -87.65 } },
  destination: { label: "Dallas, TX", location: { lat: 32.7157, lng: -96.7969 } },
  truckId: "11111111-1111-1111-1111-111111111111",
  status: "infeasible",
  reason: {
    code: "LEG_GAP",
    message: "No BVD station between mile 412 and mile 1,088.",
    gapStartMile: 412,
    gapEndMile: 1088,
    gapMiles: 676,
    maxLegMiles: 500,
    suggestions: [
      { action: "increaseDetour", maxDetourMiles: 25 },
      { action: "increaseMaxLeg", maxLegMiles: 700 },
      { action: "allowOffNetworkStop", note: "Requires a non-BVD fuel stop" },
    ],
  },
  candidateStations: [candidate],
};

describe("planResponse domain types", () => {
  it("keeps maxStops: null distinct from maxStops: 0", () => {
    const noLimit: CreatePlanRequest = { ...baseRequest, maxStops: null };
    const zeroStops: CreatePlanRequest = { ...baseRequest, maxStops: 0 };

    expect(noLimit.maxStops).toBeNull();
    expect(zeroStops.maxStops).toBe(0);
    expect(noLimit.maxStops).not.toBe(zeroStops.maxStops);
  });

  it("keeps maxDetourMiles: null distinct from maxDetourMiles: 0", () => {
    const noCap: CreatePlanRequest = { ...baseRequest, maxDetourMiles: null };
    const zeroCap: CreatePlanRequest = { ...baseRequest, maxDetourMiles: 0 };

    expect(noCap.maxDetourMiles).toBeNull();
    expect(zeroCap.maxDetourMiles).toBe(0);
    expect(noCap.maxDetourMiles).not.toBe(zeroCap.maxDetourMiles);
  });

  it("keeps corridorMiles distinct from maxDetourMiles: two parameters, two pipeline stages", () => {
    // corridorMiles decides what is even considered (screening); maxDetourMiles
    // is a later, post-routing cap on one station's actual detour. A request
    // can legitimately set them to different values, or cap detours to 0 while
    // still screening a wide corridor.
    const request: CreatePlanRequest = { ...baseRequest, corridorMiles: 25, maxDetourMiles: 0 };

    expect(request.corridorMiles).toBe(25);
    expect(request.maxDetourMiles).toBe(0);
    expect(request.corridorMiles).not.toBe(request.maxDetourMiles);
  });

  it("compiles both PlanResponse shapes, discriminated on status", () => {
    expect(completed.status).toBe("completed");
    expect(infeasible.status).toBe("infeasible");
    // Every field above is a number or a plain string/enum — never a
    // pre-formatted display string like "$286.62" or "7h 40m" (UI contract §1).
    expect(typeof completed.optimized.totalFuelCostUsd).toBe("number");
    expect(typeof completed.optimized.driveSeconds).toBe("number");
    expect(typeof completed.optimized.dwellSeconds).toBe("number");
    expect(typeof completed.optimized.detourCostUsd).toBe("number");
    expect(completed.optimized.driveSeconds + completed.optimized.dwellSeconds).toBe(completed.optimized.totalSeconds);
  });
});
