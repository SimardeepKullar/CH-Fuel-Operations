import type { AnomalyFinding } from "../types.js";

/** No tunable knob — reserved so the runner's "load config for every rule from
 * anomaly_thresholds" path stays uniform. */
export type UnitNotEnteredConfig = Record<string, never>;

export interface UnitNotEnteredStop {
  id: string;
  /** What the driver typed at the pump (`fuel_stops.unit_raw`). */
  unitRaw: string;
}

/**
 * Flags a fuel stop whose driver typed no unit number at the pump (T-95).
 * Amber: the bill is fine, the self-report is simply missing — so there is
 * nothing for `unitMismatch` to compare, and it skips a blank entry.
 *
 * Fuel stops only. An express row's null unit is a file lacking a column, not
 * a driver omission, and express rows are not stops.
 *
 * Pure — no database, no HTTP, no clock.
 */
export function unitNotEntered(
  stops: readonly UnitNotEnteredStop[],
  _config: UnitNotEnteredConfig,
): AnomalyFinding[] {
  void _config;
  return stops
    .filter((stop) => stop.unitRaw.trim() === "")
    .map((stop) => ({
      subjectType: "fuel_stop",
      subjectId: stop.id,
      severity: "amber" as const,
      detail: { reason: "no_unit" },
    }));
}
