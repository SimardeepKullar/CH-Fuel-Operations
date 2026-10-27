import { chartGeometry, type TrendView } from "../../lib/overviewCharts";
import Corners from "../Corners";

const AMBER = "#b7791f";

/** One 640-wide line chart. A week with no fuel is a gap in the line and a `no fuel` label. */
function TrendChart({ values, labels, accent, phone }: { values: (number | null)[]; labels: string[]; accent: string; phone: boolean }) {
  const g = chartGeometry(values, phone);
  const fs = phone ? 20 : 11;
  const left = phone ? 70 : 46;
  const bottom = phone ? 44 : 28;
  const n = values.length;

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

  const text = { font: `500 ${fs}px var(--font-body)`, fill: "#7b869e" } as const;
  return (
    <svg
      className={phone ? "ov-trend-svg ov-phone-only" : "ov-trend-svg ov-desktop-only"}
      viewBox={`0 0 ${g.width} ${g.height}`}
      role="img"
      aria-label="Billed price by week"
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
          <text key={`n${i}`} x={left + (n === 1 ? (g.width - left - 16) / 2 : (i * (g.width - left - 16)) / (n - 1))} y={g.height - bottom - 6} textAnchor="middle" style={{ font: text.font, fill: AMBER }}>
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
        const x = left + (n === 1 ? (g.width - left - 16) / 2 : (i * (g.width - left - 16)) / (n - 1));
        return (
          <text key={`x${i}`} x={x} y={g.height - bottom + fs + 8} textAnchor={phone ? (i === 0 ? "start" : "end") : "middle"} style={text}>
            {label}
          </text>
        );
      })}
    </svg>
  );
}

/** A side's billed-price card: the headline, then a chart, a one-line fallback, or the empty note. */
export default function TrendCard({ trend }: { trend: TrendView }) {
  return (
    <section className="ov-card ov-trend blueprint" aria-label={`${trend.code} billed price trend`} data-testid={`trend-${trend.side}`}>
      <Corners />
      <header className="ov-trend-head">
        <b className="ov-trend-badge" style={{ background: trend.accent }}>
          {trend.code}
        </b>
        <span className="ov-tile-label">{trend.label}</span>
        <span className="ov-trend-unit">{trend.unitLabel}</span>
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
          <TrendChart values={trend.chart.values} labels={trend.chart.labels} accent={trend.accent} phone={false} />
          <TrendChart values={trend.chart.values} labels={trend.chart.labels} accent={trend.accent} phone />
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
