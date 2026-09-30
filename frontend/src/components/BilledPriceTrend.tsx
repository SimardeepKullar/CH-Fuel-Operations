"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { OverviewTrendPoint } from "@ch/core/actuals/overview";
import { formatPricePerGal } from "../lib/formatMoney";
import EmptyState from "./EmptyState";

interface BilledPriceTrendProps {
  points: OverviewTrendPoint[];
}

export interface TrendChartPoint {
  period: string;
  label: string;
  /** `null` stays `null` all the way to Recharts — `connectNulls={false}`
   * below then renders it as a gap in the line, never a zero-filled point
   * (A8.1, T-41 DoD). A period with no invoice at all is never in `points`
   * to begin with (`getOverview`'s own doc comment); this `null` is the
   * other case — an invoice exists but carried no TA gallons that period. */
  value: number | null;
}

/** Exported so the "gap, not zero" behaviour is tested as a pure mapping
 * rather than by inspecting rendered SVG geometry. */
export function toTrendChartData(points: readonly OverviewTrendPoint[]): TrendChartPoint[] {
  return points.map((p) => ({
    period: p.period,
    label: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
      new Date(`${p.period}T00:00:00Z`),
    ),
    value: p.avgBilledUsdPerGal,
  }));
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: { payload: TrendChartPoint }[];
}

function TrendTooltip({ active, payload }: TrendTooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload;
  return (
    <div className="chart-tooltip" role="tooltip">
      <div className="chart-tooltip-label">{point.label}</div>
      <div className="chart-tooltip-value">
        {point.value === null ? "No TA gallons this period" : `${formatPricePerGal(point.value)}/gal`}
      </div>
    </div>
  );
}

/** A8.1's billed-price-per-gallon trend across the trailing periods (T-41). */
export default function BilledPriceTrend({ points }: BilledPriceTrendProps) {
  if (points.length === 0) {
    return <EmptyState title="No trend yet" detail="Billed price history builds up as invoices import." />;
  }

  const data = toTrendChartData(points);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--color-divider)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "var(--color-muted)", fontSize: 11 }}
          axisLine={{ stroke: "var(--color-divider)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "var(--color-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={52}
          domain={["auto", "auto"]}
          tickFormatter={(v: number) => `$${v.toFixed(2)}`}
        />
        <Tooltip content={<TrendTooltip />} />
        <Line
          dataKey="value"
          stroke="var(--color-accent)"
          strokeWidth={2}
          dot={{ r: 4, fill: "var(--color-accent)", strokeWidth: 2, stroke: "var(--color-surface)" }}
          activeDot={{ r: 5 }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
