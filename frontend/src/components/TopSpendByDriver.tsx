"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { OverviewTopSpendDriver } from "@ch/core/actuals/overview";
import { formatGallons2dp, formatMoneyUsd, formatPricePerGal } from "../lib/formatMoney";
import EmptyState from "./EmptyState";

interface TopSpendByDriverProps {
  drivers: OverviewTopSpendDriver[];
}

export interface TopSpendChartRow {
  key: string;
  label: string;
  totalUsd: number;
  gallons: number;
  avgBilledUsdPerGal: number | null;
}

/** A8.6/A9.2-style fallback — an unresolved driver is shown as such, never
 * guessed or dropped from the bars. */
export function toTopSpendChartData(drivers: readonly OverviewTopSpendDriver[]): TopSpendChartRow[] {
  return drivers.map((d, index) => ({
    key: d.driverId ?? `unresolved-${index}`,
    label: d.driverName ?? "Unresolved",
    totalUsd: d.totalUsd,
    gallons: d.gallons,
    avgBilledUsdPerGal: d.avgBilledUsdPerGal,
  }));
}

interface SpendTooltipProps {
  active?: boolean;
  payload?: { payload: TopSpendChartRow }[];
}

function SpendTooltip({ active, payload }: SpendTooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload;
  return (
    <div className="chart-tooltip" role="tooltip">
      <div className="chart-tooltip-label">{row.label}</div>
      <div className="chart-tooltip-value">{formatMoneyUsd(row.totalUsd)}</div>
      <div className="chart-tooltip-sub">
        {formatGallons2dp(row.gallons)} gal · {row.avgBilledUsdPerGal === null ? "—" : formatPricePerGal(row.avgBilledUsdPerGal)}/gal
      </div>
    </div>
  );
}

/** A8.1's top-spend-by-driver bars (T-41) — one series, so no legend (the
 * panel's own title already names what's plotted). */
export default function TopSpendByDriver({ drivers }: TopSpendByDriverProps) {
  if (drivers.length === 0) {
    return <EmptyState title="No spend yet" detail="No fuel stops on this invoice." />;
  }

  const data = toTopSpendChartData(drivers);

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid stroke="var(--color-divider)" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: "var(--color-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fill: "var(--color-text)", fontSize: 11.5 }}
          axisLine={false}
          tickLine={false}
          width={110}
        />
        <Tooltip content={<SpendTooltip />} cursor={{ fill: "var(--color-accent-100)" }} />
        <Bar dataKey="totalUsd" fill="var(--color-accent)" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
