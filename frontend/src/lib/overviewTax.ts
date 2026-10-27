/**
 * Labels for the Overview's tax column (T-65). Pure — the CA panel and the
 * combined panel name the same tax the same way.
 */
import type { OverviewTax } from "@ch/core/actuals/overview";

/** "HST" when HST is the only tax BVD printed on the invoice, "Sales tax" otherwise
 * (a GST, PST or QST beside it, or no tax at all). */
export function taxLabel(tax: Pick<OverviewTax, "hst" | "gst" | "pst" | "qst">): "HST" | "Sales tax" {
  return tax.hst !== 0 && tax.gst === 0 && tax.pst === 0 && tax.qst === 0 ? "HST" : "Sales tax";
}
