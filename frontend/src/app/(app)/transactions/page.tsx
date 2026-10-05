"use client";

import { useEffect, useMemo, useState } from "react";
import type { TransactionListItem } from "@ch/core/actuals/transactions";
import { listTransactions } from "../../../lib/api";
import { useCurrencySide } from "../../../hooks/useCurrencySide";
import { useWeek } from "../../../hooks/useWeek";
import { QTY_UNIT_NAMES, nativeQtyUnit } from "../../../lib/formatMoney";
import { invoiceOnSide } from "../../../lib/weeks";
import type { InvoiceQtyUnit } from "@ch/core/db/types";
import CurrencySideSwitch from "../../../components/CurrencySideSwitch";
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
  // US on every mount, never remembered; the same value the "Invoices in view"
  // strip highlights and the request below asks for (D28).
  const { side, setSide } = useCurrencySide();
  const invoiceNumber = invoiceOnSide(weekEntry, side)?.invoiceNumber ?? null;
  // `null` is "as BVD printed it": gal for the US side, L for the CA side.
  const [unitChoice, setUnitChoice] = useState<InvoiceQtyUnit | null>(null);
  const nativeUnit = nativeQtyUnit(side);
  // Choosing the side's own unit is the same as choosing nothing — no `?units=`.
  const unitOverride = unitChoice === nativeUnit ? null : unitChoice;
  const shownUnit = unitOverride ?? nativeUnit;
  const { filters, setFilter, clearFilters } = useTransactionFilters();
  const filterOptions = useTransactionFilterOptions(period, side);

  const [rows, setRows] = useState<TransactionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Wait for the week list: until it arrives the side cannot know whether
    // the week has a US invoice, and asking for the wrong one is a wasted call.
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
      currency: side,
      units: unitOverride === null ? undefined : unitOverride === "gal" ? "imperial" : "metric",
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
    side,
    unitOverride,
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
        <CurrencySideSwitch side={side} onChange={setSide} />
        <div className="side-switch" role="group" aria-label="Units">
          {(["gal", "L"] as const).map((unit) => (
            <button
              key={unit}
              type="button"
              className={`side-switch-option${shownUnit === unit ? " active" : ""}`}
              aria-pressed={shownUnit === unit}
              title={unit === nativeUnit ? `${QTY_UNIT_NAMES[unit]} — as printed` : `Show ${QTY_UNIT_NAMES[unit].toLowerCase()}; money is unchanged`}
              onClick={() => setUnitChoice(unit)}
            >
              {unit}
            </button>
          ))}
        </div>
      </div>
      <TransactionsTable
        rows={searched}
        totalBeforeSearch={rows.length}
        loading={loading}
        error={error}
        invoiceNumber={invoiceNumber}
        currency={side}
        qtyUnit={shownUnit}
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
