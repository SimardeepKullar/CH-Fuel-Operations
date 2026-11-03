import { describe, expect, it } from "vitest";
import {
  formatUnitNumber,
  metersToMiles,
  milesToKm,
  milesToMeters,
  sameUnit,
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

  describe("sameUnit", () => {
    it.each([
      ["50", "050"],
      ["72", "072"],
      ["01012", "1012"],
      [" 072 ", "072"],
      ["072", "072"],
      ["000", "0"],
    ])("treats %j and %j as the same truck", (entered, unitNumber) => {
      expect(sameUnit(entered, unitNumber)).toBe(true);
    });

    it.each([
      ["0", "072"],
      ["3224", "064"],
      ["07a", "07"],
      ["", "072"],
    ])("does not treat %j and %j as the same truck", (entered, unitNumber) => {
      expect(sameUnit(entered, unitNumber)).toBe(false);
    });
  });
});
