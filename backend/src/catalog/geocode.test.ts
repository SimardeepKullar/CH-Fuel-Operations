import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GeocodeResult } from "../routing/geocodeProvider.js";
import { OrsGeocoder } from "../routing/orsGeocoder.js";
import { GeocodeError, LocationInputError, MIN_GEOCODE_CONFIDENCE, parseLocationInput, pickCandidate } from "./geocode.js";

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

/** Decodes a recorded fixture through the real adapter, offline, so `pickCandidate` is tested against real ORS shapes, not a hand-built double. */
async function geocodeFixture(name: string, text: string): Promise<GeocodeResult> {
  const fixture = loadFixture(name);
  const geocoder = new OrsGeocoder({
    apiKey: "test-key",
    fetchImpl: async () =>
      new Response(JSON.stringify(fixture.responseBody), {
        status: fixture.responseStatus,
        headers: fixture.responseHeaders,
      }),
  });
  return geocoder.geocode({ text });
}

describe("parseLocationInput", () => {
  it("accepts {lat,lng} and bypasses geocoding entirely", () => {
    expect(parseLocationInput({ lat: 41.8781, lng: -87.6298 }, "origin")).toEqual({
      kind: "coordinates",
      location: { lat: 41.8781, lng: -87.6298 },
    });
  });

  it("accepts {address} and routes through the address path", () => {
    expect(parseLocationInput({ address: "233 S Wacker Dr, Chicago, IL" }, "origin")).toEqual({
      kind: "address",
      address: "233 S Wacker Dr, Chicago, IL",
    });
  });

  it("rejects neither shape present, naming the field", () => {
    expect(() => parseLocationInput({}, "origin")).toThrow(LocationInputError);
    try {
      parseLocationInput({}, "origin");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LocationInputError);
      expect((err as LocationInputError).field).toBe("origin");
    }
  });

  it("rejects a non-object input, naming the field", () => {
    expect(() => parseLocationInput(null, "destination")).toThrow(LocationInputError);
    expect(() => parseLocationInput("233 S Wacker Dr", "destination")).toThrow(LocationInputError);
  });

  it("rejects both shapes present at once", () => {
    expect(() =>
      parseLocationInput({ address: "233 S Wacker Dr", lat: 41.8781, lng: -87.6298 }, "origin"),
    ).toThrow(LocationInputError);
  });

  it("rejects a blank address, naming the address subfield", () => {
    try {
      parseLocationInput({ address: "   " }, "destination");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LocationInputError);
      expect((err as LocationInputError).field).toBe("destination.address");
    }
  });

  it("rejects out-of-range latitude, naming the lat subfield", () => {
    try {
      parseLocationInput({ lat: 95, lng: -87.6298 }, "origin");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LocationInputError);
      expect((err as LocationInputError).field).toBe("origin.lat");
    }
  });

  it("rejects out-of-range longitude, naming the lng subfield", () => {
    try {
      parseLocationInput({ lat: 41.8781, lng: 200 }, "origin");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LocationInputError);
      expect((err as LocationInputError).field).toBe("origin.lng");
    }
  });

  it("rejects NaN and non-finite coordinates", () => {
    expect(() => parseLocationInput({ lat: Number.NaN, lng: -87.6298 }, "origin")).toThrow(LocationInputError);
    expect(() => parseLocationInput({ lat: 41.8781, lng: Number.POSITIVE_INFINITY }, "origin")).toThrow(
      LocationInputError,
    );
  });

  it("accepts a coordinate of exactly 0 — a real value, not a missing one", () => {
    expect(parseLocationInput({ lat: 0, lng: 0 }, "origin")).toEqual({
      kind: "coordinates",
      location: { lat: 0, lng: 0 },
    });
  });

  it("accepts coordinates at the exact boundary (±90 lat, ±180 lng)", () => {
    expect(parseLocationInput({ lat: 90, lng: 180 }, "origin")).toEqual({
      kind: "coordinates",
      location: { lat: 90, lng: 180 },
    });
    expect(parseLocationInput({ lat: -90, lng: -180 }, "origin")).toEqual({
      kind: "coordinates",
      location: { lat: -90, lng: -180 },
    });
  });
});

describe("pickCandidate", () => {
  it("accepts a clean, high-confidence address match", async () => {
    const result = await geocodeFixture("geocode-clean-address", "233 S Wacker Dr, Chicago, IL 60606");
    const candidate = pickCandidate(result, "origin");
    expect(candidate.confidence).toBe(1);
    expect(candidate.label).toContain("Wacker");
  });

  it("accepts a confident city-centroid match — granularity alone is not rejected", async () => {
    const result = await geocodeFixture("geocode-city-centroid", "Chicago, IL");
    const candidate = pickCandidate(result, "origin");
    expect(candidate.layer).toBe("locality");
    expect(candidate.label).toContain("Chicago");
  });

  it("rejects no_match when the geocoder returns nothing", async () => {
    const result = await geocodeFixture("geocode-no-match", "zzzqxv1234nonexistentplace");
    try {
      pickCandidate(result, "destination");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GeocodeError);
      expect((err as GeocodeError).code).toBe("no_match");
      expect((err as GeocodeError).field).toBe("destination");
    }
  });

  it("rejects low_confidence below the measured floor", async () => {
    const result = await geocodeFixture("geocode-low-confidence", "9999 Wacker Dr, Chicago, IL");
    expect(result.candidates[0]!.confidence).toBeLessThan(MIN_GEOCODE_CONFIDENCE);
    try {
      pickCandidate(result, "origin");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GeocodeError);
      expect((err as GeocodeError).code).toBe("low_confidence");
    }
  });

  it("rejects ambiguous when tied top candidates disagree on state", async () => {
    const result = await geocodeFixture("geocode-ambiguous-no-city", "100 Main St");
    try {
      pickCandidate(result, "origin");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GeocodeError);
      expect((err as GeocodeError).code).toBe("ambiguous");
    }
  });

  it("does not reject a same-state tie — accepts the top-ranked candidate", () => {
    const result: GeocodeResult = {
      attribution: "test",
      providerRaw: undefined,
      candidates: [
        { location: { lat: 41.88, lng: -87.63 }, label: "Chicago, IL, USA", confidence: 1, layer: "locality", matchType: "exact", regionCode: "IL", countryCode: "USA" },
        { location: { lat: 41.95, lng: -87.92 }, label: "Chicago, IL, USA", confidence: 1, layer: "locality", matchType: "exact", regionCode: "IL", countryCode: "USA" },
      ],
    };
    expect(pickCandidate(result, "origin")).toBe(result.candidates[0]);
  });
});
