import { describe, expect, it } from "vitest";
import { normalizeName } from "./normalizeName.js";
import { normalizeCity } from "../resolution/cityNormalize.js";
import { ABBREVIATED_PREFIX_CASES } from "../../test/fixtures/gazetteer/cityNormalizeCases.js";

describe("normalizeName", () => {
  it("collapses internal whitespace", () => {
    expect(normalizeName("ELLIS  PARK")).toBe(normalizeName("ELLIS PARK"));
  });

  it("case folds regardless of the input's original casing", () => {
    expect(normalizeName("kit barnes")).toBe(normalizeName("KIT BARNES"));
    expect(normalizeName("Kit Barnes")).toBe(normalizeName("KIT BARNES"));
  });

  it("strips punctuation without gluing words together", () => {
    expect(normalizeName("ARDEN L. SHAW")).toBe(normalizeName("ARDEN L SHAW"));
    expect(normalizeName("JEAN-PIERRE")).toBe(normalizeName("JEAN PIERRE"));
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeName("  JORDAN  ")).toBe(normalizeName("JORDAN"));
  });

  it("agrees with cityNormalize's Mc/Mt/St/N prefix vocabulary on a shared fixture", () => {
    for (const { cityRaw, expected } of ABBREVIATED_PREFIX_CASES) {
      // cityNormalize only re-cases true ALL-CAPS input, so feed it the
      // fixture's already-clean casing directly; normalizeName case-folds
      // unconditionally, so a lowercased spelling reaches the same prefix
      // expansion through the same shared function.
      expect(normalizeName(cityRaw.toLowerCase())).toBe(normalizeCity(cityRaw));
      expect(normalizeCity(cityRaw)).toBe(expected);
    }
  });

  it("never mutates its argument", () => {
    const nameRaw = "JORDAN";
    normalizeName(nameRaw);
    expect(nameRaw).toBe("JORDAN");
  });
});
