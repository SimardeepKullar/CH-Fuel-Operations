"use client";

import { useState } from "react";
import { chartGeometry, type TrendTip, type TrendView } from "../../lib/overviewCharts";
import type { TrendGrain } from "../../lib/overviewAggregate";
import Corners from "../Corners";
import SegmentedControl from "../SegmentedControl";

const AMBER = "#b7791f";

/**
 * One 640-wide line chart. A period with no fuel is a gap in the line and a `no fuel` label.
 * Every period has an invisible, focusable hit target (about 24 px on screen) that opens its
 * tooltip on hover, focus or tap, and closes it on leave, blur or Esc (T-89).
 */
function TrendChart({
  values,
  labels,
  tips,
  grain,
  accent,
  phone,
}: {
  values: (number | null)[];
  labels: string[];
  tips: TrendTip[];
  grain: TrendGrain;
  accent: string;
  phone: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const g = chartGeometry(values, phone);
  const fs = phone ? 20 : 11;
  const left = phone ? 70 : 46;
  const bottom = phone ? 44 : 28;
  const n = values.length;
  const xAt = (i: number) => left + (n === 1 ? (g.width - left - 16) / 2 : (i * (g.width - left - 16)) / (n - 1));
  const yAt = (i: number) => g.points[i]?.y ?? (g.height - bottom) / 2;
  const hit = phone ? 24 : 18;

  let path = "";
  let pen = false;
  g.points.forEach((p) => {
    if (p === null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
    pen = true;
  });

  const tip = active === null ? null : tips[active];
  const activeX = active === null ? 0 : xAt(active);
  const activeY = active === null ? 0 : yAt(active);
  // The first and last points sit at the card's edges: anchor the tooltip to that side so it stays inside.
  const anchor = activeX < g.width * 0.25 ? "start" : activeX > g.width * 0.75 ? "end" : "mid";

  const text = { font: `500 ${fs}px var(--font-body)`, fill: "#7b869e" } as const;
  return (
    <div className={phone ? "ov-trend-plot ov-phone-only" : "ov-trend-plot ov-desktop-only"}>
      <svg
        className="ov-trend-svg"
        viewBox={`0 0 ${g.width} ${g.height}`}
        role="group"
        aria-label={`Billed price by ${grain}`}
        data-testid={phone ? "trend-chart-phone" : "trend-chart"}
      >
        {g.gridLabels.map((l) => (
          <g key={l.text}>
            <line x1={left} x2={g.width - 16} y1={l.y} y2={l.y} stroke="#e3e8f1" />
            <text x={left - 8} y={l.y + fs * 0.35} textAnchor="end" style={text}>
              {l.text}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke={accent} strokeWidth={phone ? 3 : 2} strokeLinejoin="round" />
        {g.points.map((p, i) =>
          p === null ? (
            <text key={`n${i}`} x={xAt(i)} y={g.height - bottom - 6} textAnchor="middle" style={{ font: text.font, fill: AMBER }}>
              no fuel
            </text>
          ) : (
            <circle
              key={`c${i}`}
              cx={p.x}
              cy={p.y}
              r={i === g.lastIndex ? (phone ? 7 : 5) : phone ? 4 : 3}
              fill={i === g.lastIndex ? accent : "#fff"}
              stroke={accent}
              strokeWidth={1.5}
            />
          ),
        )}
        {labels.map((label, i) => {
          if (phone && i !== 0 && i !== n - 1) return null;
          return (
            <text key={`x${i}`} x={xAt(i)} y={g.height - bottom + fs + 8} textAnchor={phone ? (i === 0 ? "start" : "end") : "middle"} style={text}>
              {label}
            </text>
          );
        })}
        {active !== null && <circle cx={activeX} cy={activeY} r={phone ? 10 : 8} fill="none" stroke={accent} strokeWidth={1.5} pointerEvents="none" />}
        {tips.map((t, i) => (
          <circle
            key={`h${i}`}
            cx={xAt(i)}
            cy={yAt(i)}
            r={hit}
            fill="transparent"
            tabIndex={0}
            role="img"
            aria-label={t.text}
            data-testid="trend-point"
            className="ov-trend-hit"
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive((a) => (a === i ? null : a))}
            onFocus={() => setActive(i)}
            onBlur={() => setActive((a) => (a === i ? null : a))}
            onClick={() => setActive(i)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setActive(null);
            }}
          />
        ))}
      </svg>
      {tip !== null && tip !== undefined && (
        <div
          className={`ov-trend-tip ov-trend-tip-${anchor}`}
          role="tooltip"
          data-testid="trend-tip"
          style={{ left: `${(activeX / g.width) * 100}%`, top: `${(activeY / g.height) * 100}%` }}
        >
          <b>{tip.title}</b>
          {tip.rows.map((r) => (
            <span key={r.key}>
              <i>{r.key}</i>
              <em>{r.value}</em>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A side's billed-price card: the headline, then a chart, a one-line fallback, or the empty note. */
export default function TrendCard({ trend, onGrainChange }: { trend: TrendView; onGrainChange: (grain: TrendGrain) => void }) {
  return (
    <section className="ov-card ov-trend blueprint" aria-label={`${trend.code} billed price trend`} data-testid={`trend-${trend.side}`}>
      <Corners />
      <header className="ov-trend-head">
        <b className="ov-trend-badge" style={{ background: trend.accent }}>
          {trend.code}
        </b>
        <span className="ov-tile-label">{trend.label}</span>
        <span className="ov-trend-unit">{trend.unitLabel}</span>
        {trend.chart !== null && (
          <SegmentedControl
            compact
            ariaLabel={`${trend.code} trend grain`}
            value={trend.grain}
            onChange={onGrainChange}
            options={[
              { value: "week", label: "Week" },
              { value: "month", label: "Month", disabled: !trend.canMonth, title: trend.canMonth ? undefined : "Month needs two or more months in scope" },
            ]}
          />
        )}
      </header>
      {trend.hasValue && (
        <div className="ov-trend-headline">
          <span className="ov-tile-num ov-trend-num">
            <span className="ov-cc">{trend.cc}</span>
            <span className="ov-num">{trend.value}</span>
            <span className="ov-unit">{trend.unit}</span>
          </span>
          <span className="ov-trend-delta">{trend.delta}</span>
        </div>
      )}
      {trend.chart !== null && (
        <div className="ov-trend-chart">
          <TrendChart values={trend.chart.values} labels={trend.chart.labels} tips={trend.chart.tips} grain={trend.grain} accent={trend.accent} phone={false} />
          <TrendChart values={trend.chart.values} labels={trend.chart.labels} tips={trend.chart.tips} grain={trend.grain} accent={trend.accent} phone />
        </div>
      )}
      {trend.note !== null && (
        <div className="ov-trend-note">
          {trend.progress !== null && (
            <span className="ov-trend-ticks" data-testid="trend-ticks">
              {Array.from({ length: trend.progress.total }, (_, i) => (
                <i key={i} style={{ background: i < trend.progress!.filled ? trend.accent : "#e3e8f1" }} />
              ))}
            </span>
          )}
          <span>{trend.note}</span>
        </div>
      )}
      {trend.none !== null && <div className="ov-trend-empty">{trend.none}</div>}
    </section>
  );
}
