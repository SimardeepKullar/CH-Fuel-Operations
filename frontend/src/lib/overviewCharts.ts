/**
 * The Overview's two chart models (T-72, T-73): the billed-price trend per side
 * and the stacked top-spend-by-driver columns. Pure. Geometry that the SVG and
 * the columns need (y scale, "nice" axis steps) lives here so it is testable.
 */
import { aggregateWeeks, ratio, trendChange, trendSeries, type WeekFigures } from "./overviewAggregate";
import type { Scope } from "./overviewScope";
import { formatDay } from "./weeks";
import { weeksInScope, type Side } from "./overviewView";

const NAVY = "#16205c";
const CYAN = "#00a6e2";

/** Weeks needed before a trend line is drawn. */
export const MIN_TREND_WEEKS = 4;

const TWO = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const usd = (n: number): string => "$" + n.toLocaleString("en-US", TWO);
const qty = (n: number): string => n.toLocaleString("en-US", TWO);

export interface TrendView {
  side: Side;
  code: "US" | "CA";
  accent: string;
  label: string;
  unitLabel: string;
  /** No fuel on this side in scope: a quiet line instead of a headline. */
  none: string | null;
  hasValue: boolean;
  cc: string;
  value: string;
  unit: string;
  delta: string;
  /** One value per week in scope when a chart is drawn. */
  chart: { values: (number | null)[]; labels: string[] } | null;
  note: string | null;
  /** `[filled, total]` ticks when fewer than four weeks exist in the whole dataset. */
  progress: { filled: number; total: number } | null;
}

const signed = (pct: number): string => `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;

function trendFor(all: readonly WeekFigures[], scopeWeeks: readonly WeekFigures[], side: Side, single: boolean, spanLabel: string, scopeMode: Scope["mode"]): TrendView {
  const us = side === "us";
  const base = {
    side,
    code: us ? ("US" as const) : ("CA" as const),
    accent: us ? NAVY : CYAN,
    unitLabel: us ? "USD per gallon" : "CAD per litre, with HST",
    cc: us ? "US" : "CA",
    unit: us ? "/ gal" : "/ L",
    delta: "",
    chart: null,
    note: null,
    progress: null,
  };
  const series = trendSeries(scopeWeeks, side);
  const change = trendChange(series);
  if (change === null) {
    return { ...base, label: "Billed price", none: `No ${us ? "US" : "Canadian"} fuel ${scopeMode === "week" ? "this week" : "in this scope"}.`, hasValue: false, value: "" };
  }
  const labels = scopeWeeks.map((w) => formatDay(w.start));
  if (scopeWeeks.length >= MIN_TREND_WEEKS) {
    return {
      ...base,
      label: "Billed price trend",
      none: null,
      hasValue: true,
      value: "$" + change.latest.toFixed(2),
      delta: change.percent === null ? "" : `${signed(change.percent)} since ${labels[change.firstIndex]}`,
      chart: { values: series, labels },
    };
  }

  const agg = aggregateWeeks(scopeWeeks);
  const scoped = us ? agg.us?.avgPrice : agg.ca?.avgPrice;
  let delta = "";
  if (single) {
    const prior = all[all.findIndex((w) => w.weekEnd === scopeWeeks[0]!.weekEnd) - 1];
    const priorPrice = prior === undefined ? null : trendSeries([prior], side)[0]!;
    if (priorPrice !== null && scoped != null) delta = `${signed(((scoped - priorPrice) / priorPrice) * 100)} vs week of ${formatDay(prior!.start)}`;
  }
  const short = all.length < MIN_TREND_WEEKS;
  return {
    ...base,
    label: single ? `Billed price · week of ${formatDay(scopeWeeks[0]!.start)}` : `Billed price · ${spanLabel}`,
    none: null,
    hasValue: true,
    value: "$" + (scoped ?? change.latest).toFixed(2),
    delta,
    note: short ? `${all.length} of ${MIN_TREND_WEEKS} weeks imported. The trend line appears once ${MIN_TREND_WEEKS} weeks are in.` : "Pick a range of 4 or more weeks to see the trend.",
    progress: short ? { filled: all.length, total: MIN_TREND_WEEKS } : null,
  };
}

/** Both trend cards for a scope. `spanLabel` is the view's span (`Aug 4 – Nov 9`). */
export function buildTrends(all: readonly WeekFigures[], scope: Scope, spanLabel: string): [TrendView, TrendView] {
  const weeks = weeksInScope(all, scope);
  const single = weeks.length === 1;
  return [trendFor(all, weeks, "us", single, spanLabel, scope.mode), trendFor(all, weeks, "ca", single, spanLabel, scope.mode)];
}

export interface ChartGeometry {
  width: number;
  height: number;
  gridLabels: { y: number; text: string }[];
  /** `null` points stay `null`: the line breaks there. */
  points: ({ x: number; y: number } | null)[];
  lastIndex: number;
}

/** The y range: the data's span padded 25 % (at least 0.02) each side. */
export function paddedRange(values: readonly (number | null)[]): { lo: number; hi: number } {
  const present = values.filter((v): v is number => v !== null);
  const lo = Math.min(...present);
  const hi = Math.max(...present);
  const pad = Math.max((hi - lo) * 0.25, 0.02);
  return { lo: lo - pad, hi: hi + pad };
}

/** The 640-wide SVG's geometry; the phone variant is taller with a wider label gutter. */
export function chartGeometry(values: readonly (number | null)[], phone: boolean): ChartGeometry {
  const W = 640;
  const H = phone ? 240 : 190;
  const left = phone ? 70 : 46;
  const right = 16;
  const top = 14;
  const bottom = phone ? 44 : 28;
  const { lo, hi } = paddedRange(values);
  const n = values.length;
  const x = (i: number) => left + (n === 1 ? (W - left - right) / 2 : (i * (W - left - right)) / (n - 1));
  const y = (v: number) => top + ((hi - v) / (hi - lo)) * (H - top - bottom);
  let lastIndex = -1;
  const points = values.map((v, i) => {
    if (v === null) return null;
    lastIndex = i;
    return { x: x(i), y: y(v) };
  });
  const gridLabels = [0, 1, 2, 3].map((g) => {
    const v = lo + ((hi - lo) * g) / 3;
    return { y: y(v), text: v.toFixed(2) };
  });
  return { width: W, height: H, gridLabels, points, lastIndex };
}

// ---------------------------------------------------------------- drivers

export interface DriverTooltipRow {
  key: string;
  value: string;
}

export interface DriverColumn {
  name: string;
  sub: string;
  total: string;
  /** Percent of the axis top for each segment. */
  usHeight: number;
  caHeight: number;
  /** Percent of the largest stack, for the phone bars. */
  usWidth: number;
  caWidth: number;
  /** `US$11,200 · CA$4,300` under a phone bar; empty in the split view. */
  mobileLine: string;
  usTooltip: { title: string; rows: DriverTooltipRow[] };
  caTooltip: { title: string; rows: DriverTooltipRow[] };
  /** Axis-percent where a tooltip sits above the stack. */
  stackHeight: number;
}

export interface DriverView {
  /** No week has a rate and both sides have fuel: the sides cannot be stacked. */
  split: boolean;
  view: "us" | "ca";
  unit: string;
  sub: string;
  note: string;
  legend: { color: string; label: string }[];
  ticks: { bottom: number; label: string }[];
  columns: DriverColumn[];
}

interface DriverRow {
  name: string;
  sub: string;
  usd: number;
  usGal: number;
  usDiesel: number;
  /** US spend converted at covered weeks' own rates. */
  uc: number;
  cad: number;
  caLitres: number;
  caDiesel: number;
}

const TOP_N = 10;

/** `1`, `2`, `2.5`, `5` × 10ⁿ: the smallest step whose four intervals cover `max`. */
export function niceStep(max: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(max / 4)));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s * 4 >= max)!;
}

const tickLabel = (v: number): string => (v === 0 ? "0" : v >= 1000 ? `${v / 1000}k` : String(v));

function foldDrivers(weeks: readonly WeekFigures[]): DriverRow[] {
  const byId = new Map<string, DriverRow>();
  for (const w of weeks) {
    for (const d of w.drivers) {
      const key = d.driverId ?? "";
      let r = byId.get(key);
      if (r === undefined) {
        r = { name: d.driverName ?? "Unassigned", sub: "", usd: 0, usGal: 0, usDiesel: 0, uc: 0, cad: 0, caLitres: 0, caDiesel: 0 };
        byId.set(key, r);
      }
      r.usd += d.usd;
      r.usGal += d.usGal;
      r.usDiesel += d.usDiesel;
      r.uc += w.fx === null ? 0 : d.usd * w.fx;
      r.cad += d.cad;
      r.caLitres += d.caLitres;
      r.caDiesel += d.caDiesel;
    }
  }
  return [...byId.values()];
}

/** The stacked-column model. `view` only matters in the no-rate split. */
export function buildDriverView(all: readonly WeekFigures[], scope: Scope, view: "us" | "ca"): DriverView {
  const weeks = weeksInScope(all, scope);
  const agg = aggregateWeeks(weeks);
  const single = weeks.length === 1;
  const split = agg.us !== null && agg.ca !== null && agg.fx.covered === 0;
  const partial = agg.fx.covered > 0 && agg.fx.covered < agg.fx.weeksWithData;

  let rows = foldDrivers(weeks);
  const key = (r: DriverRow) => (split && view === "ca" ? r.cad : r.usd);
  rows = rows.filter((r) => (split && view === "ca" ? r.cad > 0 : r.usd > 0 || r.cad > 0)).sort((a, b) => key(b) - key(a) || b.cad - a.cad);
  const top = rows.slice(0, TOP_N);
  const rest = rows.slice(TOP_N);
  if (rest.length > 0) {
    const sum = (f: (r: DriverRow) => number) => rest.reduce((t, r) => t + f(r), 0);
    top.push({
      name: "All other drivers",
      sub: `${rest.length} drivers`,
      usd: sum((r) => r.usd),
      usGal: sum((r) => r.usGal),
      usDiesel: sum((r) => r.usDiesel),
      uc: sum((r) => r.uc),
      cad: sum((r) => r.cad),
      caLitres: sum((r) => r.caLitres),
      caDiesel: sum((r) => r.caDiesel),
    });
  }

  const seg = (r: DriverRow): [number, number] => (split ? (view === "ca" ? [0, r.cad] : [r.usd, 0]) : [r.uc, r.cad]);
  const max = Math.max(...top.map((r) => seg(r)[0] + seg(r)[1]), 1);
  const step = niceStep(max);
  const axisTop = step * 4;
  const cur = split ? (view === "ca" ? "CA" : "US") : "CA";

  const columns = top.map((r): DriverColumn => {
    const [u, c] = seg(r);
    const avgUs = ratio(r.usDiesel, r.usGal);
    const avgCa = ratio(r.caDiesel, r.caLitres);
    return {
      name: r.name,
      sub: r.sub,
      total: cur + usd(u + c),
      usHeight: (u / axisTop) * 100,
      caHeight: (c / axisTop) * 100,
      usWidth: (u / max) * 100,
      caWidth: (c / max) * 100,
      mobileLine: split ? "" : `US${usd(r.usd)} · CA${usd(r.cad)}`,
      stackHeight: ((u + c) / axisTop) * 100,
      usTooltip: {
        title: `${r.name} · United States`,
        rows: [
          { key: "Spend", value: `US${usd(r.usd)}` + (split ? "" : ` · CA${usd(r.uc)}`) },
          { key: "Quantity", value: `${qty(r.usGal)} gal` },
          { key: "Avg billed", value: avgUs === null ? "—" : `US$${avgUs.toFixed(4)} / gal` },
        ],
      },
      caTooltip: {
        title: `${r.name} · Canada`,
        rows: [
          { key: "Spend", value: `CA${usd(r.cad)}` },
          { key: "Quantity", value: `${qty(r.caLitres)} L` },
          { key: "Avg billed", value: avgCa === null ? "—" : `CA$${avgCa.toFixed(4)} / L` },
        ],
      },
    };
  });

  return {
    split,
    view,
    unit: split ? (view === "ca" ? "CAD" : "USD") : "CAD",
    sub: split
      ? "Each side in its own currency · sorted by spend"
      : "Stacked in CAD · US converted at each week’s rate · sorted by US spend" +
        (partial ? ` · US segments cover ${agg.fx.covered} of ${agg.fx.weeksWithData} weeks` : ""),
    note: `No exchange rate for ${single ? "this week" : "these weeks"}, so US and Canadian spend can’t be stacked in one currency. Each side is shown on its own.`,
    legend: split
      ? [{ color: view === "ca" ? CYAN : NAVY, label: view === "ca" ? "Canada · CAD" : "United States · USD" }]
      : [
          { color: NAVY, label: "United States, in CAD" },
          { color: CYAN, label: "Canada" },
        ],
    ticks: [0, 1, 2, 3, 4].map((t) => ({ bottom: t * 25, label: tickLabel(step * t) })),
    columns,
  };
}
