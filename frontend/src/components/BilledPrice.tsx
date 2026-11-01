import type { CSSProperties } from "react";
import type { InvoiceCurrency } from "@ch/core/db/types";
import { RATE_PENDING, formatPricePerUnit } from "../lib/formatMoney";

interface BilledPriceProps {
  /** Per gallon or per litre, whichever the row is in; the column header names
   * the unit. `null` when the stop carries no TA line (e.g. a scale-only
   * charge) — rendered as "—", never 0 or "$0.00" (CLAUDE.md). */
  billedPerUnit: number | null;
  /** The row's own currency — a CA row is not dollars of the US kind (D28). */
  currency: InvoiceCurrency;
  /** The row asked for a conversion whose rate is not entered (T-66): "rate pending", not "—". */
  ratePending?: boolean;
}

// Inline, not a CSS class: T-40 step 40.1 asserts the size
// relationship via `getComputedStyle`, and the test environment renders
// components without the app's stylesheet cascade — see App.css's own
// header comment on this pattern being the design file's convention too
// (the design instantiates every font rule inline, not through classes).
const valueStyle: CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontWeight: 700,
  fontSize: "1rem",
  letterSpacing: "0.01em",
  color: "var(--color-accent-800)",
  fontVariantNumeric: "tabular-nums",
};

/**
 * A9.1: billed price per unit, the dominant numeral in its row (4dp). The
 * retail price and the discount under it are not shown (T-80).
 */
export default function BilledPrice({ billedPerUnit, currency, ratePending = false }: BilledPriceProps) {
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
      <span data-testid="billed-price-value" style={valueStyle}>
        {billedPerUnit === null ? (ratePending ? RATE_PENDING : "—") : formatPricePerUnit(billedPerUnit, currency)}
      </span>
    </span>
  );
}
