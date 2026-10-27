import type { CSSProperties, MouseEvent } from "react";
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
  /** Colours the value: a red 0% compliance, an amber anomaly count. */
  tone?: "bad" | "warn";
  /** A second reading of the same figure — the US tiles' CAD equivalent — set top right, level with the label. */
  corner?: string;
  /** A small note bottom right, level with the sub-line — the CA tiles' tax amount. */
  cornerBottom?: string;
  /** Makes the whole tile a link — the Overview's anomaly tiles open Transactions. */
  href?: string;
  /** Called instead of a full page load when the link is clicked plainly (the app router's `push`). */
  onOpen?: (href: string) => void;
  /** A cell inside a side panel (T-65) rather than a card of its own: no frame or corner marks. */
  flat?: boolean;
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

const TONE_COLOR = { bad: "var(--color-error)", warn: "#b7791f" } as const;

const subStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontWeight: 400,
  fontSize: "10.5px",
  color: "var(--color-muted)",
  fontVariantNumeric: "tabular-nums",
};

/** A leading `US$` / `CA$`: the country letters are set small and grey, the `$` as large as the figure; the text is unchanged. */
const CURRENCY_LEAD = /^(-?)(US\$|CA\$)(.*)$/;

function renderValue(value: string) {
  const lead = CURRENCY_LEAD.exec(value);
  if (lead === null) return value;
  return (
    <>
      {lead[1]}
      <span className="kpi-card-prefix">{lead[2].slice(0, 2)}</span>$
      {lead[3]}
    </>
  );
}

/**
 * One A5 figure from `GET /overview` (T-41). The average-billed-price card
 * passes `dominant` — its value renders larger than every sibling card's,
 * and discount rides along as this same card's `sub` line rather than a
 * KPI card of its own, reusing A9.1's billed-dominant/discount-subordinate
 * convention instead of reinventing a second hierarchy at the card level.
 */
export default function KpiCard({ label, value, unit, sub, dominant = false, tone, corner, cornerBottom, href, onOpen, flat = false, testId }: KpiCardProps) {
  const valueStyle: CSSProperties = {
    ...baseValueStyle,
    fontSize: dominant ? "27px" : "19px",
    ...(tone === undefined ? {} : { color: TONE_COLOR[tone] }),
  };
  const className = flat
    ? `kpi-tile${dominant ? " kpi-tile-dominant" : ""}`
    : `panel-card blueprint kpi-card${dominant ? " kpi-card-dominant" : ""}`;

  const body = (
    <>
      {!flat && <Corners />}
      <span className="kpi-card-head">
        <span className="kpi-card-label">{label}</span>
        {corner !== undefined && (
          <span className="kpi-card-corner" data-testid={`${testId}-corner`}>
            {corner}
          </span>
        )}
      </span>
      <span className="kpi-card-value-row">
        <span data-testid={`${testId}-value`} style={valueStyle}>
          {renderValue(value)}
        </span>
        {unit && <span className="kpi-card-unit">{unit}</span>}
      </span>
      {/* A link says so, bottom right, unless the tile has its own note there. */}
      {(cornerBottom ?? (href === undefined ? undefined : "View →")) !== undefined && (
        <span
          className={`kpi-card-corner-bottom${cornerBottom === undefined ? " kpi-card-link-hint" : ""}`}
          data-testid={`${testId}-corner-bottom`}
        >
          {cornerBottom ?? "View →"}
        </span>
      )}
      {sub !== undefined && (
        <span data-testid={`${testId}-sub`} style={subStyle}>
          {sub}
        </span>
      )}
    </>
  );

  if (href === undefined) return <div className={className}>{body}</div>;

  // A plain click goes through the app router; a modified one (new tab) is left to the browser.
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    if (onOpen === undefined || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onOpen(href);
  };
  return (
    <a className={`${className} kpi-tile-link`} href={href} onClick={open} data-testid={`${testId}-link`}>
      {body}
    </a>
  );
}
