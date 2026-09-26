import { describe, expect, it } from "vitest";
import { normalizeAddress } from "./addressNormalize.js";

describe("normalizeAddress", () => {
  it("never mutates or overwrites its argument — it returns a new string", () => {
    const addressRaw = "233 S. Wacker Dr., Chicago, IL 60606";
    const normalized = normalizeAddress(addressRaw);
    expect(addressRaw).toBe("233 S. Wacker Dr., Chicago, IL 60606");
    expect(normalized).not.toBe(addressRaw);
  });

  it("returns an empty string for blank input without throwing", () => {
    expect(normalizeAddress("")).toBe("");
    expect(normalizeAddress("   ")).toBe("");
  });

  describe("folds spelling variance that cannot change which place is meant", () => {
    const equivalentPairs: Array<[string, string, string]> = [
      [
        "case and full-word spellings",
        "233 S Wacker Dr, Chicago, IL 60606",
        "233 south wacker drive chicago illinois 60606",
      ],
      [
        "punctuation and repeated whitespace",
        "233 S. Wacker Dr., Chicago, IL 60606",
        "233   S  Wacker   Dr   Chicago   IL   60606",
      ],
      [
        "suite vs ste vs # unit designator",
        "1 Main St Suite 200, Springfield, IL 62701",
        "1 Main St Ste 200 Springfield IL 62701",
      ],
      [
        "suite vs # unit designator",
        "1 Main St Suite 200, Springfield, IL 62701",
        "1 Main St #200, Springfield, IL 62701",
      ],
      [
        "directional abbreviation vs full word",
        "100 N Elm St, Dallas, TX 75201",
        "100 North Elm Street, Dallas, Texas 75201",
      ],
      [
        "ZIP+4 collapses to ZIP5",
        "500 Commerce St, Fort Worth, TX 76102-4212",
        "500 Commerce St, Fort Worth, TX 76102",
      ],
    ];

    for (const [label, a, b] of equivalentPairs) {
      it(`merges: ${label}`, () => {
        expect(normalizeAddress(a)).toBe(normalizeAddress(b));
      });
    }
  });

  describe("never merges addresses that could be different places", () => {
    const distinctPairs: Array<[string, string, string]> = [
      ["different house number", "100 Main St, Hughes, AR 72348", "102 Main St, Hughes, AR 72348"],
      ["different directional", "100 N Elm St, Dallas, TX 75201", "100 S Elm St, Dallas, TX 75201"],
      ["different city/state/ZIP", "100 Main St, Hughes, AR 72348", "100 Main St, Beatty, NV 89003"],
      [
        "different unit number",
        "1 Main St Ste 200, Springfield, IL 62701",
        "1 Main St Ste 300, Springfield, IL 62701",
      ],
      [
        "no unit vs a unit present",
        "1 Main St, Springfield, IL 62701",
        "1 Main St Ste 200, Springfield, IL 62701",
      ],
      [
        "Saint/St is never guessed — ambiguous with the Street abbreviation, unlike cityNormalize's Census expansion",
        "Saint Louis, MO",
        "St Louis, MO",
      ],
    ];

    for (const [label, a, b] of distinctPairs) {
      it(`keeps distinct: ${label}`, () => {
        expect(normalizeAddress(a)).not.toBe(normalizeAddress(b));
      });
    }
  });

  it("produces the exact normalized form for a representative address", () => {
    expect(normalizeAddress("233 S. Wacker Dr., Chicago, IL 60606")).toBe("233 s wacker dr chicago il 60606");
  });
});
