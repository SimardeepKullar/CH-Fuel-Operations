"use client";

import { useState } from "react";
import type { InvoiceFx } from "@ch/core/api/routes/invoices";
import type { PeriodInvoice } from "@ch/core/api/routes/periods";
import { ApiError, patchInvoiceFx } from "../lib/api";

/** `2026-10-06T14:05:00Z` -> `"Oct 6, 2026, 10:05 AM"`, in the dispatcher's own time zone. */
export function formatFxEnteredAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A plain decimal, as typed — `Number("")` is 0 and `Number("0x1")` is 1, so `Number` alone won't do. */
const DECIMAL = /^\d+(\.\d+)?$/;

interface ExchangeRateFieldProps {
  /** The selected week's CA invoice — the only kind that carries a rate. */
  invoice: PeriodInvoice;
  /** After a save: re-read the shell's weeks, so every screen sees the new rate without a reload. */
  onSaved: () => Promise<void> | void;
}

/**
 * The exchange rate on a CA invoice, as the dispatcher enters it (T-66, D27):
 * CAD per 1 USD, shown with when it was entered, or "rate pending". The box can
 * be changed at any time — Enter, or leaving it, saves through `PATCH
 * /invoices/{id}`, and emptying it clears the rate back to pending. Nothing
 * converted is stored, so every screen re-converts at the new rate on its next
 * read. A 400's reason shows beside the field.
 */
export default function ExchangeRateField({ invoice, onSaved }: ExchangeRateFieldProps) {
  const [fx, setFx] = useState<InvoiceFx | null>(invoice.fx);
  const [draft, setDraft] = useState(invoice.fx === null ? "" : String(invoice.fx.rate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    const text = draft.trim();
    if (text === (fx === null ? "" : String(fx.rate))) {
      setError(null);
      return;
    }
    if (text !== "" && !DECIMAL.test(text)) {
      setError("Enter the rate as a number, e.g. 1.3712");
      return;
    }
    const rate = text === "" ? null : Number(text);
    setSaving(true);
    setError(null);
    try {
      const updated = await patchInvoiceFx(invoice.id, rate);
      setFx(updated.fx);
      setDraft(updated.fx === null ? "" : String(updated.fx.rate));
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

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
          onBlur={() => void save()}
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
            ? `rate pending — enter the rate for 🇨🇦 ${invoice.invoiceNumber}`
            : `${fx.rate} CAD per USD for 🇨🇦 ${invoice.invoiceNumber} · entered ${formatFxEnteredAt(fx.enteredAt)}`}
      </span>
      {error !== null && (
        <span className="fx-rate-error" role="alert" data-testid="fx-rate-error">
          {error}
        </span>
      )}
    </div>
  );
}
