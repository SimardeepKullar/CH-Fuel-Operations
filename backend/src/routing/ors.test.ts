import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metersToMiles } from "../domain/units.js";
import { RoutingProviderError } from "./provider.js";
import { OrsRoutingProvider } from "./ors.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/ors",
);

interface OrsFixture {
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
}

function loadFixture(name: string): OrsFixture {
  return JSON.parse(readFileSync(path.join(fixturesDir, `${name}.json`), "utf8")) as OrsFixture;
}

function fetchFromFixture(fixture: OrsFixture): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(fixture.responseBody), {
      status: fixture.responseStatus,
      headers: fixture.responseHeaders,
    }),
  ) as unknown as typeof fetch;
}

const truckSpec = {
  grossWeightKg: 36287,
  heightCm: 411,
  widthCm: 259,
  lengthCm: 2250,
  axleCount: 5,
  hazmatClass: null,
};

const origin = { lat: 41.8781, lng: -87.6298 };
const destination = { lat: 32.7767, lng: -96.797 };

describe("OrsRoutingProvider", () => {
  beforeEach(() => {
    // The whole suite must run with the network disabled — every test below
    // injects its own fetchImpl, so a real fetch call here would be a bug.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("network disabled: OrsRoutingProvider must not call the real fetch in tests");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("decodes a recorded route to polyline, distance, duration and per-leg breakdown", async () => {
    const fixture = loadFixture("route-single-leg");
    const provider = new OrsRoutingProvider({
      apiKey: "test-key",
      fetchImpl: fetchFromFixture(fixture),
    });

    const result = await provider.route({ origin, destination, truckSpec });

    const body = fixture.responseBody as { routes: Array<{ summary: { distance: number; duration: number }; geometry: string; segments: unknown[] }> };
    const expectedRoute = body.routes[0]!;

    expect(result.polyline).toBe(expectedRoute.geometry);
    expect(result.distanceMiles).toBe(metersToMiles(expectedRoute.summary.distance));
    expect(result.durationSeconds).toBe(expectedRoute.summary.duration);
    expect(result.legs).toHaveLength(expectedRoute.segments.length);
    expect(result.providerRaw).toEqual(body);
  });

  it("sums leg distances and durations to the total within rounding", async () => {
    const fixture = loadFixture("route-multi-leg");
    const provider = new OrsRoutingProvider({
      apiKey: "test-key",
      fetchImpl: fetchFromFixture(fixture),
    });

    const result = await provider.route({
      origin,
      via: [{ lat: 38.627, lng: -90.1994 }],
      destination,
      truckSpec,
    });

    expect(result.legs.length).toBeGreaterThan(1);
    const legDistanceSum = result.legs.reduce((sum, leg) => sum + leg.distanceMiles, 0);
    const legDurationSum = result.legs.reduce((sum, leg) => sum + leg.durationSeconds, 0);

    // ORS rounds each distance to 0.1 m, so the sum can drift by a few tenths of
    // a metre. 3 digits is 0.0005 mi (0.8 m): tighter than any real error, loose
    // enough for that rounding.
    expect(legDistanceSum).toBeCloseTo(result.distanceMiles, 3);
    expect(legDurationSum).toBeCloseTo(result.durationSeconds, 1);
  });

  it("maps a 4xx response to a typed RoutingProviderError, not the raw body", async () => {
    const fixture = loadFixture("route-error-400");
    const provider = new OrsRoutingProvider({
      apiKey: "test-key",
      fetchImpl: fetchFromFixture(fixture),
    });

    const call = provider.route({ origin, destination, truckSpec });

    await expect(call).rejects.toBeInstanceOf(RoutingProviderError);
    await expect(call).rejects.toMatchObject({
      provider: "ors",
      status: 400,
      code: 2003,
      message: "Parameter 'coordinates' has incorrect value or format.",
    });
  });

  it("emits a structured log keyed by a request hash on every call", async () => {
    const fixture = loadFixture("route-single-leg");
    const logger = { info: vi.fn(), error: vi.fn() };
    const provider = new OrsRoutingProvider({
      apiKey: "test-key",
      fetchImpl: fetchFromFixture(fixture),
      logger,
    });

    await provider.route({ origin, destination, truckSpec });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [logEntry] = logger.info.mock.calls[0] as [Record<string, unknown>, string];
    expect(logEntry.provider).toBe("ors");
    expect(logEntry.endpoint).toBe("directions");
    expect(logEntry.status).toBe(200);
    expect(logEntry.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("decodes a matrix response to distance and duration grids", async () => {
    const fixture = loadFixture("matrix");
    const provider = new OrsRoutingProvider({
      apiKey: "test-key",
      fetchImpl: fetchFromFixture(fixture),
    });

    const result = await provider.matrix({
      origins: [origin],
      destinations: [{ lat: 38.627, lng: -90.1994 }, destination],
      truckSpec,
    });

    const body = fixture.responseBody as { distances: number[][]; durations: number[][] };
    expect(result.distanceMiles).toEqual(body.distances.map((row) => row.map(metersToMiles)));
    expect(result.durationSeconds).toEqual(body.durations);
  });

  it("converts every leg distance from metres to miles", async () => {
    const fixture = loadFixture("route-multi-leg");
    const provider = new OrsRoutingProvider({
      apiKey: "test-key",
      fetchImpl: fetchFromFixture(fixture),
    });

    const result = await provider.route({
      origin,
      via: [{ lat: 38.627, lng: -90.1994 }],
      destination,
      truckSpec,
    });

    const body = fixture.responseBody as { routes: Array<{ segments: Array<{ distance: number }> }> };
    expect(result.legs.map((leg) => leg.distanceMiles)).toEqual(
      body.routes[0]!.segments.map((segment) => metersToMiles(segment.distance)),
    );
  });

  it("leaves a null matrix cell (unreachable pair) null, never 0 miles", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ distances: [[1609.344, null]], durations: [[60, null]] }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;
    const provider = new OrsRoutingProvider({ apiKey: "test-key", fetchImpl });

    const result = await provider.matrix({
      origins: [origin],
      destinations: [origin, destination],
      truckSpec,
    });

    expect(result.distanceMiles).toEqual([[1, null]]);
  });

  it("does not ask ORS for miles — the request body, and so its cache hash, has no units key", async () => {
    const fixture = loadFixture("route-single-leg");
    const fetchImpl = fetchFromFixture(fixture);
    const provider = new OrsRoutingProvider({ apiKey: "test-key", fetchImpl });

    await provider.route({ origin, destination, truckSpec });

    const init = vi.mocked(fetchImpl).mock.calls[0]![1] as RequestInit;
    expect(Object.keys(JSON.parse(init.body as string) as object)).not.toContain("units");
  });

  it("routes a truck around a known low bridge differently from a car (T-10 DoD)", async () => {
    const hgvFixture = loadFixture("route-hgv-low-bridge");
    const carFixture = loadFixture("route-car-low-bridge");

    const hgvProvider = new OrsRoutingProvider({
      apiKey: "test-key",
      fetchImpl: fetchFromFixture(hgvFixture),
    });
    const hgvResult = await hgvProvider.route({
      origin: { lat: 35.9935, lng: -78.9101 },
      destination: { lat: 36.0045, lng: -78.9101 },
      truckSpec,
    });

    const carBody = carFixture.responseBody as { routes: Array<{ geometry: string; summary: { distance: number } }> };
    const carGeometry = carBody.routes[0]!.geometry;
    const carDistance = carBody.routes[0]!.summary.distance;

    expect(hgvResult.polyline).not.toBe(carGeometry);
    expect(hgvResult.distanceMiles).not.toBe(metersToMiles(carDistance));
  });
});
