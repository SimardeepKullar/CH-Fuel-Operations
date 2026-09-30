"use client";

import { useEffect, useMemo, useState } from "react";
import type { TransactionListItem } from "@ch/core/actuals/transactions";
import { listTransactions } from "../../../lib/api";
import { useInvoicePeriod } from "../../../hooks/useInvoicePeriod";
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
  const { period, loading: periodLoading, invoiceNumber } = useInvoicePeriod();
  const { filters, setFilter, clearFilters } = useTransactionFilters();
  const filterOptions = useTransactionFilterOptions(period);

  const [rows, setRows] = useState<TransactionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (period === null) {
      setRows([]);
      setLoading(periodLoading);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    listTransactions({
      period,
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
      <TransactionsTable
        rows={searched}
        totalBeforeSearch={rows.length}
        loading={loading}
        error={error}
        invoiceNumber={invoiceNumber}
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
