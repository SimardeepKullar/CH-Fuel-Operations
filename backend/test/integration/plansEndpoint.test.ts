import { createHash } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handlePatchPlan } from "../../src/api/routes/planPatch.js";
import { handleCreatePlan, handleGetPlan, handleListPlans } from "../../src/api/routes/plans.js";
import type { GeocodeQuery, GeocodeResult, GeocodingProvider } from "../../src/routing/geocodeProvider.js";
import type { MatrixRequest, MatrixResult, RouteRequest, RouteResult, RoutingProvider } from "../../src/routing/provider.js";
import { scopedSchema, teardown } from "./support/actualsFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Same trick `planService.test.ts` uses: a real, decodable precision-5 polyline for `ST_LineFromEncodedPolyline`. */
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

const ROUTE_LNG = -97;
const ORIGIN = { lat: 30, lng: ROUTE_LNG };
const DESTINATION = { lat: 40, lng: ROUTE_LNG };
const BASELINE_POLYLINE = encodePolyline([
  [ORIGIN.lat, ORIGIN.lng],
  [DESTINATION.lat, DESTINATION.lng],
]);

const geocoderNeverCalled: GeocodingProvider = {
  name: "ors",
  async geocode(_query: GeocodeQuery): Promise<GeocodeResult> {
    throw new Error("geocoder must not be called for {lat,lng} input");
  },
};

function fakeProvider(): RoutingProvider {
  let matrixCallIndex = 0;
  const matrixResponses = [
    { distanceMiles: 10, durationSeconds: 600 },
    { distanceMiles: 10, durationSeconds: 600 },
  ];
  return {
    name: "ors",
    async route(req: RouteRequest): Promise<RouteResult> {
      if ((req.via?.length ?? 0) === 0) {
        return { polyline: BASELINE_POLYLINE, distanceMiles: 700, durationSeconds: 42000, legs: [{ distanceMiles: 700, durationSeconds: 42000 }], providerRaw: {} };
      }
      const legs = [
        { distanceMiles: 350, durationSeconds: 21000 },
        { distanceMiles: 350, durationSeconds: 21000 },
      ];
      return { polyline: BASELINE_POLYLINE, distanceMiles: 700, durationSeconds: 42000, legs, providerRaw: {} };
    },
    async matrix(_req: MatrixRequest): Promise<MatrixResult> {
      const response = matrixResponses[matrixCallIndex++]!;
      return { distanceMiles: [[response.distanceMiles]], durationSeconds: [[response.durationSeconds]] };
    },
  };
}

/**
 * T-55: a provider shaped like a real ORS response — every duration has a
 * fractional part, including a baseline+legs total that sums to exactly the
 * figure a live lane 500'd on (`42000 + 25817.7 = 67817.7`).
 */
function fakeProviderFractionalDurations(): RoutingProvider {
  let matrixCallIndex = 0;
  const matrixResponses = [
    { distanceMiles: 10, durationSeconds: 600.6 },
    { distanceMiles: 10, durationSeconds: 600.6 },
  ];
  return {
    name: "ors",
    async route(req: RouteRequest): Promise<RouteResult> {
      if ((req.via?.length ?? 0) === 0) {
        return { polyline: BASELINE_POLYLINE, distanceMiles: 700, durationSeconds: 42000.3, legs: [{ distanceMiles: 700, durationSeconds: 42000.3 }], providerRaw: {} };
      }
      const legs = [
        { distanceMiles: 350, durationSeconds: 42000 },
        { distanceMiles: 350, durationSeconds: 25817.7 },
      ];
      return { polyline: BASELINE_POLYLINE, distanceMiles: 700, durationSeconds: 67817.7, legs, providerRaw: {} };
    },
    async matrix(_req: MatrixRequest): Promise<MatrixResult> {
      const response = matrixResponses[matrixCallIndex++]!;
      return { distanceMiles: [[response.distanceMiles]], durationSeconds: [[response.durationSeconds]] };
    },
  };
}

describe.skipIf(!hasDatabase)("POST /plans, GET /plans/{id} (integration, T-16 step 16.3)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let truckId: string;
  let priceImportId: string;
  const PRICE_DATE = "2026-09-08";

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("plans_endpoint"));

    // '998' is not one of the 27 seeded fleet units (0005_fleet_roster_seed.sql).
    const { rows: truckRows } = await pool.query<{ id: string }>(
      `INSERT INTO trucks (unit_number, tank_gallons, avg_mpg, reserve_fraction, max_leg_miles, min_leg_miles, cost_per_mile_usd, fixed_stop_minutes)
       VALUES ('998', 150, 5, 0.2, 500, 300, 0, 20)
       RETURNING id`,
    );
    truckId = truckRows[0]!.id;

    const { rows: importRows } = await pool.query<{ id: string }>(
      `INSERT INTO price_imports (supplier, source_filename, file_sha256, effective_date, status)
       VALUES ('BVD', 'plans-endpoint-test.csv', $1, $2::date, 'completed') RETURNING id`,
      [createHash("sha256").update("plans-endpoint-test").digest("hex"), PRICE_DATE],
    );
    priceImportId = importRows[0]!.id;
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  /** An on-route station (perpOffsetMiles ~= 0): every test that needs a
   * feasible plan inserts it explicitly, so the infeasible-plan test below
   * (which relies on the *only* candidate being screened out) is never
   * accidentally rescued by a station it didn't ask for. */
  async function insertOnRouteStation(): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO stations
         (supplier, site_ref, name_raw, store_number, city_raw, city_normalized, state_usps,
          geom, resolution, uncertainty_miles, truck_accessible)
       VALUES ('BVD', '200', 'LOVES #200', 200, 'Testville', 'TESTVILLE', 'TX',
               ST_SetSRID(ST_MakePoint($1, 35), 4326)::geography, 'exact', 0, 'operator_verified')
       RETURNING id`,
      [ROUTE_LNG],
    );
    await pool.query(
      `INSERT INTO station_prices (station_id, import_id, raw_product, product_type, cost, your_price, valid_on)
       VALUES ($1, $2, 'ULSD', 'highway_diesel', 5.0, 5.0, $3::date)`,
      [rows[0]!.id, priceImportId, PRICE_DATE],
    );
  }

  function validBody(overrides: Record<string, unknown> = {}) {
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

  function post(body: unknown, query = ""): Request {
    return new Request(`http://localhost/api/v1/plans${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const deps = () => ({ routingProvider: fakeProvider(), geocoder: geocoderNeverCalled, now: new Date("2026-09-22T12:00:00Z") });

  it("POST /plans returns 201 with the complete plan body, not a job id", async () => {
    await insertOnRouteStation();
    const request = post(validBody());
    const response = await handleCreatePlan(pool, request, new URL(request.url), deps(), null);

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("completed");
    expect(body.planId).toBeTypeOf("string");
    expect(Array.isArray((body as { stops: unknown[] }).stops)).toBe(true);
    expect((body as { stops: unknown[] }).stops).toHaveLength(1);
    // Resolved origin/destination coordinates are echoed back (UI contract §6.10).
    expect((body as { origin: { location: { lat: number } } }).origin.location.lat).toBe(30);
  });

  it("GET /plans/{id} returns an identical body to what POST returned", async () => {
    await insertOnRouteStation();
    const postResponse = await handleCreatePlan(pool, post(validBody()), new URL("http://localhost/api/v1/plans"), deps(), null);
    const posted = await postResponse.json();
    const planId = (posted as { planId: string }).planId;

    const getResponse = await handleGetPlan(pool, planId, new URL(`http://localhost/api/v1/plans/${planId}`));
    expect(getResponse.status).toBe(200);
    const refetched = await getResponse.json();
    expect(refetched).toEqual(posted);
  });

  it("an infeasible result is 200 with status: infeasible, not a 4xx", async () => {
    // 0.1deg off the meridian (~5.7 mi, corridor.test.ts's own figure): inside a
    // generous corridor, but a maxDetourMiles: 0 cap screens it out entirely.
    await pool.query(
      `INSERT INTO stations (supplier, site_ref, name_raw, store_number, city_raw, city_normalized, state_usps, geom, resolution, uncertainty_miles, truck_accessible)
       VALUES ('BVD', '201', 'LOVES #201', 201, 'Testville', 'TESTVILLE', 'TX', ST_SetSRID(ST_MakePoint($1, 35), 4326)::geography, 'exact', 0, 'operator_verified')`,
      [ROUTE_LNG + 0.1],
    );

    const body = validBody({ maxDetourMiles: 0 });
    const request = post(body);
    const response = await handleCreatePlan(pool, request, new URL(request.url), deps(), null);

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { status: string };
    expect(parsed.status).toBe("infeasible");
  });

  it("?units=metric converts distances and volumes; storage remains miles and gallons", async () => {
    await insertOnRouteStation();
    const imperialResponse = await handleCreatePlan(pool, post(validBody()), new URL("http://localhost/api/v1/plans"), deps(), null);
    const imperial = (await imperialResponse.json()) as { optimized: { distanceMiles: number; totalGallons: number } };

    const metricRequest = post(validBody(), "?units=metric");
    const metricResponse = await handleCreatePlan(pool, metricRequest, new URL(metricRequest.url), deps(), null);
    const metric = (await metricResponse.json()) as { units: string; optimized: { distanceMiles: number; totalGallons: number } };

    expect(metric.units).toBe("metric");
    expect(metric.optimized.distanceMiles).toBeCloseTo(imperial.optimized.distanceMiles * 1.609344, 6);
    expect(metric.optimized.totalGallons).toBeCloseTo(imperial.optimized.totalGallons * 3.785411784, 6);
  });

  it("null for maxStops and maxDetourMiles survives the round trip over real HTTP JSON, not coerced to 0", async () => {
    await insertOnRouteStation();
    const request = post(validBody({ maxStops: null, maxDetourMiles: null }));
    const response = await handleCreatePlan(pool, request, new URL(request.url), deps(), null);
    const body = (await response.json()) as { planId: string };

    const { rows } = await pool.query<{ max_detour_miles: string | null; max_stops: number | null }>(
      "SELECT max_detour_miles, max_stops FROM plans WHERE id = $1",
      [body.planId],
    );
    expect(rows[0]!.max_detour_miles).toBeNull();
    expect(rows[0]!.max_stops).toBeNull();
  });

  it("an unknown plan id returns 404 as application/problem+json", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const response = await handleGetPlan(pool, id, new URL(`http://localhost/api/v1/plans/${id}`));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });

  it("priceEffectiveOn re-prices against a historical sheet and sets priceAsOf accordingly", async () => {
    await insertOnRouteStation();
    const { rows: stationRows } = await pool.query<{ id: string }>("SELECT id FROM stations WHERE site_ref = '200'");
    const stationId = stationRows[0]!.id;

    const OLDER_DATE = "2026-01-15";
    const { rows: olderImportRows } = await pool.query<{ id: string }>(
      `INSERT INTO price_imports (supplier, source_filename, file_sha256, effective_date, status)
       VALUES ('BVD', 'older.csv', $1, $2::date, 'completed') RETURNING id`,
      [createHash("sha256").update("older-sheet").digest("hex"), OLDER_DATE],
    );
    await pool.query(
      `INSERT INTO station_prices (station_id, import_id, raw_product, product_type, cost, your_price, valid_on)
       VALUES ($1, $2, 'ULSD', 'highway_diesel', 4.5, 4.5, $3::date)`,
      [stationId, olderImportRows[0]!.id, OLDER_DATE],
    );

    const request = post(validBody({ priceEffectiveOn: OLDER_DATE }));
    const response = await handleCreatePlan(pool, request, new URL(request.url), deps(), null);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { priceAsOf: string; stops: Array<{ unitPriceUsd: number }> };

    // The September sheet (PRICE_DATE, your_price 5.0) is the newest and
    // would be used by default — proving priceAsOf/the stop's price came
    // from the January sheet, not just that the parameter was accepted.
    expect(body.priceAsOf).toBe(OLDER_DATE);
    expect(body.stops[0]!.unitPriceUsd).toBe(4.5);
  });

  it("optimized.detourCostUsd is the sum of each stop's detourMiles times costPerMile", async () => {
    await insertOnRouteStation();
    const request = post(validBody());
    const response = await handleCreatePlan(pool, request, new URL(request.url), deps(), null);
    const body = (await response.json()) as {
      optimized: { detourCostUsd: number; costPerMile: number };
      stops: Array<{ detourMiles: number }>;
    };

    const expected = body.stops.reduce((sum, s) => sum + s.detourMiles, 0) * body.optimized.costPerMile;
    expect(body.optimized.detourCostUsd).toBeCloseTo(expected, 6);
    expect(typeof body.optimized.costPerMile).toBe("number");
  });

  it("optimized.driveSeconds + dwellSeconds equals totalSeconds, with dwellSeconds from fixedStopMinutes per stop", async () => {
    await insertOnRouteStation();
    const request = post(validBody({ fixedStopMinutes: 15 }));
    const response = await handleCreatePlan(pool, request, new URL(request.url), deps(), null);
    const body = (await response.json()) as {
      optimized: { driveSeconds: number; dwellSeconds: number; totalSeconds: number };
      stops: unknown[];
    };

    expect(body.optimized.driveSeconds + body.optimized.dwellSeconds).toBe(body.optimized.totalSeconds);
    expect(body.optimized.dwellSeconds).toBe(body.stops.length * 15 * 60);
  });

  it("a re-fetch's driveSeconds/dwellSeconds/totalSeconds and detourCostUsd match what POST returned", async () => {
    await insertOnRouteStation();
    const postResponse = await handleCreatePlan(pool, post(validBody()), new URL("http://localhost/api/v1/plans"), deps(), null);
    const posted = (await postResponse.json()) as { planId: string; optimized: Record<string, unknown> };

    const getResponse = await handleGetPlan(pool, posted.planId, new URL(`http://localhost/api/v1/plans/${posted.planId}`));
    const refetched = (await getResponse.json()) as { optimized: Record<string, unknown> };

    expect(refetched.optimized).toEqual(posted.optimized);
  });

  it("T-55: a provider returning fractional seconds still returns 201 (not 500), with whole-second durations POST and GET agree on", async () => {
    await insertOnRouteStation();
    const request = post(validBody());
    const response = await handleCreatePlan(
      pool,
      request,
      new URL(request.url),
      { routingProvider: fakeProviderFractionalDurations(), geocoder: geocoderNeverCalled, now: new Date("2026-09-22T12:00:00Z") },
      null,
    );

    // Before the fix, this was a 500: "invalid input syntax for type integer".
    expect(response.status).toBe(201);
    const posted = (await response.json()) as { planId: string; optimized: { driveSeconds: number; totalSeconds: number; addedDurationSeconds: number } };
    expect(Number.isInteger(posted.optimized.driveSeconds)).toBe(true);
    expect(Number.isInteger(posted.optimized.totalSeconds)).toBe(true);
    expect(Number.isInteger(posted.optimized.addedDurationSeconds)).toBe(true);
    expect(posted.optimized.driveSeconds).toBe(Math.round(42000 + 25817.7));

    const getResponse = await handleGetPlan(pool, posted.planId, new URL(`http://localhost/api/v1/plans/${posted.planId}`));
    const refetched = (await getResponse.json()) as { optimized: Record<string, unknown> };
    expect(refetched.optimized).toEqual(posted.optimized);
  });

  it("a single in-corridor station that becomes the only stop is excluded from candidateStations (T-16's design, kept per T-18)", async () => {
    await insertOnRouteStation();
    const request = post(validBody());
    const response = await handleCreatePlan(pool, request, new URL(request.url), deps(), null);
    const body = (await response.json()) as {
      stops: Array<{ station: { id: string } }>;
      candidateStations: Array<{ id: string }>;
    };

    expect(body.stops).toHaveLength(1);
    expect(body.candidateStations).toHaveLength(0);
    expect(body.candidateStations.some((c) => c.id === body.stops[0]!.station.id)).toBe(false);
  });
});

describe.skipIf(!hasDatabase)("GET /plans list (integration, T-18 step 18.3)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let truckId: string;
  let priceImportId: string;
  const PRICE_DATE = "2026-09-08";

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("plans_list_endpoint"));

    // '997' is not one of the 27 seeded fleet units (0005_fleet_roster_seed.sql).
    const { rows: truckRows } = await pool.query<{ id: string }>(
      `INSERT INTO trucks (unit_number, tank_gallons, avg_mpg, reserve_fraction, max_leg_miles, min_leg_miles, cost_per_mile_usd, fixed_stop_minutes)
       VALUES ('997', 150, 5, 0.2, 500, 300, 0, 20)
       RETURNING id`,
    );
    truckId = truckRows[0]!.id;

    const { rows: importRows } = await pool.query<{ id: string }>(
      `INSERT INTO price_imports (supplier, source_filename, file_sha256, effective_date, status)
       VALUES ('BVD', 'plans-list-test.csv', $1, $2::date, 'completed') RETURNING id`,
      [createHash("sha256").update("plans-list-test").digest("hex"), PRICE_DATE],
    );
    priceImportId = importRows[0]!.id;
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  async function insertOnRouteStation(): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO stations
         (supplier, site_ref, name_raw, store_number, city_raw, city_normalized, state_usps,
          geom, resolution, uncertainty_miles, truck_accessible)
       VALUES ('BVD', '200', 'LOVES #200', 200, 'Testville', 'TESTVILLE', 'TX',
               ST_SetSRID(ST_MakePoint($1, 35), 4326)::geography, 'exact', 0, 'operator_verified')
       RETURNING id`,
      [ROUTE_LNG],
    );
    await pool.query(
      `INSERT INTO station_prices (station_id, import_id, raw_product, product_type, cost, your_price, valid_on)
       VALUES ($1, $2, 'ULSD', 'highway_diesel', 5.0, 5.0, $3::date)`,
      [rows[0]!.id, priceImportId, PRICE_DATE],
    );
  }

  function validBody(overrides: Record<string, unknown> = {}) {
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

  function post(body: unknown): Request {
    return new Request("http://localhost/api/v1/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const deps = (now: Date) => ({ routingProvider: fakeProvider(), geocoder: geocoderNeverCalled, now });

  it("paginates; a page is a projection, asserted by the absence of stops[]/candidateStations[]", async () => {
    await insertOnRouteStation();
    for (let i = 0; i < 3; i++) {
      await handleCreatePlan(pool, post(validBody()), new URL("http://localhost/api/v1/plans"), deps(new Date(`2026-09-22T1${i}:00:00Z`)), null);
    }

    const response = await handleListPlans(pool, new URL("http://localhost/api/v1/plans?page=1&pageSize=2"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { plans: Array<Record<string, unknown>>; page: number; pageSize: number; total: number };

    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
    expect(body.total).toBe(3);
    expect(body.plans).toHaveLength(2);
    for (const plan of body.plans) {
      expect(plan).not.toHaveProperty("stops");
      expect(plan).not.toHaveProperty("candidateStations");
    }
  });

  it("lists newest first", async () => {
    await insertOnRouteStation();
    const firstResponse = await handleCreatePlan(pool, post(validBody()), new URL("http://localhost/api/v1/plans"), deps(new Date("2026-09-22T10:00:00Z")), null);
    const firstBody = (await firstResponse.json()) as { planId: string };
    const secondResponse = await handleCreatePlan(pool, post(validBody()), new URL("http://localhost/api/v1/plans"), deps(new Date("2026-09-22T11:00:00Z")), null);
    const secondBody = (await secondResponse.json()) as { planId: string };

    const response = await handleListPlans(pool, new URL("http://localhost/api/v1/plans"));
    const body = (await response.json()) as { plans: Array<{ planId: string }> };

    expect(body.plans[0]!.planId).toBe(secondBody.planId);
    expect(body.plans[1]!.planId).toBe(firstBody.planId);
  });

  it("an infeasible plan appears too, with null distanceMiles and savingsVsBaselineUsd", async () => {
    await pool.query(
      `INSERT INTO stations (supplier, site_ref, name_raw, store_number, city_raw, city_normalized, state_usps, geom, resolution, uncertainty_miles, truck_accessible)
       VALUES ('BVD', '201', 'LOVES #201', 201, 'Testville', 'TESTVILLE', 'TX', ST_SetSRID(ST_MakePoint($1, 35), 4326)::geography, 'exact', 0, 'operator_verified')`,
      [ROUTE_LNG + 0.1],
    );
    await handleCreatePlan(pool, post(validBody({ maxDetourMiles: 0 })), new URL("http://localhost/api/v1/plans"), deps(new Date("2026-09-22T12:00:00Z")), null);

    const response = await handleListPlans(pool, new URL("http://localhost/api/v1/plans"));
    const list = (await response.json()) as {
      plans: Array<{ status: string; distanceMiles: number | null; savingsVsBaselineUsd: number | null }>;
    };

    expect(list.plans[0]!.status).toBe("infeasible");
    expect(list.plans[0]!.distanceMiles).toBeNull();
    expect(list.plans[0]!.savingsVsBaselineUsd).toBeNull();
  });

  it("a fresh database with no plans returns an empty page, not an error", async () => {
    const response = await handleListPlans(pool, new URL("http://localhost/api/v1/plans"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { plans: unknown[]; total: number };
    expect(body.plans).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("joins through plans.truck_id to the roster's unit_number, not just the id (T-21 DoD)", async () => {
    await insertOnRouteStation();
    // '999' is not one of the 27 seeded fleet units (migrations/0005_fleet_roster_seed.sql) — avoids the unit_number unique constraint.
    const { rows: secondTruckRows } = await pool.query<{ id: string }>(
      `INSERT INTO trucks (unit_number, tank_gallons, avg_mpg, reserve_fraction, max_leg_miles, min_leg_miles, cost_per_mile_usd, fixed_stop_minutes)
       VALUES ('999', 150, 5, 0.2, 500, 300, 0, 20)
       RETURNING id`,
    );
    const secondTruckId = secondTruckRows[0]!.id;

    await handleCreatePlan(pool, post(validBody({ truckId })), new URL("http://localhost/api/v1/plans"), deps(new Date("2026-09-22T10:00:00Z")), null);
    await handleCreatePlan(
      pool,
      post(validBody({ truckId: secondTruckId })),
      new URL("http://localhost/api/v1/plans"),
      deps(new Date("2026-09-22T11:00:00Z")),
      null,
    );

    const response = await handleListPlans(pool, new URL("http://localhost/api/v1/plans"));
    const body = (await response.json()) as { plans: Array<{ truck: { id: string; unitNumber: string } }> };

    expect(body.plans[0]!.truck).toEqual({ id: secondTruckId, unitNumber: "999" });
    expect(body.plans[1]!.truck).toEqual({ id: truckId, unitNumber: "997" });
  });

  it("400s an invalid page", async () => {
    const response = await handleListPlans(pool, new URL("http://localhost/api/v1/plans?page=0"));
    expect(response.status).toBe(400);
  });
});

describe.skipIf(!hasDatabase)("PATCH /plans/{id} (integration, T-19 step 19.1)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let truckId: string;
  let priceImportId: string;
  const PRICE_DATE = "2026-09-08";
  const USER_ID = "22222222-2222-2222-2222-222222222222";

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("plans_patch_endpoint"));

    // '996' is not one of the 27 seeded fleet units (0005_fleet_roster_seed.sql).
    const { rows: truckRows } = await pool.query<{ id: string }>(
      `INSERT INTO trucks (unit_number, tank_gallons, avg_mpg, reserve_fraction, max_leg_miles, min_leg_miles, cost_per_mile_usd, fixed_stop_minutes)
       VALUES ('996', 150, 5, 0.2, 500, 300, 0, 20)
       RETURNING id`,
    );
    truckId = truckRows[0]!.id;

    const { rows: importRows } = await pool.query<{ id: string }>(
      `INSERT INTO price_imports (supplier, source_filename, file_sha256, effective_date, status)
       VALUES ('BVD', 'plans-patch-test.csv', $1, $2::date, 'completed') RETURNING id`,
      [createHash("sha256").update("plans-patch-test").digest("hex"), PRICE_DATE],
    );
    priceImportId = importRows[0]!.id;
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  async function insertOnRouteStation(): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO stations
         (supplier, site_ref, name_raw, store_number, city_raw, city_normalized, state_usps,
          geom, resolution, uncertainty_miles, truck_accessible)
       VALUES ('BVD', '200', 'LOVES #200', 200, 'Testville', 'TESTVILLE', 'TX',
               ST_SetSRID(ST_MakePoint($1, 35), 4326)::geography, 'exact', 0, 'operator_verified')
       RETURNING id`,
      [ROUTE_LNG],
    );
    await pool.query(
      `INSERT INTO station_prices (station_id, import_id, raw_product, product_type, cost, your_price, valid_on)
       VALUES ($1, $2, 'ULSD', 'highway_diesel', 5.0, 5.0, $3::date)`,
      [rows[0]!.id, priceImportId, PRICE_DATE],
    );
  }

  function validBody(overrides: Record<string, unknown> = {}) {
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

  function post(body: unknown): Request {
    return new Request("http://localhost/api/v1/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function patch(id: string, body: unknown): Request {
    return new Request(`http://localhost/api/v1/plans/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const deps = () => ({ routingProvider: fakeProvider(), geocoder: geocoderNeverCalled, now: new Date("2026-09-22T12:00:00Z") });

  async function createCompletedPlan(): Promise<string> {
    await insertOnRouteStation();
    const response = await handleCreatePlan(pool, post(validBody()), new URL("http://localhost/api/v1/plans"), deps(), null);
    const body = (await response.json()) as { planId: string };
    return body.planId;
  }

  async function createInfeasiblePlan(): Promise<string> {
    await pool.query(
      `INSERT INTO stations (supplier, site_ref, name_raw, store_number, city_raw, city_normalized, state_usps, geom, resolution, uncertainty_miles, truck_accessible)
       VALUES ('BVD', '201', 'LOVES #201', 201, 'Testville', 'TESTVILLE', 'TX', ST_SetSRID(ST_MakePoint($1, 35), 4326)::geography, 'exact', 0, 'operator_verified')`,
      [ROUTE_LNG + 0.1],
    );
    const response = await handleCreatePlan(pool, post(validBody({ maxDetourMiles: 0 })), new URL("http://localhost/api/v1/plans"), deps(), null);
    const body = (await response.json()) as { planId: string };
    return body.planId;
  }

  it("setting sentToDriver: true records dispatched_at; GET reflects it", async () => {
    const planId = await createCompletedPlan();

    const patchResponse = await handlePatchPlan(pool, planId, patch(planId, { sentToDriver: true }), new URL(`http://localhost/api/v1/plans/${planId}`), USER_ID);
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as { sentToDriver: boolean; sentToDriverAt: string | null };
    expect(patched.sentToDriver).toBe(true);
    expect(typeof patched.sentToDriverAt).toBe("string");

    const getResponse = await handleGetPlan(pool, planId, new URL(`http://localhost/api/v1/plans/${planId}`));
    const fetched = (await getResponse.json()) as { sentToDriver: boolean; sentToDriverAt: string | null };
    expect(fetched.sentToDriver).toBe(true);
    expect(fetched.sentToDriverAt).toBe(patched.sentToDriverAt);
  });

  it("setting sentToDriver: false clears dispatched_at", async () => {
    const planId = await createCompletedPlan();
    await handlePatchPlan(pool, planId, patch(planId, { sentToDriver: true }), new URL(`http://localhost/api/v1/plans/${planId}`), USER_ID);

    const clearResponse = await handlePatchPlan(pool, planId, patch(planId, { sentToDriver: false }), new URL(`http://localhost/api/v1/plans/${planId}`), USER_ID);
    const cleared = (await clearResponse.json()) as { sentToDriver: boolean; sentToDriverAt: string | null };
    expect(cleared.sentToDriver).toBe(false);
    expect(cleared.sentToDriverAt).toBeNull();

    const getResponse = await handleGetPlan(pool, planId, new URL(`http://localhost/api/v1/plans/${planId}`));
    const fetched = (await getResponse.json()) as { sentToDriver: boolean; sentToDriverAt: string | null };
    expect(fetched.sentToDriver).toBe(false);
    expect(fetched.sentToDriverAt).toBeNull();
  });

  it("the plan's stops and totals are unchanged by the patch", async () => {
    const planId = await createCompletedPlan();
    const before = (await (await handleGetPlan(pool, planId, new URL(`http://localhost/api/v1/plans/${planId}`))).json()) as {
      stops: unknown;
      optimized: unknown;
      baseline: unknown;
    };

    await handlePatchPlan(pool, planId, patch(planId, { sentToDriver: true }), new URL(`http://localhost/api/v1/plans/${planId}`), USER_ID);

    const after = (await (await handleGetPlan(pool, planId, new URL(`http://localhost/api/v1/plans/${planId}`))).json()) as {
      stops: unknown;
      optimized: unknown;
      baseline: unknown;
    };
    expect(after.stops).toEqual(before.stops);
    expect(after.optimized).toEqual(before.optimized);
    expect(after.baseline).toEqual(before.baseline);
  });

  it("patching an unknown id returns 404 problem+json", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const response = await handlePatchPlan(pool, id, patch(id, { sentToDriver: true }), new URL(`http://localhost/api/v1/plans/${id}`), USER_ID);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });

  it("patching an infeasible plan returns 409 problem+json — nothing to send a driver", async () => {
    const planId = await createInfeasiblePlan();
    const response = await handlePatchPlan(pool, planId, patch(planId, { sentToDriver: true }), new URL(`http://localhost/api/v1/plans/${planId}`), USER_ID);
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });

  it("GET /plans list projection reflects sentToDriver/sentToDriverAt", async () => {
    const planId = await createCompletedPlan();
    await handlePatchPlan(pool, planId, patch(planId, { sentToDriver: true }), new URL(`http://localhost/api/v1/plans/${planId}`), USER_ID);

    const listResponse = await handleListPlans(pool, new URL("http://localhost/api/v1/plans"));
    const list = (await listResponse.json()) as { plans: Array<{ planId: string; sentToDriver: boolean; sentToDriverAt: string | null }> };
    const row = list.plans.find((p) => p.planId === planId)!;
    expect(row.sentToDriver).toBe(true);
    expect(typeof row.sentToDriverAt).toBe("string");
  });
});
