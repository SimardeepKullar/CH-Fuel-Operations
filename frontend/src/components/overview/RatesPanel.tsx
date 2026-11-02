"use client";

import { useEffect } from "react";
import type { PeriodWeek } from "@ch/core/api/routes/periods";
import type { WeekFigures } from "../../lib/overviewAggregate";
import { rangeLabel } from "../../lib/overviewView";
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="ov-modal-backdrop"
      data-testid="rates-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="ov-modal ov-rates" role="dialog" aria-modal="true" aria-label="Exchange rates" id="rates" data-testid="rates-panel">
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
      </section>
    </div>
  );
}
