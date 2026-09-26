/**
 * BVD's fuel-card invoice product codes (§A5/§A11.1) — a distinct vocabulary
 * from the price-sheet `ProductType` in db/types.ts. Invoices carry non-fuel
 * charge codes (scale, trailer, additive, oil, lubricant, cash) the price
 * sheet never did, so this is its own type rather than a reuse of that enum.
 */
export type InvoiceProductType =
  | "highway_diesel"
  | "def"
  | "scale"
  | "trailer"
  | "additive"
  | "oil"
  | "lubricant"
  | "cash";

/**
 * The known codes (§A5/§11.1's tripwire, reused): TA tractor diesel, DF DEF,
 * S scale, TF trailer, AD additive, O oil, L lubricant, C cash.
 *
 * This is a tripwire, not a lookup — its job is to fail an unmapped raw code
 * at parse time, never to enrich or default-map one. Passed as a parameter
 * (never imported directly) so the parser stays pure and the tripwire is
 * unit-testable with a small injected map that omits a code on purpose.
 */
export const DEFAULT_INVOICE_PRODUCT_CODES: ReadonlyMap<
  string,
  InvoiceProductType
> = new Map([
  ["TA", "highway_diesel"],
  ["DF", "def"],
  ["S", "scale"],
  ["TF", "trailer"],
  ["AD", "additive"],
  ["O", "oil"],
  ["L", "lubricant"],
  ["C", "cash"],
]);
