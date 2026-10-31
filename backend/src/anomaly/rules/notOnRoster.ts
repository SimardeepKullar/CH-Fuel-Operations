import type { AnomalyFinding } from "../types.js";

/** No tunable knob — reserved so the runner's "load config for every rule from
 * anomaly_thresholds" path stays uniform. */
export type NotOnRosterConfig = Record<string, never>;

export interface NotOnRosterStop {
  id: string;
  cardNumber: string;
  /** The card's driver (`fuel_cards.driver_id`), not the stop's own. */
  cardDriverId: string | null;
  driverNameRaw: string;
  unitRaw: string;
}

/**
 * Flags a fuel stop on a card with no driver: a card the roster doesn't carry,
 * usually a driver no longer with the company on a backfilled invoice (T-85).
 * Red, because the spend belongs to nobody on file until someone looks. The
 * printed name and unit travel in `detail`, as the only record of who it was.
 *
 * Pure — no database, no HTTP, no clock.
 */
export function notOnRoster(
  stops: readonly NotOnRosterStop[],
  _config: NotOnRosterConfig,
): AnomalyFinding[] {
  void _config;
  return stops
    .filter((stop) => stop.cardDriverId === null)
    .map((stop) => ({
      subjectType: "fuel_stop",
      subjectId: stop.id,
      severity: "red" as const,
      detail: {
        cardNumber: stop.cardNumber,
        driverNameRaw: stop.driverNameRaw,
        unitRaw: stop.unitRaw,
      },
    }));
}
