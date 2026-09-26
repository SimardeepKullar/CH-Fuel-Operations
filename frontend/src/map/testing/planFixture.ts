import type { CompletedPlanResponse, PlanStop } from "@ch/core/domain/planResponse";

/**
 * Encodes `[lng, lat]` pairs as a precision-5 polyline — test-only, so the
 * fixture's route geometry is written as coordinates a reader can check
 * rather than as an opaque string.
 */
export function encodePolyline(coordinates: [number, number][], precision = 5): string {
  const factor = 10 ** precision;
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  const encodeValue = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [lng, lat] of coordinates) {
    const la = Math.round(lat * factor);
    const ln = Math.round(lng * factor);
    encodeValue(la - prevLat);
    encodeValue(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

export const BAKERSFIELD = { lat: 35.3733, lng: -119.0187 };
export const RENO = { lat: 39.5296, lng: -119.8138 };

/** Bakersfield → Fresno → Sacramento → Reno, `[lng, lat]`. */
export const OPTIMIZED_LINE: [number, number][] = [
  [-119.0187, 35.3733],
  [-119.7871, 36.7378],
  [-121.4944, 38.5816],
  [-119.8138, 39.5296],
];
/** The direct route, drawn dashed underneath. */
export const BASELINE_LINE: [number, number][] = [
  [-119.0187, 35.3733],
  [-119.5, 37.4],
  [-119.8138, 39.5296],
];

function stop(overrides: Partial<PlanStop> & Pick<PlanStop, "seq" | "station">): PlanStop {
  return {
    stopType: "fuel",
    legDistanceMiles: 110,
    detourMiles: 1.4,
    detourSeconds: 180,
    unitPriceUsd: 3.8912,
    arrivalGallons: 52.25,
    purchaseGallons: 120.5,
    departureGallons: 172.75,
    stopCostUsd: 468.89,
    cumulativeDistanceMiles: 110,
    cumulativeDurationSeconds: 7200,
    arrivalFuelPercent: 26,
    ...overrides,
  };
}

/** Deliberately listed out of `seq` order: the map must place pins by `seq`, not by array index. */
export const STOPS: PlanStop[] = [
  stop({
    seq: 2,
    station: {
      id: "st-sac",
      name: "Love's #412",
      storeNumber: 412,
      city: "Sacramento",
      state: "CA",
      location: { lat: 38.5816, lng: -121.4944 },
      resolution: "city",
      uncertaintyMiles: 3.2,
      truckAccessible: "operator_verified",
    },
    unitPriceUsd: 4.0125,
    purchaseGallons: 88.4,
    arrivalGallons: 61.3,
    detourMiles: 2.6,
    cumulativeDistanceMiles: 402.7,
    stopCostUsd: 354.71,
  }),
  stop({
    seq: 1,
    station: {
      id: "st-fresno",
      name: "Love's #368",
      storeNumber: 368,
      city: "Fresno",
      state: "CA",
      location: { lat: 36.7378, lng: -119.7871 },
      resolution: "exact",
      uncertaintyMiles: 0,
      truckAccessible: "operator_verified",
    },
  }),
];

export const COMPLETED_PLAN: CompletedPlanResponse = {
  planId: "plan-map",
  createdAt: "2026-09-22T12:00:00.000Z",
  units: "imperial",
  origin: { label: "Bakersfield, CA", location: BAKERSFIELD },
  destination: { label: "Reno, NV", location: RENO },
  truckId: "truck-fixture",
  candidateStations: [
    {
      id: "st-madera",
      name: "Love's #501",
      city: "Madera",
      state: "CA",
      location: { lat: 36.9613, lng: -120.0607 },
      unitPriceUsd: 3.9544,
      distanceAlongRouteMiles: 131.2,
      detourMiles: 0.8,
    },
    {
      id: "st-stockton",
      name: "Love's #277",
      city: "Stockton",
      state: "CA",
      location: { lat: 37.9577, lng: -121.2908 },
      unitPriceUsd: 4.1099,
      distanceAlongRouteMiles: 322.5,
      detourMiles: 3.1,
    },
  ],
  status: "completed",
  priceAsOf: "2026-09-22",
  optimizerStrategy: "dp_v1",
  solveMs: 4200,
  stationsScanned: 4,
  truck: { unitNumber: "760", maxLegMiles: 500 },
  baseline: {
    polyline: encodePolyline(BASELINE_LINE),
    distanceMiles: 480,
    driveSeconds: 27000,
    estimatedFuelCostUsd: 900,
    bounds: { north: 39.5296, south: 35.3733, east: -119.0187, west: -119.8138 },
  },
  optimized: {
    polyline: encodePolyline(OPTIMIZED_LINE),
    distanceMiles: 486.5,
    driveSeconds: 27600,
    dwellSeconds: 1200,
    totalSeconds: 28800,
    totalFuelCostUsd: 823.6,
    totalGallons: 208.9,
    savingsVsBaselineUsd: 41,
    addedDistanceMiles: 6.5,
    addedDurationSeconds: 600,
    detourCostUsd: 2.4,
    costPerMile: 0.6,
    bounds: { north: 39.5296, south: 35.3733, east: -119.0187, west: -121.4944 },
  },
  stops: STOPS,
  googleMapsUrl: "https://www.google.com/maps/dir/?api=1",
  disclaimers: [],
  attribution: { routing: "© openrouteservice.org (HeiGIT)", placeData: "© OpenStreetMap contributors (ODbL)" },
  sentToDriver: false,
  sentToDriverAt: null,
};
