import type {
  CandidateStation,
  CompletedPlanResponse,
  InfeasiblePlanResponse,
  InfeasibleReason,
  PlanResponse,
  PlanStop,
  StationLocationSummary,
  Units,
} from "./planResponse.js";
import { gallonsToLiters, milesToKm } from "./units.js";

/**
 * CLAUDE.md's third and last conversion edge: `?units=metric`. Storage and
 * every upstream computation stay miles/gallons (§6 decision 16); this is
 * the one place a distance becomes km or a gallon becomes a litre, and it
 * runs only here, over an already-built response — `planService.ts` itself
 * needs no unit awareness at all.
 *
 * Field **names** never change (`legDistanceMiles` stays `legDistanceMiles`
 * even under the metric toggle) — only their values do, exactly as `units`
 * on the response already tells the caller. `unitPriceUsd`/`*CostUsd` are
 * BVD's invoiced dollars-per-U.S.-gallon and per-trip totals, a business
 * fact independent of a display toggle, so they are never touched here;
 * `driveSeconds`/`dwellSeconds`/`totalSeconds` and `RouteBounds` (lat/lng
 * degrees) aren't distances or volumes at all.
 */
export function convertPlanResponseUnits(response: PlanResponse, units: Units): PlanResponse {
  if (units === response.units) {
    return response;
  }
  return response.status === "completed" ? convertCompleted(response) : convertInfeasible(response);
}

function convertStation(station: StationLocationSummary): StationLocationSummary {
  return { ...station, uncertaintyMiles: milesToKm(station.uncertaintyMiles) };
}

function convertStop(stop: PlanStop): PlanStop {
  return {
    ...stop,
    station: convertStation(stop.station),
    legDistanceMiles: milesToKm(stop.legDistanceMiles),
    detourMiles: milesToKm(stop.detourMiles),
    arrivalGallons: gallonsToLiters(stop.arrivalGallons),
    purchaseGallons: gallonsToLiters(stop.purchaseGallons),
    departureGallons: gallonsToLiters(stop.departureGallons),
    cumulativeDistanceMiles: milesToKm(stop.cumulativeDistanceMiles),
  };
}

function convertCandidate(candidate: CandidateStation): CandidateStation {
  return {
    ...candidate,
    distanceAlongRouteMiles: milesToKm(candidate.distanceAlongRouteMiles),
    detourMiles: milesToKm(candidate.detourMiles),
  };
}

function convertReason(reason: InfeasibleReason): InfeasibleReason {
  return {
    ...reason,
    ...(reason.gapStartMile !== undefined ? { gapStartMile: milesToKm(reason.gapStartMile) } : {}),
    ...(reason.gapEndMile !== undefined ? { gapEndMile: milesToKm(reason.gapEndMile) } : {}),
    ...(reason.gapMiles !== undefined ? { gapMiles: milesToKm(reason.gapMiles) } : {}),
    maxLegMiles: milesToKm(reason.maxLegMiles),
    suggestions: reason.suggestions.map((s) =>
      s.action === "increaseDetour"
        ? { ...s, maxDetourMiles: milesToKm(s.maxDetourMiles) }
        : s.action === "increaseMaxLeg"
          ? { ...s, maxLegMiles: milesToKm(s.maxLegMiles) }
          : s,
    ),
  };
}

function convertCompleted(response: CompletedPlanResponse): CompletedPlanResponse {
  return {
    ...response,
    units: "metric",
    candidateStations: response.candidateStations.map(convertCandidate),
    truck: { ...response.truck, maxLegMiles: milesToKm(response.truck.maxLegMiles) },
    baseline: { ...response.baseline, distanceMiles: milesToKm(response.baseline.distanceMiles) },
    optimized: {
      ...response.optimized,
      distanceMiles: milesToKm(response.optimized.distanceMiles),
      totalGallons: gallonsToLiters(response.optimized.totalGallons),
      addedDistanceMiles: milesToKm(response.optimized.addedDistanceMiles),
    },
    stops: response.stops.map(convertStop),
  };
}

function convertInfeasible(response: InfeasiblePlanResponse): InfeasiblePlanResponse {
  return {
    ...response,
    units: "metric",
    candidateStations: response.candidateStations.map(convertCandidate),
    reason: convertReason(response.reason),
  };
}
