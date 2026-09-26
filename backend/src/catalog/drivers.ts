import type { Pool } from "pg";
import { normalizeName } from "../resolve/normalizeName.js";
import type { DriverRow } from "../db/types.js";

export interface DriverAliasForMatch {
  aliasNormalized: string;
  driverId: string;
}

export interface DriverForMatch {
  id: string;
  displayName: string;
}

export type DriverNameMatch = { matched: true; driverId: string } | { matched: false };

/**
 * `driver_aliases.alias_normalized` first, then `drivers.display_name`
 * normalised the same way (T-26 step 26.1). No fuzzy match: a name that
 * hits neither returns `{ matched: false }`, never the closest driver — a
 * wrong attribution is worse than a blank because every per-driver metric
 * downstream inherits it silently.
 */
export function matchDriverName(
  nameRaw: string,
  aliases: readonly DriverAliasForMatch[],
  drivers: readonly DriverForMatch[],
): DriverNameMatch {
  const normalized = normalizeName(nameRaw);

  const alias = aliases.find((a) => a.aliasNormalized === normalized);
  if (alias) {
    return { matched: true, driverId: alias.driverId };
  }

  const driver = drivers.find((d) => normalizeName(d.displayName) === normalized);
  if (driver) {
    return { matched: true, driverId: driver.id };
  }

  return { matched: false };
}

/**
 * DB-backed form of `matchDriverName`: the alias hop is one indexed lookup
 * (`alias_normalized` is the table's primary key); the ~27-row driver roster
 * is small enough to scan for the display-name fallback rather than
 * maintaining a normalised column and index for it.
 */
export async function resolveDriverByName(pool: Pool, nameRaw: string): Promise<DriverNameMatch> {
  const normalized = normalizeName(nameRaw);

  const { rows: aliasRows } = await pool.query<{ driver_id: string }>(
    "SELECT driver_id FROM driver_aliases WHERE alias_normalized = $1",
    [normalized],
  );
  if (aliasRows[0]) {
    return { matched: true, driverId: aliasRows[0].driver_id };
  }

  const { rows: driverRows } = await pool.query<DriverRow>("SELECT * FROM drivers");
  const driver = driverRows.find((d) => normalizeName(d.display_name) === normalized);
  return driver ? { matched: true, driverId: driver.id } : { matched: false };
}

export async function getDriverById(pool: Pool, id: string): Promise<DriverRow | null> {
  const { rows } = await pool.query<DriverRow>("SELECT * FROM drivers WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listDrivers(pool: Pool): Promise<DriverRow[]> {
  const { rows } = await pool.query<DriverRow>("SELECT * FROM drivers ORDER BY display_name");
  return rows;
}
