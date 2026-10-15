/**
 * The Transactions screen's one display conversion (T-64): two buttons, `USD/gal`
 * and `CAD/L`. Pure — what a choice means, and what it asks the API for.
 *
 * With no choice an invoice shows as BVD printed it: a US invoice in USD/gal, a
 * CA one in CAD/L. A choice converts every row on screen to its unit and its
 * currency: `?units=` converts quantity and per-unit price, `?convertTo=` money
 * and per-unit price, at the rate the dispatcher entered on the week's CA
 * invoice (T-66, D27). With no rate entered the API returns the money as `null`
 * with `ratePending` — never a 1.0 rate.
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
  convertTo?: InvoiceCurrency;
}

/** What a choice asks `GET /transactions` for; `null` (as printed) asks for nothing. */
export function conversionParams(choice: DisplayChoice | null): ConversionParams {
  if (choice === null) return {};
  return { units: choiceUnit(choice) === "gal" ? "imperial" : "metric", convertTo: choiceCurrency(choice) };
}

/** `2026-10-06T14:05:00Z` -> `"Oct 6, 2026, 10:05 AM"`, in the dispatcher's own time zone —
 * when an exchange rate was entered (T-66). */
export function formatFxEnteredAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
