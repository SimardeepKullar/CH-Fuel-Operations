/**
 * Formatting for the Actuals half of the app (T-40 step 40.1, A9). A
 * deliberately separate file from `format.ts`: v1's Plan screens use their
 * own decimal conventions (gallons 1dp, price 3dp) and this file's numbers —
 * gallons 2dp, prices 4dp, money 2dp with an explicit USD marker — must not
 * drift toward or away from them by sharing a module.
 */

import type { InvoiceCurrency, InvoiceQtyUnit } from "@ch/core/db/types";

/**
 * `255.13` -> `"$255.13"` — 2dp. TICKETS-v2.md T-40's DoD reads "a USD
 * marker is present on the money column" (singular, column-level), and the
 * design file (the visual authority for this screen) puts that marker on
 * the column header ("Total USD") and the footer caption ("All amounts
 * USD") rather than repeating it on every cell — so the formatter itself
 * stays a plain `$` amount and callers are responsible for labelling the
 * column/section it appears under as USD once.
 */
export function formatMoneyUsd(amountUsd: number): string {
  const sign = amountUsd < 0 ? "-" : "";
  return `${sign}$${Math.abs(amountUsd).toFixed(2)}`;
}

/** `5.2395` -> `"$5.2395"` — 4dp, never rounded to 2dp (CLAUDE.md: `5.24`
 * must never appear where `5.2395` is the value). */
export function formatPricePerGal(usdPerGal: number): string {
  const sign = usdPerGal < 0 ? "-" : "";
  return `${sign}$${Math.abs(usdPerGal).toFixed(4)}`;
}

/** `52.3` -> `"52.30"` — 2dp, no unit suffix; callers that need "gal" add it
 * themselves (the table's column header already says "Gallons"). */
export function formatGallons2dp(gallons: number): string {
  return gallons.toFixed(2);
}

/*
 * Currency- and unit-aware formatting (T-64, D25/D28). A week has a USD side
 * and a CAD side, so a bare "$" is ambiguous: every amount here carries its
 * currency, as `US$` or `CA$`. The Overview and Import screens still use the
 * USD-only helpers above until T-65 and T-64 step 64.4 take them over.
 */
const CURRENCY_PREFIX: Record<InvoiceCurrency, string> = { USD: "US$", CAD: "CA$" };

/** `255.13, "CAD"` -> `"CA$255.13"` — money at 2dp; it formats, it never converts (the API does, T-66). */
export function formatMoney(amount: number, currency: InvoiceCurrency): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}${CURRENCY_PREFIX[currency]}${Math.abs(amount).toFixed(2)}`;
}

/** `1.9046, "CAD"` -> `"CA$1.9046"` — a per-unit price at 4dp; the column header says `/L` or `/gal`. */
export function formatPricePerUnit(price: number, currency: InvoiceCurrency): string {
  const sign = price < 0 ? "-" : "";
  return `${sign}${CURRENCY_PREFIX[currency]}${Math.abs(price).toFixed(4)}`;
}

/** A quantity at 2dp in whichever unit it is in — gallons or litres. */
export function formatQty2dp(qty: number): string {
  return qty.toFixed(2);
}

/** The unit label a quantity column and a per-unit price column use. */
export const QTY_UNIT_NAMES: Record<InvoiceQtyUnit, string> = { gal: "Gallons", L: "Litres" };

/** What BVD prints a side in, absent `?units=` (D25). */
export function nativeQtyUnit(currency: InvoiceCurrency): InvoiceQtyUnit {
  return currency === "CAD" ? "L" : "gal";
}

/** What a money cell shows while a conversion's exchange rate has not been entered (D27). */
export const RATE_PENDING = "rate pending";

/** `formatMoney`, or "rate pending" for the `null` a pending conversion returns — never 0. */
export function formatMoneyOrPending(amount: number | null, currency: InvoiceCurrency): string {
  return amount === null ? RATE_PENDING : formatMoney(amount, currency);
}

/** `formatPricePerUnit`, or "rate pending". */
export function formatPriceOrPending(price: number | null, currency: InvoiceCurrency): string {
  return price === null ? RATE_PENDING : formatPricePerUnit(price, currency);
}

/*
 * Overview display (T-65): the same figures with thousands separators, as the
 * panels print them. Kept apart from the helpers above so the Transactions
 * screen's ungrouped cells are untouched.
 */
const GROUPED_2DP = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GROUPED_4DP = new Intl.NumberFormat("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** `46837.33, "CAD"` -> `"CA$46,837.33"`. */
export function formatMoneyGrouped(amount: number, currency: InvoiceCurrency): string {
  return `${amount < 0 ? "-" : ""}${CURRENCY_PREFIX[currency]}${GROUPED_2DP.format(Math.abs(amount))}`;
}

/** `5.5479, "USD"` -> `"US$5.5479"` — 4dp. */
export function formatPriceGrouped(price: number, currency: InvoiceCurrency): string {
  return `${price < 0 ? "-" : ""}${CURRENCY_PREFIX[currency]}${GROUPED_4DP.format(Math.abs(price))}`;
}

/** `21318.77` -> `"21,318.77"`. */
export function formatQtyGrouped(qty: number): string {
  return GROUPED_2DP.format(qty);
}

/** `formatMoneyGrouped`, or "rate pending" for a pending conversion's `null`. */
export function formatMoneyGroupedOrPending(amount: number | null, currency: InvoiceCurrency): string {
  return amount === null ? RATE_PENDING : formatMoneyGrouped(amount, currency);
}

/** `formatPriceGrouped`, or "rate pending". */
export function formatPriceGroupedOrPending(price: number | null, currency: InvoiceCurrency): string {
  return price === null ? RATE_PENDING : formatPriceGrouped(price, currency);
}

/** Sums money in integer cents, so a column of 2dp amounts does not drift by a float's error. */
export function sumMoney(amounts: readonly number[]): number {
  return amounts.reduce((cents, amount) => cents + Math.round(amount * 100), 0) / 100;
}
