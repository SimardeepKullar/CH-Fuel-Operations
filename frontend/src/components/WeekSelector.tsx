"use client";

import type { PeriodWeek } from "@ch/core/api/routes/periods";
import { useWeek } from "../hooks/useWeek";
import { SIDES, SIDE_FLAGS, formatWeekEnding, invoiceOnSide } from "../lib/weeks";

/** `Week ending Sep 9, 2026 · 🇺🇸 999210 · 🇨🇦 999217` — a missing side reads `🇨🇦 —`; ⚠ when either invoice's dates differ. */
export function weekOptionLabel(week: PeriodWeek): string {
  const sides = SIDES.map((side) => `${SIDE_FLAGS[side]} ${invoiceOnSide(week, side)?.invoiceNumber ?? "—"}`);
  const warn = week.invoices.some((invoice) => invoice.datesDiffer) ? " ⚠" : "";
  return `${formatWeekEnding(week.weekEnd)} · ${sides.join(" · ")}${warn}`;
}

/** A7's top-bar week selector — governs Actuals and Analysis. `TopBar` hides
 * it entirely on Plan screens (T-39 DoD) rather than rendering it disabled.
 * Lists weeks, not invoices (T-64, D26); the US | CA choice is each screen's. */
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
            {weekOptionLabel(w)}
          </option>
        ))}
      </select>
    </span>
  );
}
