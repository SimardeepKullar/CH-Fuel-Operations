import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeocodingProviderError } from "./geocodeProvider.js";
import { OrsGeocoder } from "./orsGeocoder.js";

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

describe("OrsGeocoder", () => {
  beforeEach(() => {
    // Mirrors ors.test.ts: the whole suite runs with the network disabled.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("network disabled: OrsGeocoder must not call the real fetch in tests");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("decodes a clean address match to a single, high-confidence candidate", async () => {
    const fixture = loadFixture("geocode-clean-address");
    const geocoder = new OrsGeocoder({ apiKey: "test-key", fetchImpl: fetchFromFixture(fixture) });

    const result = await geocoder.geocode({ text: "233 S Wacker Dr, Chicago, IL 60606" });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      location: { lat: 41.878658, lng: -87.635868 },
      confidence: 1,
      layer: "address",
      matchType: "exact",
      regionCode: "IL",
      countryCode: "USA",
    });
    expect(result.candidates[0]!.label).toContain("Wacker");
    expect(result.attribution).toBe("https://openrouteservice.org/terms-of-service/#attribution-geocode");
    expect(result.providerRaw).toBeDefined();
  });

  it("returns three tied, cross-state candidates for an address with no city or state", async () => {
    const fixture = loadFixture("geocode-ambiguous-no-city");
    const geocoder = new OrsGeocoder({ apiKey: "test-key", fetchImpl: fetchFromFixture(fixture) });

    const result = await geocoder.geocode({ text: "100 Main St" });

    expect(result.candidates).toHaveLength(3);
    const regions = result.candidates.map((c) => c.regionCode);
    expect(new Set(regions).size).toBe(3);
    expect(result.candidates.every((c) => c.confidence === 1)).toBe(true);
  });

  it("returns tied, same-state candidates for a city-only query (a locality centroid, not rejected by the adapter)", async () => {
    const fixture = loadFixture("geocode-city-centroid");
    const geocoder = new OrsGeocoder({ apiKey: "test-key", fetchImpl: fetchFromFixture(fixture) });

    const result = await geocoder.geocode({ text: "Chicago, IL" });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((c) => c.layer === "locality")).toBe(true);
    expect(result.candidates.every((c) => c.regionCode === "IL")).toBe(true);
  });

  it("returns an empty candidate list for a no-match query", async () => {
    const fixture = loadFixture("geocode-no-match");
    const geocoder = new OrsGeocoder({ apiKey: "test-key", fetchImpl: fetchFromFixture(fixture) });

    const result = await geocoder.geocode({ text: "zzzqxv1234nonexistentplace" });

    expect(result.candidates).toEqual([]);
  });

  it("returns a low-confidence street-layer fallback for a nonexistent house number", async () => {
    const fixture = loadFixture("geocode-low-confidence");
    const geocoder = new OrsGeocoder({ apiKey: "test-key", fetchImpl: fetchFromFixture(fixture) });

    const result = await geocoder.geocode({ text: "9999 Wacker Dr, Chicago, IL" });

    expect(result.candidates[0]).toMatchObject({ confidence: 0.8, layer: "street", matchType: "fallback" });
  });

  it("maps a real ORS geocode error body to GeocodingProviderError, not the raw body", async () => {
    const fixture = loadFixture("geocode-error-empty-text");
    const geocoder = new OrsGeocoder({ apiKey: "test-key", fetchImpl: fetchFromFixture(fixture) });

    const call = geocoder.geocode({ text: "" });

    await expect(call).rejects.toBeInstanceOf(GeocodingProviderError);
    await expect(call).rejects.toMatchObject({ provider: "ors", status: 400 });
    await expect(call).rejects.toThrow(/text length/);
  });

  it("requests over GET with the api key in the Authorization header, not the query string", async () => {
    const fixture = loadFixture("geocode-clean-address");
    const fetchImpl = fetchFromFixture(fixture);
    const geocoder = new OrsGeocoder({ apiKey: "test-key", fetchImpl });

    await geocoder.geocode({ text: "233 S Wacker Dr, Chicago, IL 60606" });

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]! as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("test-key");
    expect(url).not.toContain("test-key");
    expect(url).toContain("boundary.country=US");
  });

  it("emits a structured log keyed by a request hash on every call", async () => {
    const fixture = loadFixture("geocode-clean-address");
    const logger = { info: vi.fn(), error: vi.fn() };
    const geocoder = new OrsGeocoder({ apiKey: "test-key", fetchImpl: fetchFromFixture(fixture), logger });

    await geocoder.geocode({ text: "233 S Wacker Dr, Chicago, IL 60606" });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [logEntry] = logger.info.mock.calls[0] as [Record<string, unknown>, string];
    expect(logEntry.provider).toBe("ors");
    expect(logEntry.endpoint).toBe("geocoding");
    expect(logEntry.status).toBe(200);
    expect(logEntry.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
