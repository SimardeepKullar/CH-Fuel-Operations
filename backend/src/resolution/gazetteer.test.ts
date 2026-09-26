import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBvdCsv, type RawBvdRow } from "../ingest/parseBvdCsv.js";
import { matchStationsToOperatorExport, type OperatorExportRow } from "./operatorExport.js";
import {
  isCityTierEligible,
  matchStationsToGazetteer,
  matchToGazetteer,
  type PlaceCentroid,
  type StationForGazetteerMatch,
} from "./gazetteer.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(dirname, "../../test/fixtures/loves");

const eloyAz: PlaceCentroid = {
  stateUsps: "AZ",
  nameNormalized: "Eloy",
  latitude: 32.7548,
  longitude: -111.5527,
  uncertaintyMiles: 3.748,
};

const centroids: readonly PlaceCentroid[] = [eloyAz];

describe("matchToGazetteer", () => {
  it("matches on (state, normalized city) and carries the centroid's uncertainty", () => {
    const match = matchToGazetteer("ELOY", "AZ", centroids);
    expect(match).not.toBeNull();
    expect(match?.resolution).toBe("city");
    expect(match?.resolutionSource).toBe("gazetteer");
    expect(match?.cityNormalized).toBe("Eloy");
    expect(match?.uncertaintyMiles).toBe(3.748);
    expect(match?.latitude).toBe(32.7548);
    expect(match?.longitude).toBe(-111.5527);
  });

  it("normalises before matching — an already-clean raw string still matches", () => {
    expect(matchToGazetteer("Eloy", "AZ", centroids)).not.toBeNull();
  });

  it("returns null, never throws, when no centroid matches — the state disagrees", () => {
    expect(matchToGazetteer("ELOY", "TX", centroids)).toBeNull();
  });

  it("returns null, never throws, when no centroid matches — the city is unknown", () => {
    expect(matchToGazetteer("NOWHERESVILLE", "AZ", centroids)).toBeNull();
  });
});

describe("matchStationsToGazetteer", () => {
  it("preserves input order and reports the normalized city even on a miss", () => {
    const stations: StationForGazetteerMatch[] = [
      { id: "s1", cityRaw: "ELOY", stateUsps: "AZ" },
      { id: "s2", cityRaw: "NOWHERESVILLE", stateUsps: "AZ" },
    ];
    const results = matchStationsToGazetteer(stations, centroids);
    expect(results.map((r) => r.stationId)).toEqual(["s1", "s2"]);
    expect(results[0]?.match).not.toBeNull();
    expect(results[0]?.cityNormalized).toBe("Eloy");
    expect(results[1]?.match).toBeNull();
    expect(results[1]?.cityNormalized).toBe("Nowheresville");
  });
});

describe("isCityTierEligible", () => {
  it("excludes a city-tier station with uncertainty 7.5 mi, regardless of slack", () => {
    expect(isCityTierEligible(7.5, 1_000)).toBe(false);
  });

  it("includes a city-tier station with uncertainty 2 mi on a leg with enough slack", () => {
    expect(isCityTierEligible(2, 4)).toBe(true);
  });

  it("excludes uncertainty 2 mi when the leg does not have 2u of slack", () => {
    expect(isCityTierEligible(2, 3.999)).toBe(false);
  });

  it("excludes exactly at the 5 mile boundary — the rule is strictly under 5 miles", () => {
    expect(isCityTierEligible(5, 1_000)).toBe(false);
  });

  it("includes just under the 5 mile boundary with enough slack", () => {
    expect(isCityTierEligible(4.999, 2 * 4.999)).toBe(true);
  });

  it("excludes just under the boundary when the leg has less than 2u of slack", () => {
    expect(isCityTierEligible(4.999, 2 * 4.999 - 0.001)).toBe(false);
  });
});

const operatorRows: OperatorExportRow[] = JSON.parse(
  readFileSync(path.join(fixturesDir, "operator_export.json"), "utf8"),
);

type AmbiguousPair = readonly [state: string, cityRaw: string];

/**
 * A (city, state) held by more than one station cannot be placed by the
 * gazetteer, so those rows must be resolved by store number at tier 1.
 */
function ambiguousPairsResolveByStoreNumber(
  rows: () => RawBvdRow[],
  pairs: readonly AmbiguousPair[],
  expectedRows: number,
): void {
  const inAmbiguousPair = (row: RawBvdRow) =>
    pairs.some(([state, city]) => row.state === state && row.city === city);

  it("covers exactly the measured number of rows", () => {
    expect(rows().filter(inAmbiguousPair)).toHaveLength(expectedRows);
  });

  it("resolves every one by store number at tier 1 — resolution_source is always operator_export", () => {
    const all = rows();
    const stations = all.map((row) => ({
      id: row.site,
      nameRaw: row.name,
      stateUsps: row.state,
    }));
    const result = matchStationsToOperatorExport(stations, operatorRows);
    const matchedById = new Map(result.matched.map((m) => [m.stationId, m]));

    for (const row of all.filter(inAmbiguousPair)) {
      const match = matchedById.get(row.site);
      expect(match).toBeDefined();
      expect(match?.update.resolutionSource).toBe("operator_export");
      expect(match?.update.resolution).toBe("exact");
    }
  });
}

describe("the ambiguous (city, state) pairs never reach the gazetteer — sample sheet", () => {
  ambiguousPairsResolveByStoreNumber(
    () =>
      parseBvdCsv(readFileSync(new URL("../../test/fixtures/bvd-prices/sample.csv", import.meta.url)))
        .rows,
    [
      ["AR", "Prescott"],
      ["OK", "Oklahoma City"],
      ["TX", "Amarillo"],
    ],
    6,
  );
});

// The real price sheets are gitignored — see the root .gitignore. Tests that
// assert their exact figures skip when they are absent, as CI's checkout is.
const REAL_AUGUST = new URL("../../../data/bvd-prices/pcn-usd-9206810-981.csv", import.meta.url);

describe.skipIf(!existsSync(REAL_AUGUST))(
  "the 9 ambiguous (city, state) pairs never reach the gazetteer — real August sheet (local files only)",
  () => {
    // §4.5's own count: 593 distinct (raw city, state) pairs across 605 rows,
    // exactly 9 held by more than one station, covering 21 rows.
    ambiguousPairsResolveByStoreNumber(
      () => parseBvdCsv(readFileSync(REAL_AUGUST)).rows,
      [
        ["AR", "Prescott"],
        ["FL", "Fort Pierce"],
        ["FL", "Jacksonville"],
        ["NM", "Albuquerque"],
        ["OK", "Oklahoma City"],
        ["TX", "Amarillo"],
        ["TX", "Houston"],
        ["TX", "Lufkin"],
        ["TX", "Van"],
      ],
      21,
    );
  },
);
