"use client";

import { normaliseRange, scopeForMode, type Scope, type ScopeMode } from "../lib/overviewScope";
import SegmentedControl from "./SegmentedControl";

export interface ScopeWeek {
  weekEnd: string;
  /** `Sep 3 – 9`. */
  label: string;
}

interface ScopeControlProps {
  scope: Scope;
  /** Every billing week, ascending. */
  weeks: readonly ScopeWeek[];
  onChange: (scope: Scope) => void;
}

const OPTIONS = [
  { value: "all", label: "All time" },
  { value: "week", label: "Billing week", dropdown: true },
  { value: "range", label: "Range", dropdown: true },
] as const;

/** `All time` | `Billing week ▾` | `Range ▾`, with the week or range pickers inline (T-71). */
export default function ScopeControl({ scope, weeks, onChange }: ScopeControlProps) {
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
      {scope.mode === "range" && (
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
