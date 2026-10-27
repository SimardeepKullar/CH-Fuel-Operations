"use client";

import Link from "next/link";
import type { CombinedTile, CombinedView } from "../../lib/overviewView";
import Corners from "../Corners";

function Figure({ tile, size }: { tile: CombinedTile; size: "xl" | "md" }) {
  return (
    <div className={`ov-tile-num ov-cb-fig ov-cb-${size}`}>
      <span className="ov-cc">{tile.cc}</span>
      <span className="ov-num">{tile.value}</span>
      {tile.unit !== "" && <span className="ov-unit">{tile.unit}</span>}
    </div>
  );
}

/**
 * The combined band, first on the Overview: total spend with the US/Canada split on the
 * left, price and discount in the middle, what needs attention on the right. US is
 * converted to CAD at each week's rate; counts need no rate.
 */
export default function CombinedBand({ view, onEnterRates }: { view: CombinedView; onEnterRates: () => void }) {
  const { total, shares, kpis, attention } = view;
  return (
    <section className="ov-card ov-combined blueprint" aria-label="Combined" data-testid="combined-panel">
      <Corners />
      <div className="ov-cb-grid">
        <div className="ov-cb-main">
          {view.show && total !== null ? (
            <>
              <div className="ov-cb-head" data-testid="ov-combined-tile" data-label={total.label}>
                <span className="ov-combined-chip">US + CA</span>
                <span className="ov-cb-label">{total.label}</span>
              </div>
              <Figure tile={total} size="xl" />
              <div className="ov-cb-sub">{total.sub}</div>
              <div className="ov-cb-sub">
                {view.sub} · <span data-testid="combined-rate">{view.rate}</span> {view.rateLabel.toLowerCase()}
              </div>
              {shares !== null && (
                <>
                  <div className="ov-cb-bar" role="img" aria-label={shares.map((s) => `${s.label} ${s.pct}%`).join(", ")}>
                    {shares.map((s) => (
                      <i key={s.label} style={{ width: `${s.pct}%`, background: s.color }} />
                    ))}
                  </div>
                  <div className="ov-cb-legend">
                    {shares.map((s) => (
                      <span key={s.label} className="ov-cb-share">
                        <i style={{ background: s.color }} />
                        {s.label}
                        <b>{s.value}</b> · {s.pct}%
                      </span>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="ov-combined-none" data-testid="combined-none">
              <span className="ov-combined-none-title">Combined figures need an exchange rate</span>
              <span className="ov-absent-text">US and Canada are shown in their own currencies below until a rate is entered.</span>
              <a
                className="ov-link"
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
        </div>
        <div className="ov-cb-col ov-cb-kpis">
          {kpis.map((k) => (
            <div key={k.label} className="ov-cb-block" data-testid="ov-combined-tile" data-label={k.label}>
              <div className="ov-cb-label">{k.label}</div>
              <Figure tile={k} size="md" />
              {k.sub !== "" && <div className="ov-cb-note">{k.sub}</div>}
            </div>
          ))}
        </div>
        <div className="ov-cb-col ov-cb-attn" data-testid="combined-attention">
          <div className="ov-cb-block ov-linked">
            <div className="ov-cb-label">Anomalies flagged</div>
            <div className="ov-cb-count ov-cb-amber">{attention.anomalies.count}</div>
            <div className="ov-cb-row">
              <span className="ov-cb-note">Review in Transactions</span>
              <span className="ov-view">{attention.anomalies.link.text}</span>
            </div>
            <Link className="ov-tile-cover" href={attention.anomalies.link.href} aria-label="Anomalies flagged: review in Transactions" data-testid="anomalies-link" />
          </div>
          {attention.receipts !== null && (
            <div className="ov-cb-block ov-linked">
              <div className="ov-cb-label">Receipt compliance</div>
              <div className="ov-cb-count" style={{ color: attention.receipts.color }}>
                {attention.receipts.value}
              </div>
              <div className="ov-cb-row">
                <span className="ov-cb-note">{attention.receipts.sub}</span>
                <span className="ov-view">{attention.receipts.link.text}</span>
              </div>
              <Link className="ov-tile-cover" href={attention.receipts.link.href} aria-label="Receipt compliance: view the receipt queue" data-testid="receipts-link" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
