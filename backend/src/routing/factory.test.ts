import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeocodingProvider, createRoutingProvider } from "./factory.js";
import { OrsGeocoder } from "./orsGeocoder.js";
import { OrsRoutingProvider } from "./ors.js";

describe("createRoutingProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the ORS adapter for 'ors'", () => {
    const provider = createRoutingProvider("ors");
    expect(provider).toBeInstanceOf(OrsRoutingProvider);
    expect(provider.name).toBe("ors");
  });

  it("throws on an unknown provider", () => {
    expect(() => createRoutingProvider("here")).toThrow(/unknown routing provider/i);
    expect(() => createRoutingProvider("bogus")).toThrow(/unknown routing provider/i);
  });

  it("gives the ORS adapter the daily limits from the environment, defaults where unset", () => {
    const provider = createRoutingProvider("ors", { ORS_DAILY_LIMIT_MATRIX: "2000" });
    expect(provider).toBeInstanceOf(OrsRoutingProvider);
    expect((provider as OrsRoutingProvider)["budgetCeilings"]).toEqual({
      directions: 200,
      matrix: 2000,
      geocoding: 100,
    });
  });

  it("throws at construction on a malformed ceiling, naming the variable", () => {
    expect(() => createRoutingProvider("ors", { ORS_DAILY_LIMIT_DIRECTIONS: "lots" })).toThrow(
      /ORS_DAILY_LIMIT_DIRECTIONS/,
    );
  });

  it("falls back to ROUTING_PROVIDER when no provider is given, and throws if that is unset too", () => {
    vi.stubEnv("ROUTING_PROVIDER", "ors");
    expect(createRoutingProvider().name).toBe("ors");

    vi.stubEnv("ROUTING_PROVIDER", "");
    expect(() => createRoutingProvider()).toThrow(/unknown routing provider/i);
  });
});

describe("createGeocodingProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the ORS geocoder for 'ors'", () => {
    const provider = createGeocodingProvider("ors");
    expect(provider).toBeInstanceOf(OrsGeocoder);
    expect(provider.name).toBe("ors");
  });

  it("throws on an unknown provider", () => {
    expect(() => createGeocodingProvider("here")).toThrow(/unknown geocoding provider/i);
    expect(() => createGeocodingProvider("bogus")).toThrow(/unknown geocoding provider/i);
  });

  it("gives the ORS geocoder the daily limits from the environment, defaults where unset", () => {
    const provider = createGeocodingProvider("ors", { ORS_DAILY_LIMIT_GEOCODING: "2000" });
    expect(provider).toBeInstanceOf(OrsGeocoder);
    expect((provider as OrsGeocoder)["budgetCeilings"]).toEqual({
      directions: 200,
      matrix: 50,
      geocoding: 2000,
    });
  });

  it("throws at construction on a malformed ceiling, naming the variable", () => {
    expect(() => createGeocodingProvider("ors", { ORS_DAILY_LIMIT_GEOCODING: "lots" })).toThrow(
      /ORS_DAILY_LIMIT_GEOCODING/,
    );
  });

  it("falls back to ROUTING_PROVIDER when no provider is given, and throws if that is unset too", () => {
    vi.stubEnv("ROUTING_PROVIDER", "ors");
    expect(createGeocodingProvider().name).toBe("ors");

    vi.stubEnv("ROUTING_PROVIDER", "");
    expect(() => createGeocodingProvider()).toThrow(/unknown geocoding provider/i);
  });
});
