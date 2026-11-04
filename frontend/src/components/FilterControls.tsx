"use client";

import { useEffect, useId, useRef, useState } from "react";
import { flagsValueLabel, optionLabel } from "../lib/transactionFilterChips";
import type { FilterOption } from "../hooks/useTransactionFilterOptions";
import { FILTERABLE_FLAGS } from "./AnomalyFlag";
import Popover from "./Popover";

/**
 * The pieces of the Transactions filter bar (T-87) that the Receipt Queue bar
 * shares (T-93): a search box, button-style dropdowns, the Flags menu, and the
 * chip row with Clear all. They hold no state about which filters exist.
 */

/** True when the given event target is a form control that should keep its
 * own keystrokes — the `/`-focuses-search shortcut must not fire while the
 * dispatcher is already typing into a filter or the search box itself. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d={up ? "M2 6.5l3-3 3 3" : "M2 3.5l3 3 3-3"} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

interface FilterSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}

/** The bar's flex-grow search box; `/` focuses it from anywhere that is not a form control. */
export function FilterSearch({ value, onChange, placeholder, ariaLabel }: FilterSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <label className="tx-bar-search">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      <input ref={inputRef} className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={ariaLabel} />
    </label>
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
export function FilterDropdown({ label, value, options, onChange }: FilterDropdownProps) {
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

interface FlagsFilterProps {
  /** Comma-separated rule names; "" is none. */
  flags: string;
  anomalyOnly: boolean;
  onChange: (patch: { flags: string; anomalyOnly: boolean }) => void;
}

/** The Flags menu: All / Flagged / one checkbox per rule in `FILTERABLE_FLAGS`, so a new rule appears here by itself. */
export function FlagsFilter({ flags, anomalyOnly, onChange }: FlagsFilterProps) {
  const [open, setOpen] = useState(false);
  const groupName = useId();
  const selected = flags === "" ? [] : flags.split(",");
  const active = anomalyOnly || selected.length > 0;

  return (
    <Popover
      triggerClassName={`tx-dd${active ? " on" : ""}`}
      trigger={
        <>
          <span className="tx-dd-key">Flags</span>
          <span className="tx-dd-value">{flagsValueLabel({ flags, anomalyOnly })}</span>
          <Chevron up={open} />
        </>
      }
      panelLabel="Filter by flag"
      panelClassName="tx-flags-menu"
      onOpenChange={setOpen}
    >
      <label className="tx-menu-option">
        <input type="radio" name={groupName} checked={!active} onChange={() => onChange({ flags: "", anomalyOnly: false })} />
        All
      </label>
      <label className="tx-menu-option">
        <input type="radio" name={groupName} checked={anomalyOnly && selected.length === 0} onChange={() => onChange({ flags: "", anomalyOnly: true })} />
        Flagged
      </label>
      <span className="tx-menu-rule" />
      {FILTERABLE_FLAGS.map((flag) => (
        <label key={flag.value} className="tx-menu-option">
          <input
            type="checkbox"
            checked={selected.includes(flag.value)}
            onChange={(e) =>
              onChange({
                flags: (e.target.checked ? [...selected, flag.value] : selected.filter((r) => r !== flag.value)).join(","),
                anomalyOnly: false,
              })
            }
          />
          {flag.label}
        </label>
      ))}
    </Popover>
  );
}

export interface ChipView<P> {
  key: string;
  label: string;
  value: string;
  /** The × button's accessible name. */
  removeLabel: string;
  clear: P;
}

interface FilterChipsProps<P> {
  chips: ChipView<P>[];
  onRemove: (patch: P) => void;
  onClearAll: () => void;
}

/** One removable chip per active filter, then Clear all. Renders nothing when no filter is on. */
export function FilterChips<P>({ chips, onRemove, onClearAll }: FilterChipsProps<P>) {
  if (chips.length === 0) return null;
  return (
    <div className="tx-chips" role="group" aria-label="Active filters">
      <span className="tx-chips-label">Filtered by</span>
      {chips.map((chip) => (
        <span key={chip.key} className="tx-chip">
          {chip.label}: <strong>{chip.value}</strong>
          <button type="button" aria-label={chip.removeLabel} onClick={() => onRemove(chip.clear)}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </span>
      ))}
      <button type="button" className="tx-chips-clear" onClick={onClearAll}>
        Clear all
      </button>
    </div>
  );
}
