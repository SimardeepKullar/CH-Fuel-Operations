/**
 * Turns the plain numbers the API returns into the display strings the mock
 * used to hard-code (UI contract §1: return numbers, not display strings —
 * the frontend composes labels).
 */

/**
 * Re-exported from `@ch/core` so `domain/units.ts` stays the only place
 * unit numbers are validated for display (T-26 DoD, D18) — a second copy
 * here would be exactly the kind of drift that guard exists to prevent.
 */
export { formatUnitNumber } from "@ch/core/domain/units";

export function formatCurrency(amountUsd: number): string {
  const sign = amountUsd < 0 ? "-" : "";
  return `${sign}$${Math.abs(amountUsd).toFixed(2)}`;
}

export function formatDistanceMiles(miles: number): string {
  return `${miles.toFixed(1)} mi`;
}

/** `27600` -> `"7h 40m"`. */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function formatGallons(gallons: number): string {
  return `${gallons.toFixed(1)} gal`;
}

export function formatPricePerGallon(usdPerGallon: number, decimals = 3): string {
  return `$${usdPerGallon.toFixed(decimals)}`;
}

