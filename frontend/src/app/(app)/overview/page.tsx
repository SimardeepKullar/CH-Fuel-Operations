"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OverviewResult } from "@ch/core/actuals/overview";
import { getOverview } from "../../../lib/api";
import { conversionParams, type DisplayChoice } from "../../../lib/conversion";
import { usePublishInView, useWeek } from "../../../hooks/useWeek";
import { formatDatesDifferNote, invoiceOnSide } from "../../../lib/weeks";
import { formatGallons2dp, formatMoney, formatPricePerUnit } from "../../../lib/formatMoney";
import KpiCard from "../../../components/KpiCard";
import BilledPriceTrend from "../../../components/BilledPriceTrend";
import TopSpendByDriver from "../../../components/TopSpendByDriver";
import AnomalyDigest from "../../../components/AnomalyDigest";
import EmptyState from "../../../components/EmptyState";
import Corners from "../../../components/Corners";
import ExchangeRateField from "../../../components/ExchangeRateField";
import ConversionToggle from "../../../components/ConversionToggle";
import CaPanel from "../../../components/CaPanel";
import CombinedPanel from "../../../components/CombinedPanel";

/**
 * A8.1 (T-41, T-65) — the whole landing screen behind one call, `GET
 * /overview?week=`: US KPIs top left, CA top right, the two added together
 * below. The effect depends on `week` and the display choice, not `useWeek`'s
 * own `loading` flag: once `week` resolves to a real value it does not change
 * again just because the shell's background `getHealth`/`listPeriods` calls
 * finish later, so keying off it too would fire this screen's fetch a second
 * time for the same week (DoD: exactly one API call).
 *
 * The choice (`USD/gal` | `CAD/L`, the Transactions screen's own control) sets
 * every rate's unit and the combined panel's currency; money on each side is
 * never converted. Saving the exchange rate re-reads the overview, since the
 * combined figures depend on it.
 *
 * Both of the week's invoices are in view on this screen, so the strip
 * highlights both chips.
 */
export default function OverviewPage() {
  const { week: period, loading: periodLoading, weekEntry, reloadPeriods } = useWeek();
  const usInvoice = invoiceOnSide(weekEntry, "USD");
  const caInvoice = invoiceOnSide(weekEntry, "CAD");
  usePublishInView(weekEntry === null ? null : weekEntry.invoices.map((invoice) => invoice.id));
  const [choice, setChoice] = useState<DisplayChoice | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<OverviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const shownKey = useRef<string | null>(null);

  const rateSaved = useCallback(async () => {
    await reloadPeriods();
    setRefresh((n) => n + 1);
  }, [reloadPeriods]);

  useEffect(() => {
    if (period === null) {
      setResult(null);
      return;
    }
    let cancelled = false;
    // A re-read for the same week and choice (a saved rate) keeps the panels on screen, and the rate field mounted.
    const key = `${period}|${choice}`;
    if (shownKey.current !== key) setLoading(true);
    setError(null);
    getOverview(period, conversionParams(choice))
      .then((r) => {
        if (!cancelled) {
          shownKey.current = key;
          setResult(r);
        }
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
  }, [period, choice, refresh]);

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

  if (result === null || result.combined === null) {
    return (
      <div className="overview-page">
        <EmptyState
          title="No invoice imported yet"
          detail="Import a BVD invoice to see spend, the billed-price trend and any anomalies for a period."
        />
      </div>
    );
  }

  const { us, ca, combined } = result;
  // Keyed on the invoice, so another week's CA invoice starts from its own rate.
  const rateField = caInvoice === null ? null : <ExchangeRateField key={caInvoice.id} invoice={caInvoice} onSaved={rateSaved} />;
  const dateNotes = (weekEntry?.invoices ?? [])
    .filter((invoice) => invoice.datesDiffer)
    .map((invoice) => `${invoice.invoiceNumber}: ${formatDatesDifferNote(invoice)}`);

  return (
    <div className="overview-page">
      <div className="tx-side-bar">
        <ConversionToggle shown={choice} onChange={setChoice} />
      </div>

      <div className="overview-sides">
        {us === null ? (
          <div className="panel-card blueprint tax-panel" data-testid="us-not-imported">
            <Corners />
            <EmptyState title="US — Not imported" detail="This week has no US invoice." />
          </div>
        ) : (
          <UsPanel us={us} invoiceNumber={usInvoice?.invoiceNumber ?? null} />
        )}
        {ca === null ? (
          <div className="panel-card blueprint tax-panel" data-testid="ca-not-imported">
            <Corners />
            <EmptyState title="CA — Not imported" detail="This week has no CA invoice." />
          </div>
        ) : (
          <CaPanel side={ca} invoiceNumber={caInvoice?.invoiceNumber ?? null} />
        )}
      </div>

      <CombinedPanel combined={combined} rateField={rateField} dateNotes={dateNotes} />

      {us !== null && (
        <>
          <div className="overview-panels">
            <div className="panel-card blueprint overview-trend-panel">
              <Corners />
              <div className="panel-card-header">
                <span className="panel-card-title">Billed price trend</span>
                <span className="panel-card-sub">US · trailing periods · $/gal</span>
              </div>
              <BilledPriceTrend points={us.trend} />
            </div>

            <div className="panel-card blueprint overview-topspend-panel">
              <Corners />
              <div className="panel-card-header">
                <span className="panel-card-title">Top spend by driver</span>
                <span className="panel-card-sub">US · this period</span>
              </div>
              <TopSpendByDriver drivers={us.topSpendByDriver} />
            </div>
          </div>

          <div className="panel-card blueprint overview-anomaly-panel">
            <Corners />
            <AnomalyDigest items={us.anomalyDigest} week={period} />
          </div>
        </>
      )}
    </div>
  );
}

/** The US side's KPI cards. US fuel tax is inside the pump price, so each figure is one value. */
function UsPanel({ us, invoiceNumber }: { us: NonNullable<OverviewResult["us"]>; invoiceNumber: string | null }) {
  const { kpis, currency, qtyUnit } = us;
  const money = (n: number) => formatMoney(n, currency);
  const receiptPct =
    kpis.receiptCompliance.total > 0 ? Math.round((kpis.receiptCompliance.confirmed / kpis.receiptCompliance.total) * 100) : null;

  return (
    <section className="overview-us" data-testid="us-panel" aria-label="US">
      <span className="overview-side-title">🇺🇸 US{invoiceNumber === null ? "" : ` · ${invoiceNumber}`}</span>
      <div className="kpi-grid">
        <KpiCard
          label="Average billed price"
          value={kpis.avgBilledPerUnit === null ? "—" : formatPricePerUnit(kpis.avgBilledPerUnit, currency)}
          unit={`${currency}/${qtyUnit}`}
          sub={`discount captured ${money(kpis.discount.total)}`}
          dominant
          testId="kpi-avg-billed"
        />
        <KpiCard label="Total spend" value={money(kpis.total.amount)} unit={currency} testId="kpi-total" />
        <KpiCard
          label="Diesel"
          value={money(kpis.diesel.amount)}
          unit={currency}
          sub={`${formatGallons2dp(kpis.diesel.qty)} ${qtyUnit}`}
          testId="kpi-diesel"
        />
        <KpiCard
          label="DEF"
          value={money(kpis.def.amount)}
          unit={currency}
          sub={`${formatGallons2dp(kpis.def.qty)} ${qtyUnit}`}
          testId="kpi-def"
        />
        <KpiCard label="Other charges" value={money(kpis.otherCharges.total)} unit={currency} testId="kpi-other" />
        <KpiCard
          label="Receipt compliance"
          value={receiptPct === null ? "—" : `${receiptPct}%`}
          sub={`${kpis.receiptCompliance.confirmed} of ${kpis.receiptCompliance.total} confirmed`}
          testId="kpi-receipts"
        />
        <KpiCard label="Anomalies flagged" value={String(kpis.anomaliesFlagged)} testId="kpi-anomalies" />
      </div>
    </section>
  );
}
