import type { InvoiceCurrency } from "../db/types.js";

/** BVD's `CUR` code → the invoice currency it denotes (D24). BVD writes
 * `CN`, not `CA` or `CAD`. Anything absent here is not guessed at. */
const CURRENCY_CODES: ReadonlyMap<string, InvoiceCurrency> = new Map([
  ["US", "USD"],
  ["CN", "CAD"],
]);

export function currencyFromCode(raw: string): InvoiceCurrency | null {
  return CURRENCY_CODES.get(raw.trim().toUpperCase()) ?? null;
}
