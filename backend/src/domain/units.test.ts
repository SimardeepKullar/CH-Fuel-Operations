import { describe, expect, it } from "vitest";
import {
  formatUnitNumber,
  metersToMiles,
  milesToKm,
  milesToMeters,
} from "./units.js";

describe("units", () => {
  it("round-trips meters to miles and back within 1e-9", () => {
    const meters = 1609.344;
    const miles = metersToMiles(meters);
    const roundTripped = milesToMeters(miles);
    expect(Math.abs(roundTripped - meters)).toBeLessThan(1e-9);
  });

  it("converts miles to km at exactly 1609.344 m per mile", () => {
    expect(milesToKm(1)).toBeCloseTo(1.609344, 9);
    expect(milesToKm(500)).toBeCloseTo(804.672, 9);
    expect(milesToKm(0)).toBe(0);
  });

  it("returns a 3-digit unit number unchanged, preserving its leading zero", () => {
    expect(formatUnitNumber("072")).toBe("072");
    expect(formatUnitNumber("031")).toBe("031");
  });

  it("returns a 4-digit unit number unchanged, not truncated", () => {
    expect(formatUnitNumber("1012")).toBe("1012");
  });

  it("rejects a unit number shorter than 3 digits rather than silently padding it", () => {
    expect(() => formatUnitNumber("31")).toThrow();
  });

  it("rejects non-digit input", () => {
    expect(() => formatUnitNumber("07a")).toThrow();
  });
});
