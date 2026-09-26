import { describe, expect, it } from "vitest";
import { decodePolyline } from "./polyline";

describe("decodePolyline", () => {
  it("decodes Google's reference vector, in GeoJSON [lng, lat] order", () => {
    // developers.google.com/maps/documentation/utilities/polylinealgorithm
    const decoded = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(decoded).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it("returns no coordinates for an empty string", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("honours a non-default precision", () => {
    // The same deltas read at precision 6 are ten times smaller.
    const [first] = decodePolyline("_p~iF~ps|U", 6);
    expect(first![0]).toBeCloseTo(-12.02, 6);
    expect(first![1]).toBeCloseTo(3.85, 6);
  });

  it("throws on a truncated string instead of drawing a short route", () => {
    // Drop the final character: the last longitude's continuation byte is left dangling.
    expect(() => decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`")).toThrow(/truncated/);
  });
});
