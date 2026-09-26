/**
 * Formatting for the Actuals half of the app (T-40 step 40.1, A9). A
 * deliberately separate file from `format.ts`: v1's Plan screens use their
 * own decimal conventions (gallons 1dp, price 3dp) and this file's numbers —
 * gallons 2dp, prices 4dp, money 2dp with an explicit USD marker — must not
 * drift toward or away from them by sharing a module.
 */

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
