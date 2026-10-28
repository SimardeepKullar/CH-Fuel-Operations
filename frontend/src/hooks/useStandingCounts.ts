import { useCallback, useEffect, useState } from "react";
import { getHealth, getReceiptQueue } from "../lib/api";

export interface StandingCounts {
  /** Receipt Queue's `progress` — global, not scoped to the selected period (A7). */
  receipts: { done: number; total: number } | null;
  /** `health.openAnomalyCount` — undismissed anomalies system-wide (A7's "Flags"). */
  flags: number | null;
  loading: boolean;
  /** Re-reads both counts — the Receipt Queue calls it after a decision so the badge follows (T-43). */
  refresh: () => void;
}

/**
 * Fetched once at the `(app)` shell level (T-39) and passed down to
 * `Sidebar` (the Receipt Queue badge) and `TopBar` (the standing
 * Receipts/Flags chips) as props, rather than each component fetching its
 * own copy — the layout mounts once per session, not per route change, so
 * this is one pair of requests, not one per navigation.
 */
export function useStandingCounts(): StandingCounts {
  const [receipts, setReceipts] = useState<{ done: number; total: number } | null>(null);
  const [flags, setFlags] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getReceiptQueue(), getHealth()])
      .then(([queue, health]) => {
        if (cancelled) return;
        setReceipts(queue.progress);
        setFlags(health.openAnomalyCount);
      })
      .catch(() => {
        // Standing counts degrade to "unknown" (null) rather than blocking
        // the shell — a dispatcher can still plan and navigate.
        if (!cancelled) {
          setReceipts(null);
          setFlags(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  return { receipts, flags, loading, refresh };
}
