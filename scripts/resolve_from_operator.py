"""Resolves BVD stations against Love's own store-locator export — tier 1 of
station resolution (PROJECT-SCOPE.md §11.4 step 1).

One-time, run by hand: `python scripts/resolve_from_operator.py`. Never
imported by application code (§7.1) — like `load_gazetteer.py` (T-03), its
whole job is producing rows in a table, not code other services depend on.

`data/US-CA-GasStations/LovesSearchResults.xlsx` holds 732 stores. Its real header is on
row 3 (`header=2` to pandas) — rows 1-2 are Love's branding and a price
disclaimer — and any trailing row with no numeric StoreNumber is a footer,
dropped defensively. Joining on the store number parsed out of BVD's `NAME`
("LOVES #368" -> 368), never `SITE`, matches 604 of the 605 BVD stations;
the store this script cannot place (#306) is temporarily closed, so Love's
omits it from the export; it stays `unresolved`, and re-running this script
places it if it reopens. T-09's gazetteer/manual tiers remain for other cases.

Sets, per matched station: `resolution = 'exact'`, `uncertainty_miles = 0`,
`resolution_source = 'operator_export'`, `resolved_at`, `truck_accessible`
(`'operator_verified'` when `StoreType = 'Travel Stop'` and `DEFLanes` is
not null, `'unverified'` otherwise — §11.5), `operator_attrs` (StoreType,
ParkingSpaces, DEFLanes, Address, Zip, HighwayOrExit — location and amenity
fields only), and `geom`. `store_number` / `brand_normalized` are backfilled
for every BVD station, matched or not, since the join key that makes this
script possible is exactly what T-08 step 8.1 (storeNumber.ts) computes.

Also loads BVD's Canadian travel-centre directory
(`data/US-CA-GasStations/bvd-travel-centres-*.csv`, T-60, D29), which —
unlike the Love's export — *creates* `stations` rows, `country = 'CA'`,
keyed on `Site #`. See `load_directory_stations`.

**Never stores a price column from this export.** Its sheet also carries
street prices (Unleaded, Midgrade, Premium, Diesel, Blend, Propane,
BulkDEF) that are not the app's contract prices — CLAUDE.md, §17.1.

State agreement (matched station's `state_usps` vs. the export's `State`)
and CONUS coordinate sanity are asserted as hard failures, not warnings:
per §11.4, "a mismatch means the join is wrong even where it looks right."
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import psycopg2
from psycopg2.extras import Json, RealDictCursor

DEFAULT_XLSX = Path(__file__).resolve().parent.parent / "data" / "US-CA-GasStations" / "LovesSearchResults.xlsx"
DEFAULT_FIXTURE_OUT = (
    Path(__file__).resolve().parent.parent
    / "backend" / "test" / "fixtures" / "US-CA-GasStations" / "operator_export.json"
)
DEFAULT_DIRECTORY_CSV = (
    Path(__file__).resolve().parent.parent
    / "data" / "US-CA-GasStations" / "bvd-travel-centres-2026-10-01.csv"
)
DEFAULT_DIRECTORY_FIXTURE_OUT = DEFAULT_FIXTURE_OUT.parent / "bvd_directory.json"

# §11.4 step 1: inside CONUS (lat 25.95-48.57, lng -123.37 to -72.26).
CONUS_LAT = (25.95, 48.57)
CONUS_LNG = (-123.37, -72.26)

STORE_NUMBER_RE = re.compile(r"^(.*?)\s*#\s*(\d+)\s*$")


def parse_store_name(name_raw: str) -> tuple[str, int | None]:
    """Mirrors backend/src/resolution/storeNumber.ts's parseStoreName —
    independently implemented, per §7.1, since Python cannot import it."""
    trimmed = name_raw.strip()
    m = STORE_NUMBER_RE.match(trimmed)
    if not m:
        return trimmed, None
    return m.group(1).strip(), int(m.group(2))


@dataclass
class OperatorRow:
    store_number: int
    state: str
    city: str
    address: str
    zip: str
    highway_or_exit: str | None
    latitude: float
    longitude: float
    store_type: str
    parking_spaces: int | None
    def_lanes: int | None


def _clean_str(value: object) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = str(value).strip()
    return text or None


def _clean_int(value: object) -> int | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    return int(value)


def load_operator_rows(xlsx_path: Path) -> list[OperatorRow]:
    df = pd.read_excel(xlsx_path, header=2)

    # Defensive footer drop: keep only rows with a real numeric StoreNumber.
    # On the file this script has actually been run against there is no such
    # row, but §11.4 step 1's practical notes call the last row a footer.
    numeric_store = pd.to_numeric(df["StoreNumber"], errors="coerce")
    df = df[numeric_store.notna()].copy()
    df["StoreNumber"] = numeric_store[numeric_store.notna()].astype(int)

    rows: list[OperatorRow] = []
    for _, r in df.iterrows():
        rows.append(
            OperatorRow(
                store_number=int(r["StoreNumber"]),
                state=str(r["State"]).strip(),
                city=str(r["City"]).strip(),
                address=str(r["Address"]).strip(),
                zip=str(r["Zip"]).strip(),
                highway_or_exit=_clean_str(r["HighwayOrExit"]),
                latitude=float(r["Latitude"]),
                longitude=float(r["Longitude"]),
                store_type=str(r["StoreType"]).strip(),
                parking_spaces=_clean_int(r["ParkingSpaces"]),
                def_lanes=_clean_int(r["DEFLanes"]),
            )
        )

    duplicates = {row.store_number for row in rows if [r.store_number for r in rows].count(row.store_number) > 1}
    if duplicates:
        raise ValueError(f"operator export has duplicate store numbers: {sorted(duplicates)}")

    return rows


def write_fixture(rows: list[OperatorRow], dest: Path) -> None:
    """A committed, price-free copy of the export for backend/src/resolution/
    operatorExport.test.ts to assert the real 604/605 join against, with no
    database, no xlsx reader and no Python required in CI (§7.1's TypeScript
    rule; this repo's CI runs no Python — .github/workflows/ci.yml)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    payload = [
        {
            "storeNumber": row.store_number,
            "state": row.state,
            "city": row.city,
            "address": row.address,
            "zip": row.zip,
            "highwayOrExit": row.highway_or_exit,
            "latitude": row.latitude,
            "longitude": row.longitude,
            "storeType": row.store_type,
            "parkingSpaces": row.parking_spaces,
            "defLanes": row.def_lanes,
        }
        for row in rows
    ]
    dest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


# ─── BVD travel-centre directory (T-60, D29) ────────────────────────────────
#
# BVD's own directory of its Canadian sites. Unlike the Love's export it
# *creates* `stations` rows — a CA site has no price-sheet row to enrich —
# keyed on `(supplier, site_ref = Site #)`, the same `Site #` the CA invoice
# prints. Mirrors backend/src/resolution/operatorExport.ts's
# stationFromDirectoryRow / mapDirectoryRows, independently implemented
# (§7.1); bvd_directory.json is the bridge operatorExport.test.ts asserts
# the two agree on. The directory carries no prices, and none of its fuel
# availability columns is read.

PROVINCE_CODES = {
    "alberta": "AB",
    "british columbia": "BC",
    "manitoba": "MB",
    "new brunswick": "NB",
    "newfoundland and labrador": "NL",
    "nova scotia": "NS",
    "ontario": "ON",
    "prince edward island": "PE",
    "quebec": "QC",
    "québec": "QC",
    "saskatchewan": "SK",
    "northwest territories": "NT",
    "nunavut": "NU",
    "yukon": "YT",
}

DIRECTORY_COLUMNS = [
    "Site Name", "Site #", "Store ID", "Status", "Address", "City", "Province",
    "Country", "Postal Code", "Highway", "Exit", "DEF at Pump", "Truck Parking",
    "CAT Scale", "Latitude", "Longitude",
]

MINOR_WORDS = {"of", "the", "and", "or"}


class DirectoryError(ValueError):
    pass


def _row_label(line: int, row: dict) -> str:
    return f"line {line} ({row['Site Name'] or 'unnamed'}, Site # {row['Site #'] or 'none'})"


def _text_or_none(value: str) -> str | None:
    return value or None


def _flag(value: str) -> bool | None:
    if value == "":
        return False
    if value.lower() == "yes":
        return True
    return None


def _parking(value: str) -> int | bool | None:
    if value.isdigit():
        return int(value)
    return _flag(value)


def _coordinate(line: int, row: dict, column: str) -> float:
    try:
        return float(row[column])
    except ValueError:
        raise DirectoryError(
            f"{_row_label(line, row)}: {column} '{row[column]}' is not a number"
        ) from None


def city_normalized_for_directory(city_raw: str) -> str:
    """Title-cases an ALL-CAPS city, as cityNormalize.ts does — without its
    Census prefix rules (`St` -> `St.`, `Mt` -> `Mount`), which are a US
    gazetteer's spelling and match nothing here: no CA station ever meets
    the gazetteer tier."""
    trimmed = city_raw.strip()
    if not (re.search(r"[A-Z]", trimmed) and not re.search(r"[a-z]", trimmed)):
        return trimmed
    words = trimmed.lower().split(" ")
    return " ".join(
        w if (i > 0 and w in MINOR_WORDS) or not w else w[0].upper() + w[1:]
        for i, w in enumerate(words)
    )


def load_directory(csv_path: Path) -> dict:
    """Returns `{"stations": [...], "skipped": [...]}` in exactly the shape
    mapDirectoryRows returns, so the fixture can be compared to it."""
    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        missing = [c for c in DIRECTORY_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise DirectoryError(f"directory header is missing column(s): {', '.join(missing)}")

        stations: list[dict] = []
        skipped: list[dict] = []
        for raw in reader:
            line = reader.line_num
            row = {c: (raw[c] or "").strip() for c in DIRECTORY_COLUMNS}
            if row["Site #"] == "":
                skipped.append(
                    {"lineNumber": line, "nameRaw": row["Site Name"], "reason": "NO_SITE_NUMBER"}
                )
                continue
            province_code = PROVINCE_CODES.get(row["Province"].lower())
            if province_code is None:
                raise DirectoryError(f"{_row_label(line, row)}: unknown province '{row['Province']}'")
            if row["Country"].lower() != "canada":
                raise DirectoryError(f"{_row_label(line, row)}: country '{row['Country']}' is not Canada")
            stations.append(
                {
                    "siteRef": row["Site #"],
                    "nameRaw": row["Site Name"],
                    "cityRaw": row["City"],
                    "provinceCode": province_code,
                    "country": "CA",
                    "latitude": _coordinate(line, row, "Latitude"),
                    "longitude": _coordinate(line, row, "Longitude"),
                    "operatorAttrs": {
                        "Status": _text_or_none(row["Status"]),
                        "StoreId": _text_or_none(row["Store ID"]),
                        "Address": _text_or_none(row["Address"]),
                        "PostalCode": _text_or_none(row["Postal Code"]),
                        "Highway": _text_or_none(row["Highway"]),
                        "Exit": _text_or_none(row["Exit"]),
                        "DEFAtPump": _flag(row["DEF at Pump"]),
                        "TruckParking": _parking(row["Truck Parking"]),
                        "CatScale": _flag(row["CAT Scale"]),
                    },
                }
            )

    site_refs = [s["siteRef"] for s in stations]
    duplicates = sorted({r for r in site_refs if site_refs.count(r) > 1})
    if duplicates:
        # (supplier, site_ref) is the upsert key — a duplicate would silently overwrite.
        raise DirectoryError(f"directory has duplicate Site #: {', '.join(duplicates)}")

    return {"stations": stations, "skipped": skipped}


def write_directory_fixture(directory: dict, dest: Path) -> None:
    """The mapped directory, committed for operatorExport.test.ts to assert
    the TypeScript mapping of the same CSV against — no Python in CI."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(directory, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_directory_stations(conn, directory: dict, supplier: str) -> dict:
    """Upserts every directory station on `(supplier, site_ref)`.

    Inserts an absent row with `country 'CA'`, `resolution 'exact'`,
    `uncertainty_miles 0`, `resolution_source 'bvd_directory'` and
    `truck_accessible 'unverified'` — the planner never uses these stations,
    so there is nothing to verify them for. `state_usps` holds the province
    code: the column name is a misnomer for these rows, kept rather than
    renamed. `store_number` stays null — BVD names carry no `#`, and
    `Store ID` is not a store number in the `LOVES #368` sense.

    A row already present has its coordinates, `operator_attrs` and
    `last_seen_at` refreshed; `name_raw` and `city_raw` are never
    overwritten. The update is restricted to `country = 'CA'`, so a `Site #`
    that ever collided with a US price-sheet `SITE` fails the load rather
    than moving a US station to Canada.
    """
    inserted = 0
    updated = 0
    collisions: list[str] = []

    with conn.cursor() as cur:
        for st in directory["stations"]:
            cur.execute(
                """
                INSERT INTO stations (
                  supplier, site_ref, name_raw, city_raw, city_normalized, state_usps, country,
                  geom, resolution, uncertainty_miles, resolution_source, resolved_at,
                  truck_accessible, operator_attrs
                )
                VALUES (
                  %s, %s, %s, %s, %s, %s, 'CA',
                  ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                  'exact', 0, 'bvd_directory', now(), 'unverified', %s
                )
                ON CONFLICT (supplier, site_ref) DO UPDATE
                  SET geom = EXCLUDED.geom,
                      operator_attrs = EXCLUDED.operator_attrs,
                      last_seen_at = now()
                  WHERE stations.country = 'CA'
                RETURNING (xmax = 0) AS inserted
                """,
                (
                    supplier,
                    st["siteRef"],
                    st["nameRaw"],
                    st["cityRaw"],
                    city_normalized_for_directory(st["cityRaw"]),
                    st["provinceCode"],
                    st["longitude"],
                    st["latitude"],
                    Json(st["operatorAttrs"]),
                ),
            )
            result = cur.fetchone()
            if result is None:
                collisions.append(f"{st['nameRaw']} (Site # {st['siteRef']})")
            elif result[0]:
                inserted += 1
            else:
                updated += 1

    if collisions:
        conn.rollback()
        raise DirectoryError(
            f"directory Site # collides with a non-CA station (left untouched): {collisions}"
        )

    conn.commit()
    return {
        "directory_stations": len(directory["stations"]),
        "inserted": inserted,
        "updated": updated,
        "skipped": [row["nameRaw"] for row in directory["skipped"]],
    }


def load_root_env() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def resolve(conn, operator_rows: list[OperatorRow], supplier: str) -> dict:
    by_store_number = {row.store_number: row for row in operator_rows}

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            # US only: the directory's CA rows are not Love's stores (T-60).
            "SELECT id, name_raw, state_usps FROM stations WHERE supplier = %s AND country = 'US'",
            (supplier,),
        )
        stations = cur.fetchall()

    matched: list[tuple[dict, OperatorRow]] = []
    unmatched: list[dict] = []
    state_mismatches: list[tuple[str, str, str]] = []
    out_of_conus: list[tuple[str, float, float]] = []

    for station in stations:
        brand, store_number = parse_store_name(station["name_raw"])
        operator_row = by_store_number.get(store_number) if store_number is not None else None

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE stations SET store_number = %s, brand_normalized = %s WHERE id = %s",
                (store_number, brand, station["id"]),
            )

        if operator_row is None:
            unmatched.append(station)
            continue

        if station["state_usps"] != operator_row.state:
            state_mismatches.append((station["name_raw"], station["state_usps"], operator_row.state))

        # §11.4 step 1's bounds are the measured extremes of this exact data,
        # rounded to 2dp for the doc table — compare at the same precision
        # so that rounding does not read as an out-of-CONUS coordinate.
        lat, lon = operator_row.latitude, operator_row.longitude
        lat2, lon2 = round(lat, 2), round(lon, 2)
        if not (CONUS_LAT[0] <= lat2 <= CONUS_LAT[1] and CONUS_LNG[0] <= lon2 <= CONUS_LNG[1]):
            out_of_conus.append((station["name_raw"], lat, lon))

        truck_accessible = (
            "operator_verified"
            if operator_row.store_type == "Travel Stop" and operator_row.def_lanes is not None
            else "unverified"
        )
        operator_attrs = {
            "StoreType": operator_row.store_type,
            "ParkingSpaces": operator_row.parking_spaces,
            "DEFLanes": operator_row.def_lanes,
            "Address": operator_row.address,
            "Zip": operator_row.zip,
            "HighwayOrExit": operator_row.highway_or_exit,
        }

        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE stations
                SET resolution = 'exact',
                    uncertainty_miles = 0,
                    resolution_source = 'operator_export',
                    resolved_at = %s,
                    truck_accessible = %s,
                    operator_attrs = %s,
                    geom = ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
                WHERE id = %s
                """,
                (
                    datetime.now(timezone.utc),
                    truck_accessible,
                    Json(operator_attrs),
                    lon,
                    lat,
                    station["id"],
                ),
            )

        matched.append((station, operator_row))

    if state_mismatches:
        conn.rollback()
        raise ValueError(
            "state disagreement between a matched station and the operator export "
            f"(the join is wrong, not just this station): {state_mismatches}"
        )
    if out_of_conus:
        conn.rollback()
        raise ValueError(f"matched station(s) outside CONUS bounds: {out_of_conus}")

    conn.commit()

    return {
        "total_stations": len(stations),
        "matched": len(matched),
        "unmatched": [s["name_raw"] for s in unmatched],
        "state_agreement": f"{len(matched) - len(state_mismatches)}/{len(matched)}",
        "operator_verified": sum(
            1 for _, row in matched if row.store_type == "Travel Stop" and row.def_lanes is not None
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xlsx", type=Path, default=DEFAULT_XLSX)
    parser.add_argument("--supplier", default="BVD")
    parser.add_argument("--fixture-out", type=Path, default=DEFAULT_FIXTURE_OUT)
    parser.add_argument("--directory-csv", type=Path, default=DEFAULT_DIRECTORY_CSV)
    parser.add_argument(
        "--directory-fixture-out", type=Path, default=DEFAULT_DIRECTORY_FIXTURE_OUT
    )
    parser.add_argument(
        "--no-fixture", action="store_true", help="Skip writing the committed test fixtures."
    )
    parser.add_argument(
        "--directory-only",
        action="store_true",
        help="Load the BVD directory only; skip the Love's join.",
    )
    args = parser.parse_args()

    operator_rows = None if args.directory_only else load_operator_rows(args.xlsx)
    directory = load_directory(args.directory_csv)

    if not args.no_fixture:
        if operator_rows is not None:
            write_fixture(operator_rows, args.fixture_out)
        write_directory_fixture(directory, args.directory_fixture_out)

    load_root_env()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(database_url)
    try:
        report = {}
        if operator_rows is not None:
            report = resolve(conn, operator_rows, args.supplier)
        report["bvd_directory"] = load_directory_stations(conn, directory, args.supplier)
    finally:
        conn.close()

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
