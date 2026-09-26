import type { CSSProperties } from "react";
import { formatPricePerGal } from "../lib/formatMoney";

interface BilledPriceProps {
  /** `null` when the stop carries no TA line (e.g. a scale-only charge) —
   * rendered as "—", never 0 or "$0.00" (CLAUDE.md). */
  billedUsdPerGal: number | null;
  retailUsdPerGal: number | null;
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
 * A9.1: billed $/gal is the dominant numeral in its row (4dp); retail is
 * small and muted (rendered by the caller — this component only owns the
 * billed+discount pairing); discount is a subline, never coloured as a win.
 */
export default function BilledPrice({ billedUsdPerGal, retailUsdPerGal }: BilledPriceProps) {
  const discountUsdPerGal =
    billedUsdPerGal === null || retailUsdPerGal === null ? null : retailUsdPerGal - billedUsdPerGal;

  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
      <span data-testid="billed-price-value" style={valueStyle}>
        {billedUsdPerGal === null ? "—" : formatPricePerGal(billedUsdPerGal)}
      </span>
      <span data-testid="billed-price-discount" style={discountStyle}>
        disc {discountUsdPerGal === null ? "—" : formatPricePerGal(discountUsdPerGal)}
      </span>
    </span>
  );
}
