"use client";

import Link from "next/link";
import type { CombinedTile, CombinedView } from "../../lib/overviewView";

/** The currency code sits small beside the figure; the `$` stays with the number, in its size and colour. */
function Figure({ tile, size }: { tile: CombinedTile; size: "xl" | "md" }) {
  return (
    <div className={`ov-cb-fig ov-cb-${size}`}>
      <span className="ov-cb-cc">{tile.cc}</span>
      <span className="ov-cb-num">{tile.value}</span>
      {tile.unit !== "" && <span className="ov-cb-unit">{tile.unit}</span>}
    </div>
  );
}

/**
 * The combined band, first on the Overview: a navy hero with total spend and the US/Canada
 * split beneath it, then a hairline grid of price and discount tiles ending in one
 * "needs review" tile. US is converted to CAD at each week's rate; counts need no rate.
 */
export default function CombinedBand({ view, onEnterRates }: { view: CombinedView; onEnterRates: () => void }) {
  const { total, shares, kpis, attention } = view;
  return (
    <section className="ov-cb" aria-label="Combined" data-testid="combined-panel">
      <div className="ov-cb-hero">
        {view.show && total !== null ? (
          <>
            <div className="ov-cb-hero-top" data-testid="ov-combined-tile" data-label={total.label}>
              <div className="ov-cb-head">
                <span className="ov-cb-chip">US + CA</span>
                <span className="ov-cb-hero-label">{total.label}</span>
              </div>
              <Figure tile={total} size="xl" />
              <div className="ov-cb-hero-sub ov-cb-hero-sub-main">{total.sub}</div>
              <div className="ov-cb-hero-sub">
                {view.sub} · <span data-testid="combined-rate">{view.rate}</span> {view.rateLabel}
              </div>
            </div>
            {shares !== null && (
              <div className="ov-cb-hero-bottom">
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
                      <b>{s.value}</b>
                      <span className="ov-cb-pct">{s.pct}%</span>
                    </span>
                  ))}
                </div>
              </div>
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

      <div className="ov-cb-tiles">
        {kpis.map((k) => (
          <div key={k.label} className="ov-cb-tile" data-testid="ov-combined-tile" data-label={k.label}>
            <div className="ov-cb-label">{k.label}</div>
            <Figure tile={k} size="md" />
            {k.sub !== "" && <div className="ov-cb-note">{k.sub}</div>}
          </div>
        ))}
        <div className="ov-cb-tile ov-cb-review" data-testid="combined-attention">
          <div className="ov-cb-label">Needs review</div>
          <div className="ov-cb-review-row ov-linked">
            <span className="ov-cb-count" style={{ color: "#A15C07" }}>
              {attention.anomalies.count}
            </span>
            <span className="ov-cb-review-text">anomalies flagged</span>
            <span className="ov-view">{attention.anomalies.link.text}</span>
            <Link className="ov-tile-cover" href={attention.anomalies.link.href} aria-label="Anomalies flagged: review in Transactions" data-testid="anomalies-link" />
          </div>
          {attention.receipts !== null && (
            <div className="ov-cb-review-row ov-linked">
              <span className="ov-cb-count" style={{ color: attention.receipts.color }}>
                {attention.receipts.value}
              </span>
              <span className="ov-cb-review-text">receipts · {attention.receipts.sub}</span>
              <span className="ov-view">{attention.receipts.link.text}</span>
              <Link className="ov-tile-cover" href={attention.receipts.link.href} aria-label="Receipt compliance: view the receipt queue" data-testid="receipts-link" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
