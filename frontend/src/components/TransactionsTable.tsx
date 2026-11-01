"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import type { InvoiceCurrency, InvoiceQtyUnit, ReceiptStatus } from "@ch/core/db/types";
import type { TransactionListItem } from "@ch/core/actuals/transactions";
import Link from "next/link";
import {
    formatMoney,
  formatMoneyOrPending,
  formatPriceOrPending,
  formatPricePerUnit,
  formatQty2dp,
  sumMoney,
} from "../lib/formatMoney";
import { formatFxEnteredAt } from "../lib/conversion";
import InvoiceTag from "./InvoiceTag";
import { defQty, productBadgeVariant, productLabel } from "../lib/transactionFilterConstants";
import type { FilterOption } from "../hooks/useTransactionFilterOptions";
import type { TransactionFiltersState } from "../hooks/useTransactionFilters";
import type { ChipPatch } from "../lib/transactionFilterChips";
import AnomalyFlag from "./AnomalyFlag";
import BilledPrice from "./BilledPrice";
import Popover from "./Popover";
import RawResolved from "./RawResolved";
import StopExpansion from "./StopExpansion";
import TransactionFilters from "./TransactionFilters";
import { printedAt } from "../lib/wallClock";

const RECEIPT_MARKS: Record<ReceiptStatus, string> = { confirmed: "✓", missing: "✗", pending: "?" };
const RECEIPT_LABELS: Record<ReceiptStatus, string> = { confirmed: "Confirmed", missing: "Missing", pending: "Pending" };

/** The key to the Unit column, behind the `i` in its header (T-87). */
function UnitKey() {
  return (
    <Popover
      trigger="i"
      triggerClassName="tx-info"
      triggerLabel="How to read the unit column"
      panelLabel="Reading the unit column"
      panelClassName="tx-unit-key"
    >
      <span className="tx-unit-key-title">Reading the unit column</span>
      <span className="tx-unit-key-item">
        <RawResolved value={{ resolved: "072", raw: "072", agrees: true }} />
        as entered at the pump
      </span>
      <span className="tx-unit-key-item">
        <RawResolved value={{ resolved: null, raw: "072", agrees: null }} />
        resolved from the card assignment
      </span>
      <span className="tx-unit-key-item">
        <RawResolved value={{ resolved: "072", raw: "0", agrees: false }} />
        the two disagree
      </span>
    </Popover>
  );
}

const columnHelper = createColumnHelper<TransactionListItem>();

/** A per-unit header: `Billed CAD/L` when every row agrees; with rows in more than
 * one currency (All invoices) the cells carry it (`US$`/`CA$`) and the header says
 * only the unit, and with more than one unit, neither. */
function perUnitHeader(prefix: string, currency: InvoiceCurrency | null, unit: InvoiceQtyUnit | null): string {
  if (currency !== null) return `${prefix} ${currency}${unit === null ? " per unit" : `/${unit}`}`;
  return `${prefix} per ${unit ?? "unit"}`;
}

/** A quantity header's unit: `gal`, `L`, or `qty` when the rows mix units. */
function qtyHeader(prefix: string, unit: InvoiceQtyUnit | null): string {
  return `${prefix} ${unit ?? "qty"}`;
}

/** The columns for the rows' currency and unit — `null` where the rows hold more
 * than one. The money and per-unit headers carry both when they can (A6.1 as
 * amended): a CA invoice reads `Litres`, `Billed CAD/L`, `Total CAD`. With
 * `showInvoice`, each row is tagged with its invoice (All invoices). */
function buildColumns(
  currency: InvoiceCurrency | null,
  unit: InvoiceQtyUnit | null,
  showInvoice: boolean,
): ColumnDef<TransactionListItem, any>[] {
  return [
    // Rendered specially in the row loop below (it needs the live `expandedId`
    // state, not just the row's own data) — this definition exists so the
    // chevron still occupies a real TanStack column/cell slot.
    columnHelper.display({ id: "chevron", header: "" }),
    columnHelper.accessor("occurredAt", {
      header: "Date · time",
      cell: ({ row, getValue }) => {
        const { date, time, full } = printedAt(getValue());
        return (
          <span className="tx-datetime">
            <span className="tx-date">{date}</span>
            <span className="tx-time" title={full}>{time}</span>
            {showInvoice && (
              <InvoiceTag
                currency={row.original.invoiceCurrency}
                invoiceNumber={row.original.invoiceNumber}
              />
            )}
          </span>
        );
      },
    }),
    columnHelper.accessor((row) => row.card.number, {
      id: "card",
      header: "Card",
      cell: ({ getValue }) => <span className="tx-card-cell">{getValue()}</span>,
    }),
    columnHelper.display({
      id: "driver",
      header: "Driver",
      cell: ({ row }) => <RawResolved value={row.original.driver} />,
    }),
    columnHelper.display({
      id: "unit",
      header: "Unit",
      // The unit/truck field is operationally worth double-checking even when
      // it agrees with the card assignment (a pump mistype is common) — the
      // design shows it always paired with its raw text, unlike driver. The
      // invoice unit (what was actually pumped) is primary here, not the
      // assigned truck (a schedule expectation) — T-40E.
      cell: ({ row }) => <RawResolved value={row.original.truck} showRawWhenAgreeing primary="raw" />,
    }),
    columnHelper.display({
      id: "station",
      header: "Station",
      cell: ({ row }) => {
        const station = row.original.station;
        return (
          <span className="tx-station">
            <span className="tx-station-name">{station ? station.name : "Unresolved"}</span>
            <span className="tx-station-place">{station ? `${station.city}, ${station.state}` : "—"}</span>
          </span>
        );
      },
    }),
    columnHelper.display({
      id: "gallons",
      header: qtyHeader("Diesel", unit),
      cell: ({ row }) => (
        <span className="tx-gal">
            {row.original.qty === null
              ? "—"
              : unit === null
                ? `${formatQty2dp(row.original.qty)} ${row.original.qtyUnit}`
                : formatQty2dp(row.original.qty)}
          </span>
      ),
    }),
    columnHelper.display({
      id: "billed",
      header: perUnitHeader("Diesel billed", currency, unit),
      cell: ({ row }) => (
        <BilledPrice
          billedPerUnit={row.original.billedPerUnit}
          retailPerUnit={row.original.retailPerUnit}
          currency={row.original.currency}
          ratePending={row.original.ratePending === true}
        />
      ),
    }),
    columnHelper.display({
      id: "def",
      header: qtyHeader("DEF", unit),
      // Lines convert with the stop (one `qtyConverter`), so this is in the same unit as the diesel cell.
      cell: ({ row }) => {
        const qty = defQty(row.original.lines);
        return (
          <span className="tx-gal">
            {qty === null
              ? "—"
              : unit === null
                ? `${formatQty2dp(qty)} ${row.original.qtyUnit}`
                : formatQty2dp(qty)}
          </span>
        );
      },
    }),
    columnHelper.accessor("total", {
      header: currency === null ? "Total" : `Total ${currency}`,
      cell: ({ row }) => <span className="tx-total">{formatMoneyOrPending(row.original.total, row.original.currency)}</span>,
    }),
    columnHelper.display({
      id: "receipt",
      header: "Rcpt",
      cell: ({ row }) => {
        const status = row.original.receiptStatus;
        return (
          <span className={`tx-receipt-mark ${status}`} title={RECEIPT_LABELS[status]}>
            {RECEIPT_MARKS[status]}
          </span>
        );
      },
    }),
    columnHelper.display({
      id: "products",
      header: "Products",
      // Facts, not warnings — a badge per distinct product the stop carries,
      // in `.anomaly-flag`'s visual language but neutral color (T-40C).
      // `lines` is optional on the type even though `includeLines: true` is
      // always requested for this list; no lines means no badges rather than
      // a guess off the diesel-only `gallons` summary.
      cell: ({ row }) => {
        const lines = row.original.lines ?? [];
        const seen = new Set<string>();
        const distinct = lines.filter((line) => {
          if (seen.has(line.productCode)) return false;
          seen.add(line.productCode);
          return true;
        });
        return (
          <span className="tx-products">
            {distinct.map((line) => (
              <span key={line.productCode} className={`product-badge product-badge-${productBadgeVariant(line.productCode)}`}>
                {productLabel(line.productCode)}
              </span>
            ))}
          </span>
        );
      },
    }),
    columnHelper.display({
      id: "flags",
      header: "Flags",
      // A charge-with-no-fuel stop (scale, cash, or otherwise) is a routine
      // fact visible in the row's own line items, not an anomaly — the
      // charges_no_fuel/"Scale" flag never renders here (T-40H, extending
      // T-40G's Scale-badge-specific suppression to every case).
      cell: ({ row }) => {
        const flags = row.original.flags.filter((f) => f.rule !== "charges_no_fuel");
        return (
          <span className="tx-flags">
            {flags.map((f) => (
              <AnomalyFlag key={f.rule} flag={f} />
            ))}
          </span>
        );
      },
    }),
  ];
}

interface TransactionsTableProps {
  /** Already filtered (server-side filters + client-side search) and
   * sorted — this component renders and lets the dispatcher interact, it
   * doesn't decide what belongs in the set. */
  rows: TransactionListItem[];
  /** Count before the free-text search narrows it further — the toolbar's
   * "N of M" label. */
  totalBeforeSearch: number;
  loading: boolean;
  error: Error | null;
  /** Tag each row with the invoice it came from (flag + number) — on under All invoices. */
  showInvoice?: boolean;
  /** The selected week — where "rate pending" links to enter the rate (the Overview, T-66). */
  week?: string | null;
  /** What the page asked for — the headers' currency and unit when no row says. */
  currency: InvoiceCurrency;
  qtyUnit: InvoiceQtyUnit;
  filters: TransactionFiltersState;
  setFilter: (key: keyof TransactionFiltersState, value: string | boolean) => void;
  setFilters: (patch: ChipPatch) => void;
  clearFilters: () => void;
  driverOptions: FilterOption[];
  truckOptions: FilterOption[];
  cardOptions: FilterOption[];
  stateOptions: FilterOption[];
}

/**
 * A8.3 at real density (T-40). Columns/cells come from TanStack Table
 * (Step 40.2); the horizontal-scroll and row-expansion mechanics are the
 * design file's own — one `overflow-x: auto` wrapper around a single
 * min-width inner block holding header, rows and footer as siblings, so
 * they scroll together by construction rather than three panes kept in
 * sync by JS.
 */
export default function TransactionsTable({
  rows,
  totalBeforeSearch,
  loading,
  error,
  showInvoice = false,
  week = null,
  currency: requestedCurrency,
  qtyUnit: requestedUnit,
  filters,
  setFilter,
  setFilters,
  clearFilters,
  driverOptions,
  truckOptions,
  cardOptions,
  stateOptions,
}: TransactionsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (activeIndex >= rows.length) setActiveIndex(Math.max(0, rows.length - 1));
  }, [rows.length, activeIndex]);

  // A new order puts a different row first (T-40J).
  useEffect(() => {
    setActiveIndex(0);
  }, [filters.sort]);

  const toggleRow = useCallback((id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  const handleRowsKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (rows.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => {
          const next = Math.min(rows.length - 1, i + 1);
          rowRefs.current.get(rows[next]!.id)?.focus();
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => {
          const next = Math.max(0, i - 1);
          rowRefs.current.get(rows[next]!.id)?.focus();
          return next;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[activeIndex];
        if (row) toggleRow(row.id);
      }
    },
    [rows, activeIndex, toggleRow],
  );

  // The headers follow the rows when there are any. One invoice is one currency
  // and one unit; All invoices can hold two of either, and then the totals below
  // that would add them — litres with gallons, CAD with USD — are withheld.
  const currencies = new Set(rows.map((row) => row.currency));
  const units = new Set(rows.map((row) => row.qtyUnit));
  const currency = currencies.size > 1 ? null : (rows[0]?.currency ?? requestedCurrency);
  const unit = units.size > 1 ? null : (rows[0]?.qtyUnit ?? requestedUnit);
  // T-66: a converted row carries the rate it was converted at; a row whose rate is not
  // entered carries `ratePending` and no money — and then no total adds it in.
  const ratePending = rows.some((row) => row.ratePending === true);
  const fx = rows.find((row) => row.fx !== undefined)?.fx ?? null;
  const columns = useMemo(
    () => buildColumns(currency, unit, showInvoice),
    [currency, unit, showInvoice],
  );
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  const totals = useMemo(() => {
    // Quantity adds up within one unit, money within one currency, and a
    // weighted price needs both.
    let qty = 0;
    let hasQty = false;
    let weightedBilled = 0;
    let defTotal = 0;
    let hasDef = false;
    for (const row of rows) {
      const def = defQty(row.lines);
      if (def !== null) {
        hasDef = true;
        defTotal += def;
      }
      // A rate-pending row has no prices, but its quantity is not money and still adds up.
      const priced = row.billedPerUnit !== null && row.retailPerUnit !== null;
      if (row.qty !== null && (priced || row.ratePending === true)) {
        hasQty = true;
        qty += row.qty;
        if (priced) {
          weightedBilled += row.qty * row.billedPerUnit!;
        }
      }
    }
    const priced = currency !== null && unit !== null && hasQty && qty > 0 && !ratePending;
    return {
      qty: unit !== null && hasQty ? qty : null,
      defQty: unit !== null && hasDef ? defTotal : null,
      avgBilled: priced ? weightedBilled / qty : null,
      total: currency !== null && !ratePending ? sumMoney(rows.map((row) => row.total ?? 0)) : null,
    };
  }, [rows, currency, unit, ratePending]);

  return (
    <>
      <TransactionFilters
        filters={filters}
        setFilter={setFilter}
        setFilters={setFilters}
        clearFilters={clearFilters}
        driverOptions={driverOptions}
        truckOptions={truckOptions}
        cardOptions={cardOptions}
        stateOptions={stateOptions}
        shown={rows.length}
        total={totalBeforeSearch}
      />

      <div className="tx-panel">
        <div className="tx-scroll">
          <div className="tx-scroll-inner">
            <div className="tx-row-grid tx-head-row">
              {table.getHeaderGroups()[0]!.headers.map((header) => (
                <span
                  key={header.id}
                  className={`tx-head-cell${["gallons", "billed", "def", "total"].includes(header.id) ? " num" : ""}${header.id === "billed" ? " tx-head-billed" : ""}`}
                  {...(header.id === "occurredAt"
                    ? { role: "columnheader", "aria-sort": filters.sort === "asc" ? ("ascending" as const) : ("descending" as const) }
                    : {})}
                >
                  {header.id === "occurredAt" ? (
                    <button
                      type="button"
                      className="tx-sort"
                      onClick={() => setFilter("sort", filters.sort === "asc" ? "" : "asc")}
                      title={filters.sort === "asc" ? "Oldest first — click for newest first" : "Newest first — click for oldest first"}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <span className="tx-sort-mark" aria-hidden="true">
                        {filters.sort === "asc" ? "↑" : "↓"}
                      </span>
                    </button>
                  ) : header.id === "unit" ? (
                    <span className="tx-head-with-info">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <UnitKey />
                    </span>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </span>
              ))}
            </div>

            {loading && <div className="tx-empty">Loading transactions…</div>}
            {!loading && error && <div className="tx-empty">{error.message}</div>}
            {!loading && !error && rows.length === 0 && (
              <div className="tx-empty">No transactions match these filters.</div>
            )}

            {!loading &&
              !error &&
              table.getRowModel().rows.map((row, index) => {
                const stop = row.original;
                const open = expandedId === stop.id;
                return (
                  <div className="tx-row-wrap" key={stop.id}>
                    <div
                      ref={(el) => {
                        if (el) rowRefs.current.set(stop.id, el);
                        else rowRefs.current.delete(stop.id);
                      }}
                      className={`tx-row-grid tx-row${index === activeIndex ? " active" : ""}`}
                      onClick={() => {
                        setActiveIndex(index);
                        toggleRow(stop.id);
                      }}
                      onFocus={() => setActiveIndex(index)}
                      onKeyDown={handleRowsKeyDown}
                      tabIndex={index === activeIndex ? 0 : -1}
                      role="button"
                      aria-expanded={open}
                    >
                      {row.getVisibleCells().map((cell) =>
                        cell.column.id === "chevron" ? (
                          <span key={cell.id} className="tx-cell">
                            <span className="tx-chev">{open ? "▾" : "▸"}</span>
                          </span>
                        ) : (
                          <span
                            key={cell.id}
                            className={`tx-cell${["gallons", "billed", "def", "total"].includes(cell.column.id) ? " num" : ""}`}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </span>
                        ),
                      )}
                    </div>
                    {open && <StopExpansion stop={stop} invoiceNumber={stop.invoiceNumber} />}
                  </div>
                );
              })}

            {!loading && !error && (
              <div className="tx-row-grid tx-foot-row">
                <span />
                <span className="tx-foot-label">
                  {rows.length} stop{rows.length === 1 ? "" : "s"} shown
                </span>
                <span className="tx-foot-cell">{totals.qty === null ? "—" : formatQty2dp(totals.qty)}</span>
                <span className="tx-foot-cell tx-foot-billed">
                  {totals.avgBilled === null || currency === null ? "—" : formatPricePerUnit(totals.avgBilled, currency)}
                </span>
                <span className="tx-foot-cell">{totals.defQty === null ? "—" : formatQty2dp(totals.defQty)}</span>
                <span className="tx-foot-cell">{totals.total === null || currency === null ? "—" : formatMoney(totals.total, currency)}</span>
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="tx-caption">
        <span>
          Rows are one fuel stop, grouped by base auth code — expand to see every product line.{" "}
          {currency === null
            ? "Amounts are in each invoice's own currency — no combined total."
            : `All amounts ${currency}.`}
          {fx !== null && (
            <span className="tx-fx-rate" data-testid="fx-rate-line">
              {" "}
              Converted at {fx.rate} CAD per USD, entered {formatFxEnteredAt(fx.enteredAt)}.
            </span>
          )}
          {ratePending && (
            <span className="tx-conversion-pending" data-testid="conversion-pending">
              {" "}
              rate pending —{" "}
              <Link href={week === null ? "/overview" : `/overview?scope=week&w=${encodeURIComponent(week)}`} data-testid="enter-rate-link">
                enter the exchange rate on the Overview
              </Link>
              .
            </span>
          )}
        </span>
      </div>
    </>
  );
}
