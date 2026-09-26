import type { Pool } from "pg";
import type { TruckRow } from "../db/types.js";

/**
 * The real fleet roster (A11, A16) — `unit_number` is text, matched exactly
 * as stored (trimmed only). `formatUnitNumber` (domain/units.ts) is the
 * display-time validator; a lookup here must not throw on a raw value that
 * fails its pattern, so it does not call it.
 */
export async function getTruckById(pool: Pool, id: string): Promise<TruckRow | null> {
  const { rows } = await pool.query<TruckRow>("SELECT * FROM trucks WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function getTruckByUnitNumber(pool: Pool, unitNumber: string): Promise<TruckRow | null> {
  const { rows } = await pool.query<TruckRow>("SELECT * FROM trucks WHERE unit_number = $1", [
    unitNumber.trim(),
  ]);
  return rows[0] ?? null;
}

/** The 7 planning-spec fields are nullable metadata, not the key — a truck missing them still lists (T-56). */
export async function listTrucks(pool: Pool): Promise<TruckRow[]> {
  const { rows } = await pool.query<TruckRow>("SELECT * FROM trucks ORDER BY unit_number");
  return rows;
}
