import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBvdCsv, type RawBvdRow } from "../ingest/parseBvdCsv.js";
import {
  BvdDirectoryError,
  mapDirectoryRows,
  matchStationsToOperatorExport,
  parseBvdDirectoryCsv,
  resolveFromOperatorRow,
  stationFromDirectoryRow,
  type BvdDirectoryRow,
  type OperatorExportRow,
  type StationForMatch,
} from "./operatorExport.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(dirname, "../../test/fixtures/US-CA-GasStations");

// A real matched row (LOVES #211, Oklahoma City) from data/US-CA-GasStations/LovesSearchResults.xlsx.
const travelStopRow: OperatorExportRow = {
  storeNumber: 211,
  state: "OK",
  city: "Oklahoma City",
  address: "845 SE 89th St",
  zip: "73149",
  highwayOrExit: "I-35 / 120",
  latitude: 35.377871,
  longitude: -97.495873,
  storeType: "Travel Stop",
  parkingSpaces: 17,
  defLanes: 6,
};

// A real Car Stop row (LOVES #245) — no diesel lanes, so never operator_verified.
const carStopRow: OperatorExportRow = {
  storeNumber: 245,
  state: "OK",
  city: "Oklahoma City",
  address: "3233 SW 89th St",
  zip: "73159",
  highwayOrExit: "I-44 / 113",
  latitude: 35.377833,
  longitude: -97.573646,
  storeType: "Car Stop",
  parkingSpaces: null,
  defLanes: null,
};

const ALLOWED_OPERATOR_ATTR_KEYS = [
  "StoreType",
  "ParkingSpaces",
  "DEFLanes",
  "Address",
  "Zip",
  "HighwayOrExit",
].sort();

// §11.4 step 1's coordinate-sanity table, rounded to 2dp as the doc records
// it — the real data's extremes round-trip to exactly these bounds.
const CONUS_LAT: [number, number] = [25.95, 48.57];
const CONUS_LNG: [number, number] = [-123.37, -72.26];

describe("resolveFromOperatorRow", () => {
  it("a Travel Stop with DEFLanes is operator_verified (§11.5)", () => {
    const update = resolveFromOperatorRow(travelStopRow);
    expect(update.truckAccessible).toBe("operator_verified");
    expect(update.resolution).toBe("exact");
    expect(update.uncertaintyMiles).toBe(0);
    expect(update.resolutionSource).toBe("operator_export");
  });

  it("a Car Stop with no DEFLanes stays unverified", () => {
    const update = resolveFromOperatorRow(carStopRow);
    expect(update.truckAccessible).toBe("unverified");
  });

  it("operator_attrs never carries a price field — the closed key set", () => {
    const update = resolveFromOperatorRow(travelStopRow);
    expect(Object.keys(update.operatorAttrs).sort()).toEqual(ALLOWED_OPERATOR_ATTR_KEYS);
  });
});

describe("matchStationsToOperatorExport", () => {
  const stations: StationForMatch[] = [
    { id: "s1", nameRaw: "LOVES #211", stateUsps: "OK" },
    { id: "s2", nameRaw: "LOVES #999", stateUsps: "OK" },
    { id: "s3", nameRaw: "UNRECOGNISED BRAND", stateUsps: "OK" },
  ];

  it("matches by store number and leaves the rest unmatched, never throwing", () => {
    const result = matchStationsToOperatorExport(stations, [travelStopRow]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.stationId).toBe("s1");
    expect(result.unmatched.map((s) => s.id).sort()).toEqual(["s2", "s3"]);
  });

  it("flags state disagreement rather than silently accepting a wrong join", () => {
    const result = matchStationsToOperatorExport(
      [{ id: "s1", nameRaw: "LOVES #211", stateUsps: "TX" }],
      [travelStopRow],
    );
    expect(result.matched[0]?.stateAgrees).toBe(false);
  });
});

const operatorRows: OperatorExportRow[] = JSON.parse(
  readFileSync(path.join(fixturesDir, "operator_export.json"), "utf8"),
);

describe("the committed operator-export fixture", () => {
  it("the committed fixture carries only location/amenity fields, never a price column (§17.1)", () => {
    const priceLikeKeys = [
      "unleaded",
      "midgrade",
      "premium",
      "diesel",
      "blend",
      "propane",
      "bulkdef",
      "price",
    ];
    for (const row of operatorRows) {
      const keys = Object.keys(row).map((k) => k.toLowerCase());
      for (const forbidden of priceLikeKeys) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });
});

/** Every price sheet's stations resolve through the operator export the same way; only the counts differ. */
function operatorExportResolves(
  rows: () => RawBvdRow[],
  expectedMatched: number,
  expectedUnmatchedName: string,
): void {
  const match = () => {
    const stations: StationForMatch[] = rows().map((row) => ({
      id: row.site,
      nameRaw: row.name,
      stateUsps: row.state,
    }));
    return matchStationsToOperatorExport(stations, operatorRows);
  };

  it("matches every station but the one the export does not carry", () => {
    const result = match();
    expect(result.matched).toHaveLength(expectedMatched);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]?.nameRaw).toBe(expectedUnmatchedName);
  });

  it("state agreement holds on every match — an independent check", () => {
    const disagreements = match().matched.filter((m) => !m.stateAgrees);
    expect(disagreements).toEqual([]);
  });

  it("every match is a Travel Stop with DEFLanes, so all resolve operator_verified", () => {
    for (const m of match().matched) {
      expect(m.operatorRow.storeType).toBe("Travel Stop");
      expect(m.operatorRow.defLanes).not.toBeNull();
      expect(m.update.truckAccessible).toBe("operator_verified");
    }
  });

  it("every matched coordinate falls inside CONUS", () => {
    for (const m of match().matched) {
      const lat = Math.round(m.update.latitude * 100) / 100;
      const lon = Math.round(m.update.longitude * 100) / 100;
      expect(lat).toBeGreaterThanOrEqual(CONUS_LAT[0]);
      expect(lat).toBeLessThanOrEqual(CONUS_LAT[1]);
      expect(lon).toBeGreaterThanOrEqual(CONUS_LNG[0]);
      expect(lon).toBeLessThanOrEqual(CONUS_LNG[1]);
    }
  });

  it("none of the matched updates' operator_attrs carry a price field", () => {
    for (const m of match().matched) {
      expect(Object.keys(m.update.operatorAttrs).sort()).toEqual(ALLOWED_OPERATOR_ATTR_KEYS);
    }
  });
}

describe("operator-export resolution against the sample sheet", () => {
  // 12 stations; #306 is the one the operator export does not carry.
  operatorExportResolves(
    () =>
      parseBvdCsv(readFileSync(new URL("../../test/fixtures/bvd-prices/sample.csv", import.meta.url)))
        .rows,
    11,
    "LOVES #306",
  );
});

// The real price sheets are gitignored — see the root .gitignore. Tests that
// assert their exact figures skip when they are absent, as CI's checkout is.
const REAL_AUGUST = new URL("../../../data/bvd-prices/pcn-usd-9206810-981.csv", import.meta.url);

describe.skipIf(!existsSync(REAL_AUGUST))(
  "operator-export resolution against the real August sheet (local files only)",
  () => {
    // 604 of 605 match; the miss is store #306.
    operatorExportResolves(() => parseBvdCsv(readFileSync(REAL_AUGUST)).rows, 604, "LOVES #306");
  },
);

// ─── BVD travel-centre directory (T-60 step 60.2) ───────────────────────────

// Committed (D29), so these run in CI — unlike the gitignored price sheets.
const DIRECTORY_CSV = new URL(
  "../../../data/US-CA-GasStations/bvd-travel-centres-2026-10-01.csv",
  import.meta.url,
);

const ALLOWED_DIRECTORY_ATTR_KEYS = [
  "Status",
  "StoreId",
  "Address",
  "PostalCode",
  "Highway",
  "Exit",
  "DEFAtPump",
  "TruckParking",
  "CatScale",
];

function readDirectory(): BvdDirectoryRow[] {
  return parseBvdDirectoryCsv(readFileSync(DIRECTORY_CSV));
}

function directoryRow(overrides: Partial<BvdDirectoryRow>): BvdDirectoryRow {
  return {
    lineNumber: 2,
    siteName: "BVD Comber",
    siteRef: "58156",
    storeId: "1019",
    status: "Open",
    address: "7018 Industrial Dr",
    city: "Comber",
    province: "Ontario",
    country: "Canada",
    postalCode: "N0P 1J0",
    highway: "",
    exit: "",
    defAtPump: "Yes",
    truckParking: "",
    catScale: "Yes",
    latitude: "42.23884",
    longitude: "-82.54973",
    ...overrides,
  };
}

describe("the BVD travel-centre directory (T-60)", () => {
  it("maps Comber (58156) to ON with its coordinates as printed", () => {
    const { stations } = mapDirectoryRows(readDirectory());
    const comber = stations.find((s) => s.siteRef === "58156");
    expect(comber).toEqual({
      siteRef: "58156",
      nameRaw: "BVD Comber",
      cityRaw: "Comber",
      provinceCode: "ON",
      country: "CA",
      latitude: 42.23884,
      longitude: -82.54973,
      operatorAttrs: {
        Status: "Open",
        StoreId: "1019",
        Address: "7018 Industrial Dr",
        PostalCode: "N0P 1J0",
        Highway: null,
        Exit: null,
        DEFAtPump: true,
        TruckParking: false,
        CatScale: true,
      },
    });
  });

  it("maps 91 stations and reports the one row with no Site # by name, unmapped", () => {
    const { stations, skipped } = mapDirectoryRows(readDirectory());
    expect(stations).toHaveLength(91);
    expect(skipped).toEqual([{ lineNumber: 19, nameRaw: "BVD Nisku", reason: "NO_SITE_NUMBER" }]);
    expect(stations.map((s) => s.nameRaw)).not.toContain("BVD Nisku");
  });

  it("every row's operator_attrs keys are within the closed set, and none names a price (§17.1)", () => {
    const priceWords = ["price", "cost", "diesel", "gasoline", "unleaded", "retail", "rate"];
    for (const s of mapDirectoryRows(readDirectory()).stations) {
      const keys = Object.keys(s.operatorAttrs);
      for (const key of keys) {
        expect(ALLOWED_DIRECTORY_ATTR_KEYS).toContain(key);
        for (const word of priceWords) {
          expect(key.toLowerCase()).not.toContain(word);
        }
      }
    }
  });

  it("every station is CA with a two-letter province code", () => {
    for (const s of mapDirectoryRows(readDirectory()).stations) {
      expect(s.country).toBe("CA");
      expect(s.provinceCode).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("loads Coming soon and Temporarily closed rows — an invoice can name them", () => {
    const statuses = new Set(
      mapDirectoryRows(readDirectory()).stations.map((s) => s.operatorAttrs.Status),
    );
    expect(statuses).toEqual(new Set(["Open", "Coming soon", "Temporarily closed"]));
  });

  it("agrees with the Python loader's mapping of the same file (bvd_directory.json)", () => {
    const fromPython = JSON.parse(readFileSync(path.join(fixturesDir, "bvd_directory.json"), "utf8"));
    expect(mapDirectoryRows(readDirectory())).toEqual(fromPython);
  });

  it("parses identically from CRLF and LF line endings", () => {
    const text = readFileSync(DIRECTORY_CSV, "utf8").replace(/\r\n/g, "\n");
    const lf = parseBvdDirectoryCsv(text);
    const crlf = parseBvdDirectoryCsv(text.replace(/\n/g, "\r\n"));
    expect(crlf).toEqual(lf);
    expect(mapDirectoryRows(crlf)).toEqual(mapDirectoryRows(lf));
    expect(lf).toHaveLength(92);
  });

  it("an unknown province throws, naming the row — never a guess", () => {
    expect(() => stationFromDirectoryRow(directoryRow({ province: "Narnia", lineNumber: 7 }))).toThrow(
      /line 7 \(BVD Comber, Site # 58156\): unknown province 'Narnia'/,
    );
  });

  it("a country other than Canada throws, naming the row", () => {
    expect(() => stationFromDirectoryRow(directoryRow({ country: "United States" }))).toThrow(
      BvdDirectoryError,
    );
  });

  it("a non-numeric coordinate throws rather than storing NaN", () => {
    expect(() => stationFromDirectoryRow(directoryRow({ latitude: "" }))).toThrow(/Latitude/);
  });

  it("a duplicate Site # throws — it is the upsert key", () => {
    expect(() => mapDirectoryRows([directoryRow({}), directoryRow({ lineNumber: 3 })])).toThrow(
      /duplicate Site #: 58156/,
    );
  });

  it("flags: Yes → true, blank → false, a parking count → number, anything else → null", () => {
    const attrs = (o: Partial<BvdDirectoryRow>) => stationFromDirectoryRow(directoryRow(o)).operatorAttrs;
    expect(attrs({ truckParking: "110" }).TruckParking).toBe(110);
    expect(attrs({ truckParking: "Yes" }).TruckParking).toBe(true);
    expect(attrs({ truckParking: "" }).TruckParking).toBe(false);
    expect(attrs({ truckParking: "lots" }).TruckParking).toBeNull();
    expect(attrs({ defAtPump: "" }).DEFAtPump).toBe(false);
    expect(attrs({ catScale: "maybe" }).CatScale).toBeNull();
  });

  it("a header missing a column is an error, not a row of blanks", () => {
    const text = readFileSync(DIRECTORY_CSV, "utf8").replace("Site #", "Site Number");
    expect(() => parseBvdDirectoryCsv(text)).toThrow(/missing column\(s\): Site #/);
  });
});
