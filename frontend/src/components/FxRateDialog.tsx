"use client";

import type { InvoiceFx } from "@ch/core/api/routes/invoices";
import { useFxRateDraft } from "../hooks/useFxRateDraft";
import { formatFxEnteredAt } from "../lib/conversion";
import Dialog from "./Dialog";
import { CodeBadge } from "./SubStrip";

interface FxRateDialogProps {
  invoiceId: string;
  invoiceNumber: string;
  /** The rate the invoice already carries (e.g. from the CLI's `--fx-rate`). */
  fx: InvoiceFx | null;
  /** After a save: re-read the shell's weeks and the history list, so every screen shows the rate without a reload. */
  onSaved: () => Promise<void> | void;
  onClose: () => void;
}

/**
 * The prompt after a US invoice imports (T-67, D27): the person importing it knows the rate it
 * settled at. Optional — the import has already committed, "Enter later" leaves the invoice at
 * "rate pending" and PATCHes nothing. A successful save closes it; the saved rate and when it was
 * entered are then in the Import history row, so there is no confirmation screen.
 */
export default function FxRateDialog({ invoiceId, invoiceNumber, fx: initial, onSaved, onClose }: FxRateDialogProps) {
  const { fx, draft, setDraft, dirty, saving, error, save } = useFxRateDraft({ invoiceId, fx: initial, onSaved });
  const saveAndClose = () => void save().then((ok) => ok && onClose());

  return (
    <Dialog label={`Exchange rate (CAD per USD) for US ${invoiceNumber}`} className="fx-dialog" testId="fx-dialog" onClose={onClose}>
      <h2 className="ov-section-title">Exchange rate (CAD per USD)</h2>
      <p className="fx-dialog-invoice-line">
        Invoice <CodeBadge code="US" />
        <span className="fx-dialog-invoice" data-testid="fx-dialog-invoice">
          {invoiceNumber}
        </span>
      </p>
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
              if (dirty) saveAndClose();
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
        <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
          Enter later
        </button>
        <button type="button" className="btn btn-primary btn-square" disabled={!dirty || saving} onClick={saveAndClose}>
          {saving ? "Saving…" : "Save rate"}
        </button>
      </div>
    </Dialog>
  );
}
