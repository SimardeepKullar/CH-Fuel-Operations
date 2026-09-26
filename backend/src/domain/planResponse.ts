import type { PriceBasis, StationResolution, StopType, TruckAccessible } from "../db/types.js";

/**
 * Shared shapes for `POST /plans` / `GET /plans/{id}` (§14, UI contract §3).
 * The frontend mock (T-04) types its fixture data against these so T-21 swaps
 * a data source instead of reshaping every component a second time.
 *
 * Storage is miles and gallons; conversion happens at the API boundary only
 * (§6 decision 16) — these are the boundary shapes, already in display units.
 */

export type Units = "imperial" | "metric";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface AddressInput {
  address: string;
}

export type LocationInput = AddressInput | LatLng;

/**
 * `POST /plans` request body (§14). Several fields are genuinely nullable —
 * "no cap" — and must never be coerced to `0`, which is a different, valid
 * value (e.g. zero extra stops allowed vs. no limit on stops at all).
 */
export interface CreatePlanRequest {
  origin: LocationInput;
  destination: LocationInput;
  /**
   * Which of the 27 real fleet trucks (`trucks.id`) this plan is for (T-56).
   * Required — every plan is for a real truck, whose own row also carries
   * the mpg/tank spec the optimiser solves against (no more separate
   * abstract-class id to pass alongside it).
   */
  truckId: string;

  /** null = tank capacity (100%). */
  startFuelGallons: number | null;
  /** null = the truck profile's reserve level. */
  minArrivalGallons: number | null;
  /** null = the truck profile's default. */
  maxLegMiles: number | null;
  /** null = the truck profile's default; auto-relaxed if infeasible (§5.1). */
  minLegMiles: number | null;
  /**
   * Straight-line screening radius (miles) that decides what a corridor
   * candidate is at all, inflated per-station by its own uncertainty
   * (§15.1). null = the default screening radius. Distinct from
   * `maxDetourMiles`, the post-routing cap on one station's actual
   * routed detour — a station can be inside the corridor and still be
   * rejected by that cap, at a later stage of the pipeline.
   */
  corridorMiles: number | null;
  /** null = no cap on a single stop's post-routing, routed detour. */
  maxDetourMiles: number | null;
  /** null = no limit on stop count. */
  maxStops: number | null;
  priceBasis: PriceBasis;
  driverCostPerHour: number;
  fixedStopMinutes: number;
  /** Optional override of the registered optimiser (§13.1). */
  optimizerStrategy?: string;
  /** Re-price against a historical sheet (UI contract §3.6); null = latest. */
  priceEffectiveOn?: string | null;
  departAt: string | null;
}

export interface PlanTruckSummary {
  unitNumber: string;
  maxLegMiles: number;
}

export interface RouteBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface RouteGeometrySummary {
  polyline: string | null;
  distanceMiles: number;
  /** Driving time only — was `durationSeconds` (T-16). Renamed under T-18 so
   * it reads correctly on `baseline` too: a direct route is 100% drive time
   * by definition, so the name should say so even where there is no dwell
   * figure to contrast it against. */
  driveSeconds: number;
  bounds: RouteBounds;
}

/** The baseline (direct, unoptimized) route. */
export interface RouteSummary extends RouteGeometrySummary {
  estimatedFuelCostUsd: number;
}

/** The solved route — supersedes `estimatedFuelCostUsd` with a real total. */
export interface OptimizedRouteSummary extends RouteGeometrySummary {
  totalFuelCostUsd: number;
  totalGallons: number;
  savingsVsBaselineUsd: number;
  addedDistanceMiles: number;
  addedDurationSeconds: number;
  /**
   * T-18: time spent stopped at the pump, summed across every stop the plan
   * chose — `stops.length * fixedStopMinutes * 60`. `fixedStopMinutes` was
   * already a cost input to the optimiser (`optimizer/model.ts`'s
   * `fixedStopCost`); this is the same per-stop assumption expressed as
   * time instead of dollars, so `driveSeconds + dwellSeconds = totalSeconds`
   * and the "excludes time at the pump" caption has a real figure to name.
   */
  dwellSeconds: number;
  totalSeconds: number;
  /** `Σ stop.detourMiles * costPerMile` for the stops actually chosen. */
  detourCostUsd: number;
  /** The rate `detourCostUsd` was computed from — `truck_profiles.cost_per_mile_usd`,
   * a business input the response must carry rather than the frontend
   * re-guessing the design's hard-coded $0.60/mi (UI contract §6.4). */
  costPerMile: number;
}

export interface StationLocationSummary {
  id: string;
  name: string;
  storeNumber: number | null;
  city: string;
  state: string;
  location: LatLng;
  resolution: StationResolution;
  uncertaintyMiles: number;
  truckAccessible: TruckAccessible;
}

export interface PlanStop {
  seq: number;
  stopType: StopType;
  station: StationLocationSummary;
  legDistanceMiles: number;
  detourMiles: number;
  detourSeconds: number;
  unitPriceUsd: number;
  arrivalGallons: number;
  purchaseGallons: number;
  departureGallons: number;
  stopCostUsd: number;
  cumulativeDistanceMiles: number;
  cumulativeDurationSeconds: number;
  arrivalFuelPercent: number;
}

/**
 * §14 leaves this as a comment stub; T-18 specifies it fully. This is the
 * minimum UI contract §3.3 names, enough for T-04's mock to type against —
 * the candidate dot layer, its hover card, and the cheapest-along-route chart.
 */
export interface CandidateStation {
  id: string;
  name: string;
  city: string;
  state: string;
  location: LatLng;
  unitPriceUsd: number;
  distanceAlongRouteMiles: number;
  detourMiles: number;
}

export type DisclaimerCode =
  | "GOOGLE_LINK_NOT_TRUCK_LEGAL"
  | "ACCESSIBILITY_UNVERIFIED"
  | "MIN_LEG_RELAXED"
  | "PRICE_STALENESS";

export interface Disclaimer {
  code: DisclaimerCode;
  message: string;
}

export interface Attribution {
  routing: string;
  placeData: string;
}

export type InfeasibleSuggestion =
  | { action: "increaseDetour"; maxDetourMiles: number }
  | { action: "increaseMaxLeg"; maxLegMiles: number }
  | { action: "allowOffNetworkStop"; note: string };

export interface InfeasibleReason {
  code: string;
  message: string;
  /**
   * Only `LEG_GAP` has a gap to name. `MAX_STOPS_EXCEEDED`, `FUEL_INFEASIBLE`
   * and `NO_STABLE_PLAN` (§15.5) have no natural gap figure — leaving these
   * optional keeps a non-gap reason from carrying three made-up zeros, which
   * would read as a real measurement.
   */
  gapStartMile?: number;
  gapEndMile?: number;
  gapMiles?: number;
  maxLegMiles: number;
  suggestions: InfeasibleSuggestion[];
}

/**
 * A geocoded endpoint, echoed back so the lane form shows what was actually
 * resolved rather than what was typed (UI contract §3.1, §3.4). §14's sample
 * payload doesn't yet carry this — UI contract §3.1 names it as a gap for
 * T-18 to close; it's added here so the Plan tab's Source/Destination fields
 * have something typed to render against in the meantime.
 */
export interface ResolvedLocation {
  /** `null` for a `{lat,lng}` request, which typed no address to resolve (T-15's `LocationResolution.label`). */
  label: string | null;
  location: LatLng;
}

interface PlanResponseBase {
  planId: string;
  /** `plans.created_at` — omitted from §14's illustrative sample, not a gap. */
  createdAt: string;
  /** §14's `?units=metric` toggle. Applies to both shapes: `InfeasibleReason`'s gap figures are miles too. */
  units: Units;
  origin: ResolvedLocation;
  destination: ResolvedLocation;
  /** Echoes `CreatePlanRequest.truckId` (T-56) — every plan names a real truck. */
  truckId: string;
  /** Corridor stations not selected — the map's dot layer. */
  candidateStations: CandidateStation[];
}

export interface CompletedPlanResponse extends PlanResponseBase {
  status: "completed";
  priceAsOf: string;
  optimizerStrategy: string;
  /** Wall-clock milliseconds the solve took (UI contract §6.7). Not persisted — recomputing it from a re-fetch would just be the fetch's own latency. */
  solveMs: number;
  /** Corridor candidates the optimiser actually considered, i.e. `candidateStations.length + stops.length` (UI contract §6.7). */
  stationsScanned: number;
  truck: PlanTruckSummary;
  baseline: RouteSummary;
  optimized: OptimizedRouteSummary;
  stops: PlanStop[];
  googleMapsUrl: string;
  disclaimers: Disclaimer[];
  attribution: Attribution;
  /**
   * Dispatcher bookkeeping (T-19), not a solve output — a checkbox alongside
   * solve status and trip lifecycle (UI contract §3.10/§7), not folded into
   * either. Lives only on `CompletedPlanResponse`: an infeasible plan has no
   * route, no stops and no `googleMapsUrl`, so there is nothing to have sent
   * a driver.
   */
  sentToDriver: boolean;
  sentToDriverAt: string | null;
}

export interface InfeasiblePlanResponse extends PlanResponseBase {
  status: "infeasible";
  reason: InfeasibleReason;
}

/** `GET /plans/{id}` (§14) — exactly two shapes, discriminated on `status`. */
export type PlanResponse = CompletedPlanResponse | InfeasiblePlanResponse;
