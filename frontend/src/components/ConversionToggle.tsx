"use client";

import { DISPLAY_CHOICES, type DisplayChoice } from "../lib/conversion";

interface ConversionToggleProps {
  /** What the screen is showing: the chosen conversion, or — with none chosen —
   * the invoice's own (`USD/gal` for a US invoice, `CAD/L` for a CA one). `null`
   * when nothing is chosen and the rows are in more than one (All invoices). */
  shown: DisplayChoice | null;
  onChange: (choice: DisplayChoice) => void;
}

/**
 * The Transactions screen's one conversion control (T-64): `USD/gal` and
 * `CAD/L`, applied to every row on screen. The pressed button is what is shown.
 */
export default function ConversionToggle({ shown, onChange }: ConversionToggleProps) {
  return (
    <div className="side-switch" role="group" aria-label="Show amounts in">
      {DISPLAY_CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          className={`side-switch-option${shown === choice ? " active" : ""}`}
          aria-pressed={shown === choice}
          onClick={() => onChange(choice)}
        >
          {choice}
        </button>
      ))}
    </div>
  );
}
