import { DEFAULT_INVOICE_PRODUCT_CODES, type InvoiceProductType } from "@ch/core/invoice/productCode";
import type { FilterOption } from "../hooks/useTransactionFilterOptions";

const PRODUCT_LABELS: Record<InvoiceProductType, string> = {
  highway_diesel: "Diesel",
  def: "DEF",
  scale: "Scale",
  trailer: "Trailer",
  additive: "Additive",
  oil: "Oil",
  lubricant: "Lubricant",
  cash: "Cash",
};

/** T-40G: which colour a product's badge takes — the site's own light
 * blue/navy/green (already used for the accent, headings, and map
 * candidates elsewhere), not a bespoke palette. Every other product stays
 * neutral, same as all of them were under T-40C. */
const PRODUCT_BADGE_VARIANTS: Record<InvoiceProductType, string> = {
  highway_diesel: "diesel",
  def: "def",
  scale: "scale",
  trailer: "neutral",
  additive: "neutral",
  oil: "neutral",
  lubricant: "neutral",
  cash: "neutral",
};

/** The product filter's options — BVD's fixed, known invoice codes
 * (`productCode.ts`'s tripwire map), not derived from loaded rows: a
 * product with no stops this period should still be choosable, unlike
 * card/state (T-40's `useTransactionFilterOptions`). */
export const PRODUCT_OPTIONS: FilterOption[] = [...DEFAULT_INVOICE_PRODUCT_CODES.entries()].map(([code, type]) => ({
  value: code,
  label: PRODUCT_LABELS[type],
}));

export const RECEIPT_STATUS_OPTIONS: FilterOption[] = [
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "missing", label: "Missing" },
];

/** A product line's raw code (`TA`, `DF`, ...) -> its display label, for the
 * expanded row's product-line table (`StopExpansion.tsx`). Falls back to the
 * raw code itself for anything outside the known tripwire map, rather than
 * hiding an otherwise-valid line. */
export function productLabel(code: string): string {
  const type = DEFAULT_INVOICE_PRODUCT_CODES.get(code);
  return type ? PRODUCT_LABELS[type] : code;
}

/** A product line's raw code -> its badge colour variant (T-40G). Falls
 * back to "neutral" for anything outside the known tripwire map, mirroring
 * `productLabel`'s own fallback. */
export function productBadgeVariant(code: string): string {
  const type = DEFAULT_INVOICE_PRODUCT_CODES.get(code);
  return type ? PRODUCT_BADGE_VARIANTS[type] : "neutral";
}
