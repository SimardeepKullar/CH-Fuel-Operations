/**
 * Normalises BVD's `city_raw` into the exact string convention the Census
 * Gazetteer uses for `place_centroids.name_normalized` (§4.6, §11.4 step 3)
 * — `scripts/load_gazetteer.py` strips only the Census legal/statistical
 * suffix ("city", "village", "CDP", "township", ...) and otherwise leaves
 * NAME untouched, so this function has to reproduce the *real* Census
 * spelling, not just a generic title-case.
 *
 * Two independent problems, both present in the 605-row August sheet:
 *  - 25 rows arrive ALL-CAPS ("ELOY", "TRUTH OR CONSEQUENCES").
 *  - 5 rows arrive with an abbreviated first word ("Mc Calla", "Mt Juliet",
 *    "Mt Vernon", "N Little Rock", "St Augustine") that Census does not
 *    abbreviate the same way for every prefix: "Mc" joins solid, "Mt" and
 *    "N" spell out, "St" stays abbreviated but gains a period. Verified
 *    against the live 2024 Census Gazetteer for every one of these exact
 *    (state, city) pairs — see cityNormalizeCases.ts.
 */

const MINOR_WORDS = new Set(["of", "the", "and", "or"]);

function isAllCaps(value: string): boolean {
  return /[A-Z]/.test(value) && !/[a-z]/.test(value);
}

/** Exported so `resolve/normalizeName.ts` (T-26) reuses this word-casing rather than a second copy. */
export function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(" ")
    .map((word, index) => {
      if (index > 0 && MINOR_WORDS.has(word)) {
        return word;
      }
      return word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word;
    })
    .join(" ");
}

/**
 * Census does not abbreviate every prefix the same way, so this is a fixed
 * lookup, not a rule — closed over the 5 rows §4.6 names, not a general
 * abbreviation expander. Exported so `resolve/normalizeName.ts` (T-26 step
 * 26.1) shares this exact vocabulary for driver-name matching rather than
 * writing a second copy that could drift from this one.
 */
export function expandAbbreviatedPrefix(value: string): string {
  const match = /^(Mc|Mt|St|N)\s+(.+)$/i.exec(value);
  if (!match) {
    return value;
  }
  const [, prefix, rest] = match as unknown as [string, string, string];
  switch (prefix.toLowerCase()) {
    case "mc":
      return `Mc${rest}`;
    case "mt":
      return `Mount ${rest}`;
    case "n":
      return `North ${rest}`;
    case "st":
      return `St. ${rest}`;
    default:
      return value;
  }
}

/** `city_raw` is never overwritten — this returns a new string, it never mutates its argument. */
export function normalizeCity(cityRaw: string): string {
  const trimmed = cityRaw.trim();
  const cased = isAllCaps(trimmed) ? toTitleCase(trimmed) : trimmed;
  return expandAbbreviatedPrefix(cased);
}
