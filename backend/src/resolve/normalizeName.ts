import { expandAbbreviatedPrefix, toTitleCase } from "../resolution/cityNormalize.js";

/**
 * Punctuation that free-text driver names carry (periods after initials,
 * commas, quotes) and is dropped outright, versus separators (hyphens,
 * slashes, underscores) that stand in for a space and would otherwise glue
 * two words together if simply deleted.
 */
const DROPPED_PUNCTUATION_PATTERN = /['".,()]/g;
const SEPARATOR_PUNCTUATION_PATTERN = /[-_/]/g;

/**
 * Canonical form of a free-text driver name — invoice `driver_name_raw`, a
 * `driver_aliases.alias_normalized` key, or `drivers.display_name` — so any
 * two spellings of one name compare equal (T-26 step 26.1). Case folds
 * unconditionally (unlike `normalizeCity`, which only corrects true
 * ALL-CAPS input): raw driver names arrive upper-, lower- and mixed-case
 * alike, so there is no "already clean" case to leave untouched here.
 *
 * Reuses `cityNormalize.ts`'s word-casing and Mc/Mt/St/N prefix vocabulary
 * (T-09 step 9.1) rather than a second copy that could drift from it — the
 * DoD requires the two agree on a shared fixture.
 */
export function normalizeName(nameRaw: string): string {
  const withoutPunctuation = nameRaw
    .replace(SEPARATOR_PUNCTUATION_PATTERN, " ")
    .replace(DROPPED_PUNCTUATION_PATTERN, "");
  const collapsed = withoutPunctuation.trim().split(/\s+/).join(" ");
  const cased = toTitleCase(collapsed.toLowerCase());
  return expandAbbreviatedPrefix(cased);
}
