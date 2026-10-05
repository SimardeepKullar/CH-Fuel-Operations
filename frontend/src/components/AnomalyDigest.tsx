"use client";

import type { MouseEvent } from "react";
import { useRouter } from "next/navigation";
import type { OverviewAnomalyDigestItem } from "@ch/core/actuals/overview";
import AnomalyFlag from "./AnomalyFlag";
import EmptyState from "./EmptyState";

interface AnomalyDigestProps {
  items: OverviewAnomalyDigestItem[];
  /** The Overview screen's own selected billing week — carried onto the deep link
   * so Transactions opens already scoped to the same week, not whatever
   * it last remembered. */
  week: string | null;
}

/** A8.1's deep link into Transactions, `anomalyOnly` pre-applied — the exact
 * query param `useTransactionFilters` reads (T-41 DoD). */
export function anomalyDigestHref(week: string | null): string {
  const params = new URLSearchParams({ anomalyOnly: "true" });
  if (week !== null) params.set("week", week);
  return `/transactions?${params.toString()}`;
}

function formatDetectedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
}

/** A8.1's compact anomalies list (T-41) — every row and the header link
 * share one destination: Transactions, pre-filtered to flagged stops only. */
export default function AnomalyDigest({ items, week }: AnomalyDigestProps) {
  const router = useRouter();
  const href = anomalyDigestHref(week);

  const navigate = (e: MouseEvent) => {
    e.preventDefault();
    router.push(href);
  };

  return (
    <div className="anomaly-digest">
      <div className="anomaly-digest-header">
        <span className="panel-card-title">Anomalies</span>
        <a className="anomaly-digest-viewall" href={href} onClick={navigate}>
          View flagged in Transactions →
        </a>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No anomalies flagged" detail="Nothing worth a look on this invoice." />
      ) : (
        <ul className="anomaly-digest-list">
          {items.map((item) => (
            <li key={item.id}>
              <a className="anomaly-digest-item" href={href} onClick={navigate}>
                <AnomalyFlag flag={{ rule: item.rule, severity: item.severity }} />
                <span className="anomaly-digest-detected">{formatDetectedAt(item.detectedAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
