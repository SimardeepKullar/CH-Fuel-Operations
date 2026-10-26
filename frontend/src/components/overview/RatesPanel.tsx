"use client";

import type { PeriodWeek } from "@ch/core/api/routes/periods";
import type { WeekFigures } from "../../lib/overviewAggregate";
import { rangeLabel } from "../../lib/overviewView";
import Corners from "../Corners";
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
 * Where the exchange rates are entered (T-66, until T-68 moves the rate onto the US
 * invoice): one field per week in scope, on the week's CA invoice. A week with no CA
 * invoice has nowhere to hold a rate yet and says so.
 */
export default function RatesPanel({ weeks, periods, onSaved, onClose }: RatesPanelProps) {
  return (
    <section className="ov-card ov-rates blueprint" id="rates" aria-label="Exchange rates" data-testid="rates-panel">
      <Corners />
      <header className="ov-rates-head">
        <h2 className="ov-section-title">Exchange rates</h2>
        <button type="button" className="ss-ghost" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="ov-rates-body">
        {weeks.map((w) => {
          const ca = periods.find((p) => p.weekEnd === w.weekEnd)?.invoices.find((i) => i.currency === "CAD") ?? null;
          return (
            <div key={w.weekEnd} className="ov-rates-row">
              <span className="ov-rates-week">Week of {rangeLabel(w.start, w.end)}</span>
              {ca === null ? (
                <span className="ov-rates-none">No Canadian invoice, so there is no invoice to hold a rate for this week.</span>
              ) : (
                <ExchangeRateField key={ca.id} invoice={ca} onSaved={onSaved} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
