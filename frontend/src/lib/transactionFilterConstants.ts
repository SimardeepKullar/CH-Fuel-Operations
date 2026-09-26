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
