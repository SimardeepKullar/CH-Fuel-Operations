/**
 * Normalises a dispatcher-typed address into `saved_locations.address_norm`,
 * the cache key (T-15, §11.6). **Conservative by design (decided
 * 2026-09-22):** a false merge of two different addresses silently hands a
 * driver the wrong coordinates and a wrong route, which is worse than a
 * cache miss that spends one more geocoding call. So this only folds
 * spelling variance that cannot change *which place* is meant — case,
 * whitespace, punctuation, a closed table of street-suffix, directional and
 * full state names, and the unit/suite designator word. Distinct house
 * numbers, unit numbers, directionals and ZIP codes are never touched.
 *
 * This deliberately does **not** reuse `resolution/cityNormalize.ts`'s
 * `St`/`Mt`/`N` prefix expansion. There, "St Augustine" and "Saint
 * Augustine" are the same Census place. Here, "St" is ambiguous between
 * "Saint" and "Street" ("St Louis" vs "123 Main St"), so guessing which one
 * is meant risks exactly the false merge this module exists to avoid —
 * "Saint Louis, MO" and "St Louis, MO" are left as two distinct cache rows
 * rather than guessed into one.
 *
 * Pure: no database, no HTTP, no clock (CLAUDE.md testing rules).
 */

/** The street-suffix spellings this fleet's lanes actually use — a closed table, not a general USPS Publication 28 expander. */
const STREET_SUFFIXES: Record<string, string> = {
  street: "st",
  str: "st",
  avenue: "ave",
  boulevard: "blvd",
  drive: "dr",
  road: "rd",
  lane: "ln",
  court: "ct",
  place: "pl",
  parkway: "pkwy",
  highway: "hwy",
  circle: "cir",
  trail: "trl",
  terrace: "ter",
  square: "sq",
};

const DIRECTIONALS: Record<string, string> = {
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
};

/** `#` is spaced into its own token upstream so it hits this same table. */
const UNIT_DESIGNATORS: Record<string, string> = {
  suite: "ste",
  unit: "ste",
  apartment: "ste",
  apt: "ste",
  "#": "ste",
};

/** USPS state/territory names, full lowercase name -> two-letter code. A closed table, checked as a whole-phrase suffix match — never a fuzzy one. */
const STATE_NAMES: Record<string, string> = {
  alabama: "al",
  alaska: "ak",
  arizona: "az",
  arkansas: "ar",
  california: "ca",
  colorado: "co",
  connecticut: "ct",
  delaware: "de",
  "district of columbia": "dc",
  florida: "fl",
  georgia: "ga",
  hawaii: "hi",
  idaho: "id",
  illinois: "il",
  indiana: "in",
  iowa: "ia",
  kansas: "ks",
  kentucky: "ky",
  louisiana: "la",
  maine: "me",
  maryland: "md",
  massachusetts: "ma",
  michigan: "mi",
  minnesota: "mn",
  mississippi: "ms",
  missouri: "mo",
  montana: "mt",
  nebraska: "ne",
  nevada: "nv",
  "new hampshire": "nh",
  "new jersey": "nj",
  "new mexico": "nm",
  "new york": "ny",
  "north carolina": "nc",
  "north dakota": "nd",
  ohio: "oh",
  oklahoma: "ok",
  oregon: "or",
  pennsylvania: "pa",
  "rhode island": "ri",
  "south carolina": "sc",
  "south dakota": "sd",
  tennessee: "tn",
  texas: "tx",
  utah: "ut",
  vermont: "vt",
  virginia: "va",
  washington: "wa",
  "west virginia": "wv",
  wisconsin: "wi",
  wyoming: "wy",
};

/** Longest name first, so "new york" is tried before a shorter false match could apply. */
const STATE_NAMES_BY_LENGTH = Object.keys(STATE_NAMES).sort((a, b) => b.length - a.length);

/** Replaces a trailing full state name with its USPS code. Already-abbreviated input ("il") matches no key and passes through untouched. */
function replaceTrailingStateName(body: string): string {
  for (const name of STATE_NAMES_BY_LENGTH) {
    if (body === name || body.endsWith(` ${name}`)) {
      return body.slice(0, body.length - name.length) + STATE_NAMES[name];
    }
  }
  return body;
}

/** `address_raw` is never overwritten (mirrors `city_raw`'s convention) — this returns a new string, it never mutates its argument. */
export function normalizeAddress(addressRaw: string): string {
  let text = addressRaw.normalize("NFKC").toLowerCase();
  text = text.replace(/#/g, " # ");
  text = text.replace(/[.,]/g, " ");
  text = text.replace(/\s+/g, " ").trim();

  if (text.length === 0) {
    return text;
  }

  const tokens = text.split(" ");
  const last = tokens[tokens.length - 1]!;
  let zip: string | undefined;
  if (/^\d{5}-\d{4}$/.test(last)) {
    zip = last.slice(0, 5);
    tokens.pop();
  } else if (/^\d{5}$/.test(last)) {
    zip = last;
    tokens.pop();
  }

  const body = replaceTrailingStateName(tokens.join(" "));

  const mapped = body
    .split(" ")
    .filter((token) => token.length > 0)
    .map((token) => UNIT_DESIGNATORS[token] ?? DIRECTIONALS[token] ?? STREET_SUFFIXES[token] ?? token);

  const result = mapped.join(" ");
  return zip ? `${result} ${zip}` : result;
}
