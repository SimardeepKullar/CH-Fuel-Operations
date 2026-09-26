import { createHash } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompletedPlanResponse, CreatePlanRequest, InfeasiblePlanResponse } from "../../src/domain/planResponse.js";
import type { GeocodeQuery, GeocodeResult, GeocodingProvider } from "../../src/routing/geocodeProvider.js";
import { RoutingProviderError, type MatrixRequest, type MatrixResult, type RouteRequest, type RouteResult, type RoutingProvider } from "../../src/routing/provider.js";
import { createPlan, getPlan, PlanServiceError } from "../../src/planning/planService.js";
import { scopedSchema, teardown } from "./support/actualsFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * A minimal precision-5 encoded-polyline writer (the standard Google
 * algorithm ORS also emits, per `RouteResult.polyline`'s contract). It
 * exists only so the fake `RoutingProvider` below hands `upsertRoute` a
 * real, decodable geometry — `ST_LineFromEncodedPolyline` has to have
 * something valid to decode, the same way a live ORS response would.
 */
function encodePolyline(points: ReadonlyArray<[lat: number, lng: number]>): string {
  const factor = 1e5;
  let output = "";
  let prevLat = 0;
  let prevLng = 0;
  const encodeValue = (value: number): string => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let out = "";
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
    return out;
  };
  for (const [lat, lng] of points) {
    const lat5 = Math.round(lat * factor);
    const lng5 = Math.round(lng * factor);
    output += encodeValue(lat5 - prevLat);
    output += encodeValue(lng5 - prevLng);
    prevLat = lat5;
    prevLng = lng5;
  }
  return output;
}

/** A due-north meridian, same trick `corridor.test.ts` uses: lng stays constant, so a station's
 * offset is exact degrees-of-latitude arithmetic, no geodesic bow to reason around. */
const ROUTE_LNG = -97;
const ORIGIN = { lat: 30, lng: ROUTE_LNG };
const DESTINATION = { lat: 40, lng: ROUTE_LNG };
const BASELINE_POLYLINE = encodePolyline([
  [ORIGIN.lat, ORIGIN.lng],
  [DESTINATION.lat, DESTINATION.lng],
]);

/** TRUCK, `backend/test/support/optimizer.ts`: 150 gal, 5 mpg, reserve/arrival minimum 30 gal, cap 500, floor 300. */
const TANK_GALLONS = 150;
const AVG_MPG = 5;
const RESERVE_FRACTION = 0.2;

const geocoderNeverCalled: GeocodingProvider = {
  name: "ors",
  async geocode(_query: GeocodeQuery): Promise<GeocodeResult> {
    throw new Error("geocoder must not be called for {lat,lng} input");
  },
};

interface FakeProviderConfig {
  /** `via.length === 0` (the baseline call). */
  baseline: { distanceMiles: number; durationSeconds: number };
  /** `via.length === 1` (the validation loop's routed call), in leg order. */
  routedLegs?: Array<{ distanceMiles: number; durationSeconds: number }>;
  /** In call order: `measureDetours` calls inbound then outbound, one pair per block. */
  matrixResponses?: Array<{ distanceMiles: number; durationSeconds: number }>;
  /** Throws instead of ever answering — the "technical failure" scenario. */
  failBaselineWith?: Error;
}

function createFakeProvider(config: FakeProviderConfig) {
  const routeCalls: RouteRequest[] = [];
  const matrixCalls: MatrixRequest[] = [];
  let matrixCallIndex = 0;

  const provider: RoutingProvider = {
    name: "ors",
    async route(req: RouteRequest): Promise<RouteResult> {
      routeCalls.push(req);
      if ((req.via?.length ?? 0) === 0) {
        if (config.failBaselineWith) {
          throw config.failBaselineWith;
        }
        return {
          polyline: BASELINE_POLYLINE,
          distanceMiles: config.baseline.distanceMiles,
          durationSeconds: config.baseline.durationSeconds,
          legs: [{ distanceMiles: config.baseline.distanceMiles, durationSeconds: config.baseline.durationSeconds }],
          providerRaw: {},
        };
      }
      const legs = config.routedLegs ?? [];
      return {
        polyline: BASELINE_POLYLINE,
        distanceMiles: legs.reduce((sum, l) => sum + l.distanceMiles, 0),
        durationSeconds: legs.reduce((sum, l) => sum + l.durationSeconds, 0),
        legs,
        providerRaw: {},
      };
    },
    async matrix(req: MatrixRequest): Promise<MatrixResult> {
      matrixCalls.push(req);
      const response = (config.matrixResponses ?? [])[matrixCallIndex++];
      if (!response) {
        throw new Error(`no fake matrix response configured for call ${matrixCallIndex}`);
      }
      return {
        distanceMiles: [[response.distanceMiles]],
        durationSeconds: [[response.durationSeconds]],
      };
    },
  };

  return { provider, routeCalls, matrixCalls };
}

describe.skipIf(!hasDatabase)("planService (integration, T-16)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let truckId: string;
  let priceImportId: string;
  const PRICE_DATE = "2026-09-08";

  async function insertStation(spec: { ref: string; lat: number; lngDelta?: number; truckAccessible?: string }): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO stations
         (supplier, site_ref, name_raw, store_number, city_raw, city_normalized, state_usps,
          geom, resolution, uncertainty_miles, truck_accessible)
       VALUES ('BVD', $1, $2, $3, 'Testville', 'TESTVILLE', 'TX',
               ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 'exact', 0, $6)
       RETURNING id`,
      [
        spec.ref,
        `LOVES #${spec.ref}`,
        Number(spec.ref.replace(/\D/g, "")) || null,
        ROUTE_LNG + (spec.lngDelta ?? 0),
        spec.lat,
        spec.truckAccessible ?? "operator_verified",
      ],
    );
    return rows[0]!.id;
  }

  async function insertPrice(stationId: string, yourPriceUsd: number): Promise<void> {
    await pool.query(
      `INSERT INTO station_prices (station_id, import_id, raw_product, product_type, cost, your_price, valid_on)
       VALUES ($1, $2, 'ULSD', 'highway_diesel', $3, $3, $4::date)`,
      [stationId, priceImportId, yourPriceUsd, PRICE_DATE],
    );
  }

  function baseRequest(overrides: Partial<CreatePlanRequest> = {}): CreatePlanRequest {
    return {
      origin: ORIGIN,
      destination: DESTINATION,
      truckId,
      startFuelGallons: null,
      minArrivalGallons: null,
      maxLegMiles: null,
      minLegMiles: null,
      corridorMiles: null,
      maxDetourMiles: null,
      maxStops: null,
      priceBasis: "pump",
      driverCostPerHour: 0,
      fixedStopMinutes: 20,
      priceEffectiveOn: PRICE_DATE,
      departAt: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("plan_service"));

    // scopedSchema runs every migration, including 0005's 27-unit roster
    // seed — a fresh unit_number here avoids colliding with it. T-56: one
    // merged trucks row carries both identity and spec — no separate
    // truck_profiles row any more.
    const { rows: truckRows } = await pool.query<{ id: string }>(
      `INSERT INTO trucks (unit_number, tank_gallons, avg_mpg, reserve_fraction, max_leg_miles, min_leg_miles, cost_per_mile_usd, fixed_stop_minutes)
       VALUES ('T-TEST', $1, $2, $3, 500, 300, 0, 20)
       RETURNING id`,
      [TANK_GALLONS, AVG_MPG, RESERVE_FRACTION],
    );
    truckId = truckRows[0]!.id;

    const { rows: importRows } = await pool.query<{ id: string }>(
      `INSERT INTO price_imports (supplier, source_filename, file_sha256, effective_date, status)
       VALUES ('BVD', 'plan-service-test.csv', $1, $2::date, 'completed') RETURNING id`,
      [createHash("sha256").update("plan-service-test").digest("hex"), PRICE_DATE],
    );
    priceImportId = importRows[0]!.id;
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  it("plans a real lane: one mandatory stop, reconciled totals, telemetry recorded", async () => {
    const stationId = await insertStation({ ref: "200", lat: 35 });
    await insertPrice(stationId, 5.0);

    const { provider } = createFakeProvider({
      baseline: { distanceMiles: 700, durationSeconds: 42000 },
      routedLegs: [
        { distanceMiles: 350, durationSeconds: 21000 },
        { distanceMiles: 350, durationSeconds: 21000 },
      ],
      // inbound (before -> station), then outbound (station -> after): 10 mi each,
      // against a 20-mile bracket arc, for an exactly-zero measured detour.
      matrixResponses: [
        { distanceMiles: 10, durationSeconds: 600 },
        { distanceMiles: 10, durationSeconds: 600 },
      ],
    });

    const response = await createPlan(baseRequest(), { pool, routingProvider: provider, geocoder: geocoderNeverCalled, now: new Date("2026-09-22T12:00:00Z") });

    expect(response.status).toBe("completed");
    const plan = response as CompletedPlanResponse;

    // (1) a real lane produces a plan with stops, totals, priceAsOf and a baseline comparison.
    expect(plan.stops).toHaveLength(1);
    expect(plan.priceAsOf).toBe(PRICE_DATE);
    expect(plan.baseline.estimatedFuelCostUsd).toBeGreaterThan(0);

    // (2) totals reconcile.
    const sumStopCost = plan.stops.reduce((sum, s) => sum + s.stopCostUsd, 0);
    const sumPurchaseGallons = plan.stops.reduce((sum, s) => sum + s.purchaseGallons, 0);
    expect(sumStopCost).toBeCloseTo(plan.optimized.totalFuelCostUsd, 6);
    expect(sumPurchaseGallons).toBeCloseTo(plan.optimized.totalGallons, 6);
    expect(plan.optimized.totalFuelCostUsd).toBeCloseTo(100, 6); // 20 gal x $5.00
    expect(plan.optimized.totalGallons).toBeCloseTo(20, 6);

    // (3) every leg is <= max_leg_miles against measured distances.
    expect(plan.stops[0]!.legDistanceMiles).toBeLessThanOrEqual(500);
    expect(plan.optimized.distanceMiles - plan.stops[0]!.cumulativeDistanceMiles).toBeLessThanOrEqual(500);

    // (4) tank level never exceeds capacity nor drops below reserve at any stop.
    expect(plan.stops[0]!.arrivalGallons).toBeGreaterThanOrEqual(30);
    expect(plan.stops[0]!.departureGallons).toBeLessThanOrEqual(150);
    expect(plan.stops[0]!.arrivalGallons).toBeCloseTo(80, 6);
    expect(plan.stops[0]!.departureGallons).toBeCloseTo(100, 6);

    // detourMiles is the measured figure (0 here), never left as the pre-matrix estimate.
    expect(plan.stops[0]!.detourMiles).toBeCloseTo(0, 6);
    expect(plan.candidateStations).toEqual([]); // the only in-corridor station was selected.

    // (7) solveMs and stationsScanned are recorded.
    expect(plan.solveMs).toBeGreaterThanOrEqual(0);
    expect(plan.stationsScanned).toBe(1);
    expect(plan.attribution.routing).toContain("openrouteservice");
    expect(plan.attribution.placeData).toContain("OpenStreetMap");

    // (8) T-17: the driver link carries origin, destination and the one stop, in order.
    const mapsUrl = new URL(plan.googleMapsUrl);
    expect(mapsUrl.searchParams.get("origin")).toBe(`${ORIGIN.lat},${ORIGIN.lng}`);
    expect(mapsUrl.searchParams.get("destination")).toBe(`${DESTINATION.lat},${DESTINATION.lng}`);
    expect(mapsUrl.searchParams.get("waypoints")).toBe(`${plan.stops[0]!.station.location.lat},${plan.stops[0]!.station.location.lng}`);

    // (9) T-17: the always-on disclaimers, and nothing else — the one stop is
    // operator-verified and the plan needed no relaxation.
    expect(plan.disclaimers).toEqual([
      {
        code: "GOOGLE_LINK_NOT_TRUCK_LEGAL",
        message: "The Google Maps link routes between the correct stops but does not check truck restrictions.",
      },
      { code: "PRICE_STALENESS", message: `Prices reflect the BVD sheet effective ${PRICE_DATE}.` },
    ]);

    // GET /plans/{id} returns an identical body.
    const refetched = await getPlan(pool, plan.planId);
    expect(refetched).toEqual(response);
  });

  it("T-55: a provider returning fractional seconds (a real ORS response) still persists, with whole-second durations that POST and GET agree on", async () => {
    const stationId = await insertStation({ ref: "200", lat: 35 });
    await insertPrice(stationId, 5.0);

    // Real-shaped fractional durations, including the exact figure that
    // 500'd on a live lane (§ T-55): 42000 + 25817.7 = 67817.7.
    const { provider } = createFakeProvider({
      baseline: { distanceMiles: 700, durationSeconds: 42000.3 },
      routedLegs: [
        { distanceMiles: 350, durationSeconds: 42000 },
        { distanceMiles: 350, durationSeconds: 25817.7 },
      ],
      matrixResponses: [
        { distanceMiles: 10, durationSeconds: 600.6 },
        { distanceMiles: 10, durationSeconds: 600.6 },
      ],
    });

    const response = await createPlan(baseRequest(), {
      pool,
      routingProvider: provider,
      geocoder: geocoderNeverCalled,
      now: new Date("2026-09-22T12:00:00Z"),
    });

    // This is the 500: a fractional total_duration_s was rejected by Postgres
    // before this fix, and no plans row existed.
    expect(response.status).toBe("completed");
    const plan = response as CompletedPlanResponse;
    const { rows } = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM plans");
    expect(rows[0]!.count).toBe("1");

    // Every duration the response carries is a whole number.
    expect(Number.isInteger(plan.optimized.driveSeconds)).toBe(true);
    expect(Number.isInteger(plan.optimized.totalSeconds)).toBe(true);
    expect(Number.isInteger(plan.optimized.addedDurationSeconds)).toBe(true);
    expect(plan.optimized.driveSeconds).toBe(Math.round(42000 + 25817.7));

    // A re-fetch returns the same whole-second figures POST did — never a
    // second, differently-rounded value for the same plan.
    const refetched = (await getPlan(pool, plan.planId)) as CompletedPlanResponse;
    expect(refetched.optimized.driveSeconds).toBe(plan.optimized.driveSeconds);
    expect(refetched.optimized.totalSeconds).toBe(plan.optimized.totalSeconds);
    expect(refetched.optimized.addedDurationSeconds).toBe(plan.optimized.addedDurationSeconds);
  });

  it("T-17: carries ACCESSIBILITY_UNVERIFIED, naming the stop, when the selected station is not operator-verified", async () => {
    const stationId = await insertStation({ ref: "306", lat: 35, truckAccessible: "unverified" });
    await insertPrice(stationId, 5.0);

    const { provider } = createFakeProvider({
      baseline: { distanceMiles: 700, durationSeconds: 42000 },
      routedLegs: [
        { distanceMiles: 350, durationSeconds: 21000 },
        { distanceMiles: 350, durationSeconds: 21000 },
      ],
      matrixResponses: [
        { distanceMiles: 10, durationSeconds: 600 },
        { distanceMiles: 10, durationSeconds: 600 },
      ],
    });

    const response = await createPlan(baseRequest(), { pool, routingProvider: provider, geocoder: geocoderNeverCalled, now: new Date("2026-09-22T12:00:00Z") });
    expect(response.status).toBe("completed");
    const plan = response as CompletedPlanResponse;

    expect(plan.stops[0]!.station.truckAccessible).toBe("unverified");
    expect(plan.disclaimers).toContainEqual({
      code: "ACCESSIBILITY_UNVERIFIED",
      message: "Truck accessibility is unverified for: LOVES #306.",
    });

    const refetched = await getPlan(pool, plan.planId);
    expect(refetched).toEqual(response);
  });

  it("persists an infeasible lane with a structured reason and still returns candidates", async () => {
    // ~5.7 mi east of the meridian (corridor.test.ts's own figure for 0.1 degrees
    // at these latitudes): inside a generous corridor, but its *estimated* detour
    // is well over a maxDetourMiles: 0 cap, so it is screened out before any
    // matrix call, leaving zero usable candidates for a 700-mile, 500-mile-cap lane.
    const stationId = await insertStation({ ref: "201", lat: 35, lngDelta: 0.1 });
    await insertPrice(stationId, 5.0);

    const { provider, matrixCalls } = createFakeProvider({ baseline: { distanceMiles: 700, durationSeconds: 42000 } });

    const response = await createPlan(baseRequest({ maxDetourMiles: 0 }), {
      pool,
      routingProvider: provider,
      geocoder: geocoderNeverCalled,
      now: new Date("2026-09-22T12:00:00Z"),
    });

    expect(response.status).toBe("infeasible");
    const infeasible = response as InfeasiblePlanResponse;
    expect(infeasible.reason.code).toBe("LEG_GAP");
    expect(infeasible.reason.maxLegMiles).toBe(500);
    expect(infeasible.reason.suggestions.length).toBeGreaterThan(0);

    // Still returned: the corridor screening (corridorMiles) and the detour cap
    // (maxDetourMiles) are different stages — the station was considered, then
    // rejected, and the dispatcher can still see it.
    expect(infeasible.candidateStations).toHaveLength(1);
    expect(infeasible.candidateStations[0]!.id).toBe(stationId);

    // The estimate cap rejected it before any matrix call was spent.
    expect(matrixCalls).toHaveLength(0);

    const refetched = await getPlan(pool, infeasible.planId);
    expect(refetched).toEqual(response);

    const { rows } = await pool.query<{ status: string }>("SELECT status FROM plans WHERE id = $1", [infeasible.planId]);
    expect(rows[0]!.status).toBe("infeasible");
  });

  it("persists nothing on a technical failure (a provider error propagates)", async () => {
    const { provider } = createFakeProvider({
      baseline: { distanceMiles: 700, durationSeconds: 42000 },
      failBaselineWith: new RoutingProviderError("ors", 503, undefined, "simulated provider outage"),
    });

    await expect(
      createPlan(baseRequest(), { pool, routingProvider: provider, geocoder: geocoderNeverCalled, now: new Date() }),
    ).rejects.toThrow(RoutingProviderError);

    const { rows } = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM plans");
    expect(rows[0]!.count).toBe("0");
  });

  it("rejects an unknown truck id before touching the provider or the database's plans table (T-38/T-56)", async () => {
    const { provider, routeCalls } = createFakeProvider({ baseline: { distanceMiles: 700, durationSeconds: 42000 } });

    const failure = createPlan(baseRequest({ truckId: "00000000-0000-0000-0000-000000000000" }), {
      pool,
      routingProvider: provider,
      geocoder: geocoderNeverCalled,
      now: new Date(),
    });
    await expect(failure).rejects.toThrow(PlanServiceError);
    await expect(failure).rejects.toMatchObject({ code: "TRUCK_NOT_FOUND" });
    expect(routeCalls).toHaveLength(0);
  });

  it("rejects a truck with an incomplete mpg/tank spec, naming the truck and the missing fields (T-56)", async () => {
    const { rows: bareTruckRows } = await pool.query<{ id: string }>(
      `INSERT INTO trucks (unit_number) VALUES ('T-BARE') RETURNING id`,
    );
    const bareTruckId = bareTruckRows[0]!.id;
    const { provider, routeCalls } = createFakeProvider({ baseline: { distanceMiles: 700, durationSeconds: 42000 } });

    const failure = createPlan(baseRequest({ truckId: bareTruckId }), {
      pool,
      routingProvider: provider,
      geocoder: geocoderNeverCalled,
      now: new Date(),
    });
    await expect(failure).rejects.toThrow(PlanServiceError);
    await expect(failure).rejects.toMatchObject({ code: "TRUCK_SPEC_INCOMPLETE" });
    await expect(failure).rejects.toThrow(/T-BARE/);
    expect(routeCalls).toHaveLength(0);
  });

  it("round-trips a plan's truckId through create and a later getPlan, even on an infeasible plan (T-38)", async () => {
    // No station inserted: a 700-mile lane against the profile's 500-mile
    // cap with zero candidates is a guaranteed, deterministic LEG_GAP —
    // the same shape as the "no usable candidates" test above — so this
    // asserts the round trip without needing any extra provider mocking.
    const { provider } = createFakeProvider({ baseline: { distanceMiles: 700, durationSeconds: 42000 } });

    const created = await createPlan(baseRequest({ truckId }), {
      pool,
      routingProvider: provider,
      geocoder: geocoderNeverCalled,
      now: new Date(),
    });
    expect(created.status).toBe("infeasible");
    expect(created.truckId).toBe(truckId);

    const fetched = await getPlan(pool, created.planId);
    expect(fetched?.truckId).toBe(truckId);
  });

  it("returns null from getPlan for an unknown id", async () => {
    await expect(getPlan(pool, "00000000-0000-0000-0000-000000000000")).resolves.toBeNull();
  });
});
