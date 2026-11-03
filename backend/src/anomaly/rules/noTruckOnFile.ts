import type { AnomalyFinding } from "../types.js";

/** No tunable knob — reserved so the runner's "load config for every rule from
 * anomaly_thresholds" path stays uniform. */
export type NoTruckOnFileConfig = Record<string, never>;

export interface NoTruckOnFileStop {
  id: string;
  /** `fuel_stops.truck_id`: the truck the stop's driver had on its date, or
   * `null` when nothing resolved. Read as stored, never recomputed here. */
  truckId: string | null;
  /** `fuel_stops.driver_id`: `null` when the card has no driver. */
  driverId: string | null;
  /** What the driver typed at the pump (`fuel_stops.unit_raw`). */
  unitRaw: string;
}

/**
 * Flags a fuel stop with no truck on file, so a missing truck is visible
 * instead of silent (T-78). Amber: nothing is wrong with the bill — there is
 * simply nothing to compare the entered unit against. `detail.reason` says
 * why: `no_driver` (the card has no driver) or `no_assignment` (the driver had
 * no truck that day), and `detail.unitRaw` carries the entered unit, so the
 * flag can read "No truck on file — entered 2" and a pop-up can pre-fill it.
 *
 * It is the other half of `unitMismatch`, which skips a stop with no truck, so
 * one stop never carries both.
 *
 * Pure — no database, no HTTP, no clock.
 */
export function noTruckOnFile(
  stops: readonly NoTruckOnFileStop[],
  _config: NoTruckOnFileConfig,
): AnomalyFinding[] {
  void _config;
  return stops
    .filter((stop) => stop.truckId === null)
    .map((stop) => ({
      subjectType: "fuel_stop",
      subjectId: stop.id,
      severity: "amber" as const,
      detail: {
        reason: stop.driverId === null ? "no_driver" : "no_assignment",
        unitRaw: stop.unitRaw,
      },
    }));
}
