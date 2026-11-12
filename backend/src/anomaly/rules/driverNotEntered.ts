import type { AnomalyFinding } from "../types.js";

/** No tunable knob — reserved so the runner's "load config for every rule from
 * anomaly_thresholds" path stays uniform. */
export type DriverNotEnteredConfig = Record<string, never>;

export interface DriverNotEnteredStop {
  id: string;
  /** The driver name BVD printed on the line (`fuel_stops.driver_name_raw`). */
  driverNameRaw: string;
}

/**
 * Flags a fuel stop whose invoice line printed no driver name (T-127). Red,
 * not amber like `unitNotEntered`: the driver shown for the stop is the
 * card's driver, a guess the invoice does not confirm, and the dispatcher
 * has to establish who was actually driving.
 *
 * Fuel stops only. Express rows already show a blank driver as unmatched.
 *
 * Pure — no database, no HTTP, no clock.
 */
export function driverNotEntered(
  stops: readonly DriverNotEnteredStop[],
  _config: DriverNotEnteredConfig,
): AnomalyFinding[] {
  void _config;
  return stops
    .filter((stop) => stop.driverNameRaw.trim() === "")
    .map((stop) => ({
      subjectType: "fuel_stop",
      subjectId: stop.id,
      severity: "red" as const,
      detail: { reason: "no_driver_name" },
    }));
}
