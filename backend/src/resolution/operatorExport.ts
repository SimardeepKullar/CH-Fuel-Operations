import { parse } from "csv-parse/sync";
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

// ─── BVD travel-centre directory (T-60, D29) ────────────────────────────────
//
// BVD's own directory of its Canadian sites is the second operator source:
// an operator saying where its own sites are, admitted on the same §17.1
// ground as the Love's export. Unlike the Love's export it *creates*
// `stations` rows — a CA site has no price-sheet row to enrich — and those
// rows are actuals-only: the planner filters to `country = 'US'`.

/**
 * The directory columns this module reads, by header name. The file carries
 * more (phone, hours, fuel grades, amenities); none is stored. Its fuel
 * columns (`Diesel`, `Gasoline 87`, …) are availability flags, not prices —
 * the directory carries no prices at all — but they are still not read.
 */
const DIRECTORY_COLUMNS = {
  siteName: "Site Name",
  siteRef: "Site #",
  storeId: "Store ID",
  status: "Status",
  address: "Address",
  city: "City",
  province: "Province",
  country: "Country",
  postalCode: "Postal Code",
  highway: "Highway",
  exit: "Exit",
  defAtPump: "DEF at Pump",
  truckParking: "Truck Parking",
  catScale: "CAT Scale",
  latitude: "Latitude",
  longitude: "Longitude",
} as const;

/** One directory row, straight off the file — every field a trimmed raw string. */
export type BvdDirectoryRow = { lineNumber: number } & {
  -readonly [K in keyof typeof DIRECTORY_COLUMNS]: string;
};

export class BvdDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BvdDirectoryError";
  }
}

/**
 * Parses the directory CSV. Strips the UTF-8 BOM the file ships with, and
 * reads CRLF and LF identically. A missing column is an error, not a row of
 * blanks.
 */
export function parseBvdDirectoryCsv(input: string | Buffer): BvdDirectoryRow[] {
  const records: { record: Record<string, string>; info: { lines: number } }[] = parse(input, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    info: true,
  });

  const header = records[0] ? Object.keys(records[0].record) : [];
  const missing = Object.values(DIRECTORY_COLUMNS).filter((c) => !header.includes(c));
  if (records.length > 0 && missing.length > 0) {
    throw new BvdDirectoryError(`directory header is missing column(s): ${missing.join(", ")}`);
  }

  return records.map(({ record, info }) => {
    const row = { lineNumber: info.lines } as BvdDirectoryRow;
    for (const [key, column] of Object.entries(DIRECTORY_COLUMNS)) {
      row[key as keyof typeof DIRECTORY_COLUMNS] = (record[column] ?? "").trim();
    }
    return row;
  });
}

/**
 * The ten provinces and three territories. `stations.state_usps` holds the
 * two-letter code — the column name is a misnomer for these rows, kept
 * rather than renamed. An unlisted name is an error, never a guess.
 */
const PROVINCE_CODES: ReadonlyMap<string, string> = new Map([
  ["alberta", "AB"],
  ["british columbia", "BC"],
  ["manitoba", "MB"],
  ["new brunswick", "NB"],
  ["newfoundland and labrador", "NL"],
  ["nova scotia", "NS"],
  ["ontario", "ON"],
  ["prince edward island", "PE"],
  ["quebec", "QC"],
  ["québec", "QC"],
  ["saskatchewan", "SK"],
  ["northwest territories", "NT"],
  ["nunavut", "NU"],
  ["yukon", "YT"],
]);

/**
 * The exact, closed field set `operator_attrs` may carry for a directory
 * row (§17.1) — location and amenity fields only.
 */
export interface DirectoryAttrs {
  Status: string | null;
  StoreId: string | null;
  Address: string | null;
  PostalCode: string | null;
  Highway: string | null;
  Exit: string | null;
  DEFAtPump: boolean | null;
  /** A parking count when the directory gives one; `Yes`/blank otherwise. */
  TruckParking: number | boolean | null;
  CatScale: boolean | null;
}

export interface DirectoryStation {
  /** `Site #` — the same identifier the CA invoice prints. */
  siteRef: string;
  nameRaw: string;
  cityRaw: string;
  provinceCode: string;
  country: "CA";
  latitude: number;
  longitude: number;
  operatorAttrs: DirectoryAttrs;
}

export interface SkippedDirectoryRow {
  lineNumber: number;
  nameRaw: string;
  reason: "NO_SITE_NUMBER";
}

export interface DirectoryMapResult {
  stations: DirectoryStation[];
  skipped: SkippedDirectoryRow[];
}

function rowLabel(row: BvdDirectoryRow): string {
  return `line ${row.lineNumber} (${row.siteName || "unnamed"}, Site # ${row.siteRef || "none"})`;
}

function textOrNull(value: string): string | null {
  return value === "" ? null : value;
}

/** `Yes` → true, blank → false, anything else → null rather than a guess. */
function parseFlag(value: string): boolean | null {
  if (value === "") return false;
  if (/^yes$/i.test(value)) return true;
  return null;
}

function parseParking(value: string): number | boolean | null {
  if (/^\d+$/.test(value)) return Number(value);
  return parseFlag(value);
}

function parseCoordinate(row: BvdDirectoryRow, value: string, label: string): number {
  const n = value === "" ? Number.NaN : Number(value);
  if (!Number.isFinite(n)) {
    throw new BvdDirectoryError(`${rowLabel(row)}: ${label} '${value}' is not a number`);
  }
  return n;
}

/**
 * Maps one directory row to a station. Throws, naming the row, on a
 * province outside the closed map, a country other than Canada, or a
 * coordinate that is not a number. A row with no `Site #` is the caller's
 * to skip — see `mapDirectoryRows`.
 */
export function stationFromDirectoryRow(row: BvdDirectoryRow): DirectoryStation {
  const provinceCode = PROVINCE_CODES.get(row.province.toLowerCase());
  if (!provinceCode) {
    throw new BvdDirectoryError(`${rowLabel(row)}: unknown province '${row.province}'`);
  }
  if (row.country.toLowerCase() !== "canada") {
    throw new BvdDirectoryError(`${rowLabel(row)}: country '${row.country}' is not Canada`);
  }

  return {
    siteRef: row.siteRef,
    nameRaw: row.siteName,
    cityRaw: row.city,
    provinceCode,
    country: "CA",
    latitude: parseCoordinate(row, row.latitude, "Latitude"),
    longitude: parseCoordinate(row, row.longitude, "Longitude"),
    operatorAttrs: {
      Status: textOrNull(row.status),
      StoreId: textOrNull(row.storeId),
      Address: textOrNull(row.address),
      PostalCode: textOrNull(row.postalCode),
      Highway: textOrNull(row.highway),
      Exit: textOrNull(row.exit),
      DEFAtPump: parseFlag(row.defAtPump),
      TruckParking: parseParking(row.truckParking),
      CatScale: parseFlag(row.catScale),
    },
  };
}

/**
 * Maps every row. A row with no `Site #` cannot be keyed to an invoice, so
 * it is reported by name and left out — never given an invented key. Rows
 * whose `Status` is `Coming soon` or `Temporarily closed` still map: an
 * invoice can name them.
 */
export function mapDirectoryRows(rows: readonly BvdDirectoryRow[]): DirectoryMapResult {
  const stations: DirectoryStation[] = [];
  const skipped: SkippedDirectoryRow[] = [];
  for (const row of rows) {
    if (row.siteRef === "") {
      skipped.push({ lineNumber: row.lineNumber, nameRaw: row.siteName, reason: "NO_SITE_NUMBER" });
      continue;
    }
    stations.push(stationFromDirectoryRow(row));
  }
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const s of stations) {
    if (seen.has(s.siteRef)) duplicates.add(s.siteRef);
    seen.add(s.siteRef);
  }
  if (duplicates.size > 0) {
    // (supplier, site_ref) is the upsert key — a duplicate would silently overwrite.
    throw new BvdDirectoryError(`directory has duplicate Site #: ${[...duplicates].sort().join(", ")}`);
  }
  return { stations, skipped };
}
