"use client";

import { useState } from "react";
import Link from "next/link";
import type { InvoiceFx } from "@ch/core/api/routes/invoices";
import { useFxRateDraft } from "../hooks/useFxRateDraft";
import { formatFxEnteredAt } from "../lib/conversion";
import Dialog from "./Dialog";

interface FxRateDialogProps {
  invoiceId: string;
  invoiceNumber: string;
  /** The billing week the invoice landed in — where "View week" goes. */
  billingWeekEnd: string;
  /** The rate the invoice already carries (e.g. from the CLI's `--fx-rate`). */
  fx: InvoiceFx | null;
  /** After a save: re-read the shell's weeks, so every screen sees the rate without a reload. */
  onSaved: () => Promise<void> | void;
  onClose: () => void;
}

/**
 * The prompt after a US invoice imports (T-67, D27): the person importing it knows the rate it
 * settled at. Optional — the import has already committed, "Enter later" leaves the invoice at
 * "rate pending" and PATCHes nothing. After a save it shows the rate and when it was entered,
 * with a link to that week's Overview; Done closes it.
 */
export default function FxRateDialog({ invoiceId, invoiceNumber, billingWeekEnd, fx: initial, onSaved, onClose }: FxRateDialogProps) {
  const { fx, draft, setDraft, dirty, saving, error, save } = useFxRateDraft({ invoiceId, fx: initial, onSaved });
  const [didSave, setDidSave] = useState(false);
  const title = `Exchange rate (CAD per USD) for 🇺🇸 ${invoiceNumber}`;

  if (didSave) {
    return (
      <Dialog label={title} className="fx-dialog" testId="fx-dialog" onClose={onClose}>
        <h2 className="ov-section-title">{title}</h2>
        <p className="fx-dialog-line" data-testid="fx-dialog-saved">
          {fx === null
            ? "Rate cleared — this invoice is back to rate pending."
            : `${fx.rate} CAD per USD · entered ${formatFxEnteredAt(fx.enteredAt)}`}
        </p>
        <div className="fx-dialog-actions">
          <Link className="btn btn-ghost" href={`/overview?scope=week&w=${billingWeekEnd}`}>
            View this week on the Overview →
          </Link>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog label={title} className="fx-dialog" testId="fx-dialog" onClose={onClose}>
      <h2 className="ov-section-title">{title}</h2>
      <p className="fx-dialog-line">
        The invoice is imported. The rate converts its figures to CAD and litres; you can also enter it later from the Import history or the Overview.
      </p>
      {fx !== null && (
        <p className="fx-dialog-line" data-testid="fx-dialog-current">
          Currently {fx.rate} · entered {formatFxEnteredAt(fx.enteredAt)}
        </p>
      )}
      <label className="fx-rate-label">
        <span>Exchange rate (CAD per USD)</span>
        <input
          type="text"
          inputMode="decimal"
          className="input fx-rate-input"
          placeholder="e.g. 1.3712"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (dirty) void save().then((ok) => ok && setDidSave(true));
            }
          }}
        />
      </label>
      {error !== null && (
        <span className="fx-rate-error" role="alert">
          {error}
        </span>
      )}
      <div className="fx-dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Enter later
        </button>
        <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save().then((ok) => ok && setDidSave(true))}>
          {saving ? "Saving…" : "Save rate"}
        </button>
      </div>
    </Dialog>
  );
}
