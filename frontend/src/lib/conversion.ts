/**
 * The Transactions screen's one display conversion (T-64): two buttons, `USD/gal`
 * and `CAD/L`. Pure — what a choice means, and what it asks the API for.
 *
 * With no choice an invoice shows as BVD printed it: a US invoice in USD/gal, a
 * CA one in CAD/L. A choice converts every row on screen to its unit.
 *
 * **Money is not converted yet.** `GET /transactions?units=` converts quantity
 * and per-unit price only (D25); converting CAD money to USD (or back) needs the
 * Bank of Canada rate stored on the CA invoice, which is T-66. Until then a
 * choice whose currency differs from a row's leaves that row's money in its own
 * currency, labelled, and the screen says the conversion is pending — never a
 * 1.0 rate (D27). T-66 adds `convertTo` to `conversionParams` and nothing else
 * here changes.
 */
import type { InvoiceCurrency, InvoiceQtyUnit } from "@ch/core/db/types";

export type DisplayChoice = "USD/gal" | "CAD/L";

export const DISPLAY_CHOICES: readonly DisplayChoice[] = ["USD/gal", "CAD/L"];

/** The choice an invoice shows in by default — the one it came in. */
export function nativeChoice(currency: InvoiceCurrency): DisplayChoice {
  return currency === "CAD" ? "CAD/L" : "USD/gal";
}

export function choiceCurrency(choice: DisplayChoice): InvoiceCurrency {
  return choice === "CAD/L" ? "CAD" : "USD";
}

export function choiceUnit(choice: DisplayChoice): InvoiceQtyUnit {
  return choice === "CAD/L" ? "L" : "gal";
}

export interface ConversionParams {
  units?: "imperial" | "metric";
}

/** What a choice asks `GET /transactions` for; `null` (as printed) asks for nothing. */
export function conversionParams(choice: DisplayChoice | null): ConversionParams {
  if (choice === null) return {};
  return { units: choiceUnit(choice) === "gal" ? "imperial" : "metric" };
}

/** True when a choice would need money converted for a row in `currency` — the part T-66 delivers. */
export function moneyConversionPending(choice: DisplayChoice | null, currency: InvoiceCurrency): boolean {
  return choice !== null && choiceCurrency(choice) !== currency;
}
