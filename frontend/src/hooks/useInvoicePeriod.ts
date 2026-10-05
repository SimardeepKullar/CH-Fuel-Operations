import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getHealth, listPeriods } from "../lib/api";
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";

export interface InvoicePeriodOption {
  /** A billing week's end, `YYYY-MM-DD` (D26) — the value stored in the URL
   * and the key every period-scoped route takes as `?week=` (A13). */
  value: string;
  label: string;
  invoiceNumber: string;
}

export interface UseInvoicePeriodResult {
  /** `null` only while still loading or when no invoice has ever imported. */
  period: string | null;
  setPeriod: (value: string) => void;
  periods: InvoicePeriodOption[];
  loading: boolean;
  /** `periods` entry matching `period`'s own `invoiceNumber` — `null` while
   * loading or if `period` names no imported invoice (a quarantined one, or
   * an unknown `?period=`). A stop's own `invoiceId` isn't returned by `GET
   * /transactions` (T-40, A7): the whole page is already scoped to one
   * invoice via `period`, so this is that same invoice's human number. */
  invoiceNumber: string | null;
}

function formatRange(periodStart: string, periodEnd: string): string {
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T00:00:00Z`);
  const month = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(d);
  const day = (d: Date) => d.getUTCDate();
  const year = end.getUTCFullYear();
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  return sameMonth
    ? `${month(start)} ${day(start)} – ${day(end)}, ${year}`
    : `${month(start)} ${day(start)} – ${month(end)} ${day(end)}, ${year}`;
}

function toOption(week: PeriodWeek, us: PeriodInvoice): InvoicePeriodOption {
  return {
    value: week.weekEnd,
    label: `${us.invoiceNumber} · ${formatRange(us.printedStart, us.printedEnd)}`,
    invoiceNumber: us.invoiceNumber,
  };
}

/**
 * The shell's invoice-period selector (T-39 step 39.2, A7), now over billing
 * weeks (T-63, D26). The screens it governs still read the US side, so the
 * list is the weeks that have a USD invoice — one option each, labelled with
 * that invoice — until T-64 replaces this with a week selector and a US | CA
 * switch. Defaults to the newest week (`GET /health`'s `latestInvoicePeriod`,
 * immune to backfill import order, A16) when it has a US invoice, else the
 * newest week that does, and persists the choice in the URL's `period` query
 * param so a filtered Actuals/Analysis view is linkable and survives a reload.
 * The value is a week end, whatever the param is still called.
 */
export function useInvoicePeriod(): UseInvoicePeriodResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [defaultPeriod, setDefaultPeriod] = useState<string | null>(null);
  const [options, setOptions] = useState<InvoicePeriodOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getHealth(), listPeriods()])
      .then(([health, { weeks }]) => {
        if (cancelled) return;
        const usWeeks = weeks.flatMap((week) => {
          const us = week.invoices.find((invoice) => invoice.currency === "USD");
          return us ? [toOption(week, us)] : [];
        });
        setOptions(usWeeks);
        setDefaultPeriod(
          usWeeks.some((option) => option.value === health.latestInvoicePeriod)
            ? health.latestInvoicePeriod
            : (usWeeks[0]?.value ?? null),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setDefaultPeriod(null);
          setOptions([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const period = searchParams.get("period") ?? defaultPeriod;

  const setPeriod = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("period", value);
      router.replace(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const invoiceNumber = options.find((o) => o.value === period)?.invoiceNumber ?? null;

  return useMemo(
    () => ({ period, setPeriod, periods: options, loading, invoiceNumber }),
    [period, setPeriod, options, loading, invoiceNumber],
  );
}
