"use client";

import type { PeriodInvoice } from "@ch/core/api/routes/periods";
import { useFxRateDraft } from "../hooks/useFxRateDraft";
import { formatFxEnteredAt } from "../lib/conversion";

interface ExchangeRateFieldProps {
  /** The week's US invoice — the only kind that carries a rate (T-68). */
  invoice: PeriodInvoice;
  /** After a save: re-read the shell's weeks, so every screen sees the new rate without a reload. */
  onSaved: () => Promise<void> | void;
}

/**
 * The exchange rate on a US invoice, as the dispatcher enters it (T-66, T-68, D27):
 * CAD per 1 USD, shown with when it was entered, or "rate pending". The box can
 * be changed at any time — Enter saves through `PATCH
 * /invoices/{id}` (leaving the box does not, as in the Import history, T-67), and emptying it clears the rate back to pending. Nothing
 * converted is stored, so every screen re-converts at the new rate on its next
 * read. A 400's reason shows beside the field.
 */
export default function ExchangeRateField({ invoice, onSaved }: ExchangeRateFieldProps) {
  const { fx, draft, setDraft, saving, error, save } = useFxRateDraft({ invoiceId: invoice.id, fx: invoice.fx, onSaved });

  return (
    <div className="panel-card fx-rate" data-testid="fx-rate">
      <label className="fx-rate-label">
        <span>Exchange rate (CAD per USD)</span>
        <input
          type="text"
          inputMode="decimal"
          className="input fx-rate-input"
          placeholder="e.g. 1.3712"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
        />
      </label>
      <span className="fx-rate-status" data-testid="fx-rate-status">
        {saving
          ? "Saving…"
          : fx === null
            ? `rate pending — enter the rate for 🇺🇸 ${invoice.invoiceNumber}`
            : `${fx.rate} CAD per USD for 🇺🇸 ${invoice.invoiceNumber} · entered ${formatFxEnteredAt(fx.enteredAt)}`}
      </span>
      {error !== null && (
        <span className="fx-rate-error" role="alert" data-testid="fx-rate-error">
          {error}
        </span>
      )}
    </div>
  );
}
