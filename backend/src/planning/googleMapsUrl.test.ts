import { describe, expect, it } from "vitest";
import { buildGoogleMapsUrl, MAX_WAYPOINTS, TooManyWaypointsError } from "./googleMapsUrl.js";

const origin = { lat: 39.1123, lng: -88.5434 };
const destination = { lat: 41.8781, lng: -87.6298 };

describe("buildGoogleMapsUrl (§9.4)", () => {
  it("puts 3 stops in as 3 waypoints, in the order given", () => {
    const stops = [
      { lat: 39.5, lng: -88.0 },
      { lat: 40.0, lng: -87.9 },
      { lat: 40.5, lng: -87.8 },
    ];
    const url = new URL(buildGoogleMapsUrl(origin, destination, stops));
    expect(url.searchParams.get("waypoints")).toBe(stops.map((s) => `${s.lat},${s.lng}`).join("|"));
  });

  it("formats coordinates lat,lng and URL-encodes the link", () => {
    const url = buildGoogleMapsUrl(origin, destination, []);
    // The raw string carries percent-encoding for the comma in "lat,lng" —
    // decoding is what makes the round trip below equal the input again.
    expect(url).toContain("%2C");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("origin")).toBe(`${origin.lat},${origin.lng}`);
    expect(parsed.searchParams.get("destination")).toBe(`${destination.lat},${destination.lng}`);
    expect(parsed.searchParams.get("travelmode")).toBe("driving");
  });

  it("URL-encodes the pipe separator between multiple waypoints", () => {
    const stops = [
      { lat: 39.5, lng: -88.0 },
      { lat: 40.0, lng: -87.9 },
    ];
    const url = buildGoogleMapsUrl(origin, destination, stops);
    expect(url).toContain("%7C");
  });

  it("with 0 stops, returns a valid origin/destination link and no waypoints param", () => {
    const url = new URL(buildGoogleMapsUrl(origin, destination, []));
    expect(url.searchParams.has("waypoints")).toBe(false);
    expect(url.searchParams.get("origin")).toBe(`${origin.lat},${origin.lng}`);
    expect(url.searchParams.get("destination")).toBe(`${destination.lat},${destination.lng}`);
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("travelmode")).toBe("driving");
  });

  it("throws a typed error for more than 9 stops rather than truncating the link", () => {
    const tooMany = Array.from({ length: MAX_WAYPOINTS + 1 }, (_, i) => ({ lat: i, lng: i }));
    expect(() => buildGoogleMapsUrl(origin, destination, tooMany)).toThrow(TooManyWaypointsError);
    expect(() => buildGoogleMapsUrl(origin, destination, tooMany)).toThrow(/10/);
  });

  it("accepts exactly 9 waypoints", () => {
    const nine = Array.from({ length: MAX_WAYPOINTS }, (_, i) => ({ lat: i, lng: i }));
    expect(() => buildGoogleMapsUrl(origin, destination, nine)).not.toThrow();
  });
});
