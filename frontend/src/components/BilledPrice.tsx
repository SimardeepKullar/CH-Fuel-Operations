import type { CSSProperties } from "react";
import type { InvoiceCurrency } from "@ch/core/db/types";
import { formatPricePerUnit } from "../lib/formatMoney";

interface BilledPriceProps {
  /** Per gallon or per litre, whichever the row is in; the column header names
   * the unit. `null` when the stop carries no TA line (e.g. a scale-only
   * charge) — rendered as "—", never 0 or "$0.00" (CLAUDE.md). */
  billedPerUnit: number | null;
  retailPerUnit: number | null;
  /** The row's own currency — a CA row is not dollars of the US kind (D28). */
  currency: InvoiceCurrency;
}

// Inline, not a CSS class: BUILD-PLAN-v2 Step 40.1 asserts the size
// relationship via `getComputedStyle`, and the test environment renders
// components without the app's stylesheet cascade — see App.css's own
// header comment on this pattern being the design file's convention too
// (the design instantiates every font rule inline, not through classes).
const valueStyle: CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontWeight: 700,
  fontSize: "14.5px",
  letterSpacing: "0.01em",
  color: "var(--color-accent-800)",
  fontVariantNumeric: "tabular-nums",
};

const discountStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontWeight: 400,
  fontSize: "10px",
  color: "var(--color-muted)",
  fontVariantNumeric: "tabular-nums",
};

/**
 * A9.1: billed price per unit is the dominant numeral in its row (4dp); retail is
 * small and muted (rendered by the caller — this component only owns the
 * billed+discount pairing); discount is a subline, never coloured as a win.
 */
export default function BilledPrice({ billedPerUnit, retailPerUnit, currency }: BilledPriceProps) {
  const discountPerUnit = billedPerUnit === null || retailPerUnit === null ? null : retailPerUnit - billedPerUnit;

  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
      <span data-testid="billed-price-value" style={valueStyle}>
        {billedPerUnit === null ? "—" : formatPricePerUnit(billedPerUnit, currency)}
      </span>
      <span data-testid="billed-price-discount" style={discountStyle}>
        disc {discountPerUnit === null ? "—" : formatPricePerUnit(discountPerUnit, currency)}
      </span>
    </span>
  );
}
