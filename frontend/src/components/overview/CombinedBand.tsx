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
  const { total, shares, price, disc, attention } = view;
  return (
    <section className="ov-card ov-combined blueprint" aria-label="Combined" data-testid="combined-panel">
      <Corners />
      <div className="ov-cb-grid">
        <div className="ov-cb-main">
          {view.show && total !== null ? (
            <>
              <div className="ov-cb-head" data-testid="ov-combined-tile" data-label="Total fuel spend, combined">
                <span className="ov-combined-chip">US + CA</span>
                <span className="ov-cb-label">{total.label}</span>
              </div>
              <Figure tile={total} size="xl" />
              <div className="ov-cb-sub">
                {total.sub} · <span data-testid="combined-rate">{view.rate}</span> {view.rateLabel.toLowerCase()}
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
        <div className="ov-cb-col">
          {price !== null && disc !== null && (
            <>
              <div className="ov-cb-block" data-testid="ov-combined-tile" data-label={price.label}>
                <div className="ov-cb-label">{price.label}</div>
                <Figure tile={price} size="md" />
                <div className="ov-cb-note">{price.sub}</div>
              </div>
              <div className="ov-cb-block" data-testid="ov-combined-tile" data-label={disc.label}>
                <div className="ov-cb-label">{disc.label}</div>
                <Figure tile={disc} size="md" />
              </div>
            </>
          )}
        </div>
        <div className="ov-cb-col ov-cb-attn" data-testid="combined-attention">
          <div className="ov-cb-label">Needs attention</div>
          <div className="ov-cb-block">
            <div className="ov-cb-count ov-cb-amber">{attention.anomalies.count}</div>
            <div className="ov-cb-note">Anomalies flagged</div>
            <Link className="ov-link" href={attention.anomalies.link.href} data-testid="anomalies-link">
              {attention.anomalies.link.text}
            </Link>
          </div>
          {attention.receipts !== null && (
            <div className="ov-cb-block">
              <div className="ov-cb-count ov-cb-amber">{attention.receipts.missing}</div>
              <div className="ov-cb-note">{attention.receipts.sub}</div>
              <Link className="ov-link" href={attention.receipts.link.href}>
                {attention.receipts.link.text}
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
