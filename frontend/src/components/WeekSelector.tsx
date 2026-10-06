"use client";

import { useWeek } from "../hooks/useWeek";
import { formatWeekEnding } from "../lib/weeks";

/** A7's top-bar week selector — governs Actuals and Analysis. `TopBar` hides
 * it entirely on Plan screens (T-39 DoD) rather than rendering it disabled.
 * Lists weeks, not invoices (T-64, D26): each option is just "Week ending Sep 9,
 * 2026" — the invoices behind the week, and any ⚠, are on the "Invoices in view"
 * strip under the bar. */
export default function WeekSelector() {
  const { week, setWeek, weeks, loading } = useWeek();

  return (
    <span className="topbar-period">
      <span className="topbar-period-label">Billing week</span>
      <select
        className="input topbar-period-select"
        aria-label="Billing week"
        value={week ?? ""}
        onChange={(e) => setWeek(e.target.value)}
        disabled={loading || weeks.length === 0}
      >
        {week === null && <option value="">{loading ? "Loading…" : "No invoices imported"}</option>}
        {week !== null && !weeks.some((w) => w.weekEnd === week) && (
          <option value={week}>{formatWeekEnding(week)}</option>
        )}
        {weeks.map((w) => (
          <option key={w.weekEnd} value={w.weekEnd}>
            {formatWeekEnding(w.weekEnd)}
          </option>
        ))}
      </select>
    </span>
  );
}
