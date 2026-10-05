"use client";

import { useEffect, useMemo, useState } from "react";
import type { TransactionListItem } from "@ch/core/actuals/transactions";
import { listTransactions } from "../../../lib/api";
import type { InvoiceCurrency } from "@ch/core/db/types";
import { useInvoiceInView } from "../../../hooks/useInvoiceInView";
import { useWeek } from "../../../hooks/useWeek";
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
  const { week: period, loading: periodLoading, weekEntry } = useWeek();
  // One invoice picked from the strip, or all of the week's; the same selection
  // the strip highlights and the request below asks for (D28).
  const selection = useInvoiceInView();
  const selectionKey = selection.kind === "one" ? selection.invoice.id : selection.kind;
  // `undefined` serves both sides; one invoice is one side, since a week holds
  // at most one imported invoice per currency (D26).
  const currency: InvoiceCurrency | undefined = selection.kind === "one" ? selection.invoice.currency : undefined;

  // The conversion belongs to the invoice it was chosen on: picking another
  // invoice (or All) shows that one as it came in again.
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
  const { units } = conversionParams(conversion);

  const invoiceNumbers = useMemo(
    () => Object.fromEntries((weekEntry?.invoices ?? []).map((invoice) => [invoice.currency, invoice.invoiceNumber])),
    [weekEntry],
  ) as Partial<Record<InvoiceCurrency, string>>;
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
      week: period,
      currency,
      units,
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
    currency,
    units,
    filters.driverId,
    filters.truckId,
    filters.cardId,
    filters.state,
    filters.product,
    filters.receiptStatus,
    filters.anomalyOnly,
  ]);

  const searched = useMemo(() => rows.filter((row) => matchesSearch(row, filters.q)), [rows, filters.q]);

  return (
    <div className="tx-page">
      <div className="tx-side-bar">
        <ConversionToggle shown={shown} onChange={(choice) => setPick({ key: selectionKey, choice })} />
      </div>
      <TransactionsTable
        rows={searched}
        totalBeforeSearch={rows.length}
        loading={loading}
        error={error}
        invoiceNumbers={invoiceNumbers}
        showInvoice={selection.kind === "all"}
        conversion={conversion}
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
  );
}
