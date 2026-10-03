import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getHealth, listInvoices } from "../lib/api";
import type { InvoiceListItem } from "@ch/core/api/routes/invoices";

export interface InvoicePeriodOption {
  /** `invoices.period_start`, `YYYY-MM-DD` — the value stored in the URL and
   * the natural key `GET /overview?period=` etc. take (A13). */
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

function toOption(row: InvoiceListItem): InvoicePeriodOption {
  return {
    value: row.periodStart,
    label: `${row.invoiceNumber} · ${formatRange(row.periodStart, row.periodEnd)}`,
    invoiceNumber: row.invoiceNumber,
  };
}

/**
 * The shell's invoice-period selector (T-39 step 39.2, A7). Defaults to the
 * newest invoice (`GET /health`'s `latestInvoicePeriod` — `period_start`
 * order, immune to backfill import order, A16) and persists the choice in
 * the URL's `period` query param so a filtered Actuals/Analysis view is
 * linkable and survives a reload.
 *
 * `GET /invoices` has no `status`/`sort` query params yet (T-34 built only
 * `page`/`pageSize`), so the picker's list — `status: "imported"` only,
 * sorted by `periodStart` — is filtered and re-sorted here rather than in
 * SQL. A dedicated query param would be the better long-term shape once a
 * screen needs more than ~200 periods; noted rather than built now, per the
 * open question this ticket's kickoff prompt raised.
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
    Promise.all([getHealth(), listInvoices({ pageSize: 200 })])
      .then(([health, invoices]) => {
        if (cancelled) return;
        setDefaultPeriod(health.latestInvoicePeriod);
        // US invoices only until T-63 pairs US and CA invoices into
        // billing weeks: the period-scoped endpoints read USD alone (T-61).
        const imported = invoices.rows
          .filter((row) => row.status === "imported" && row.currency === "USD")
          .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
        setOptions(imported.map(toOption));
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
