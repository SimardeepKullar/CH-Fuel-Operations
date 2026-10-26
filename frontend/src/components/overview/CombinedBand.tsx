"use client";

import type { CombinedView } from "../../lib/overviewView";
import Corners from "../Corners";

/** The combined band: US converted to CAD at each week's rate plus Canada, in litres. */
export default function CombinedBand({ view, onEnterRates }: { view: CombinedView; onEnterRates: () => void }) {
  return (
    <section className="ov-card ov-combined blueprint" aria-label="Combined" data-testid="combined-panel">
      <Corners />
      <header className="ov-combined-head">
        <span className="ov-combined-chip">US + CA</span>
        <div className="ov-region-titles">
          <h2 className="ov-region-name ov-on-navy">Combined</h2>
          <div className="ov-combined-sub">{view.sub}</div>
        </div>
        <div className="ov-combined-rate">
          <span className="ov-combined-rate-label">{view.rateLabel}</span>
          <span className="ov-combined-rate-box" data-testid="combined-rate">
            {view.rate}
          </span>
        </div>
      </header>
      {view.show && (
        <div className="ov-tiles-combined">
          {view.tiles.map((t) => (
            <div key={t.label} className="ov-tile ov-tile-combined" data-testid="ov-combined-tile" data-label={t.label}>
              <div className="ov-tile-label">{t.label}</div>
              <div className="ov-tile-num ov-comb">
                <span className="ov-cc">{t.cc}</span>
                <span className="ov-num">{t.value}</span>
                {t.unit !== "" && <span className="ov-unit">{t.unit}</span>}
              </div>
              <div className="ov-tile-sub">{t.sub}</div>
            </div>
          ))}
        </div>
      )}
      {view.none && (
        <div className="ov-combined-none" data-testid="combined-none">
          <span className="ov-combined-none-title">Combined figures need an exchange rate</span>
          <span className="ov-absent-text">US and Canada are shown in their own currencies above until a rate is entered.</span>
          <a
            className="ov-link ov-push"
            href="#rates"
            onClick={(e) => {
              e.preventDefault();
              onEnterRates();
            }}
          >
            Enter exchange rates →
          </a>
        </div>
      )}
    </section>
  );
}
