"use client";

import { useCallback, useEffect, useState } from "react";
import type { WeekFigures } from "../lib/overviewAggregate";
import { getOverviewWeeks } from "../lib/api";

export interface OverviewWeeksState {
  /** Every imported billing week, ascending. */
  weeks: WeekFigures[];
  loading: boolean;
  error: Error | null;
  /** Re-reads without blanking the screen — after a saved exchange rate. */
  reload: () => Promise<void>;
}

/** The Overview's one data call (T-70): every week's figures, read once and aggregated in the client per scope. */
export function useOverviewWeeks(): OverviewWeeksState {
  const [weeks, setWeeks] = useState<WeekFigures[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getOverviewWeeks();
      setWeeks(result.weeks);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return { weeks, loading, error, reload: load };
}
