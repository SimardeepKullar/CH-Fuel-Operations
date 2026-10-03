import type { InvoiceCurrency, InvoiceQtyUnit } from "../../db/types.js";
import { litersToGallons } from "../../domain/units.js";
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

/** A line as the invoice printed it — litres and CAD on a CA invoice (D25). */
export interface SubGallonLine {
  productCode: string;
  qty: string;
  qtyUnit: InvoiceQtyUnit;
  amount: string;
  currency: InvoiceCurrency;
}

export interface SubGallonStop {
  id: string;
  lines: readonly SubGallonLine[];
}

/**
 * Flags a fuel stop whose fuel line pumped a suspiciously small quantity —
 * §A10's 0.04 gal / $0.20 case. Only lines with a quantity above zero are
 * eligible, so a legitimate zero-quantity charge line never collides with
 * this rule.
 *
 * The threshold is in gallons and stays there: a litre line is converted at
 * this rule's input and judged in gallons (D25) — 3.00 L is 0.79 gal and is
 * flagged. Nothing converted is stored: a CA finding's detail records the
 * litres and CAD as printed.
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
      const qty = Number(line.qty);
      const gallons = line.qtyUnit === "L" ? litersToGallons(qty) : qty;
      if (gallons > 0 && gallons < minGallons) {
        findings.push({
          subjectType: "fuel_stop",
          subjectId: stop.id,
          severity: "red",
          detail:
            line.qtyUnit === "gal" && line.currency === "USD"
              ? { productCode: line.productCode, gallons: line.qty, amountUsd: line.amount, minGallons: config.minGallons }
              : {
                  productCode: line.productCode,
                  qty: line.qty,
                  qtyUnit: line.qtyUnit,
                  amount: line.amount,
                  currency: line.currency,
                  minGallons: config.minGallons,
                },
        });
        break; // one flag per stop even if more than one line qualifies
      }
    }
  }

  return findings;
}
