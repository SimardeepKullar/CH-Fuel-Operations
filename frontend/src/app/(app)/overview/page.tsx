"use client";

import { useCallback, useMemo, useState } from "react";
import { useOverviewScope } from "../../../hooks/useOverviewScope";
import { useOverviewWeeks } from "../../../hooks/useOverviewWeeks";
import { useWeek } from "../../../hooks/useWeek";
import { buildDriverView, buildTrends } from "../../../lib/overviewCharts";
import { buildOverviewView, rangeLabel, type Side } from "../../../lib/overviewView";
import { anomaliesLink } from "../../../lib/transactionsLink";
import CombinedBand from "../../../components/overview/CombinedBand";
import DriverSpend from "../../../components/overview/DriverSpend";
import EmptyState from "../../../components/EmptyState";
import FxNotice from "../../../components/overview/FxNotice";
import InvoicesStrip from "../../../components/overview/InvoicesStrip";
import PageBanner from "../../../components/PageBanner";
import RatesPanel from "../../../components/overview/RatesPanel";
import RegionCard from "../../../components/overview/RegionCard";
import ScopeControl from "../../../components/ScopeControl";
import TrendCard from "../../../components/overview/TrendCard";

/**
 * The landing screen (T-71): US and Canada side by side, the two added together in
 * CAD/L, the billed-price trend per side and the top drivers, over the time scope in
 * the URL — all time by default. One call (`GET /overview/weeks`) brings every week's
 * figures; the scope picks the weeks and `lib/overviewAggregate` sums them, so a week,
 * a range and all time can never disagree.
 */
export default function OverviewPage() {
  const { weeks, loading, error, reload } = useOverviewWeeks();
  const { weeks: periods, reloadPeriods } = useWeek();
  const weekEnds = useMemo(() => weeks.map((w) => w.weekEnd), [weeks]);
  const { scope, setScope } = useOverviewScope(weekEnds);
  const [ratesOpen, setRatesOpen] = useState(false);

  const view = useMemo(
    () => buildOverviewView(weeks, scope, (side: Side) => anomaliesLink(scope, side === "us" ? "USD" : "CAD")),
    [weeks, scope],
  );
  const trends = useMemo(() => buildTrends(weeks, scope, view.span), [weeks, scope, view.span]);
  const splitPossible = useMemo(() => buildDriverView(weeks, scope, "us").split, [weeks, scope]);
  const buildDrivers = useCallback((v: "us" | "ca") => buildDriverView(weeks, scope, v), [weeks, scope]);
  const scopeWeeks = useMemo(() => weeks.map((w) => ({ weekEnd: w.weekEnd, label: rangeLabel(w.start, w.end) })), [weeks]);

  const rateSaved = useCallback(async () => {
    await Promise.all([reloadPeriods(), reload()]);
  }, [reloadPeriods, reload]);

  if (loading) {
    return (
      <div className="ov-page">
        <PageBanner title="Overview" />
        <EmptyState title="Loading overview…" />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="ov-page">
        <PageBanner title="Overview" />
        <EmptyState title="Couldn't load the overview" detail={error.message} />
      </div>
    );
  }

  if (weeks.length === 0) {
    return (
      <div className="ov-page">
        <PageBanner title="Overview" />
        <EmptyState
          title="No invoice imported yet"
          detail="Import a BVD invoice to see spend, the billed-price trend and any anomalies for a period."
        />
      </div>
    );
  }

  return (
    <div className="ov-page">
      <PageBanner
        title="Overview"
        controls={<ScopeControl scope={scope} weeks={scopeWeeks} onChange={setScope} />}
        readout={view.readout}
        meta={
          <>
            <span data-testid="rate-meta">{view.rateMeta}</span>
            <a
              href="#rates"
              onClick={(e) => {
                e.preventDefault();
                setRatesOpen((o) => !o);
              }}
            >
              Edit rates
            </a>
          </>
        }
      />
      <div className="ov">
        <InvoicesStrip view={view.invoices} />
        {view.fxNotice !== null && <FxNotice notice={view.fxNotice} onEnter={() => setRatesOpen(true)} />}
        {ratesOpen && <RatesPanel weeks={view.weeks} periods={periods} onSaved={rateSaved} onClose={() => setRatesOpen(false)} />}
        <div className="ov-regions">
          <RegionCard region={view.us} />
          <RegionCard region={view.ca} />
        </div>
        <CombinedBand view={view.combined} onEnterRates={() => setRatesOpen(true)} />
        <div className="ov-trends">
          <TrendCard trend={trends[0]} />
          <TrendCard trend={trends[1]} />
        </div>
        <DriverSpend build={buildDrivers} splitPossible={splitPossible} />
      </div>
    </div>
  );
}
