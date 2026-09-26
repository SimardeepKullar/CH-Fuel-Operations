import type { Pool } from "pg";
import { parseStoreName } from "../resolution/storeNumber.js";

export interface StationForNameMatch {
  id: string;
  /** `stations.name_raw`, e.g. "LOVES #294". */
  nameRaw: string;
  /** `stations.site_ref` — BVD's own site identifier, e.g. "43673". */
  siteRef: string;
}

/**
 * Matches an invoice line's station to a `stations` row.
 *
 * Prefers BVD's site identifier, which the invoice prints in its own `Site #`
 * column and which `stations.site_ref` already stores from the price sheet —
 * the same identifier on both sides, so the match needs no text parsing at
 * all. Measured on the 605-station roster: `site_ref` is unique, and it
 * resolves every distinct station on invoice 999210.
 *
 * Falls back to the store number parsed out of the name with T-08's
 * `parseStoreName` (e.g. `LOVES #294` -> 294) when the site identifier is
 * absent or unknown, which is what this function did on its own before.
 *
 * Note this does **not** revisit CLAUDE.md's rule that a store number comes
 * from `NAME` and never from `SITE`: `site_ref` is not the store number
 * (43673 is not 294) and is never treated as one. It is only used as the
 * station's identity.
 *
 * A station that matches on neither resolves to `null` rather than a guess —
 * a station miss is a named exclusion, not a reason to quarantine the stop.
 *
 * Pure — no database, no HTTP, no clock.
 */
export function matchStation(
  siteRef: string,
  stationNameRaw: string,
  stations: readonly StationForNameMatch[],
): string | null {
  const trimmedSiteRef = siteRef.trim();
  if (trimmedSiteRef !== "") {
    const bySiteRef = stations.find((s) => s.siteRef.trim() === trimmedSiteRef);
    if (bySiteRef) {
      return bySiteRef.id;
    }
  }

  const { storeNumber } = parseStoreName(stationNameRaw);
  if (storeNumber === null) {
    return null;
  }
  const byStoreNumber = stations.find(
    (s) => parseStoreName(s.nameRaw).storeNumber === storeNumber,
  );
  return byStoreNumber?.id ?? null;
}

interface StationRow {
  id: string;
  name_raw: string;
  site_ref: string;
}

/**
 * DB-backed form of `matchStation`. The station roster is small enough
 * (hundreds, not thousands) to scan in memory per call — the same reasoning
 * `resolveDriverByName` applies to the ~27-row driver roster.
 */
export async function resolveStation(
  pool: Pool,
  siteRef: string,
  stationNameRaw: string,
  opts: { supplier?: string } = {},
): Promise<string | null> {
  const supplier = opts.supplier ?? "BVD";
  const { rows } = await pool.query<StationRow>(
    "SELECT id, name_raw, site_ref FROM stations WHERE supplier = $1",
    [supplier],
  );
  return matchStation(
    siteRef,
    stationNameRaw,
    rows.map((r) => ({ id: r.id, nameRaw: r.name_raw, siteRef: r.site_ref })),
  );
}
