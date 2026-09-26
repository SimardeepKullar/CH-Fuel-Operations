import { useCallback, useEffect, useState } from "react";
import type { StationLocationSummary } from "@ch/core/domain/planResponse";
import { listStations } from "../lib/api";

export interface UseSheetStationsResult {
  stations: StationLocationSummary[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

const PAGE_SIZE = 500;

/**
 * Continental US (CLAUDE.md: this app is US only) — wide enough to catch
 * every resolved station regardless of which plan is open. Not a per-plan
 * scope: an earlier version padded the open plan's own route bbox by a
 * fixed distance, which was still a guess about how far off-route a real
 * station could sit (T-23 follow-up). The map's own viewport still clips
 * what's drawn; this only controls what's fetched.
 */
const US_BBOX = { west: -125, south: 24, east: -66, north: 50 };

/**
 * Every resolved station, paged through `GET /stations`
 * (UI-DATA-CONTRACT §3.8's "all sheet stations" layer, T-23 step 23.2).
 * Fetched once, on mount — not tied to the open plan. `GET /stations` has
 * no sheet-scoping parameter (only bbox), so "every priced station on the
 * selected sheet" is still approximated as "every resolved station",
 * unfiltered by price.
 */
export function useSheetStations(): UseSheetStationsResult {
  const [stations, setStations] = useState<StationLocationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const all: StationLocationSummary[] = [];
      let page = 1;
      for (;;) {
        const result = await listStations({ ...US_BBOX, page, pageSize: PAGE_SIZE });
        all.push(...result.stations);
        if (result.stations.length === 0 || page * PAGE_SIZE >= result.total) break;
        page += 1;
      }
      if (!cancelled) setStations(all);
    })()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const refetch = useCallback(() => setAttempt((n) => n + 1), []);

  return { stations, loading, error, refetch };
}
