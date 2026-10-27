"use client";

import { useState } from "react";
import type { DriverColumn, DriverView } from "../../lib/overviewCharts";
import Corners from "../Corners";
import SegmentedControl from "../SegmentedControl";

const NAVY = "#16205c";
const CYAN = "#00a6e2";
const TOP = 5;

const tip = (c: DriverColumn, side: "us" | "ca"): string => {
  const t = side === "us" ? c.usTooltip : c.caTooltip;
  return `${t.title}\n${t.rows.map((r) => `${r.key}: ${r.value}`).join("\n")}`;
};

/**
 * Top spend by driver as horizontal stacked bars, collapsible: the top five to start,
 * then the top ten and one bar for everyone else. With no rate anywhere the sides cannot
 * be stacked, so a toggle shows each in its own currency.
 */
export default function DriverSpend({
  build,
  splitPossible,
}: {
  /** The model for a view; only the split's toggle changes it. */
  build: (view: "us" | "ca") => DriverView;
  splitPossible: boolean;
}) {
  const [view, setView] = useState<"us" | "ca">("us");
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const model = build(splitPossible ? view : "us");
  const canExpand = model.columns.length > TOP;
  const shown = all ? model.columns : model.columns.slice(0, TOP);
  // Scale to the longest bar on screen, so the top five fill the width on their own.
  const longest = Math.max(...shown.map((c) => c.usWidth + c.caWidth), 1);

  return (
    <section className="ov-card ov-drivers blueprint" aria-label="Top spend by driver" data-testid="driver-spend">
      <Corners />
      <button type="button" className="ov-drivers-head" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="driver-toggle">
        <svg className="ov-drivers-icon" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="1" y="9" width="4" height="10" fill="currentColor" />
          <rect x="8" y="3" width="4" height="16" fill="currentColor" />
          <rect x="15" y="12" width="4" height="7" fill="currentColor" />
        </svg>
        <span className="ov-drivers-titles">
          <h2 className="ov-section-title">Spend by driver</h2>
          <span className="ov-region-sub">{model.sub}</span>
        </span>
        <span className="ov-hide">{open ? "Hide ▴" : "Show ▾"}</span>
      </button>
      {open && (
        <div className="ov-drivers-body">
          <div className="ov-drivers-side">
            {model.split && (
              <SegmentedControl
                compact
                ariaLabel="Driver spend view"
                value={view}
                onChange={setView}
                options={[
                  { value: "us", label: "US · USD" },
                  { value: "ca", label: "Canada · CAD" },
                ]}
              />
            )}
            {model.legend.map((l) => (
              <span key={l.label} className="ov-legend">
                <i style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
          {model.split && (
            <div className="ov-drivers-note" data-testid="driver-split-note">
              {model.note}
            </div>
          )}
          <div className="ov-hbars" data-testid="driver-bars">
            {shown.map((c) => (
              <div key={c.name} className="ov-hbar" data-testid="driver-column">
                <div className="ov-hbar-name">
                  {c.name}
                  {c.name === "All other drivers" && <span className="ov-bar-sub"> {c.sub}</span>}
                </div>
                <div className="ov-hbar-track">
                  <i data-testid="driver-seg-us" title={tip(c, "us")} style={{ background: NAVY, width: `${(c.usWidth / longest) * 100}%` }} />
                  <i data-testid="driver-seg-ca" title={tip(c, "ca")} style={{ background: CYAN, width: `${(c.caWidth / longest) * 100}%` }} />
                </div>
                <div className="ov-hbar-total">{c.total}</div>
              </div>
            ))}
          </div>
          {canExpand && (
            <button type="button" className="ov-more" onClick={() => setAll((a) => !a)} data-testid="driver-more">
              {all ? `Show top ${TOP}` : `Show all ${model.columns.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
