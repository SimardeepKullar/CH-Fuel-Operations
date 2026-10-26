"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OverviewConverted, OverviewResult } from "@ch/core/actuals/overview";
import { getOverview } from "../../../lib/api";
import { usePublishInView, useWeek } from "../../../hooks/useWeek";
import type { PeriodInvoice } from "@ch/core/api/routes/periods";
import { actualRange, formatCompactRange, formatDatesDifferNote, formatDay, invoiceOnSide } from "../../../lib/weeks";
import {
  RATE_PENDING,
  formatMoneyGroupedOrPending,
  formatMoneyGrouped,
  formatPriceGrouped,
  formatQtyGrouped,
} from "../../../lib/formatMoney";
import KpiCard from "../../../components/KpiCard";
import BilledPriceTrend from "../../../components/BilledPriceTrend";
import TopSpendByDriver from "../../../components/TopSpendByDriver";
import { anomalyDigestHref } from "../../../components/AnomalyDigest";
import EmptyState from "../../../components/EmptyState";
import Corners from "../../../components/Corners";
import ExchangeRateField from "../../../components/ExchangeRateField";
import CaPanel from "../../../components/CaPanel";
import SidePanel from "../../../components/SidePanel";
import CombinedPanel from "../../../components/CombinedPanel";

/**
 * A8.1 (T-41, T-65) — the whole landing screen behind one call, `GET
 * /overview?week=`: US KPIs top left, CA top right, the two added together
 * below. The effect depends on `week`, not `useWeek`'s
 * own `loading` flag: once `week` resolves to a real value it does not change
 * again just because the shell's background `getHealth`/`listPeriods` calls
 * finish later, so keying off it too would fire this screen's fetch a second
 * time for the same week (DoD: exactly one API call).
 *
 * Each side reads as BVD printed it — US in USD/gal, CA in CAD/L — and the
 * combined panel in CAD/L (`COMBINED`), the US side converted at the entered
 * rate. There is no unit control on this screen. Saving the exchange rate
 * re-reads the overview, since the combined figures depend on it.
 *
 * Both of the week's invoices are in view on this screen, so the strip
 * highlights both chips.
 */
/** The combined panel's currency; its unit follows (CAD → litres). Each side stays as printed. */
const COMBINED = { convertTo: "CAD" } as const;

export default function OverviewPage() {
  const { week: period, loading: periodLoading, weekEntry, reloadPeriods } = useWeek();
  const router = useRouter();
  const usInvoice = invoiceOnSide(weekEntry, "USD");
  const caInvoice = invoiceOnSide(weekEntry, "CAD");
  usePublishInView(weekEntry === null ? null : weekEntry.invoices.map((invoice) => invoice.id));
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
    // A re-read for the same week (a saved rate) keeps the panels on screen, and the rate field mounted.
    if (shownKey.current !== period) setLoading(true);
    setError(null);
    getOverview(period, COMBINED)
      .then((r) => {
        if (!cancelled) {
          shownKey.current = period;
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
  }, [period, refresh]);

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

  const { us, usConverted, ca, combined } = result;
  // Keyed on the invoice, so another week's CA invoice starts from its own rate.
  const rateField = caInvoice === null ? null : <ExchangeRateField key={caInvoice.id} invoice={caInvoice} onSaved={rateSaved} />;
  const dateNotes = (weekEntry?.invoices ?? [])
    .filter((invoice) => invoice.datesDiffer)
    .map((invoice) => `${invoice.invoiceNumber}: ${formatDatesDifferNote(invoice)}`);

  return (
    <div className="overview-page">

      <div className="overview-sides">
        {us === null ? (
          <div className="panel-card blueprint tax-panel" data-testid="us-not-imported">
            <Corners />
            <EmptyState title="US — Not imported" detail="This week has no US invoice." />
          </div>
        ) : (
          <UsPanel
            us={us}
            converted={usConverted}
            invoiceLine={invoiceLine(usInvoice)}
            anomaliesHref={anomalyDigestHref(period, us.kpis.invoiceId)}
            onOpen={router.push}
          />
        )}
        {ca === null ? (
          <div className="panel-card blueprint tax-panel" data-testid="ca-not-imported">
            <Corners />
            <EmptyState title="CA — Not imported" detail="This week has no CA invoice." />
          </div>
        ) : (
          <CaPanel side={ca} anomaliesHref={anomalyDigestHref(period, ca.kpis.invoiceId)} onOpen={router.push} invoiceLine={invoiceLine(caInvoice)} headerNote={caInvoice?.datesDiffer ? printedNote(caInvoice) : undefined} />
        )}
      </div>

      <CombinedPanel combined={combined} rateField={rateField} dateNotes={dateNotes} />

      {us !== null && (
        <>
          <div className="overview-panels">
            <section className="chart-panel" aria-label="Billed price trend">
              <header className="chart-panel-head">
                <h2 className="chart-panel-title">Billed price trend</h2>
                <span className="chart-panel-sub">US · trailing periods · $/gal</span>
              </header>
              <div className="chart-panel-body">
                <BilledPriceTrend points={us.trend} />
              </div>
            </section>

            <section className="chart-panel" aria-label="Top spend by driver">
              <header className="chart-panel-head">
                <h2 className="chart-panel-title">Top spend by driver</h2>
                <span className="chart-panel-sub">US · this period</span>
              </header>
              <div className="chart-panel-body">
                <TopSpendByDriver drivers={us.topSpendByDriver} />
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

/** "Invoice 999210 · Sep 3–9" — the invoice number and the range its transactions ran. */
function invoiceLine(invoice: PeriodInvoice | null): string | null {
  if (invoice === null) return null;
  const range = actualRange(invoice);
  return `Invoice ${invoice.invoiceNumber} · ${formatCompactRange(range.start, range.end)}`;
}

/** The amber header callout when an invoice's printed range is not the one its transactions ran. */
function printedNote(invoice: PeriodInvoice): string {
  return `Printed ${formatDay(invoice.printedStart)} – ${formatDay(invoice.printedEnd)} · check period`;
}

/** The US side's KPI tiles. US fuel tax is inside the pump price, so each figure is one value. */
function UsPanel({
  us,
  converted,
  invoiceLine,
  anomaliesHref,
  onOpen,
}: {
  us: NonNullable<OverviewResult["us"]>;
  converted: OverviewConverted | null;
  invoiceLine: string | null;
  /** Transactions, scoped to this invoice's flagged stops. */
  anomaliesHref: string;
  onOpen: (href: string) => void;
}) {
  const { kpis, currency, qtyUnit } = us;
  const money = (n: number) => formatMoneyGrouped(n, currency);
  // The same figure in CAD/L, top right of its tile; "rate pending" until the CA invoice's rate is entered.
  // A product's CAD cost over its litres, stacked: "CA$64,440.62" / "33,051.74 L".
  const cadWithQty = (amount: number | null | undefined, litres: number | undefined) =>
    converted === null || litres === undefined
      ? undefined
      : `${formatMoneyGroupedOrPending(amount ?? null, "CAD")}\n${formatQtyGrouped(litres)} ${converted.qtyUnit}`;
  const cad = (n: number | null | undefined) => (converted === null ? undefined : formatMoneyGroupedOrPending(n ?? null, "CAD"));
  const receiptPct =
    kpis.receiptCompliance.total > 0 ? Math.round((kpis.receiptCompliance.confirmed / kpis.receiptCompliance.total) * 100) : null;

  return (
    <SidePanel
      badge="US"
      title="United States"
      subtitle={`${invoiceLine === null ? "" : `${invoiceLine} · `}${currency}`}
      accent="us"
      testId="us-panel"
      ariaLabel="US"
    >
      <KpiCard
        flat
        dominant
        label="Average billed price"
        value={kpis.avgBilledPerUnit === null ? "—" : formatPriceGrouped(kpis.avgBilledPerUnit, currency)}
        unit={`/ ${qtyUnit}`}
        corner={
          converted === null
            ? undefined
            : converted.avgBilledPerUnit === null
              ? RATE_PENDING
              : `${formatPriceGrouped(converted.avgBilledPerUnit, "CAD")} / ${converted.qtyUnit}`
        }
        sub={
          kpis.discount.avgPerUnit === null ? undefined : `${formatPriceGrouped(kpis.discount.avgPerUnit, currency)} / ${qtyUnit} discount`
        }
        testId="kpi-avg-billed"
      />
      <KpiCard
        flat
        dominant
        label="Total spend"
        value={money(kpis.total.amount)}
        corner={cad(converted?.total)}
        sub="Diesel + DEF + other charges"
        testId="kpi-total"
      />
      <KpiCard
        flat
        label="Diesel"
        value={money(kpis.diesel.amount)}
        corner={cadWithQty(converted?.dieselAmount, converted?.dieselQty)}
        sub={`${formatQtyGrouped(kpis.diesel.qty)} ${qtyUnit}`}
        testId="kpi-diesel"
      />
      <KpiCard
        flat
        label="DEF"
        value={money(kpis.def.amount)}
        corner={cadWithQty(converted?.defAmount, converted?.defQty)}
        sub={`${formatQtyGrouped(kpis.def.qty)} ${qtyUnit}`}
        testId="kpi-def"
      />
      <KpiCard flat label="Discount captured" value={money(kpis.discount.total)} corner={cad(converted?.discount)} testId="kpi-discount" />
      <KpiCard
        flat
        label="Other charges"
        value={money(kpis.otherCharges.total)}
        corner={cad(converted?.otherCharges)}
        sub="Scale, express and fees"
        testId="kpi-other"
      />
      <KpiCard
        flat
        label="Receipt compliance"
        value={receiptPct === null ? "—" : `${receiptPct}%`}
        tone={receiptPct === 0 ? "bad" : undefined}
        sub={`${kpis.receiptCompliance.confirmed} of ${kpis.receiptCompliance.total} confirmed`}
        testId="kpi-receipts"
      />
      <KpiCard
        flat
        label="Anomalies flagged"
        value={String(kpis.anomaliesFlagged)}
        tone={kpis.anomaliesFlagged > 0 ? "warn" : undefined}
        sub="Review in Transactions"
        href={anomaliesHref}
        onOpen={onOpen}
        testId="kpi-anomalies"
      />
    </SidePanel>
  );
}
