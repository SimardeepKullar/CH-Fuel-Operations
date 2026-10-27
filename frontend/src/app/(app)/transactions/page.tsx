"use client";

import { useEffect, useMemo, useState } from "react";
import type { TransactionListItem } from "@ch/core/actuals/transactions";
import { listTransactions } from "../../../lib/api";
import type { InvoiceCurrency } from "@ch/core/db/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePublishInView, useWeek } from "../../../hooks/useWeek";
import { useStandingCountsValue } from "../../../hooks/standingCountsContext";
import { INVOICE_PARAM, actualRange, formatDay } from "../../../lib/weeks";
import { writeScope, weekEndsInScope, type Scope } from "../../../lib/overviewScope";
import { rangeLabel, scopeReadout } from "../../../lib/overviewView";
import { anchorWeek, resolveSide, scopeQuery, transactionsScope, type SideChoice } from "../../../lib/transactionsScope";
import PageBanner from "../../../components/PageBanner";
import ScopeControl from "../../../components/ScopeControl";
import TransactionsStrip from "../../../components/TransactionsStrip";
import { choiceCurrency, choiceUnit, conversionParams, nativeChoice, type DisplayChoice } from "../../../lib/conversion";
import ConversionToggle from "../../../components/ConversionToggle";
import { useTransactionFilterOptions } from "../../../hooks/useTransactionFilterOptions";
import { useTransactionFilters } from "../../../hooks/useTransactionFilters";
import TransactionsTable from "../../../components/TransactionsTable";

const RECEIPT_STATUSES = new Set(["pending", "confirmed", "missing"]);

/** Case-insensitive substring match across every field the toolbar's search
 * box advertises (T-40, A8.3: "Search driver, card, unit, station, auth
 * code") — client-side because no free-text search param exists on
 * `GET /transactions`, and a period's whole result set (~60 stops, fetched
 * in full below) is cheap to filter in the browser. */
function matchesSearch(row: TransactionListItem, query: string): boolean {
  if (query === "") return true;
  const q = query.toLowerCase();
  const haystack = [
    row.baseAuthCode,
    row.card.number,
    row.driver.resolved,
    row.driver.raw,
    row.truck.resolved,
    row.truck.raw,
    row.station?.city,
    row.station?.state,
    row.station?.loveNumber !== null && row.station?.loveNumber !== undefined ? String(row.station.loveNumber) : null,
  ];
  return haystack.some((field) => field !== null && field !== undefined && field.toLowerCase().includes(q));
}

export default function TransactionsPage() {
  const { weeks: periods, week: shellWeek, loading: periodLoading } = useWeek();
  const { receipts, flags } = useStandingCountsValue();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The scope is the Overview's, kept in the same URL keys (T-74); with none, the shell's week.
  const weekEnds = useMemo(() => periods.map((w) => w.weekEnd).reverse(), [periods]);
  const scope = transactionsScope(searchParams, weekEnds, shellWeek);
  const period = anchorWeek(scope, weekEnds);
  const inScopeEnds = new Set(weekEndsInScope(scope, weekEnds));
  const inScope = periods.filter((w) => inScopeEnds.has(w.weekEnd));

  // One side, picked on the strip (or by a link), or both. A week holds at most one imported
  // invoice per currency (D26), so a side is an invoice there.
  const side: SideChoice = resolveSide(scope, searchParams.get("currency"), searchParams.get(INVOICE_PARAM), periods);
  const currency: InvoiceCurrency | undefined = side === "all" ? undefined : side;
  const selectionKey = side;
  usePublishInView(null);

  const setScope = (next: Scope) => {
    const params = new URLSearchParams(searchParams.toString());
    writeScope(params, next);
    params.delete(INVOICE_PARAM);
    router.replace(`${pathname}?${params.toString()}`);
  };
  const setSide = (next: SideChoice) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("currency", next);
    params.delete(INVOICE_PARAM);
    router.replace(`${pathname}?${params.toString()}`);
  };
  const scopeWeeks = useMemo(
    () =>
      [...periods].reverse().map((w) => {
        const dates = w.invoices.map(actualRange);
        const start = dates.map((d) => d.start).sort()[0] ?? w.weekEnd;
        const end = dates.map((d) => d.end).sort().at(-1) ?? w.weekEnd;
        return { weekEnd: w.weekEnd, label: rangeLabel(start, end), start, end };
      }),
    [periods],
  );
  const covered = scopeWeeks.filter((w) => inScopeEnds.has(w.weekEnd));
  const readout =
    covered.length === 0
      ? undefined
      : scopeReadout(scope, covered.length, covered.length === 1 ? covered[0]!.label : `${formatDay(covered[0]!.start)} – ${formatDay(covered.at(-1)!.end)}`);

  const [pick, setPick] = useState<{ key: string; choice: DisplayChoice } | null>(null);
  // Forget it on leaving, too, so coming back to an invoice shows it as it came in.
  const [lastKey, setLastKey] = useState(selectionKey);
  if (lastKey !== selectionKey) {
    setLastKey(selectionKey);
    setPick(null);
  }
  const native = currency === undefined ? null : nativeChoice(currency);
  const chosen = pick !== null && pick.key === selectionKey ? pick.choice : null;
  // Choosing the invoice's own format is the same as choosing nothing — no params.
  const conversion = chosen === native ? null : chosen;
  const shown = conversion ?? native;
  const { units, convertTo } = conversionParams(conversion);

  const request = scopeQuery(scope);
  const { filters, setFilter, clearFilters } = useTransactionFilters();
  const filterOptions = useTransactionFilterOptions(period, currency ?? null);

  const [rows, setRows] = useState<TransactionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Wait for the week list: until it arrives the selection cannot know which
    // invoice to default to, and asking for the wrong one is a wasted call.
    if (period === null || periodLoading) {
      setRows([]);
      setLoading(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    listTransactions({
      ...request,
      currency,
      units,
      convertTo,
      pageSize: 200,
      includeLines: true,
      driverId: filters.driverId || undefined,
      truckId: filters.truckId || undefined,
      cardId: filters.cardId || undefined,
      state: filters.state || undefined,
      product: filters.product || undefined,
      receiptStatus: RECEIPT_STATUSES.has(filters.receiptStatus)
        ? (filters.receiptStatus as "pending" | "confirmed" | "missing")
        : undefined,
      anomalyOnly: filters.anomalyOnly || undefined,
      // Newest first is the API's default, so only oldest first is asked for (T-40J).
      ...(filters.sort === "asc" ? { sortField: "occurred_at" as const, sortDirection: "asc" as const } : {}),
    })
      .then((result) => {
        if (!cancelled) setRows(result.rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    period,
    periodLoading,
    scope.mode,
    request.week,
    request.weekFrom,
    request.weekTo,
    currency,
    units,
    convertTo,
    filters.driverId,
    filters.truckId,
    filters.cardId,
    filters.state,
    filters.product,
    filters.receiptStatus,
    filters.anomalyOnly,
    filters.sort,
  ]);

  const searched = useMemo(() => rows.filter((row) => matchesSearch(row, filters.q)), [rows, filters.q]);

  return (
    <>
        <PageBanner
          title="Transactions"
          controls={<ScopeControl scope={scope} weeks={scopeWeeks} onChange={setScope} />}
          readout={readout}
          meta={
            <span className="pb-standing" data-testid="standing-counts">
              Receipts <b>{receipts ? `${receipts.done}/${receipts.total}` : "—"}</b>
              Flags <b className="pb-flags">{flags ?? "—"}</b>
            </span>
          }
        />
      <div className="tx-page">
        <TransactionsStrip scope={scope} weeks={periods} inScope={inScope} side={side} onSide={setSide} />
        <div className="tx-side-bar">
          <ConversionToggle shown={shown} onChange={(choice) => setPick({ key: selectionKey, choice })} />
        </div>
        <TransactionsTable
          rows={searched}
          totalBeforeSearch={rows.length}
          loading={loading}
          error={error}
          showInvoice={side === "all"}
          week={period}
          currency={shown === null ? "USD" : choiceCurrency(shown)}
          qtyUnit={shown === null ? "gal" : choiceUnit(shown)}
          filters={filters}
          setFilter={setFilter}
          clearFilters={clearFilters}
          driverOptions={filterOptions.drivers}
          truckOptions={filterOptions.trucks}
          cardOptions={filterOptions.cards}
          stateOptions={filterOptions.states}
        />
      </div>
    </>
  );
}
