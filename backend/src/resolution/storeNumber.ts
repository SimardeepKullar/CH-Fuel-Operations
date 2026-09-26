/**
 * The join key for operator-export resolution (§11.4 step 1).
 *
 * Parsed out of `NAME` ("LOVES #368" -> 368), never `SITE` — `SITE` is BVD's
 * internal id and matches the store number in 0 of 605 rows. The pattern is
 * generic (strip a trailing "#nnnn"), not Love's-specific, so a future brand
 * that follows the same convention degrades gracefully instead of breaking.
 */

const TRAILING_STORE_NUMBER = /^(.*?)\s*#\s*(\d+)\s*$/;

export interface ParsedStoreName {
  brand: string;
  storeNumber: number | null;
}

/**
 * Never throws. A name with no recognisable "#nnnn" suffix yields the whole
 * trimmed string as `brand` and a null `storeNumber` — a station this
 * pattern cannot place is a candidate for the gazetteer/manual tiers (T-09),
 * not a parse failure.
 */
export function parseStoreName(nameRaw: string): ParsedStoreName {
  const trimmed = nameRaw.trim();
  const match = TRAILING_STORE_NUMBER.exec(trimmed);
  if (!match) {
    return { brand: trimmed, storeNumber: null };
  }
  return {
    brand: match[1]?.trim() ?? "",
    storeNumber: Number(match[2]),
  };
}
