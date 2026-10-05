"use client";

import { useEffect, useState } from "react";
import type { OverviewResult } from "@ch/core/actuals/overview";
import { getOverview } from "../../../lib/api";
import { usePublishViewSide, useWeek } from "../../../hooks/useWeek";
import { formatGallons2dp, formatMoneyUsd, formatPricePerGal } from "../../../lib/formatMoney";
import KpiCard from "../../../components/KpiCard";
import BilledPriceTrend from "../../../components/BilledPriceTrend";
import TopSpendByDriver from "../../../components/TopSpendByDriver";
import AnomalyDigest from "../../../components/AnomalyDigest";
import EmptyState from "../../../components/EmptyState";
import Corners from "../../../components/Corners";

/**
 * A8.1 (T-41) — the whole landing screen behind one call, `GET
 * /overview?week=` (T-33). The effect depends on `week` alone, not
 * `useWeek`'s own `loading` flag: once `week` resolves to a real value it does
 * not change again just because the shell's background `getHealth`/`listPeriods`
 * calls finish later, so keying off it too would fire this screen's fetch a
 * second time for the same week (DoD: exactly one API call).
 *
 * `/overview` serves the US side alone until T-65 shapes the CA and combined
 * panels, so the screen says so to the "Invoices in view" strip.
 */
export default function OverviewPage() {
  const { week: period, loading: periodLoading } = useWeek();
  usePublishViewSide("USD");
  const [result, setResult] = useState<OverviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (period === null) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getOverview(period)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const showLoading = period === null ? periodLoading : loading;

  if (showLoading) {
    return (
      <div className="overview-page">
        <EmptyState title="Loading overview…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="overview-page">
        <EmptyState title="Couldn't load the overview" detail={error.message} />
      </div>
    );
  }

  if (result === null || result.kpis.invoiceId === null) {
    return (
      <div className="overview-page">
        <EmptyState
          title="No invoice imported yet"
          detail="Import a BVD invoice to see spend, the billed-price trend and any anomalies for a period."
        />
      </div>
    );
  }

  const { kpis, trend, topSpendByDriver, anomalyDigest } = result;
  const receiptPct =
    kpis.receiptCompliance.total > 0 ? Math.round((kpis.receiptCompliance.confirmed / kpis.receiptCompliance.total) * 100) : null;

  return (
    <div className="overview-page">
      <div className="kpi-grid">
        <KpiCard
          label="Average billed price"
          value={kpis.avgBilledPerUnit === null ? "—" : formatPricePerGal(kpis.avgBilledPerUnit)}
          unit="USD/gal"
          sub={`discount captured ${formatMoneyUsd(kpis.discount.total)}`}
          dominant
          testId="kpi-avg-billed"
        />
        <KpiCard label="Total spend" value={formatMoneyUsd(kpis.total.amount)} unit="USD" testId="kpi-total" />
        <KpiCard
          label="Diesel"
          value={formatMoneyUsd(kpis.diesel.amount)}
          unit="USD"
          sub={`${formatGallons2dp(kpis.diesel.qty)} gal`}
          testId="kpi-diesel"
        />
        <KpiCard
          label="DEF"
          value={formatMoneyUsd(kpis.def.amount)}
          unit="USD"
          sub={`${formatGallons2dp(kpis.def.qty)} gal`}
          testId="kpi-def"
        />
        <KpiCard label="Other charges" value={formatMoneyUsd(kpis.otherCharges.total)} unit="USD" testId="kpi-other" />
        <KpiCard
          label="Receipt compliance"
          value={receiptPct === null ? "—" : `${receiptPct}%`}
          sub={`${kpis.receiptCompliance.confirmed} of ${kpis.receiptCompliance.total} confirmed`}
          testId="kpi-receipts"
        />
        <KpiCard label="Anomalies flagged" value={String(kpis.anomaliesFlagged)} testId="kpi-anomalies" />
      </div>

      <div className="overview-panels">
        <div className="panel-card blueprint overview-trend-panel">
          <Corners />
          <div className="panel-card-header">
            <span className="panel-card-title">Billed price trend</span>
            <span className="panel-card-sub">trailing periods · $/gal</span>
          </div>
          <BilledPriceTrend points={trend} />
        </div>

        <div className="panel-card blueprint overview-topspend-panel">
          <Corners />
          <div className="panel-card-header">
            <span className="panel-card-title">Top spend by driver</span>
            <span className="panel-card-sub">this period</span>
          </div>
          <TopSpendByDriver drivers={topSpendByDriver} />
        </div>
      </div>

      <div className="panel-card blueprint overview-anomaly-panel">
        <Corners />
        <AnomalyDigest items={anomalyDigest} week={period} />
      </div>
    </div>
  );
}
