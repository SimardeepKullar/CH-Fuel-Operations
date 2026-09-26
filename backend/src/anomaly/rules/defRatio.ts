import type { AnomalyFinding } from "../types.js";

export interface DefRatioConfig {
  /** Fraction, e.g. 0.05 for 5% — a stop's DEF/diesel gallons ratio above
   * this is flagged. The ~3% norm cited in §A10 sits well under it. */
  maxRatio: number;
  fuelProductCode: string;
  defProductCode: string;
}

export interface DefRatioLine {
  productCode: string;
  gallons: string;
}

export interface DefRatioStop {
  id: string;
  lines: readonly DefRatioLine[];
}

function sumGallons(lines: readonly DefRatioLine[], productCode: string): number {
  return lines
    .filter((l) => l.productCode === productCode)
    .reduce((sum, l) => sum + Number(l.gallons), 0);
}

/**
 * Flags a stop whose DEF gallons are an implausibly large share of its
 * diesel gallons — §A10's 15.60 DEF against 176.44 diesel (8.8%). A stop
 * with no diesel line has no ratio to compute and is skipped, not treated
 * as 0/0.
 *
 * Pure — no database, no HTTP, no clock.
 */
export function defRatio(
  stops: readonly DefRatioStop[],
  config: DefRatioConfig,
): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];

  for (const stop of stops) {
    const dieselGallons = sumGallons(stop.lines, config.fuelProductCode);
    if (dieselGallons <= 0) {
      continue;
    }
    const defGallons = sumGallons(stop.lines, config.defProductCode);
    const ratio = defGallons / dieselGallons;
    if (ratio > config.maxRatio) {
      findings.push({
        subjectType: "fuel_stop",
        subjectId: stop.id,
        severity: "amber",
        detail: {
          defGallons,
          dieselGallons,
          ratio,
          maxRatio: config.maxRatio,
        },
      });
    }
  }

  return findings;
}
