import type { Pool } from "pg";
import { resolveDriverByName } from "../catalog/drivers.js";
import type { ExpressMatchStatus } from "../db/types.js";

export interface ExpressDriverResolution {
  driverId: string | null;
  matchStatus: ExpressMatchStatus;
}

/**
 * Express charges carry a free-text driver name and no card to resolve a
 * truck/driver pair from — this is the only path that matches on name text
 * at all, and only through `driver_aliases` / `drivers.display_name` (T-26's
 * `resolveDriverByName`), never a fuzzy guess. A blank name (the real
 * blank-driver row in A19) is unmatched, not an error.
 */
export async function resolveExpressDriver(
  pool: Pool,
  driverNameRaw: string | null,
): Promise<ExpressDriverResolution> {
  if (driverNameRaw === null || driverNameRaw.trim() === "") {
    return { driverId: null, matchStatus: "unmatched" };
  }

  const result = await resolveDriverByName(pool, driverNameRaw);
  return result.matched
    ? { driverId: result.driverId, matchStatus: "matched" }
    : { driverId: null, matchStatus: "unmatched" };
}
