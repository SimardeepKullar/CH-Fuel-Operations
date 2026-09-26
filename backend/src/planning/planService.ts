import type { Pool } from "pg";
import type {
  CandidateStation,
  CompletedPlanResponse,
  CreatePlanRequest,
  InfeasiblePlanResponse,
  InfeasibleReason,
  InfeasibleSuggestion,
  LatLng,
  OptimizedRouteSummary,
  PlanResponse,
  PlanStop,
  ResolvedLocation,
  RouteSummary,
  StationLocationSummary,
} from "../domain/planResponse.js";
import { resolveLocation } from "../catalog/geocode.js";
import { DEFAULT_OPTIMIZER_ID, OPTIMIZERS, isOptimizerId } from "../optimizer/registry.js";
import type { OptimizerInfeasible, OptimizerInput } from "../optimizer/types.js";
import type { GeocodingProvider } from "../routing/geocodeProvider.js";
import { OSM_PLACE_DATA_ATTRIBUTION, ORS_ROUTING_ATTRIBUTION } from "../routing/ors.js";
import type { RoutingProvider } from "../routing/provider.js";
import { CITY_TIER_MAX_UNCERTAINTY_MILES } from "../resolution/gazetteer.js";
import { type BracketCandidate, buildDetourSubjects } from "./bracketPoints.js";
import { type CorridorCandidate, findCorridor } from "./corridor.js";
import { measureDetours } from "./detour.js";
import { estimateDetourMiles, filterByEstimate } from "./detourEstimate.js";
import { buildDisclaimers } from "./disclaimers.js";
import { buildGoogleMapsUrl } from "./googleMapsUrl.js";
import { toOptimizerLane } from "./optimizerInput.js";
import {
  boundsFromRow,
  loadPlanRow,
  loadPlanStopRows,
  loadRouteGeometry,
  loadRoutePoint,
  loadTruckRow,
  persistCompletedPlan,
  persistInfeasiblePlan,
  planStopFromRow,
  resolveLatestPriceDate,
  type TruckForPlanRow,
  type RouteGeometryRow,
} from "./planPersistence.js";
import { DEFAULT_CORRIDOR_MILES, resolvePlanDefaults } from "./planDefaults.js";
import { upsertRoute } from "./routePersistence.js";
import { stratifiedTopK } from "./stratifiedTopK.js";
import type { NoStablePlan } from "./validationLoop.js";
import { runValidationLoop } from "./validationLoop.js";

export type PlanServiceErrorCode = "TRUCK_NOT_FOUND" | "TRUCK_SPEC_INCOMPLETE" | "NO_PRICE_SHEET" | "UNKNOWN_OPTIMIZER_STRATEGY";

/**
 * A request-shaped failure the caller (T-16 step 16.3's endpoint) maps onto
 * an RFC 9457 error. Like a provider failure, nothing is persisted for one
 * of these — persistence only starts once a `plans` row is actually being
 * written, well after every one of these checks.
 */
export class PlanServiceError extends Error {
  constructor(
    public readonly code: PlanServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PlanServiceError";
  }
}

export interface PlanServiceDeps {
  pool: Pool;
  routingProvider: RoutingProvider;
  geocoder: GeocodingProvider;
  /** Injected so persistence and telemetry are testable without a clock (§ savedLocations.ts's pattern). */
  now: Date;
}

interface TruckForPlan {
  id: string;
  unitNumber: string;
  tankGallons: number;
  avgMpg: number;
  reserveFraction: number;
  maxLegMiles: number;
  minLegMiles: number;
  costPerMileUsd: number;
  truckSpec: {
    grossWeightKg: number | null;
    heightCm: number | null;
    widthCm: number | null;
    lengthCm: number | null;
    axleCount: number | null;
    hazmatClass: string | null;
  };
}

/** `column name -> the field name TRUCK_SPEC_INCOMPLETE's message names it by`. */
const REQUIRED_PLANNING_FIELDS: ReadonlyArray<readonly [keyof TruckForPlanRow, string]> = [
  ["tank_gallons", "tankGallons"],
  ["avg_mpg", "avgMpg"],
  ["reserve_fraction", "reserveFraction"],
  ["max_leg_miles", "maxLegMiles"],
  ["min_leg_miles", "minLegMiles"],
  ["cost_per_mile_usd", "costPerMileUsd"],
  ["fixed_stop_minutes", "fixedStopMinutes"],
];

/**
 * Loads the truck a plan is for and validates its 7 planning fields are set
 * (T-56: nullable at the schema level — zero real per-unit data yet, only a
 * flagged seeded default — but a plan cannot solve against a gap). Throws
 * `PlanServiceError` rather than returning null/incomplete: every caller
 * (`createPlan`, `getPlan`) needs the same request-shaped failure either way,
 * and a plan already created necessarily had a complete spec at creation
 * time, so a re-fetch hitting this path at all would itself be a bug worth
 * surfacing loudly rather than silently degrading.
 */
async function requireTruckForPlan(pool: Pool, truckId: string): Promise<TruckForPlan> {
  const row = await loadTruckRow(pool, truckId);
  if (!row) {
    throw new PlanServiceError("TRUCK_NOT_FOUND", `no truck ${truckId}`);
  }
  const missing = REQUIRED_PLANNING_FIELDS.filter(([column]) => row[column] === null).map(([, field]) => field);
  if (missing.length > 0) {
    throw new PlanServiceError("TRUCK_SPEC_INCOMPLETE", `truck ${row.unit_number} has no ${missing.join(", ")} set`);
  }
  return {
    id: row.id,
    unitNumber: row.unit_number,
    tankGallons: Number(row.tank_gallons),
    avgMpg: Number(row.avg_mpg),
    reserveFraction: Number(row.reserve_fraction),
    maxLegMiles: Number(row.max_leg_miles),
    minLegMiles: Number(row.min_leg_miles),
    costPerMileUsd: Number(row.cost_per_mile_usd),
    truckSpec: {
      grossWeightKg: row.gross_weight_kg,
      heightCm: row.height_cm,
      widthCm: row.width_cm,
      lengthCm: row.length_cm,
      axleCount: row.axle_count,
      hazmatClass: row.hazmat_class,
    },
  };
}

function toStationSummary(c: CorridorCandidate): StationLocationSummary {
  return {
    id: c.id,
    name: c.nameRaw,
    storeNumber: c.storeNumber,
    city: c.cityRaw,
    state: c.stateUsps,
    location: { lat: c.lat, lng: c.lng },
    resolution: c.resolution,
    uncertaintyMiles: c.uncertaintyMiles,
    truckAccessible: c.truckAccessible,
  };
}

/**
 * The map's dot layer (§14 `candidateStations`). `detourMiles` here is
 * always the cheap §15.4.1 estimate, never the measured figure — most
 * corridor candidates never reach a matrix call at all, so a uniform,
 * cheap figure is what every dot on the map can actually carry.
 */
function toCandidateStation(c: CorridorCandidate): CandidateStation {
  return {
    id: c.id,
    name: c.nameRaw,
    city: c.cityRaw,
    state: c.stateUsps,
    location: { lat: c.lat, lng: c.lng },
    unitPriceUsd: c.unitPriceUsd,
    distanceAlongRouteMiles: c.offsetAlongRouteMiles,
    detourMiles: estimateDetourMiles(c.perpOffsetMiles),
  };
}

/**
 * §15.1's screening stage: a candidate is truly in the corridor only if its
 * offset is within `corridorMiles` **plus its own uncertainty** — inflated
 * per station, not once for the whole query. The SQL call that produced
 * `candidate` already ran with an outer, flat superset radius
 * (`corridorMiles + CITY_TIER_MAX_UNCERTAINTY_MILES`, the widest any
 * station's uncertainty can be) so this filter never has to reject a
 * candidate the query should have returned; it only tightens the boundary
 * back down per station.
 */
function withinCorridor(candidate: Pick<CorridorCandidate, "perpOffsetMiles" | "uncertaintyMiles">, corridorMiles: number): boolean {
  return candidate.perpOffsetMiles <= corridorMiles + candidate.uncertaintyMiles;
}

/**
 * A reference figure only: what the direct route would roughly cost, at the
 * average price across every priced, in-corridor station — there is no
 * "the" baseline price, since the direct route buys nowhere in particular.
 * 0 when nothing priced sits in the corridor at all (nothing to reference).
 */
function estimateBaselineCostUsd(distanceMiles: number, avgMpg: number, inCorridor: readonly CorridorCandidate[]): number {
  if (inCorridor.length === 0) {
    return 0;
  }
  const averageUnitPriceUsd = inCorridor.reduce((sum, c) => sum + c.unitPriceUsd, 0) / inCorridor.length;
  return (distanceMiles / avgMpg) * averageUnitPriceUsd;
}

/**
 * Only `LEG_GAP` has a natural gap to name; the other three infeasibility
 * codes leave `InfeasibleReason`'s gap fields unset rather than filling them
 * with a meaningless 0 (planResponse.ts's own nulls-are-meaningful rule).
 */
function buildInfeasibleReason(result: OptimizerInfeasible | NoStablePlan, maxLegMiles: number, maxDetourMiles: number | null): InfeasibleReason {
  if (result.code === "LEG_GAP") {
    const { gapStartMiles, gapEndMiles, gapMiles } = result.detail;
    const suggestions: InfeasibleSuggestion[] = [];
    if (maxDetourMiles !== null) {
      suggestions.push({ action: "increaseDetour", maxDetourMiles: Math.round((maxDetourMiles + 20) * 10) / 10 });
    }
    suggestions.push({ action: "increaseMaxLeg", maxLegMiles: Math.ceil((maxLegMiles + gapMiles) / 50) * 50 });
    suggestions.push({ action: "allowOffNetworkStop", note: "Requires a non-BVD fuel stop" });
    return {
      code: "LEG_GAP",
      message: `No BVD station between mile ${Math.round(gapStartMiles)} and mile ${Math.round(gapEndMiles)}; the ${maxLegMiles}-mile cap cannot be met.`,
      gapStartMile: gapStartMiles,
      gapEndMile: gapEndMiles,
      gapMiles,
      maxLegMiles,
      suggestions,
    };
  }
  if (result.code === "MAX_STOPS_EXCEEDED") {
    return {
      code: "MAX_STOPS_EXCEEDED",
      message: `This lane needs at least ${result.detail.minStopsRequired} stop(s), more than the ${result.detail.maxStops} allowed.`,
      maxLegMiles,
      suggestions: [],
    };
  }
  if (result.code === "FUEL_INFEASIBLE") {
    return {
      code: "FUEL_INFEASIBLE",
      message: `Starting with ${result.detail.startGallons} gal cannot satisfy the ${result.detail.reserveGallons} gal reserve and ${result.detail.minArrivalGallons} gal arrival minimum on this lane.`,
      maxLegMiles,
      suggestions: [],
    };
  }
  return {
    code: "NO_STABLE_PLAN",
    message: `No stop selection remained valid after ${result.detail.iterations} route measurement(s) (§15.5).`,
    maxLegMiles,
    suggestions: [],
  };
}

/**
 * §19 step 12: geocode → baseline route → corridor → stratified top-K →
 * detour estimate → optimise (with relaxation) → validation loop → measured
 * detours → totals → persist — synchronous, one request, per §6 decision 19.
 *
 * A technical failure (provider timeout, budget guard, an unhandled
 * exception, or any `PlanServiceError` thrown before the persist step)
 * propagates and persists nothing. Only a DP-produced `infeasible` result
 * is a persisted non-success (§12.2).
 */
export async function createPlan(request: CreatePlanRequest, deps: PlanServiceDeps, createdBy: string | null = null): Promise<PlanResponse> {
  const startedAt = Date.now();
  const { pool, routingProvider, geocoder, now } = deps;

  const profile = await requireTruckForPlan(pool, request.truckId);

  const priceAsOf = request.priceEffectiveOn ?? (await resolveLatestPriceDate(pool));
  if (!priceAsOf) {
    throw new PlanServiceError("NO_PRICE_SHEET", "no BVD price sheet has been ingested yet");
  }

  const strategyId = request.optimizerStrategy ?? DEFAULT_OPTIMIZER_ID;
  if (!isOptimizerId(strategyId)) {
    throw new PlanServiceError("UNKNOWN_OPTIMIZER_STRATEGY", `unknown optimizer strategy "${strategyId}"`);
  }
  const strategy = OPTIMIZERS[strategyId];

  const origin = await resolveLocation(request.origin, "origin", { pool, geocoder, now });
  const destination = await resolveLocation(request.destination, "destination", { pool, geocoder, now });

  const defaults = resolvePlanDefaults(request, profile);
  const departAt = request.departAt ? new Date(request.departAt) : undefined;

  const baselineRoute = await routingProvider.route({
    origin: origin.location,
    destination: destination.location,
    truckSpec: profile.truckSpec,
    ...(departAt ? { departAt } : {}),
  });

  const baseRouteId = await upsertRoute(pool, {
    provider: routingProvider.name,
    origin: origin.location,
    destination: destination.location,
    via: [],
    truckSpec: profile.truckSpec,
    truckId: request.truckId,
    route: baselineRoute,
  });
  const baseGeometry = await loadRouteGeometry(pool, baseRouteId);

  const outerRadiusMiles = defaults.corridorMiles + CITY_TIER_MAX_UNCERTAINTY_MILES;
  const corridorResult = await findCorridor(pool, {
    routeId: baseRouteId,
    radiusMiles: outerRadiusMiles,
    priceBasis: request.priceBasis,
    validOn: priceAsOf,
  });
  const inCorridor = corridorResult.candidates.filter((c) => withinCorridor(c, defaults.corridorMiles));
  const stationsScanned = inCorridor.length;
  const baselineCostUsd = estimateBaselineCostUsd(corridorResult.routeDistanceMiles, profile.avgMpg, inCorridor);

  const { kept: withinEstimateCap } = filterByEstimate(inCorridor, request.maxDetourMiles);
  const shortlist = stratifiedTopK(withinEstimateCap);

  const bracketCandidates: BracketCandidate[] = shortlist.map((c) => ({
    id: c.id,
    lat: c.lat,
    lng: c.lng,
    offsetAlongRouteMiles: c.offsetAlongRouteMiles,
    perpOffsetMiles: c.perpOffsetMiles,
  }));
  const subjects = await buildDetourSubjects(pool, { routeId: baseRouteId, routeDistanceMiles: corridorResult.routeDistanceMiles }, bracketCandidates);

  const measureResult = await measureDetours({
    provider: routingProvider,
    truckSpec: profile.truckSpec,
    subjects,
    routeDistanceMiles: corridorResult.routeDistanceMiles,
    routeDurationSeconds: baselineRoute.durationSeconds,
  });

  // §15.1's second stage: `filterByEstimate` above already screened on the
  // cheap pre-matrix estimate; now that the real, routed detour is known,
  // the same cap is checked again against it. The estimate never
  // substitutes for this — a station can pass the estimate and still be
  // dropped here.
  const measuredMap = new Map<string, { measuredDetourMiles: number; detourHours: number }>();
  for (const m of measureResult.measurements) {
    if (request.maxDetourMiles !== null && m.measuredDetourMiles > request.maxDetourMiles) {
      continue;
    }
    measuredMap.set(m.id, { measuredDetourMiles: m.measuredDetourMiles, detourHours: m.detourHours });
  }

  const optimizerLane = toOptimizerLane({ routeDistanceMiles: corridorResult.routeDistanceMiles, candidates: shortlist }, measuredMap);
  const lane: OptimizerInput = {
    totalDistanceMiles: optimizerLane.totalDistanceMiles,
    candidates: optimizerLane.candidates,
    fuel: {
      tankGallons: profile.tankGallons,
      avgMpg: profile.avgMpg,
      reserveFraction: profile.reserveFraction,
      maxLegMiles: defaults.maxLegMiles,
      minLegMiles: defaults.minLegMiles,
      startGallons: defaults.startFuelGallons,
      minArrivalGallons: defaults.minArrivalGallons,
      // A truck cannot arrive beyond its own range; v1 has no request field
      // that would ever make this false.
      requireArrivalWithinMaxLeg: true,
    },
    cost: {
      costPerMile: profile.costPerMileUsd,
      driverCostPerHour: request.driverCostPerHour,
      fixedStopMinutes: request.fixedStopMinutes,
    },
    maxStops: request.maxStops,
  };

  const locations = new Map<string, LatLng>(shortlist.map((c) => [c.id, { lat: c.lat, lng: c.lng }]));
  const stationById = new Map(shortlist.map((c) => [c.id, c]));

  const loopResult = await runValidationLoop({
    provider: routingProvider,
    strategy,
    lane,
    locations,
    origin: origin.location,
    destination: destination.location,
    truckSpec: profile.truckSpec,
    baselineDurationSeconds: baselineRoute.durationSeconds,
    ...(departAt ? { departAt } : {}),
  });

  const originResolved: ResolvedLocation = { label: origin.label, location: origin.location };
  const destinationResolved: ResolvedLocation = { label: destination.label, location: destination.location };

  if (loopResult.kind === "infeasible") {
    const reason = buildInfeasibleReason(loopResult, defaults.maxLegMiles, request.maxDetourMiles);
    const solveMs = Date.now() - startedAt;
    const planId = await persistInfeasiblePlan(pool, {
      createdAt: now,
      createdBy,
      baseRouteId,
      truckId: request.truckId,
      originLabel: origin.label,
      destinationLabel: destination.label,
      optimizerStrategy: strategy.id,
      priceBasis: request.priceBasis,
      startFuelGallons: defaults.startFuelGallons,
      minArrivalGallons: defaults.minArrivalGallons,
      maxLegMiles: defaults.maxLegMiles,
      minLegMiles: defaults.minLegMiles,
      corridorMiles: defaults.corridorMiles,
      maxDetourMiles: request.maxDetourMiles,
      driverCostPerHour: request.driverCostPerHour,
      fixedStopMinutes: request.fixedStopMinutes,
      maxStops: request.maxStops,
      baselineCostUsd,
      priceAsOf,
      solveMs,
      reason,
    });

    const response: InfeasiblePlanResponse = {
      planId,
      createdAt: now.toISOString(),
      units: "imperial",
      origin: originResolved,
      destination: destinationResolved,
      truckId: request.truckId,
      candidateStations: inCorridor.map(toCandidateStation),
      status: "infeasible",
      reason,
    };
    return response;
  }

  const measuredById = new Map(measureResult.measurements.map((m) => [m.id, m]));
  const validatedPlan = loopResult.plan;

  const stops: PlanStop[] = validatedPlan.stops.map((stop, i) => {
    const candidate = stationById.get(stop.candidateId)!;
    const measured = measuredById.get(stop.candidateId)!;
    return {
      seq: i + 1,
      stopType: "fuel",
      station: toStationSummary(candidate),
      legDistanceMiles: stop.legMiles,
      detourMiles: measured.measuredDetourMiles,
      detourSeconds: Math.round(measured.detourHours * 3600),
      unitPriceUsd: stop.unitPriceUsd,
      arrivalGallons: stop.arrivalGallons,
      purchaseGallons: stop.purchaseGallons,
      departureGallons: stop.departureGallons,
      stopCostUsd: stop.fuelCostUsd,
      cumulativeDistanceMiles: stop.positionMiles,
      cumulativeDurationSeconds: stop.cumulativeDurationSeconds,
      arrivalFuelPercent: (stop.arrivalGallons / profile.tankGallons) * 100,
    };
  });

  const googleMapsUrl = buildGoogleMapsUrl(
    origin.location,
    destination.location,
    stops.map((s) => s.station.location),
  );
  const disclaimers = buildDisclaimers({
    stops,
    priceAsOf,
    minLegRelaxed: loopResult.minLegRelaxed,
    ...(loopResult.minLegRelaxed ? { shortLegs: loopResult.shortLegs } : {}),
  });

  // A plan with no stops has no route to validate — realLane.ts documented
  // this as "it is the direct route, already measured" — so its optimized
  // route IS the baseline route, not a null reference to "nothing computed".
  const optimizedRouteId = loopResult.route
    ? await upsertRoute(pool, {
        provider: routingProvider.name,
        origin: origin.location,
        destination: destination.location,
        via: validatedPlan.stops.map((s) => locations.get(s.candidateId)!),
        truckSpec: profile.truckSpec,
        truckId: request.truckId,
        route: loopResult.route,
      })
    : baseRouteId;
  const optimizedGeometry: RouteGeometryRow = loopResult.route ? await loadRouteGeometry(pool, optimizedRouteId) : baseGeometry;

  const solveMs = Date.now() - startedAt;

  // T-55: the provider (and so the validated plan) reports fractional
  // seconds; `plans.total_duration_s` is `integer`. Round once, here, and
  // use this single value for both the persisted row and the response's
  // driveSeconds/totalSeconds/addedDurationSeconds, so a re-fetch can never
  // disagree with what POST returned for the same plan.
  const totalDurationS = Math.round(validatedPlan.totalDurationSeconds);

  const planId = await persistCompletedPlan(pool, {
    createdAt: now,
    createdBy,
    baseRouteId,
    optimizedRouteId,
    truckId: request.truckId,
    originLabel: origin.label,
    destinationLabel: destination.label,
    optimizerStrategy: strategy.id,
    priceBasis: request.priceBasis,
    startFuelGallons: defaults.startFuelGallons,
    minArrivalGallons: defaults.minArrivalGallons,
    maxLegMiles: defaults.maxLegMiles,
    minLegMiles: defaults.minLegMiles,
    minLegRelaxed: loopResult.minLegRelaxed,
    corridorMiles: defaults.corridorMiles,
    maxDetourMiles: request.maxDetourMiles,
    driverCostPerHour: request.driverCostPerHour,
    fixedStopMinutes: request.fixedStopMinutes,
    maxStops: request.maxStops,
    totalFuelCostUsd: validatedPlan.totalFuelCostUsd,
    totalGallons: validatedPlan.totalGallons,
    totalDistanceMiles: validatedPlan.totalDistanceMiles,
    totalDurationS,
    baselineCostUsd,
    priceAsOf,
    solveMs,
    googleMapsUrl,
    disclaimers,
    stops: validatedPlan.stops.map((stop, i) => {
      const candidate = stationById.get(stop.candidateId)!;
      const measured = measuredById.get(stop.candidateId)!;
      return {
        seq: i + 1,
        stopType: "fuel" as const,
        stationId: candidate.id,
        stationPriceId: candidate.priceId,
        offsetAlongRouteMiles: stop.positionMiles,
        legDistanceMiles: stop.legMiles,
        detourDistanceMiles: measured.measuredDetourMiles,
        detourDurationS: measured.detourHours * 3600,
        arrivalGallons: stop.arrivalGallons,
        purchaseGallons: stop.purchaseGallons,
        departureGallons: stop.departureGallons,
        unitPriceUsd: stop.unitPriceUsd,
        stopCostUsd: stop.fuelCostUsd,
        cumDistanceMiles: stop.positionMiles,
        cumDurationS: stop.cumulativeDurationSeconds,
      };
    }),
  });

  const selectedIds = new Set(validatedPlan.stops.map((s) => s.candidateId));
  const baseline: RouteSummary = {
    polyline: baseGeometry.polyline,
    distanceMiles: Number(baseGeometry.distance_miles),
    driveSeconds: baseGeometry.duration_s,
    estimatedFuelCostUsd: baselineCostUsd,
    bounds: boundsFromRow(baseGeometry),
  };
  // T-18: the same per-stop time assumption the optimiser already priced
  // via fixedStopCost (optimizer/model.ts), expressed as time instead of
  // dollars, and the detour cost at the same per-mile rate the optimiser
  // costed detours against.
  const dwellSeconds = stops.length * request.fixedStopMinutes * 60;
  const detourCostUsd = stops.reduce((sum, s) => sum + s.detourMiles, 0) * profile.costPerMileUsd;
  const optimized: OptimizedRouteSummary = {
    polyline: optimizedGeometry.polyline,
    distanceMiles: validatedPlan.totalDistanceMiles,
    driveSeconds: totalDurationS,
    dwellSeconds,
    totalSeconds: totalDurationS + dwellSeconds,
    bounds: boundsFromRow(optimizedGeometry),
    totalFuelCostUsd: validatedPlan.totalFuelCostUsd,
    totalGallons: validatedPlan.totalGallons,
    savingsVsBaselineUsd: baselineCostUsd - validatedPlan.totalFuelCostUsd,
    addedDistanceMiles: validatedPlan.totalDistanceMiles - baseline.distanceMiles,
    addedDurationSeconds: totalDurationS - baseline.driveSeconds,
    detourCostUsd,
    costPerMile: profile.costPerMileUsd,
  };

  const response: CompletedPlanResponse = {
    planId,
    createdAt: now.toISOString(),
    origin: originResolved,
    destination: destinationResolved,
    truckId: request.truckId,
    candidateStations: inCorridor.filter((c) => !selectedIds.has(c.id)).map(toCandidateStation),
    status: "completed",
    units: "imperial",
    priceAsOf,
    optimizerStrategy: strategy.id,
    solveMs,
    stationsScanned,
    truck: { unitNumber: profile.unitNumber, maxLegMiles: profile.maxLegMiles },
    baseline,
    optimized,
    stops,
    googleMapsUrl,
    disclaimers,
    attribution: { routing: ORS_ROUTING_ATTRIBUTION, placeData: OSM_PLACE_DATA_ATTRIBUTION },
    // A plan just created by this request can never have been dispatched yet
    // (T-19) — dispatched_at is unset until a later PATCH /plans/{id}.
    sentToDriver: false,
    sentToDriverAt: null,
  };
  return response;
}

/**
 * Re-fetches a persisted plan (§14): a shared link, browsing history — never
 * a poll on one still computing (`plans.status` has no in-progress state).
 * `stationsScanned`/`candidateStations` are **not** stored; they are
 * re-derived by re-running the corridor query against the plan's own
 * persisted `base_route_id`/`corridor_miles`/`price_as_of` (all permanent —
 * §17 — so the result is deterministic across time, the same way `plans`
 * and `plan_stops` are the permanent record while `routes` is a cache).
 * `solveMs` cannot be re-derived this way — a re-fetch's own latency is not
 * the original solve's — so it alone is a stored column.
 *
 * Returns `null` for an unknown id; the caller (step 16.3) maps that to 404.
 */
export async function getPlan(pool: Pool, planId: string): Promise<PlanResponse | null> {
  const row = await loadPlanRow(pool, planId);
  if (!row) {
    return null;
  }

  const profile = await requireTruckForPlan(pool, row.truck_id);

  const baseGeometry = await loadRouteGeometry(pool, row.base_route_id);
  const originPoint = await loadRoutePoint(pool, row.base_route_id, "origin");
  const destinationPoint = await loadRoutePoint(pool, row.base_route_id, "destination");
  const origin: ResolvedLocation = { label: row.origin_label, location: originPoint };
  const destination: ResolvedLocation = { label: row.destination_label, location: destinationPoint };

  const corridorMiles = Number(row.corridor_miles);
  const outerRadiusMiles = corridorMiles + CITY_TIER_MAX_UNCERTAINTY_MILES;
  const corridorResult = await findCorridor(pool, {
    routeId: row.base_route_id,
    radiusMiles: outerRadiusMiles,
    priceBasis: row.price_basis,
    validOn: row.price_as_of,
  });
  const inCorridor = corridorResult.candidates.filter((c) => withinCorridor(c, corridorMiles));

  if (row.status === "infeasible") {
    if (!row.infeasible_reason) {
      throw new Error(`plan ${planId} is infeasible but has no stored reason`);
    }
    const response: InfeasiblePlanResponse = {
      planId: row.id,
      createdAt: row.created_at.toISOString(),
      units: "imperial",
      origin,
      destination,
      truckId: row.truck_id,
      candidateStations: inCorridor.map(toCandidateStation),
      status: "infeasible",
      reason: row.infeasible_reason,
    };
    return response;
  }

  const stopRows = await loadPlanStopRows(pool, planId);
  const stops = stopRows.map((r) => planStopFromRow(r, profile.tankGallons));
  const selectedIds = new Set(stopRows.map((r) => r.station_id));

  const optimizedGeometry = row.optimized_route_id ? await loadRouteGeometry(pool, row.optimized_route_id) : baseGeometry;
  const totalFuelCostUsd = Number(row.total_fuel_cost_usd);
  const baselineCostUsd = Number(row.baseline_cost_usd);
  const totalDistanceMiles = Number(row.total_distance_miles);
  const totalDurationS = row.total_duration_s!;
  const baseline: RouteSummary = {
    polyline: baseGeometry.polyline,
    distanceMiles: Number(baseGeometry.distance_miles),
    driveSeconds: baseGeometry.duration_s,
    estimatedFuelCostUsd: baselineCostUsd,
    bounds: boundsFromRow(baseGeometry),
  };
  const dwellSeconds = stops.length * row.fixed_stop_minutes * 60;
  const detourCostUsd = stops.reduce((sum, s) => sum + s.detourMiles, 0) * profile.costPerMileUsd;
  const optimized: OptimizedRouteSummary = {
    polyline: optimizedGeometry.polyline,
    distanceMiles: totalDistanceMiles,
    driveSeconds: totalDurationS,
    dwellSeconds,
    totalSeconds: totalDurationS + dwellSeconds,
    bounds: boundsFromRow(optimizedGeometry),
    totalFuelCostUsd,
    totalGallons: Number(row.total_gallons),
    savingsVsBaselineUsd: baselineCostUsd - totalFuelCostUsd,
    addedDistanceMiles: totalDistanceMiles - baseline.distanceMiles,
    addedDurationSeconds: totalDurationS - baseline.driveSeconds,
    detourCostUsd,
    costPerMile: profile.costPerMileUsd,
  };

  const response: CompletedPlanResponse = {
    planId: row.id,
    createdAt: row.created_at.toISOString(),
    origin,
    destination,
    truckId: row.truck_id,
    candidateStations: inCorridor.filter((c) => !selectedIds.has(c.id)).map(toCandidateStation),
    status: "completed",
    units: "imperial",
    priceAsOf: row.price_as_of,
    optimizerStrategy: row.optimizer_strategy,
    solveMs: row.solve_ms,
    stationsScanned: inCorridor.length,
    truck: { unitNumber: profile.unitNumber, maxLegMiles: profile.maxLegMiles },
    baseline,
    optimized,
    stops,
    googleMapsUrl: row.google_maps_url ?? "",
    disclaimers: row.disclaimers,
    attribution: { routing: ORS_ROUTING_ATTRIBUTION, placeData: OSM_PLACE_DATA_ATTRIBUTION },
    sentToDriver: row.dispatched_at !== null,
    sentToDriverAt: row.dispatched_at ? row.dispatched_at.toISOString() : null,
  };
  return response;
}

// Re-exported so a caller resolving "no corridorMiles given" never has to
// import two modules for one constant.
export { DEFAULT_CORRIDOR_MILES };
