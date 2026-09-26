import { describe, expect, it } from "vitest";
import { normalizeCity } from "./cityNormalize.js";
import {
  ABBREVIATED_PREFIX_CASES,
  ALL_CAPS_CASES,
  ALL_CITY_NORMALIZE_CASES,
} from "../../test/fixtures/gazetteer/cityNormalizeCases.js";

describe("normalizeCity", () => {
  it("normalises all 25 ALL-CAPS rows (§4.6)", () => {
    for (const { cityRaw, expected } of ALL_CAPS_CASES) {
      expect(normalizeCity(cityRaw)).toBe(expected);
    }
  });

  it("expands all 5 abbreviated prefixes (§4.6)", () => {
    for (const { cityRaw, expected } of ABBREVIATED_PREFIX_CASES) {
      expect(normalizeCity(cityRaw)).toBe(expected);
    }
  });

  it("agrees with the real Census 2024 Gazetteer name on every one of the 30 known-dirty strings", () => {
    // ALL_CITY_NORMALIZE_CASES's `expected` values are the live Census
    // 2024_Gaz_place_national / 2024_Gaz_cousubs_national NAME, with
    // scripts/load_gazetteer.py's LSAD-suffix stripping already applied —
    // i.e. exactly what a fresh `place_centroids` load would carry as
    // `name_normalized` for these (state, city) pairs. See
    // cityNormalizeCases.ts for how each row was checked.
    for (const { cityRaw, expected } of ALL_CITY_NORMALIZE_CASES) {
      expect(normalizeCity(cityRaw)).toBe(expected);
    }
    expect(ALL_CITY_NORMALIZE_CASES).toHaveLength(30);
  });

  it("never mutates or overwrites city_raw — it returns a new string", () => {
    const cityRaw = "ELOY";
    const normalized = normalizeCity(cityRaw);
    expect(cityRaw).toBe("ELOY");
    expect(normalized).toBe("Eloy");
    expect(normalized).not.toBe(cityRaw);
  });

  it("leaves already-clean city strings unchanged", () => {
    expect(normalizeCity("Clanton")).toBe("Clanton");
    expect(normalizeCity("Oklahoma City")).toBe("Oklahoma City");
    expect(normalizeCity("Saint Louis")).toBe("Saint Louis");
    expect(normalizeCity("North Platte")).toBe("North Platte");
  });
});
