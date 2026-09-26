import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { GeocodeQuery, GeocodeResult, GeocodingProvider } from "../../routing/geocodeProvider.js";
import type { MatrixRequest, MatrixResult, RouteRequest, RouteResult, RoutingProvider } from "../../routing/provider.js";
import { handleCreatePlan, handleGetPlan } from "./plans.js";

/** Fails the test the moment anything on it is called — proves a 400 from
 * body validation never reaches the database (mirrors `app.test.ts`). */
const untouchedPool = new Proxy(
  {},
  {
    get(): never {
      throw new Error("route touched the database before request validation finished");
    },
  },
) as Pool;

const untouchedProvider: RoutingProvider = {
  name: "ors",
  route(_req: RouteRequest): Promise<RouteResult> {
    throw new Error("route() should not be called before request validation finished");
  },
  matrix(_req: MatrixRequest): Promise<MatrixResult> {
    throw new Error("matrix() should not be called before request validation finished");
  },
};

const untouchedGeocoder: GeocodingProvider = {
  name: "ors",
  geocode(_query: GeocodeQuery): Promise<GeocodeResult> {
    throw new Error("geocode() should not be called before request validation finished");
  },
};

const deps = { routingProvider: untouchedProvider, geocoder: untouchedGeocoder, now: new Date("2026-09-22T12:00:00Z") };

const VALID_BODY = {
  origin: { lat: 30, lng: -97 },
  destination: { lat: 40, lng: -97 },
  truckId: "11111111-1111-1111-1111-111111111111",
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
  departAt: null,
};

function postRequest(body: unknown, query = ""): Request {
  return new Request(`http://localhost/api/v1/plans${query}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function problemOf(response: Response): Promise<{ title: string; status: number; detail?: string }> {
  expect(response.headers.get("content-type")).toBe("application/problem+json");
  return (await response.json()) as { title: string; status: number; detail?: string };
}

describe("handleCreatePlan: request validation, before anything is touched", () => {
  it("rejects a non-JSON body as 400 without touching the database or providers", async () => {
    const request = new Request("http://localhost/api/v1/plans", { method: "POST", body: "not json" });
    const response = await handleCreatePlan(untouchedPool, request, new URL(request.url), deps, null);
    expect(response.status).toBe(400);
    expect((await problemOf(response)).title).toBe("Bad Request");
  });

  it("rejects a body missing a required nullable key (CLAUDE.md: null must be explicit, not omitted)", async () => {
    const { maxDetourMiles: _drop, ...incomplete } = VALID_BODY;
    const response = await handleCreatePlan(untouchedPool, postRequest(incomplete), new URL("http://localhost/api/v1/plans"), deps, null);
    expect(response.status).toBe(400);
  });

  it("rejects maxStops as a non-integer", async () => {
    const body = { ...VALID_BODY, maxStops: 1.5 };
    const response = await handleCreatePlan(untouchedPool, postRequest(body), new URL("http://localhost/api/v1/plans"), deps, null);
    expect(response.status).toBe(400);
  });

  it("rejects an invalid priceBasis rather than accepting an unknown string", async () => {
    const body = { ...VALID_BODY, priceBasis: "retail" };
    const response = await handleCreatePlan(untouchedPool, postRequest(body), new URL("http://localhost/api/v1/plans"), deps, null);
    expect(response.status).toBe(400);
  });

  it("rejects a truckId that is not a uuid", async () => {
    const body = { ...VALID_BODY, truckId: "not-a-uuid" };
    const response = await handleCreatePlan(untouchedPool, postRequest(body), new URL("http://localhost/api/v1/plans"), deps, null);
    expect(response.status).toBe(400);
  });

  it("rejects an unknown units query value as 400", async () => {
    const response = await handleCreatePlan(untouchedPool, postRequest(VALID_BODY, "?units=furlongs"), new URL("http://localhost/api/v1/plans?units=furlongs"), deps, null);
    expect(response.status).toBe(400);
  });

  it("accepts corridorMiles and maxDetourMiles as 0, distinct from null (never coerced)", async () => {
    // A valid body with 0s should pass validation and proceed past the
    // schema — it will then fail downstream (no real DB), proving the 0s
    // were accepted, not silently rejected as "missing".
    const body = { ...VALID_BODY, corridorMiles: 0, maxDetourMiles: 0, maxStops: 0 };
    const response = await handleCreatePlan(untouchedPool, postRequest(body), new URL("http://localhost/api/v1/plans"), deps, null);
    // Fails past validation (the untouched pool throws), not a 400.
    expect(response.status).not.toBe(400);
  });
});

describe("handleGetPlan: request validation", () => {
  it("returns 404 problem+json for a non-uuid id without touching the database", async () => {
    const response = await handleGetPlan(untouchedPool, "not-a-uuid", new URL("http://localhost/api/v1/plans/not-a-uuid"));
    expect(response.status).toBe(404);
    expect((await problemOf(response)).title).toBe("Not Found");
  });

  it("rejects an unknown units query value as 400 before touching the database", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const response = await handleGetPlan(untouchedPool, id, new URL(`http://localhost/api/v1/plans/${id}?units=furlongs`));
    expect(response.status).toBe(400);
  });
});
