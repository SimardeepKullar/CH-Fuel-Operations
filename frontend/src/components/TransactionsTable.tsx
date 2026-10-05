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
import { QTY_UNIT_NAMES, formatMoney, formatPricePerUnit, formatQty2dp, sumMoney } from "../lib/formatMoney";
import { moneyConversionPending, type DisplayChoice } from "../lib/conversion";
import { SIDE_FLAGS, SIDE_LABELS } from "../lib/weeks";
import {
  PRODUCT_OPTIONS,
  RECEIPT_STATUS_OPTIONS,
  productBadgeVariant,
  productLabel,
} from "../lib/transactionFilterConstants";
import type { FilterOption } from "../hooks/useTransactionFilterOptions";
import type { TransactionFiltersState } from "../hooks/useTransactionFilters";
import AnomalyFlag from "./AnomalyFlag";
import BilledPrice from "./BilledPrice";
import RawResolved from "./RawResolved";
import StopExpansion from "./StopExpansion";

const RECEIPT_MARKS: Record<ReceiptStatus, string> = { confirmed: "✓", missing: "✗", pending: "?" };
const RECEIPT_LABELS: Record<ReceiptStatus, string> = { confirmed: "Confirmed", missing: "Missing", pending: "Pending" };

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d),
    time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d),
  };
}

/** True when the given event target is a form control that should keep its
 * own keystrokes — the `/`-focuses-search shortcut must not fire while the
 * dispatcher is already typing into a filter or the search box itself. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
}

const columnHelper = createColumnHelper<TransactionListItem>();

/** A per-unit header: `Billed CAD/L` when every row agrees; with rows in more than
 * one currency (All invoices) the cells carry it (`US$`/`CA$`) and the header says
 * only the unit, and with more than one unit, neither. */
function perUnitHeader(prefix: string, currency: InvoiceCurrency | null, unit: InvoiceQtyUnit | null): string {
  if (currency !== null) return `${prefix} ${currency}${unit === null ? " per unit" : `/${unit}`}`;
  return `${prefix} per ${unit ?? "unit"}`;
}

/** Under All invoices, the tag under a row's date naming the invoice it came
 * from and its country: `🇨🇦 999217`. A row carries its currency, and a week
 * holds one imported invoice per currency (D26), so the currency names it. */
function InvoiceTag({ currency, invoiceNumber }: { currency: InvoiceCurrency; invoiceNumber: string | null }) {
  return (
    <span className="tx-invoice-tag" data-currency={currency} data-testid="tx-invoice-tag">
      <span role="img" aria-label={SIDE_LABELS[currency]}>
        {SIDE_FLAGS[currency]}
      </span>{" "}
      {invoiceNumber ?? SIDE_LABELS[currency]}
    </span>
  );
}

/** The columns for the rows' currency and unit — `null` where the rows hold more
 * than one. The money and per-unit headers carry both when they can (A6.1 as
 * amended): a CA invoice reads `Litres`, `Billed CAD/L`, `Total CAD`. With
 * `invoiceNumbers`, each row is tagged with its invoice (All invoices). */
function buildColumns(
  currency: InvoiceCurrency | null,
  unit: InvoiceQtyUnit | null,
  invoiceNumbers: Partial<Record<InvoiceCurrency, string>> | null,
): ColumnDef<TransactionListItem, any>[] {
  return [
    // Rendered specially in the row loop below (it needs the live `expandedId`
    // state, not just the row's own data) — this definition exists so the
    // chevron still occupies a real TanStack column/cell slot.
    columnHelper.display({ id: "chevron", header: "" }),
    columnHelper.accessor("occurredAt", {
      header: "Date · time",
      cell: ({ row, getValue }) => {
        const { date, time } = formatDateTime(getValue());
        return (
          <span className="tx-datetime">
            <span className="tx-date">{date}</span>
            <span className="tx-time">{time}</span>
            {invoiceNumbers !== null && (
              <InvoiceTag currency={row.original.currency} invoiceNumber={invoiceNumbers[row.original.currency] ?? null} />
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
            <span className="tx-station-name">{station ? `Love's #${station.loveNumber ?? "?"}` : "Unresolved"}</span>
            <span className="tx-station-place">{station ? `${station.city}, ${station.state}` : "—"}</span>
          </span>
        );
      },
    }),
    columnHelper.display({
      id: "gallons",
      header: unit === null ? "Quantity" : QTY_UNIT_NAMES[unit],
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
      header: perUnitHeader("Billed", currency, unit),
      cell: ({ row }) => (
        <BilledPrice
          billedPerUnit={row.original.billedPerUnit}
          retailPerUnit={row.original.retailPerUnit}
          currency={row.original.currency}
        />
      ),
    }),
    columnHelper.display({
      id: "retail",
      header: perUnitHeader("Retail", currency, unit),
      cell: ({ row }) => (
        <span className="muted">
          {row.original.retailPerUnit === null ? "—" : formatPricePerUnit(row.original.retailPerUnit, row.original.currency)}
        </span>
      ),
    }),
    columnHelper.accessor("total", {
      header: currency === null ? "Total" : `Total ${currency}`,
      cell: ({ row }) => <span className="tx-total">{formatMoney(row.original.total, row.original.currency)}</span>,
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
  /** The week's invoice number per currency (one imported invoice per side, D26) — a row's
   * own invoice for `StopExpansion`'s "Source" row. A row carries its currency, not its
   * invoice id (A7); T-66's money conversion must keep the invoice's own currency on the row. */
  invoiceNumbers: Partial<Record<InvoiceCurrency, string>>;
  /** Tag each row with the invoice it came from (flag + number) — on under All invoices. */
  showInvoice?: boolean;
  /** The conversion chosen on screen, `null` for as printed — for the "conversion pending" caption. */
  conversion?: DisplayChoice | null;
  /** What the page asked for — the headers' currency and unit when no row says. */
  currency: InvoiceCurrency;
  qtyUnit: InvoiceQtyUnit;
  filters: TransactionFiltersState;
  setFilter: (key: keyof TransactionFiltersState, value: string | boolean) => void;
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
  invoiceNumbers,
  showInvoice = false,
  conversion = null,
  currency: requestedCurrency,
  qtyUnit: requestedUnit,
  filters,
  setFilter,
  clearFilters,
  driverOptions,
  truckOptions,
  cardOptions,
  stateOptions,
}: TransactionsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (activeIndex >= rows.length) setActiveIndex(Math.max(0, rows.length - 1));
  }, [rows.length, activeIndex]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
  const pendingCurrencies = [...currencies].filter((c) => moneyConversionPending(conversion, c));
  const columns = useMemo(
    () => buildColumns(currency, unit, showInvoice ? invoiceNumbers : null),
    [currency, unit, showInvoice, invoiceNumbers],
  );
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  const totals = useMemo(() => {
    // Quantity adds up within one unit, money within one currency, and a
    // weighted price needs both.
    let qty = 0;
    let hasQty = false;
    let weightedBilled = 0;
    let weightedRetail = 0;
    for (const row of rows) {
      if (row.qty !== null && row.billedPerUnit !== null && row.retailPerUnit !== null) {
        hasQty = true;
        qty += row.qty;
        weightedBilled += row.qty * row.billedPerUnit;
        weightedRetail += row.qty * row.retailPerUnit;
      }
    }
    const priced = currency !== null && unit !== null && hasQty && qty > 0;
    return {
      qty: unit !== null && hasQty ? qty : null,
      avgBilled: priced ? weightedBilled / qty : null,
      avgRetail: priced ? weightedRetail / qty : null,
      total: currency !== null ? sumMoney(rows.map((row) => row.total)) : null,
    };
  }, [rows, currency, unit]);

  return (
    <>
      <div className="tx-toolbar">
        <div className="tx-toolbar-row">
          <input
            ref={searchInputRef}
            className="input tx-search"
            value={filters.q}
            onChange={(e) => setFilter("q", e.target.value)}
            placeholder="Search driver, card, unit, station, auth code"
            aria-label="Search transactions"
          />
          <span className="tx-filter">
            <span className="tx-filter-label">Driver</span>
            <select
              className="input tx-filter-select"
              value={filters.driverId}
              onChange={(e) => setFilter("driverId", e.target.value)}
            >
              <option value="">All</option>
              {driverOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
          <span className="tx-filter">
            <span className="tx-filter-label">Truck</span>
            <select
              className="input tx-filter-select"
              value={filters.truckId}
              onChange={(e) => setFilter("truckId", e.target.value)}
            >
              <option value="">All</option>
              {truckOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
          <span className="tx-filter">
            <span className="tx-filter-label">Card</span>
            <select
              className="input tx-filter-select"
              value={filters.cardId}
              onChange={(e) => setFilter("cardId", e.target.value)}
            >
              <option value="">All</option>
              {cardOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
          <span className="tx-filter">
            <span className="tx-filter-label">State</span>
            <select
              className="input tx-filter-select"
              value={filters.state}
              onChange={(e) => setFilter("state", e.target.value)}
            >
              <option value="">All</option>
              {stateOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
          <span className="tx-filter">
            <span className="tx-filter-label">Product</span>
            <select
              className="input tx-filter-select"
              value={filters.product}
              onChange={(e) => setFilter("product", e.target.value)}
            >
              <option value="">All</option>
              {PRODUCT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
          <span className="tx-filter">
            <span className="tx-filter-label">Receipt</span>
            <select
              className="input tx-filter-select"
              value={filters.receiptStatus}
              onChange={(e) => setFilter("receiptStatus", e.target.value)}
            >
              <option value="">All</option>
              {RECEIPT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
          <label className={`tx-anomaly-toggle${filters.anomalyOnly ? " active" : ""}`}>
            <input
              type="checkbox"
              checked={filters.anomalyOnly}
              onChange={(e) => setFilter("anomalyOnly", e.target.checked)}
            />
            <span className="tx-anomaly-toggle-label">Flagged only</span>
          </label>
          <span className="tx-toolbar-meta">
            <span className="tx-count">
              {rows.length} of {totalBeforeSearch}
            </span>
            <button className="tx-clear" onClick={clearFilters} type="button">
              Clear
            </button>
          </span>
        </div>
        <div className="tx-legend">
          <span className="tx-legend-label">Reading the columns</span>
          <span className="tx-legend-item">
            <RawResolved value={{ resolved: "072", raw: "072", agrees: true }} />
            resolved from the card assignment
          </span>
          <span className="tx-legend-item">
            <RawResolved value={{ resolved: null, raw: "072", agrees: null }} />
            as entered at the pump
          </span>
          <span className="tx-legend-item">
            <RawResolved value={{ resolved: "072", raw: "0", agrees: false }} />
            the two disagree
          </span>
        </div>
      </div>

      <div className="tx-panel">
        <div className="tx-scroll">
          <div className="tx-scroll-inner">
            <div className="tx-row-grid tx-head-row">
              {table.getHeaderGroups()[0]!.headers.map((header) => (
                <span
                  key={header.id}
                  className={`tx-head-cell${["gallons", "billed", "retail", "total"].includes(header.id) ? " num" : ""}${header.id === "billed" ? " tx-head-billed" : ""}`}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
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
                            className={`tx-cell${["gallons", "billed", "retail", "total"].includes(cell.column.id) ? " num" : ""}`}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </span>
                        ),
                      )}
                    </div>
                    {open && <StopExpansion stop={stop} invoiceNumber={invoiceNumbers[stop.currency] ?? null} />}
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
                <span className="tx-foot-cell muted">
                  {totals.avgRetail === null || currency === null ? "—" : formatPricePerUnit(totals.avgRetail, currency)}
                </span>
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
          {pendingCurrencies.length > 0 && (
            <span className="tx-conversion-pending" data-testid="conversion-pending">
              {" "}
              Shown per {unit === "L" ? "litre" : "gallon"}; {pendingCurrencies.join(" and ")} amounts stay in{" "}
              {pendingCurrencies.length > 1 ? "their own currency" : pendingCurrencies[0]} — converting them needs the
              Bank of Canada rate (rate pending).
            </span>
          )}
        </span>
      </div>
    </>
  );
}
