"use client";

import { normaliseRange, scopeForMode, type Scope, type ScopeMode } from "../lib/overviewScope";
import SegmentedControl from "./SegmentedControl";

export interface ScopeWeek {
  weekEnd: string;
  /** `Sep 3 – 9`. */
  label: string;
}

/** Exact days for Range, in place of its week dropdowns. */
export interface ScopeDayPicker {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

interface ScopeControlProps {
  scope: Scope;
  /** Every billing week, ascending. */
  weeks: readonly ScopeWeek[];
  onChange: (scope: Scope) => void;
  /** Transactions picks days (T-87); the Overview reads whole weeks and leaves this out. */
  days?: ScopeDayPicker;
}

const OPTIONS = [
  { value: "all", label: "All time" },
  { value: "week", label: "Billing week", dropdown: true },
  { value: "range", label: "Range", dropdown: true },
] as const;

/** `All time` | `Billing week ▾` | `Range ▾`, with the week or range pickers inline (T-71). */
export default function ScopeControl({ scope, weeks, onChange, days }: ScopeControlProps) {
  const ends = weeks.map((w) => w.weekEnd);
  return (
    <>
      <SegmentedControl<ScopeMode> ariaLabel="Scope" options={OPTIONS} value={scope.mode} onChange={(mode) => onChange(scopeForMode(mode, ends))} />
      {scope.mode === "week" && (
        <select className="pb-select" aria-label="Billing week" value={scope.week} onChange={(e) => onChange({ mode: "week", week: e.target.value })}>
          {weeks.map((w) => (
            <option key={w.weekEnd} value={w.weekEnd}>
              Week of {w.label}
            </option>
          ))}
        </select>
      )}
      {scope.mode === "range" && days !== undefined && (
        <div className="pb-range">
          <input
            type="date"
            className="pb-select pb-date"
            aria-label="From"
            value={days.from}
            max={days.to || undefined}
            onChange={(e) => days.onChange(e.target.value, days.to)}
          />
          <span className="pb-to">to</span>
          <input
            type="date"
            className="pb-select pb-date"
            aria-label="To"
            value={days.to}
            min={days.from || undefined}
            onChange={(e) => days.onChange(days.from, e.target.value)}
          />
        </div>
      )}
      {scope.mode === "range" && days === undefined && (
        <div className="pb-range">
          <select className="pb-select" aria-label="From week" value={scope.from} onChange={(e) => onChange(normaliseRange(e.target.value, scope.to))}>
            {weeks.map((w) => (
              <option key={w.weekEnd} value={w.weekEnd}>
                {w.label}
              </option>
            ))}
          </select>
          <span className="pb-to">to</span>
          <select className="pb-select" aria-label="To week" value={scope.to} onChange={(e) => onChange(normaliseRange(scope.from, e.target.value))}>
            {weeks.map((w) => (
              <option key={w.weekEnd} value={w.weekEnd}>
                {w.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
