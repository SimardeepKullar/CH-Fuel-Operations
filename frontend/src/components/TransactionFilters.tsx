"use client";

import { useEffect, useRef, useState } from "react";
import type { FilterOption } from "../hooks/useTransactionFilterOptions";
import type { TransactionFiltersState } from "../hooks/useTransactionFilters";
import { activeFilterChips, flagsValueLabel, optionLabel, type ChipPatch } from "../lib/transactionFilterChips";
import { PRODUCT_OPTIONS, RECEIPT_STATUS_OPTIONS } from "../lib/transactionFilterConstants";
import { FILTERABLE_FLAGS } from "./AnomalyFlag";
import Popover from "./Popover";

/** True when the given event target is a form control that should keep its
 * own keystrokes — the `/`-focuses-search shortcut must not fire while the
 * dispatcher is already typing into a filter or the search box itself. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
}

function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d={up ? "M2 6.5l3-3 3 3" : "M2 3.5l3 3 3-3"} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

interface FilterDropdownProps {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

/** `DRIVER  All ▾`: a native select laid invisibly over the button-shaped label,
 * so the keyboard, the phone's picker and the accessible name all come for free. */
function FilterDropdown({ label, value, options, onChange }: FilterDropdownProps) {
  return (
    <label className={`tx-dd${value === "" ? "" : " on"}`}>
      <span className="tx-dd-key">{label}</span>
      <span className="tx-dd-value">{value === "" ? "All" : (optionLabel(options, value) ?? "Selected")}</span>
      <Chevron />
      <select className="tx-dd-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

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
}: TransactionFiltersProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

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

  const selectedFlags = filters.flags === "" ? [] : filters.flags.split(",");
  const flagsActive = filters.anomalyOnly || selectedFlags.length > 0;
  const moreCount = (filters.cardId === "" ? 0 : 1) + (filters.state === "" ? 0 : 1);
  const chips = activeFilterChips(filters, { drivers: driverOptions, trucks: truckOptions, cards: cardOptions, states: stateOptions });

  return (
    <div className="tx-toolbar">
      <div className="tx-bar">
        <label className="tx-bar-search">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <input
            ref={searchInputRef}
            className="input"
            value={filters.q}
            onChange={(e) => setFilter("q", e.target.value)}
            placeholder="Search driver, card, unit, station, auth code…"
            aria-label="Search transactions"
          />
        </label>
        <FilterDropdown label="Driver" value={filters.driverId} options={driverOptions} onChange={(v) => setFilter("driverId", v)} />
        <FilterDropdown label="Truck" value={filters.truckId} options={truckOptions} onChange={(v) => setFilter("truckId", v)} />
        <FilterDropdown label="Product" value={filters.product} options={PRODUCT_OPTIONS} onChange={(v) => setFilter("product", v)} />
        <FilterDropdown label="Receipt" value={filters.receiptStatus} options={RECEIPT_STATUS_OPTIONS} onChange={(v) => setFilter("receiptStatus", v)} />
        <Popover
          triggerClassName={`tx-dd${flagsActive ? " on" : ""}`}
          trigger={
            <>
              <span className="tx-dd-key">Flags</span>
              <span className="tx-dd-value">{flagsValueLabel(filters)}</span>
              <Chevron up={flagsOpen} />
            </>
          }
          panelLabel="Filter by flag"
          panelClassName="tx-flags-menu"
          onOpenChange={setFlagsOpen}
        >
          <label className="tx-menu-option">
            <input type="radio" name="tx-flags-mode" checked={!flagsActive} onChange={() => setFilters({ flags: "", anomalyOnly: false })} />
            All
          </label>
          <label className="tx-menu-option">
            <input
              type="radio"
              name="tx-flags-mode"
              checked={filters.anomalyOnly && selectedFlags.length === 0}
              onChange={() => setFilters({ flags: "", anomalyOnly: true })}
            />
            Flagged
          </label>
          <span className="tx-menu-rule" />
          {FILTERABLE_FLAGS.map((flag) => (
            <label key={flag.value} className="tx-menu-option">
              <input
                type="checkbox"
                checked={selectedFlags.includes(flag.value)}
                onChange={(e) =>
                  setFilters({
                    flags: (e.target.checked ? [...selectedFlags, flag.value] : selectedFlags.filter((r) => r !== flag.value)).join(","),
                    anomalyOnly: false,
                  })
                }
              />
              {flag.label}
            </label>
          ))}
        </Popover>
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
        <span className="tx-bar-count">
          <strong>{shown}</strong> of {total}
        </span>
      </div>
      {chips.length > 0 && (
        <div className="tx-chips" role="group" aria-label="Active filters">
          <span className="tx-chips-label">Filtered by</span>
          {chips.map((chip) => (
            <span key={chip.key} className="tx-chip">
              {chip.label}: <strong>{chip.value}</strong>
              <button type="button" aria-label={chip.removeLabel} onClick={() => setFilters(chip.clear)}>
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            </span>
          ))}
          <button type="button" className="tx-chips-clear" onClick={clearFilters}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
