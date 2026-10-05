"use client";

import { useWeek } from "../hooks/useWeek";
import { SIDES, SIDE_FLAGS, SIDE_LABELS, invoiceOnSide, type CurrencySide } from "../lib/weeks";

interface CurrencySideSwitchProps {
  side: CurrencySide;
  onChange: (side: CurrencySide) => void;
}

/**
 * The US | CA switch (T-64, D28). State lives in the screen via
 * `useCurrencySide()`; this is the control. A side the selected week has no
 * imported invoice on is disabled and says why. Any screen that reads one side
 * of a week (Transactions, then Drivers, Trucks, Stations, Other Charges)
 * mounts this beside the shell's strip.
 */
export default function CurrencySideSwitch({ side, onChange }: CurrencySideSwitchProps) {
  const { weekEntry } = useWeek();

  return (
    <div className="side-switch" role="group" aria-label="Invoice side">
      {SIDES.map((s) => {
        // Before the week resolves there is nothing to disable against.
        const missing = weekEntry !== null && invoiceOnSide(weekEntry, s) === null;
        return (
          <button
            key={s}
            type="button"
            className={`side-switch-option${side === s ? " active" : ""}`}
            aria-pressed={side === s}
            disabled={missing}
            title={missing ? "Not imported" : undefined}
            onClick={() => onChange(s)}
          >
            <span role="img" aria-label={SIDE_LABELS[s]}>
              {SIDE_FLAGS[s]}
            </span>{" "}
            {SIDE_LABELS[s]}
            {missing && <span className="side-switch-missing"> · Not imported</span>}
          </button>
        );
      })}
    </div>
  );
}
