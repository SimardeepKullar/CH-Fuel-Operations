import type { CSSProperties } from "react";
import Corners from "./Corners";

export interface KpiCardProps {
  label: string;
  value: string;
  /** e.g. "USD", "USD/gal", "gal" — rendered beside the value, omitted for
   * a bare count (anomalies flagged) or a percentage already in `value`. */
  unit?: string;
  /** Subordinate subline — discount captured, a gallon count, a compliance
   * fraction. Omitted entirely (not an empty node) when the card has none. */
  sub?: string;
  dominant?: boolean;
  testId: string;
}

// Inline, not a CSS class, for the same reason as `BilledPrice.tsx`: the
// test environment renders components without the app's stylesheet cascade,
// so the dominant/subordinate size relationship (A9.1, applied here to the
// KPI row per A8.1) has to be a real computed style, not a class name.
const baseValueStyle: CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontWeight: 700,
  color: "var(--color-accent-800)",
  fontVariantNumeric: "tabular-nums",
};

const subStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontWeight: 400,
  fontSize: "10.5px",
  color: "var(--color-muted)",
  fontVariantNumeric: "tabular-nums",
};

/**
 * One A5 figure from `GET /overview` (T-41). The average-billed-price card
 * passes `dominant` — its value renders larger than every sibling card's,
 * and discount rides along as this same card's `sub` line rather than a
 * KPI card of its own, reusing A9.1's billed-dominant/discount-subordinate
 * convention instead of reinventing a second hierarchy at the card level.
 */
export default function KpiCard({ label, value, unit, sub, dominant = false, testId }: KpiCardProps) {
  const valueStyle: CSSProperties = { ...baseValueStyle, fontSize: dominant ? "27px" : "19px" };

  return (
    <div className={`panel-card blueprint kpi-card${dominant ? " kpi-card-dominant" : ""}`}>
      <Corners />
      <span className="kpi-card-label">{label}</span>
      <span className="kpi-card-value-row">
        <span data-testid={`${testId}-value`} style={valueStyle}>
          {value}
        </span>
        {unit && <span className="kpi-card-unit">{unit}</span>}
      </span>
      {sub !== undefined && (
        <span data-testid={`${testId}-sub`} style={subStyle}>
          {sub}
        </span>
      )}
    </div>
  );
}
