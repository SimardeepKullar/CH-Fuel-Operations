"""Resolves BVD stations against Love's own store-locator export — tier 1 of
station resolution (PROJECT-SCOPE.md §11.4 step 1).

One-time, run by hand: `python scripts/resolve_from_operator.py`. Never
imported by application code (§7.1) — like `load_gazetteer.py` (T-03), its
whole job is producing rows in a table, not code other services depend on.

`data/loves/LovesSearchResults.xlsx` holds 732 stores. Its real header is on
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

**Never stores a price column from this export.** Its sheet also carries
street prices (Unleaded, Midgrade, Premium, Diesel, Blend, Propane,
BulkDEF) that are not the app's contract prices — CLAUDE.md, §17.1.

State agreement (matched station's `state_usps` vs. the export's `State`)
and CONUS coordinate sanity are asserted as hard failures, not warnings:
per §11.4, "a mismatch means the join is wrong even where it looks right."
"""

from __future__ import annotations

import argparse
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

DEFAULT_XLSX = Path(__file__).resolve().parent.parent / "data" / "loves" / "LovesSearchResults.xlsx"
DEFAULT_FIXTURE_OUT = (
    Path(__file__).resolve().parent.parent
    / "backend" / "test" / "fixtures" / "loves" / "operator_export.json"
)

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
            "SELECT id, name_raw, state_usps FROM stations WHERE supplier = %s",
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
    parser.add_argument(
        "--no-fixture", action="store_true", help="Skip writing the committed test fixture."
    )
    args = parser.parse_args()

    operator_rows = load_operator_rows(args.xlsx)

    if not args.no_fixture:
        write_fixture(operator_rows, args.fixture_out)

    load_root_env()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(database_url)
    try:
        report = resolve(conn, operator_rows, args.supplier)
    finally:
        conn.close()

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
