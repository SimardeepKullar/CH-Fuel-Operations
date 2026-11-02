"use client";

import type { PeriodWeek } from "@ch/core/api/routes/periods";
import type { WeekFigures } from "../../lib/overviewAggregate";
import { rangeLabel } from "../../lib/overviewView";
import Dialog from "../Dialog";
import ExchangeRateField from "../ExchangeRateField";

interface RatesPanelProps {
  /** The weeks in scope. */
  weeks: readonly WeekFigures[];
  /** The shell's periods, which carry each invoice and its rate. */
  periods: readonly PeriodWeek[];
  onSaved: () => Promise<void> | void;
  onClose: () => void;
}

/**
 * Where the exchange rates are entered, as a pop-up (T-68, D31): one field per week in
 * scope, on the week's US invoice — the US side is the one converted. A week with no US
 * invoice needs no rate and says so. Escape, the backdrop and Close dismiss it.
 */
export default function RatesPanel({ weeks, periods, onSaved, onClose }: RatesPanelProps) {
  return (
    <Dialog label="Exchange rates" className="ov-rates" id="rates" testId="rates-panel" backdropTestId="rates-backdrop" onClose={onClose}>
      <header className="ov-rates-head">
        <h2 className="ov-section-title">Exchange rates</h2>
        <button type="button" className="ss-ghost" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="ov-rates-body">
        {weeks.map((w) => {
          const us = periods.find((p) => p.weekEnd === w.weekEnd)?.invoices.find((i) => i.currency === "USD") ?? null;
          return (
            <div key={w.weekEnd} className="ov-rates-row">
              <span className="ov-rates-week">Week of {rangeLabel(w.start, w.end)}</span>
              {us === null ? (
                <span className="ov-rates-none">No US invoice, so no rate is needed this week.</span>
              ) : (
                <ExchangeRateField key={us.id} invoice={us} onSaved={onSaved} />
              )}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
