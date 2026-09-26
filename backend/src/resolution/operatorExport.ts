import { parseStoreName } from "./storeNumber.js";

/**
 * One row of the Love's operator export, trimmed to the columns §11.4 step 1
 * names as useful beyond coordinates. Deliberately excludes every price
 * column the sheet carries (Unleaded, Midgrade, Premium, Diesel, Blend,
 * Propane, BulkDEF) — those are street prices, not contract prices, and
 * §17.1 forbids storing them (CLAUDE.md, "Never store price data from the
 * Love's export").
 */
export interface OperatorExportRow {
  storeNumber: number;
  state: string;
  city: string;
  address: string;
  zip: string;
  highwayOrExit: string | null;
  latitude: number;
  longitude: number;
  storeType: string;
  parkingSpaces: number | null;
  defLanes: number | null;
}

/** The exact, closed field set `operator_attrs` may ever carry (§17.1). */
export interface OperatorAttrs {
  StoreType: string;
  ParkingSpaces: number | null;
  DEFLanes: number | null;
  Address: string;
  Zip: string;
  HighwayOrExit: string | null;
}

export interface StationResolutionUpdate {
  resolution: "exact";
  uncertaintyMiles: 0;
  resolutionSource: "operator_export";
  truckAccessible: "operator_verified" | "unverified";
  operatorAttrs: OperatorAttrs;
  latitude: number;
  longitude: number;
}

/**
 * §11.5: `Travel Stop` plus a non-null `DEFLanes` count settles truck
 * accessibility from the operator directly, rather than by inference from
 * OSM tagging. Anything else observed from the export (there is none in the
 * 604 real matches) stays `unverified` rather than guessed at.
 */
export function resolveFromOperatorRow(row: OperatorExportRow): StationResolutionUpdate {
  const truckAccessible: StationResolutionUpdate["truckAccessible"] =
    row.storeType === "Travel Stop" && row.defLanes !== null
      ? "operator_verified"
      : "unverified";

  return {
    resolution: "exact",
    uncertaintyMiles: 0,
    resolutionSource: "operator_export",
    truckAccessible,
    operatorAttrs: {
      StoreType: row.storeType,
      ParkingSpaces: row.parkingSpaces,
      DEFLanes: row.defLanes,
      Address: row.address,
      Zip: row.zip,
      HighwayOrExit: row.highwayOrExit,
    },
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

export interface StationForMatch {
  id: string;
  /** `NAME`, exactly as ingested — the join key is parsed from this. */
  nameRaw: string;
  stateUsps: string;
}

export interface MatchedStation {
  stationId: string;
  storeNumber: number;
  stateAgrees: boolean;
  operatorRow: OperatorExportRow;
  update: StationResolutionUpdate;
}

export interface OperatorExportMatchResult {
  matched: MatchedStation[];
  /** Stations with no operator-export row at their parsed store number. */
  unmatched: StationForMatch[];
}

/**
 * Tier 1 of §11.4's resolution ladder: join BVD stations to the operator
 * export on store number, parsed from `NAME` — never `SITE` (T-08 step 8.1).
 * A station with no recognisable store number never matches, rather than
 * throwing partway through a batch.
 */
export function matchStationsToOperatorExport(
  stations: readonly StationForMatch[],
  operatorRows: readonly OperatorExportRow[],
): OperatorExportMatchResult {
  const byStoreNumber = new Map(operatorRows.map((row) => [row.storeNumber, row]));

  const matched: MatchedStation[] = [];
  const unmatched: StationForMatch[] = [];

  for (const station of stations) {
    const { storeNumber } = parseStoreName(station.nameRaw);
    const operatorRow = storeNumber !== null ? byStoreNumber.get(storeNumber) : undefined;

    if (storeNumber === null || !operatorRow) {
      unmatched.push(station);
      continue;
    }

    matched.push({
      stationId: station.id,
      storeNumber,
      stateAgrees: station.stateUsps === operatorRow.state,
      operatorRow,
      update: resolveFromOperatorRow(operatorRow),
    });
  }

  return { matched, unmatched };
}
