import { useCallback, useMemo } from "react";
import { listDrivers, listTransactions, listTrucks } from "../lib/api";
import { useApiResource } from "./useApiResource";

export interface FilterOption {
  value: string;
  label: string;
}

export interface TransactionFilterOptions {
  drivers: FilterOption[];
  trucks: FilterOption[];
  cards: FilterOption[];
  states: FilterOption[];
  loading: boolean;
}

/**
 * Option lists for the driver/truck/card/state filter dropdowns (A8.3, T-40).
 *
 * Drivers and trucks reuse existing roster endpoints — `GET /drivers?week=&currency=`
 * returns every driver on the roster (zero-row entries included, per its own
 * doc comment), and `GET /trucks` (no `week`, D23) is the plain fleet
 * roster. Neither `GET /cards` nor any state-list endpoint exists anywhere in
 * the API, so cards and states are derived from one unfiltered fetch of the
 * week's own transactions on the side in view (`pageSize: 200` — the same "get everything, this
 * week is small" convention the shell's week context already uses) — the same
 * approach the design file's own mock takes, deriving filter options from
 * already-loaded rows, rather than adding two endpoints for two small lists.
 * This is a separate, unfiltered fetch from the table's own (filtered)
 * fetch, so choosing one filter never shrinks another filter's own options.
 */
/** `currency` is the side on screen, or `null` for both (All invoices). */
export function useTransactionFilterOptions(period: string | null, currency: "USD" | "CAD" | null): TransactionFilterOptions {
  const driversFetcher = useCallback(
    // The driver list is the whole roster whichever side is asked (zero-row
    // entries included), so both sides at once reads it from the US side.
    () => (period === null ? Promise.resolve(null) : listDrivers(period, currency ?? "USD")),
    [period, currency],
  );
  const { data: driversResult, loading: driversLoading } = useApiResource(driversFetcher);

  const trucksFetcher = useCallback(() => listTrucks(), []);
  const { data: trucksResult, loading: trucksLoading } = useApiResource(trucksFetcher);

  const seedFetcher = useCallback(
    () => (period === null ? Promise.resolve(null) : listTransactions({ week: period, currency: currency ?? undefined, pageSize: 200 })),
    [period, currency],
  );
  const { data: seedResult, loading: seedLoading } = useApiResource(seedFetcher);

  const drivers = useMemo<FilterOption[]>(
    () =>
      (driversResult?.rows ?? [])
        .map((r) => ({ value: r.driver.id, label: r.driver.displayName }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [driversResult],
  );

  const trucks = useMemo<FilterOption[]>(
    () =>
      (trucksResult?.rows ?? [])
        .map((t) => ({ value: t.id, label: t.unitNumber }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [trucksResult],
  );

  const cards = useMemo<FilterOption[]>(() => {
    const seen = new Map<string, string>();
    for (const row of seedResult?.rows ?? []) {
      seen.set(row.card.id, row.card.number);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [seedResult]);

  const states = useMemo<FilterOption[]>(() => {
    const seen = new Set<string>();
    for (const row of seedResult?.rows ?? []) {
      if (row.station?.state) seen.add(row.station.state);
    }
    return [...seen].sort().map((s) => ({ value: s, label: s }));
  }, [seedResult]);

  return { drivers, trucks, cards, states, loading: driversLoading || trucksLoading || seedLoading };
}
