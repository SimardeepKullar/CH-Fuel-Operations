"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";
import { getHealth, listPeriods } from "../lib/api";

/** The URL key holding the selected billing week's end (D26). */
export const WEEK_PARAM = "week";

export interface WeekContextValue {
  /** Every billing week with an imported invoice on either side, newest first. */
  weeks: PeriodWeek[];
  loading: boolean;
  /** The selected week's end, `YYYY-MM-DD`. `null` only while loading or when nothing is imported. */
  week: string | null;
  setWeek: (weekEnd: string) => void;
  /** The `weeks` entry for `week` — `null` while loading or for a week no invoice belongs to. */
  weekEntry: PeriodWeek | null;
  /** The selected week's imported invoices, USD first. */
  invoices: PeriodInvoice[];
  /** The ids of the invoices the mounted screen's figures come from — what the "Invoices in view"
   * strip highlights. `null` when the screen reads no invoice figures (a stub, a Plan screen), so
   * nothing is dimmed. */
  inViewIds: readonly string[] | null;
  setInViewIds: (ids: readonly string[] | null) => void;
  /** Re-reads `GET /periods` — after an override moved an invoice. Navigation never calls this. */
  reloadPeriods: () => Promise<void>;
}

const WeekContext = createContext<WeekContextValue | null>(null);

/**
 * The shell's billing-week state (T-39 step 39.2, A7; over weeks since T-63/T-64).
 * Mounted once in the `(app)` layout, which persists across navigation, so
 * `GET /health` and `GET /periods` are read once per session — not once per
 * screen (T-39's rule). Screens and the top bar read it through `useWeek()`.
 *
 * Defaults to the newest week (`GET /health`'s `latestInvoicePeriod`, immune to
 * backfill import order, A16) and keeps the choice in the URL's `week` param,
 * so a filtered view is linkable and survives a reload.
 */
export function WeekProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [latestWeek, setLatestWeek] = useState<string | null>(null);
  const [weeks, setWeeks] = useState<PeriodWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [inViewIds, setInViewIds] = useState<readonly string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getHealth(), listPeriods()])
      .then(([health, result]) => {
        if (cancelled) return;
        setLatestWeek(health.latestInvoicePeriod);
        setWeeks(result.weeks);
      })
      .catch(() => {
        if (cancelled) return;
        setLatestWeek(null);
        setWeeks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadPeriods = useCallback(async () => {
    const result = await listPeriods();
    setWeeks(result.weeks);
  }, []);

  const defaultWeek = weeks.some((w) => w.weekEnd === latestWeek) ? latestWeek : (weeks[0]?.weekEnd ?? null);
  const week = searchParams.get(WEEK_PARAM) ?? defaultWeek;

  const setWeek = useCallback(
    (weekEnd: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set(WEEK_PARAM, weekEnd);
      router.replace(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const weekEntry = useMemo(() => weeks.find((w) => w.weekEnd === week) ?? null, [weeks, week]);

  const value = useMemo<WeekContextValue>(
    () => ({
      weeks,
      loading,
      week,
      setWeek,
      weekEntry,
      invoices: weekEntry?.invoices ?? [],
      inViewIds,
      setInViewIds,
      reloadPeriods,
    }),
    [weeks, loading, week, setWeek, weekEntry, inViewIds, reloadPeriods],
  );

  return <WeekContext.Provider value={value}>{children}</WeekContext.Provider>;
}

export function useWeek(): WeekContextValue {
  const value = useContext(WeekContext);
  if (value === null) throw new Error("useWeek must be used inside <WeekProvider> (the (app) shell layout mounts it)");
  return value;
}

/**
 * Tells the strip which invoices a screen's figures come from. Transactions
 * publishes through `useInvoiceInView()`; the Overview publishes its US invoice
 * until T-65 serves both. Cleared on unmount, so a screen that publishes nothing
 * dims nothing. Keyed on the ids' contents, so a fresh array each render is fine.
 */
export function usePublishInView(ids: readonly string[] | null): void {
  const { setInViewIds } = useWeek();
  const key = ids === null ? null : ids.join(",");
  useEffect(() => {
    setInViewIds(key === null ? null : key === "" ? [] : key.split(","));
    return () => setInViewIds(null);
  }, [key, setInViewIds]);
}
