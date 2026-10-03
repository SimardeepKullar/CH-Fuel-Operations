import type { InvoiceCurrency } from "../../db/types.js";
import type { AnomalyFinding } from "../types.js";

export interface ChargesNoFuelConfig {
  /** Which raw product codes count as "fuel" for this check. */
  fuelProductCodes: readonly string[];
}

/** A line as printed; any unit, since only "more than zero" matters here. */
export interface ChargesNoFuelLine {
  productCode: string;
  qty: string;
  amount: string;
  currency: InvoiceCurrency;
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
    const fuelQty = stop.lines
      .filter((l) => fuelCodes.has(l.productCode))
      .reduce((sum, l) => sum + Number(l.qty), 0);
    if (fuelQty > 0) {
      continue;
    }
    const total = stop.lines.reduce((sum, l) => sum + Number(l.amount), 0);
    if (total <= 0) {
      continue; // no fuel and no charge — nothing to flag
    }
    const productCodes = stop.lines.map((l) => l.productCode);
    const currency = stop.lines[0]!.currency;
    findings.push({
      subjectType: "fuel_stop",
      subjectId: stop.id,
      severity: "amber",
      // A US finding keeps its existing shape; a CA one names its currency
      // rather than filing CAD under a USD key.
      detail: currency === "USD" ? { totalUsd: total, productCodes } : { total, currency, productCodes },
    });
  }

  return findings;
}
