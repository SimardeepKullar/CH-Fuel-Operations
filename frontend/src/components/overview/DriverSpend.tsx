"use client";

import { useState } from "react";
import type { DriverColumn, DriverView } from "../../lib/overviewCharts";
import Corners from "../Corners";
import SegmentedControl from "../SegmentedControl";

const NAVY = "#16205c";
const CYAN = "#00a6e2";

type Hover = { index: number; side: "us" | "ca" } | null;

function Tooltip({ column, side }: { column: DriverColumn; side: "us" | "ca" }) {
  const tip = side === "us" ? column.usTooltip : column.caTooltip;
  return (
    <div className="ov-tip" style={{ bottom: `calc(${column.stackHeight}% + 10px)` }} role="tooltip" data-testid="driver-tooltip">
      <div className="ov-tip-title">{tip.title}</div>
      <div className="ov-tip-rows">
        {tip.rows.map((r) => (
          <div key={r.key} className="ov-tip-row">
            <span>{r.key}</span>
            <span>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Top spend by driver: stacked columns on a desktop, horizontal bars on a phone (both
 * rendered, the viewport picks one). With no rate anywhere the sides cannot be stacked,
 * so a toggle shows each in its own currency.
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
  const [hover, setHover] = useState<Hover>(null);
  const model = build(splitPossible ? view : "us");

  return (
    <section className="ov-card ov-drivers blueprint" aria-label="Top spend by driver" data-testid="driver-spend">
      <Corners />
      <header className="ov-drivers-head">
        <div className="ov-drivers-titles">
          <h2 className="ov-section-title">Top spend by driver</h2>
          <div className="ov-region-sub">{model.sub}</div>
        </div>
        <div className="ov-drivers-side">
          {model.split && (
            <SegmentedControl
              compact
              ariaLabel="Driver spend view"
              value={view}
              onChange={(v) => {
                setView(v);
                setHover(null);
              }}
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
      </header>
      {model.split && (
        <div className="ov-drivers-note" data-testid="driver-split-note">
          {model.note}
        </div>
      )}

      <div className="ov-cols ov-desktop-only" data-testid="driver-columns">
        <div className="ov-cols-plot">
          {model.ticks.map((t) => (
            <div key={t.bottom} className="ov-cols-tick" style={{ bottom: `${t.bottom}%` }}>
              <span>{t.label}</span>
            </div>
          ))}
          <span className="ov-cols-unit">{model.unit}</span>
          <div className="ov-cols-stacks">
            {model.columns.map((c, i) => {
              const on = hover !== null && hover.index === i ? hover.side : null;
              return (
                <div key={c.name} className="ov-col" onMouseLeave={() => setHover(null)} data-testid="driver-column">
                  {on !== null && <Tooltip column={c} side={on} />}
                  <div
                    className="ov-seg"
                    data-testid="driver-seg-ca"
                    style={{ background: CYAN, height: `${c.caHeight}%`, outline: on === "ca" ? `2px solid ${NAVY}` : "none" }}
                    onMouseEnter={() => setHover({ index: i, side: "ca" })}
                  />
                  <div
                    className="ov-seg"
                    data-testid="driver-seg-us"
                    style={{ background: NAVY, height: `${c.usHeight}%`, outline: on === "us" ? `2px solid ${CYAN}` : "none" }}
                    onMouseEnter={() => setHover({ index: i, side: "us" })}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className="ov-cols-labels">
          {model.columns.map((c) => (
            <div key={c.name} className="ov-cols-label">
              <div className="ov-cols-name">{c.name}</div>
              <div className="ov-cols-total">{c.total}</div>
              <div className="ov-cols-sub">{c.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="ov-bars ov-phone-only" data-testid="driver-bars">
        {model.columns.map((c) => (
          <div key={c.name}>
            <div className="ov-bar-head">
              <span className="ov-bar-name">
                {c.name} <span className="ov-bar-sub">{c.sub}</span>
              </span>
              <span className="ov-bar-total">{c.total}</span>
            </div>
            <div className="ov-bar-track">
              <i style={{ background: NAVY, width: `${c.usWidth}%` }} />
              <i style={{ background: CYAN, width: `${c.caWidth}%` }} />
            </div>
            {c.mobileLine !== "" && <div className="ov-bar-line">{c.mobileLine}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
