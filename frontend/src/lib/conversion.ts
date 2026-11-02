/**
 * The Transactions screen's one display conversion (T-64): two buttons, `USD/gal`
 * and `CAD/L`. Pure — what a choice means, and what it asks the API for.
 *
 * With no choice an invoice shows as BVD printed it: a US invoice in USD/gal, a
 * CA one in CAD/L. A choice converts the **US rows** to its unit and currency
 * (T-68): a CA invoice is never converted, so the toggle is hidden with it
 * selected and, under All invoices, `CAD/L` leaves the CA rows as printed (the
 * API's identity for a request that matches the row). `?units=` converts
 * quantity and per-unit price, `?convertTo=` money and per-unit price, at the
 * rate the dispatcher entered on the week's US invoice (T-66, T-68, D27). With
 * no rate entered the API returns the money as `null` with `ratePending` —
 * never a 1.0 rate.
 */
import type { InvoiceCurrency, InvoiceQtyUnit } from "@ch/core/db/types";

export type DisplayChoice = "USD/gal" | "CAD/L";

export const DISPLAY_CHOICES: readonly DisplayChoice[] = ["USD/gal", "CAD/L"];

/** The choice an invoice shows in by default — the one it came in. */
export function nativeChoice(currency: InvoiceCurrency): DisplayChoice {
  return currency === "CAD" ? "CAD/L" : "USD/gal";
}

/** Whether the toggle shows for a side, and the choice that means "as printed" there (T-68). */
export function toggleFor(side: "USD" | "CAD" | "all"): { visible: boolean; native: DisplayChoice } {
  return side === "CAD" ? { visible: false, native: "CAD/L" } : { visible: true, native: "USD/gal" };
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
