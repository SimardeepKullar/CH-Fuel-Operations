import type { AnomalyFinding } from "../types.js";

/** `minGallons`/`productCodes` come from `anomaly_thresholds` (rule
 * `sub_gallon`) — never hard-coded (D16). */
export interface SubGallonConfig {
  /** Decimal string, e.g. "1.00" — a fuel line under this is flagged. */
  minGallons: string;
  /** Which raw product codes count as "fuel" here. A zero-gallon
   * non-fuel charge (a scale fee) is `chargesNoFuel`'s case, not this one. */
  productCodes: readonly string[];
}

export interface SubGallonLine {
  productCode: string;
  gallons: string;
  amountUsd: string;
}

export interface SubGallonStop {
  id: string;
  lines: readonly SubGallonLine[];
}

/**
 * Flags a fuel stop whose fuel line pumped a suspiciously small quantity —
 * §A10's 0.04 gal / $0.20 case. Only lines with `gallons > 0` are eligible,
 * so a legitimate zero-gallon charge line never collides with this rule.
 *
 * Pure — no database, no HTTP, no clock.
 */
export function subGallon(
  stops: readonly SubGallonStop[],
  config: SubGallonConfig,
): AnomalyFinding[] {
  const fuelCodes = new Set(config.productCodes);
  const minGallons = Number(config.minGallons);
  const findings: AnomalyFinding[] = [];

  for (const stop of stops) {
    for (const line of stop.lines) {
      if (!fuelCodes.has(line.productCode)) {
        continue;
      }
      const gallons = Number(line.gallons);
      if (gallons > 0 && gallons < minGallons) {
        findings.push({
          subjectType: "fuel_stop",
          subjectId: stop.id,
          severity: "red",
          detail: {
            productCode: line.productCode,
            gallons: line.gallons,
            amountUsd: line.amountUsd,
            minGallons: config.minGallons,
          },
        });
        break; // one flag per stop even if more than one line qualifies
      }
    }
  }

  return findings;
}
