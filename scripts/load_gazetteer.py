"""Load Census Gazetteer place and county-subdivision centroids into
place_centroids — the tier-3 city-level fallback for station resolution
(PROJECT-SCOPE.md §11.4 step 3).

One-time, run by hand: `python scripts/load_gazetteer.py`. Never imported
by application code (§7.1) — its whole job is producing rows in a table,
not code other services depend on.

Downloads (or reuses a local cache of) the Census Bureau's national
Gazetteer files for Places and County Subdivisions, keeps only the 50
states plus DC — this app is US-only (CLAUDE.md), and Puerto Rico's rows
in the 2024 file carry mangled accented characters that are moot once
territories are dropped — and computes each row's uncertainty radius as

    uncertainty_miles = sqrt(land_area_sqmi / pi)

which is §11.4's `r = sqrt(ALAND_SQMI / pi)`. The source area is already in
square miles, so the radius is stored as it comes: storage is miles
(CLAUDE.md). The tier-3 eligibility rule ("only if u < 5 miles") is applied in
`resolution/gazetteer.ts`, in the same unit.

Name normalisation (`name_normalized`) strips only the Census legal or
statistical descriptor ("city", "town", "CDP", "township", ...) from the
end of NAME. It does not case-fold or expand abbreviations, because
Census names already arrive in the exact convention BVD's ALL-CAPS
`city_raw` values must be normalised into to join against this table —
"McCalla", "Mount Vernon", "St. Augustine" (PROJECT-SCOPE.md §4.6).
T-09's cityNormalize.ts has to reproduce that convention exactly, in
TypeScript, from the supplier's raw strings; that the two independent
implementations agree is asserted by the shared test in BUILD-PLAN step
9.1, not by anything in this file.

Where a Place and a County Subdivision would claim the same (state,
normalized name), the Place wins — it is the more direct match for a
supplier-reported city. Places load first; a County Subdivision only
claims a key nothing has already claimed.
"""

from __future__ import annotations

import argparse
import io
import math
import os
import sys
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

GAZETTEER_YEAR = "2024"
CENSUS_BASE = f"https://www2.census.gov/geo/docs/maps-data/data/gazetteer/{GAZETTEER_YEAR}_Gazetteer"
PLACES_URL = f"{CENSUS_BASE}/{GAZETTEER_YEAR}_Gaz_place_national.zip"
COUSUB_URL = f"{CENSUS_BASE}/{GAZETTEER_YEAR}_Gaz_cousubs_national.zip"

CACHE_DIR = Path(__file__).resolve().parent / ".cache" / "gazetteer"


# US-only (CLAUDE.md): the 50 states plus DC. Excludes PR, GU, VI, AS, MP.
STATES_AND_DC = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
    "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
    "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
    "WI", "WY", "DC",
}

# Places carries an LSAD code that names its legal/statistical descriptor
# exactly, so the suffix to strip is looked up, never guessed from text.
# LSAD '00' means "no descriptor" (consolidated city-counties, independent
# cities like Carson City NV) — the name is used as-is.
PLACE_LSAD_SUFFIX = {
    "21": "borough",
    "53": "borough",
    "25": "city",
    "35": "township",
    "37": "municipality",
    "43": "town",
    "47": "village",
    "57": "CDP",
    "CN": "corporation",
    "UC": "urban county",
    "CG": "consolidated government",
    "MG": "metropolitan government",
    "UG": "unified government",
}

# County Subdivisions carry no LSAD column, so the suffix is matched by
# text against the vocabulary actually observed in the 2024 file, longest
# phrase first. Anything not on this list is kept as-is — acceptable for a
# fallback tier that a supplier city string like "3" or "Precinct F-01"
# will never hit anyway.
COUSUB_SUFFIXES = sorted(
    [
        "unified government", "consolidated government", "metropolitan government",
        "metro government", "metro township", "urban county", "unorganized territory",
        "township", "borough", "village", "town", "city", "CCD", "precinct",
        "district", "plantation", "municipality", "corporation", "UT",
    ],
    key=len,
    reverse=True,
)

# A placeholder row the Bureau emits for states (CT, RI, ...) where county
# subdivisions are not the governing geography — not a real place.
COUSUB_PLACEHOLDER = "County subdivisions not defined"


@dataclass
class Centroid:
    state_usps: str
    name_normalized: str
    name_raw: str
    geoid: str
    lat: float
    lon: float
    land_area_sqmi: float
    uncertainty_miles: float
    source: str


def strip_place_suffix(name: str, lsad: str) -> str:
    suffix = PLACE_LSAD_SUFFIX.get(lsad)
    if suffix is None:
        return name
    if name.endswith(" " + suffix):
        return name[: -(len(suffix) + 1)].rstrip()
    return name


def strip_cousub_suffix(name: str) -> str:
    for suffix in COUSUB_SUFFIXES:
        if name != suffix and name.endswith(" " + suffix):
            return name[: -(len(suffix) + 1)].rstrip()
    return name


def uncertainty_from_land_area(aland_sqmi: float) -> float:
    return math.sqrt(aland_sqmi / math.pi)


def download(url: str, dest: Path) -> Path:
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {url}", file=sys.stderr)
    with urllib.request.urlopen(url) as resp:
        dest.write_bytes(resp.read())
    return dest


def read_gazetteer_rows(zip_path: Path):
    """Yields each data row of the national Gazetteer .txt inside zip_path
    as a header-keyed dict. The files are latin-1, tab-delimited, and pad
    the last column with trailing spaces."""
    with zipfile.ZipFile(zip_path) as zf:
        member = next(n for n in zf.namelist() if n.endswith(".txt"))
        with zf.open(member) as fh:
            text = io.TextIOWrapper(fh, encoding="latin-1", newline="")
            header = [h.strip() for h in text.readline().rstrip("\n").split("\t")]
            for line in text:
                cols = [c.strip() for c in line.rstrip("\n").split("\t")]
                yield dict(zip(header, cols))


def load_places(zip_path: Path) -> list[Centroid]:
    rows: list[Centroid] = []
    for row in read_gazetteer_rows(zip_path):
        if row["USPS"] not in STATES_AND_DC:
            continue
        aland_sqmi = float(row["ALAND_SQMI"])
        if aland_sqmi <= 0:
            continue
        name_raw = row["NAME"]
        rows.append(
            Centroid(
                state_usps=row["USPS"],
                name_normalized=strip_place_suffix(name_raw, row["LSAD"]),
                name_raw=name_raw,
                geoid=row["GEOID"],
                lat=float(row["INTPTLAT"]),
                lon=float(row["INTPTLONG"]),
                land_area_sqmi=aland_sqmi,
                uncertainty_miles=uncertainty_from_land_area(aland_sqmi),
                source=f"census_gazetteer_{GAZETTEER_YEAR}_place",
            )
        )
    return rows


def load_cousubs(zip_path: Path) -> list[Centroid]:
    rows: list[Centroid] = []
    for row in read_gazetteer_rows(zip_path):
        if row["USPS"] not in STATES_AND_DC:
            continue
        name_raw = row["NAME"]
        if name_raw == COUSUB_PLACEHOLDER:
            continue
        aland_sqmi = float(row["ALAND_SQMI"])
        if aland_sqmi <= 0:
            continue
        rows.append(
            Centroid(
                state_usps=row["USPS"],
                name_normalized=strip_cousub_suffix(name_raw),
                name_raw=name_raw,
                geoid=row["GEOID"],
                lat=float(row["INTPTLAT"]),
                lon=float(row["INTPTLONG"]),
                land_area_sqmi=aland_sqmi,
                uncertainty_miles=uncertainty_from_land_area(aland_sqmi),
                source=f"census_gazetteer_{GAZETTEER_YEAR}_cousub",
            )
        )
    return rows


def dedupe(rows: list[Centroid]) -> list[Centroid]:
    """First occurrence per (state, name_normalized) wins. Callers order
    `rows` so that the first occurrence is the one that should win: every
    Place ahead of every County Subdivision, and largest land area first
    within each source, so a real tie is broken toward the more
    significant place rather than file order."""
    seen: dict[tuple[str, str], Centroid] = {}
    for row in rows:
        key = (row.state_usps, row.name_normalized)
        seen.setdefault(key, row)
    return list(seen.values())


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


def write_rows(conn, rows: list[Centroid]) -> None:
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO place_centroids
              (state_usps, name_normalized, name_raw, geoid, geom,
               land_area_sqmi, uncertainty_miles, source)
            VALUES %s
            ON CONFLICT (state_usps, name_normalized) DO NOTHING
            """,
            [
                (
                    r.state_usps,
                    r.name_normalized,
                    r.name_raw,
                    r.geoid,
                    f"SRID=4326;POINT({r.lon} {r.lat})",
                    r.land_area_sqmi,
                    r.uncertainty_miles,
                    r.source,
                )
                for r in rows
            ],
        )
    conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--places-zip", type=Path, default=None,
        help="Local 2024_Gaz_place_national.zip; downloaded to a cache if omitted.",
    )
    parser.add_argument(
        "--cousub-zip", type=Path, default=None,
        help="Local 2024_Gaz_cousubs_national.zip; downloaded to a cache if omitted.",
    )
    args = parser.parse_args()

    places_zip = args.places_zip or download(
        PLACES_URL, CACHE_DIR / f"{GAZETTEER_YEAR}_Gaz_place_national.zip"
    )
    cousub_zip = args.cousub_zip or download(
        COUSUB_URL, CACHE_DIR / f"{GAZETTEER_YEAR}_Gaz_cousubs_national.zip"
    )

    places = sorted(load_places(places_zip), key=lambda r: -r.land_area_sqmi)
    cousubs = sorted(load_cousubs(cousub_zip), key=lambda r: -r.land_area_sqmi)
    rows = dedupe(places + cousubs)

    missing = STATES_AND_DC - {r.state_usps for r in rows}
    if missing:
        print(f"WARNING: no centroid rows for {sorted(missing)}", file=sys.stderr)

    load_root_env()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(database_url)
    try:
        write_rows(conn, rows)
    finally:
        conn.close()

    deduped_away = len(places) + len(cousubs) - len(rows)
    print(
        f"loaded {len(rows)} centroids "
        f"({len(places)} places, {len(cousubs)} county subdivisions, "
        f"{deduped_away} collided and dropped) "
        f"across {len({r.state_usps for r in rows})} states"
    )


if __name__ == "__main__":
    main()
