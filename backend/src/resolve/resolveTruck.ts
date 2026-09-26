import type { Pool } from "pg";
import { resolveAssignment } from "../catalog/assignments.js";
import { getTruckById } from "../catalog/trucks.js";

export interface TruckResolution {
  truckId: string | null;
  driverId: string | null;
  /**
   * Whether the entered `unit_raw` text matches the truck resolved from the
   * card's driver and that driver's assignment (never the reverse). `null`
   * — not `false` — when there is no resolved truck to compare against, so
   * a resolution miss is never mistaken for a mismatch (CLAUDE.md: nulls
   * are meaningful).
   */
  agrees: boolean | null;
}

/**
 * The truck comes from `cardId` -> `fuel_cards.driver_id` -> the truck in
 * force at `occurredAt` (T-26's `resolveAssignment`) — never from `unitRaw`.
 * `unitRaw` is only ever compared against that result, to flag disagreement
 * for the anomaly engine (T-30) and the UI (A9.2); it never feeds back into
 * which truck gets picked, so two different cards entering the same unit
 * text on the same day resolve independently and are never conflated.
 */
export async function resolveTruckForStop(
  pool: Pool,
  cardId: string,
  occurredAt: Date,
  unitRaw: string,
): Promise<TruckResolution> {
  const { driverId, truckId } = await resolveAssignment(pool, cardId, occurredAt);
  if (truckId === null) {
    return { truckId: null, driverId, agrees: null };
  }

  const truck = await getTruckById(pool, truckId);
  const agrees = truck !== null && unitRaw.trim() === truck.unit_number;
  return { truckId, driverId, agrees };
}
