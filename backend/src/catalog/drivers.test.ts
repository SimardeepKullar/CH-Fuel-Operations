import { describe, expect, it } from "vitest";
import { matchDriverName, type DriverAliasForMatch, type DriverForMatch } from "./drivers.js";
import { normalizeName } from "../resolve/normalizeName.js";

const DRIVERS: DriverForMatch[] = [
  { id: "d-kit", displayName: "KIT BARNES" },
  { id: "d-ellis", displayName: "ELLIS PARK" },
  { id: "d-arden", displayName: "ARDEN LEE SHAW" },
];

const ALIASES: DriverAliasForMatch[] = [
  { aliasNormalized: normalizeName("ARDEN L SHAW"), driverId: "d-arden" },
  { aliasNormalized: normalizeName("A SHAW"), driverId: "d-arden" },
];

describe("matchDriverName", () => {
  it("matches a double-spaced name against the display name", () => {
    expect(matchDriverName("ELLIS  PARK", ALIASES, DRIVERS)).toEqual({
      matched: true,
      driverId: "d-ellis",
    });
  });

  it("matches a lowercase name against the display name, case-insensitively", () => {
    expect(matchDriverName("kit barnes", ALIASES, DRIVERS)).toEqual({
      matched: true,
      driverId: "d-kit",
    });
  });

  it("matches an abbreviated name through driver_aliases", () => {
    expect(matchDriverName("ARDEN L SHAW", ALIASES, DRIVERS)).toEqual({
      matched: true,
      driverId: "d-arden",
    });
  });

  it("returns unmatched for a name with no alias and no display-name hit — never a best guess", () => {
    expect(matchDriverName("emerson", ALIASES, DRIVERS)).toEqual({ matched: false });
  });

  it("resolves both of two aliases pointing at the same driver", () => {
    expect(matchDriverName("ARDEN L SHAW", ALIASES, DRIVERS)).toEqual({
      matched: true,
      driverId: "d-arden",
    });
    expect(matchDriverName("A SHAW", ALIASES, DRIVERS)).toEqual({
      matched: true,
      driverId: "d-arden",
    });
  });

  it("returns unmatched against an empty roster rather than throwing", () => {
    expect(matchDriverName("ANYONE", [], [])).toEqual({ matched: false });
  });
});
