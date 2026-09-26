// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompletedPlanResponse } from "@ch/core/domain/planResponse";
import { ApiError, getPlan, listStations, listTransactions } from "./api";

const PLAN_ID = "11111111-1111-1111-1111-111111111111";

const completedPlan: CompletedPlanResponse = {
  planId: PLAN_ID,
  createdAt: "2026-09-01T12:00:00.000Z",
  units: "imperial",
  origin: { label: "Bakersfield, CA", location: { lat: 35.3733, lng: -119.0187 } },
  destination: { label: "Reno, NV", location: { lat: 39.5296, lng: -119.8138 } },
  truckId: "truck-1",
  candidateStations: [],
  status: "completed",
  priceAsOf: "2026-09-01",
  optimizerStrategy: "dp_v1",
  solveMs: 4200,
  stationsScanned: 1,
  truck: { unitNumber: "760", maxLegMiles: 500 },
  baseline: {
    polyline: null,
    distanceMiles: 481.8,
    driveSeconds: 27333,
    estimatedFuelCostUsd: 327.62,
    bounds: { north: 0, south: 0, east: 0, west: 0 },
  },
  optimized: {
    polyline: null,
    distanceMiles: 486.5,
    driveSeconds: 27600,
    dwellSeconds: 6000,
    totalSeconds: 33600,
    totalFuelCostUsd: 286.62,
    totalGallons: 68,
    savingsVsBaselineUsd: 41.0,
    addedDistanceMiles: 4.7,
    addedDurationSeconds: 267,
    detourCostUsd: 2.82,
    costPerMile: 0.6,
    bounds: { north: 0, south: 0, east: 0, west: 0 },
  },
  stops: [],
  googleMapsUrl: "https://www.google.com/maps/dir/?api=1&travelmode=driving",
  disclaimers: [],
  attribution: { routing: "© openrouteservice.org (HeiGIT)", placeData: "© OpenStreetMap contributors (ODbL)" },
  sentToDriver: false,
  sentToDriverAt: null,
};

function jsonResponse(body: unknown, status: number, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": contentType } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("a mocked 200 yields a typed PlanResponse", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(completedPlan, 200)));

    const result = await getPlan(PLAN_ID);

    expect(result.planId).toBe(PLAN_ID);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.optimized.totalFuelCostUsd).toBe(286.62);
    }
  });

  it("a problem+json response surfaces as a typed error with its title and detail", async () => {
    const problem = { type: "about:blank", title: "Bad Request", status: 400, detail: "priceEffectiveOn must be YYYY-MM-DD", instance: "/plans" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(problem, 400, "application/problem+json")));

    await expect(getPlan(PLAN_ID)).rejects.toThrow(ApiError);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(problem, 400, "application/problem+json")));
    try {
      await getPlan(PLAN_ID);
      expect.unreachable("getPlan should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiError = err as ApiError;
      expect(apiError.title).toBe("Bad Request");
      expect(apiError.detail).toBe("priceEffectiveOn must be YYYY-MM-DD");
    }
  });

  it("a 401 is distinguishable from a 500 by the caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ title: "Unauthorized", status: 401 }, 401, "application/problem+json")),
    );
    let unauthorized: ApiError | null = null;
    try {
      await getPlan(PLAN_ID);
    } catch (err) {
      unauthorized = err as ApiError;
    }
    expect(unauthorized?.status).toBe(401);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ title: "Internal Server Error", status: 500 }, 500, "application/problem+json")),
    );
    let serverError: ApiError | null = null;
    try {
      await getPlan(PLAN_ID);
    } catch (err) {
      serverError = err as ApiError;
    }
    expect(serverError?.status).toBe(500);
    expect(serverError?.status).not.toBe(unauthorized?.status);
  });

  it("listStations sends a required bbox and omits unset optional params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ stations: [], page: 1, pageSize: 100, total: 0 }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await listStations({ west: -122, south: 35, east: -118, north: 40 });

    const url = new URL((fetchMock.mock.calls[0]![0] as string), "http://localhost");
    expect(url.pathname).toBe("/api/v1/stations");
    expect(url.searchParams.get("bbox")).toBe("-122,35,-118,40");
    expect(url.searchParams.has("resolution")).toBe(false);
    expect(url.searchParams.has("page")).toBe(false);
  });

  it("listStations forwards resolution/page/pageSize when given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ stations: [], page: 2, pageSize: 500, total: 0 }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await listStations({ west: -122, south: 35, east: -118, north: 40, resolution: "exact", page: 2, pageSize: 500 });

    const url = new URL((fetchMock.mock.calls[0]![0] as string), "http://localhost");
    expect(url.searchParams.get("resolution")).toBe("exact");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("pageSize")).toBe("500");
  });

  it("listTransactions omits unset optional params and forwards the ones given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [], page: 1, pageSize: 200, total: 0 }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await listTransactions({ period: "2026-09-03", anomalyOnly: true, includeLines: true, driverId: "d1" });

    const url = new URL(fetchMock.mock.calls[0]![0] as string, "http://localhost");
    expect(url.pathname).toBe("/api/v1/transactions");
    expect(url.searchParams.get("period")).toBe("2026-09-03");
    expect(url.searchParams.get("anomalyOnly")).toBe("true");
    expect(url.searchParams.get("includeLines")).toBe("true");
    expect(url.searchParams.get("driverId")).toBe("d1");
    expect(url.searchParams.has("truckId")).toBe(false);
    expect(url.searchParams.has("cardId")).toBe(false);
  });
});
