"use client";

import Link from "next/link";
import type { ReviewRows as ReviewRowsModel } from "../../lib/overviewView";

/**
 * Anomalies and receipt compliance as two linked rows: the Needs review tile in the combined
 * band and, `compact`, in a region card's narrower grid (T-131), where the words shorten and
 * the link is an arrow.
 */
export default function ReviewRows({ review, compact = false }: { review: ReviewRowsModel; compact?: boolean }) {
  const { anomalies, receipts } = review;
  return (
    <>
      <div className="ov-cb-review-row ov-linked">
        <span className="ov-cb-count" style={{ color: "#A15C07" }}>
          {anomalies.count}
        </span>
        <span className="ov-cb-review-text">{compact ? "flagged" : "anomalies flagged"}</span>
        <span className="ov-view">{compact ? "→" : anomalies.link.text}</span>
        <Link className="ov-tile-cover" href={anomalies.link.href} aria-label="Anomalies flagged: review in Transactions" data-testid="anomalies-link" />
      </div>
      {receipts !== null && (
        <div className="ov-cb-review-row ov-linked">
          <span className="ov-cb-count" style={{ color: receipts.color }}>
            {receipts.value}
          </span>
          <span className="ov-cb-review-text">{compact ? `${receipts.sub.replace(/ confirmed$/, "")} receipts` : `receipts · ${receipts.sub}`}</span>
          <span className="ov-view">{compact ? "→" : receipts.link.text}</span>
          <Link className="ov-tile-cover" href={receipts.link.href} aria-label="Receipt compliance: view the receipt queue" data-testid="receipts-link" />
        </div>
      )}
    </>
  );
}
