"use client";

import { useState, type ReactNode } from "react";
import type { FilterOption } from "../hooks/useTransactionFilterOptions";
import type { TransactionFiltersState } from "../hooks/useTransactionFilters";
import { activeFilterChips, type ChipPatch } from "../lib/transactionFilterChips";
import { PRODUCT_OPTIONS, RECEIPT_STATUS_OPTIONS } from "../lib/transactionFilterConstants";
import { Chevron, FilterChips, FilterDropdown, FilterSearch, FlagsFilter } from "./FilterControls";
import Popover from "./Popover";

interface TransactionFiltersProps {
  filters: TransactionFiltersState;
  setFilter: (key: keyof TransactionFiltersState, value: string | boolean) => void;
  setFilters: (patch: ChipPatch) => void;
  clearFilters: () => void;
  driverOptions: FilterOption[];
  truckOptions: FilterOption[];
  cardOptions: FilterOption[];
  stateOptions: FilterOption[];
  /** Rows on screen, after the search. */
  shown: number;
  /** Rows before the search narrows them. */
  total: number;
  /** The page's units toggle (T-82): rendered after More, before the count. The
   * page owns the conversion state; this bar only gives it a place. */
  unitsControl?: ReactNode;
}

/** The Transactions filter bar (T-87): one row of filters, then a chip per active
 * filter. Holds no filter state of its own; the URL does (`useTransactionFilters`). */
export default function TransactionFilters({
  filters,
  setFilter,
  setFilters,
  clearFilters,
  driverOptions,
  truckOptions,
  cardOptions,
  stateOptions,
  shown,
  total,
  unitsControl,
}: TransactionFiltersProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const moreCount = (filters.cardId === "" ? 0 : 1) + (filters.state === "" ? 0 : 1);
  const chips = activeFilterChips(filters, { drivers: driverOptions, trucks: truckOptions, cards: cardOptions, states: stateOptions });

  return (
    <div className="tx-toolbar">
      <div className="tx-bar">
        <FilterSearch value={filters.q} onChange={(v) => setFilter("q", v)} placeholder="Search driver, card, unit, station, auth code…" ariaLabel="Search transactions" />
        <FilterDropdown label="Driver" value={filters.driverId} options={driverOptions} onChange={(v) => setFilter("driverId", v)} />
        <FilterDropdown label="Truck" value={filters.truckId} options={truckOptions} onChange={(v) => setFilter("truckId", v)} />
        <FilterDropdown label="Product" value={filters.product} options={PRODUCT_OPTIONS} onChange={(v) => setFilter("product", v)} />
        <FilterDropdown label="Receipt" value={filters.receiptStatus} options={RECEIPT_STATUS_OPTIONS} onChange={(v) => setFilter("receiptStatus", v)} />
        <FlagsFilter flags={filters.flags} anomalyOnly={filters.anomalyOnly} onChange={setFilters} />
        <Popover
          triggerClassName={`tx-dd${moreCount > 0 ? " on" : ""}`}
          trigger={
            <>
              <span className="tx-dd-value">More</span>
              {moreCount > 0 && (
                <span className="tx-dd-badge" aria-label={`${moreCount} active`}>
                  {moreCount}
                </span>
              )}
              <Chevron up={moreOpen} />
            </>
          }
          panelLabel="More filters"
          panelClassName="tx-more-menu"
          onOpenChange={setMoreOpen}
        >
          <label className="tx-more-field">
            <span className="tx-more-label">Card</span>
            <select className="input" value={filters.cardId} onChange={(e) => setFilter("cardId", e.target.value)}>
              <option value="">All cards</option>
              {cardOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="tx-more-field">
            <span className="tx-more-label">State / province</span>
            <select className="input" value={filters.state} onChange={(e) => setFilter("state", e.target.value)}>
              <option value="">All</option>
              {stateOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </Popover>
        {unitsControl && (
          <div className="tx-units">
            <span className="tx-units-rule" aria-hidden="true" />
            <span className="tx-units-key">Units</span>
            {unitsControl}
          </div>
        )}
        <span className="tx-bar-count">
          <strong>{shown}</strong> of {total}
        </span>
      </div>
      <FilterChips chips={chips} onRemove={setFilters} onClearAll={clearFilters} />
    </div>
  );
}
