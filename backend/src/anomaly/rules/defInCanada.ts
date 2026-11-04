import type { InvoiceCurrency, InvoiceQtyUnit } from "../../db/types.js";
import type { AnomalyFinding } from "../types.js";

/** No tunable knob: every DEF purchase on a CAD invoice is flagged (T-90). A
 * "flag only above N L" threshold, if one is ever wanted, goes here (D16). */
export type DefInCanadaConfig = Record<string, never>;

export interface DefInCanadaLine {
  productCode: string;
  qty: string;
  amount: string;
  currency: InvoiceCurrency;
  qtyUnit: InvoiceQtyUnit;
}

export interface DefInCanadaStop {
  id: string;
  lines: readonly DefInCanadaLine[];
}

/** The product code BVD prints for diesel exhaust fluid. */
const DEF_PRODUCT_CODE = "DF";

/** Sums non-negative decimal strings exactly, as integers of the finest scale present. */
function sumDecimals(values: readonly string[]): string {
  const scale = Math.max(0, ...values.map((v) => (v.split(".")[1] ?? "").length));
  const total = values.reduce((sum, v) => {
    const [whole = "0", frac = ""] = v.split(".");
    return sum + BigInt(whole + frac.padEnd(scale, "0"));
  }, 0n);
  const digits = total.toString().padStart(scale + 1, "0");
  return scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/**
 * Flags a stop on a CAD invoice with at least one DEF (`DF`) line, once per
 * stop however many DEF lines it has (T-90). Informational (amber): it blocks
 * nothing and changes no totals. `detail` carries the DEF quantity and amount
 * as printed — litres and CAD — with no `Usd` key. A US stop with DEF is not
 * flagged.
 *
 * Pure — no database, no HTTP, no clock.
 */
export function defInCanada(
  stops: readonly DefInCanadaStop[],
  _config: DefInCanadaConfig,
): AnomalyFinding[] {
  void _config;
  const findings: AnomalyFinding[] = [];
  for (const stop of stops) {
    const def = stop.lines.filter((l) => l.productCode === DEF_PRODUCT_CODE && l.currency === "CAD");
    if (def.length === 0) {
      continue;
    }
    findings.push({
      subjectType: "fuel_stop",
      subjectId: stop.id,
      severity: "amber",
      detail: {
        qty: sumDecimals(def.map((l) => l.qty)),
        qtyUnit: def[0]!.qtyUnit,
        amount: sumDecimals(def.map((l) => l.amount)),
        currency: "CAD",
      },
    });
  }
  return findings;
}
