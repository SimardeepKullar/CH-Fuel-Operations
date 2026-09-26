import type { AnomalyFinding } from "../types.js";

export interface ChargesNoFuelConfig {
  /** Which raw product codes count as "fuel" for this check. */
  fuelProductCodes: readonly string[];
}

export interface ChargesNoFuelLine {
  productCode: string;
  gallons: string;
  amountUsd: string;
}

export interface ChargesNoFuelStop {
  id: string;
  lines: readonly ChargesNoFuelLine[];
}

/**
 * Flags a fuel stop that carries a charge but pumped no fuel at all —
 * §A10's card that carried only a $15.25 scale charge. A stop with zero
 * lines altogether can't occur (`groupByAuthCode` only ever produces a stop
 * from at least one line), so "no fuel gallons" is the only condition that
 * matters here.
 *
 * Pure — no database, no HTTP, no clock.
 */
export function chargesNoFuel(
  stops: readonly ChargesNoFuelStop[],
  config: ChargesNoFuelConfig,
): AnomalyFinding[] {
  const fuelCodes = new Set(config.fuelProductCodes);
  const findings: AnomalyFinding[] = [];

  for (const stop of stops) {
    const fuelGallons = stop.lines
      .filter((l) => fuelCodes.has(l.productCode))
      .reduce((sum, l) => sum + Number(l.gallons), 0);
    if (fuelGallons > 0) {
      continue;
    }
    const totalUsd = stop.lines.reduce((sum, l) => sum + Number(l.amountUsd), 0);
    if (totalUsd <= 0) {
      continue; // no fuel and no charge — nothing to flag
    }
    findings.push({
      subjectType: "fuel_stop",
      subjectId: stop.id,
      severity: "amber",
      detail: {
        totalUsd,
        productCodes: stop.lines.map((l) => l.productCode),
      },
    });
  }

  return findings;
}
