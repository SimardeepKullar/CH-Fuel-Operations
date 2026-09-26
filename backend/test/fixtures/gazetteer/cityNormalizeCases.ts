/**
 * The 30 known-dirty `city_raw` strings from `data/bvd-prices/` (§4.6: 25 ALL-CAPS
 * + 5 abbreviated prefixes), each paired with the real Census 2024
 * Gazetteer `name_normalized` value for that exact (state, city) —
 * `scripts/load_gazetteer.py`'s Place/County-Subdivision suffix-stripping
 * applied to the live 2024_Gaz_place_national / 2024_Gaz_cousubs_national
 * files, fetched from www2.census.gov and checked by hand against every
 * row below.
 *
 * This is the "shared fixture" BUILD-PLAN step 9.1 asks for: proof that
 * `normalizeCity()` converges on the same string
 * `scripts/load_gazetteer.py` would have already stored, for every dirty
 * string that exists in the real data — not just a plausible-looking
 * title-case.
 */
export interface CityNormalizeCase {
  stateUsps: string;
  cityRaw: string;
  expected: string;
}

export const ALL_CAPS_CASES: readonly CityNormalizeCase[] = [
  { stateUsps: "NM", cityRaw: "ALBUQUERQUE", expected: "Albuquerque" },
  { stateUsps: "OH", cityRaw: "BELMONT", expected: "Belmont" },
  { stateUsps: "CO", cityRaw: "BRIGHTON", expected: "Brighton" },
  { stateUsps: "WY", cityRaw: "BUFFALO", expected: "Buffalo" },
  { stateUsps: "NV", cityRaw: "CARLIN", expected: "Carlin" },
  { stateUsps: "MO", cityRaw: "CHARLESTON", expected: "Charleston" },
  { stateUsps: "OH", cityRaw: "DELTA", expected: "Delta" },
  { stateUsps: "VA", cityRaw: "ELLISTON", expected: "Elliston" },
  { stateUsps: "AZ", cityRaw: "ELOY", expected: "Eloy" },
  { stateUsps: "MO", cityRaw: "FREDERICKTOWN", expected: "Fredericktown" },
  { stateUsps: "MT", cityRaw: "LAUREL", expected: "Laurel" },
  { stateUsps: "TN", cityRaw: "MANCHESTER", expected: "Manchester" },
  { stateUsps: "LA", cityRaw: "MANDEVILLE", expected: "Mandeville" },
  { stateUsps: "OH", cityRaw: "MILAN", expected: "Milan" },
  { stateUsps: "TX", cityRaw: "PREMONT", expected: "Premont" },
  { stateUsps: "ND", cityRaw: "STERLING", expected: "Sterling" },
  { stateUsps: "CO", cityRaw: "TRINIDAD", expected: "Trinidad" },
  { stateUsps: "TX", cityRaw: "TULIA", expected: "Tulia" },
  { stateUsps: "IL", cityRaw: "WILMINGTON", expected: "Wilmington" },
  { stateUsps: "TX", cityRaw: "BIG SPRING", expected: "Big Spring" },
  { stateUsps: "LA", cityRaw: "NEW IBERIA", expected: "New Iberia" },
  { stateUsps: "IL", cityRaw: "ROCK FALLS", expected: "Rock Falls" },
  { stateUsps: "TX", cityRaw: "SAN ANTONIO", expected: "San Antonio" },
  { stateUsps: "NM", cityRaw: "TRUTH OR CONSEQUENCES", expected: "Truth or Consequences" },
  { stateUsps: "OH", cityRaw: "WEST JEFFERSON", expected: "West Jefferson" },
];

export const ABBREVIATED_PREFIX_CASES: readonly CityNormalizeCase[] = [
  { stateUsps: "AL", cityRaw: "Mc Calla", expected: "McCalla" },
  { stateUsps: "TN", cityRaw: "Mt Juliet", expected: "Mount Juliet" },
  { stateUsps: "IL", cityRaw: "Mt Vernon", expected: "Mount Vernon" },
  { stateUsps: "AR", cityRaw: "N Little Rock", expected: "North Little Rock" },
  { stateUsps: "FL", cityRaw: "St Augustine", expected: "St. Augustine" },
];

export const ALL_CITY_NORMALIZE_CASES: readonly CityNormalizeCase[] = [
  ...ALL_CAPS_CASES,
  ...ABBREVIATED_PREFIX_CASES,
];
