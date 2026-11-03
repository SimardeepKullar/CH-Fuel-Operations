"use client";

import { useEffect, useState } from "react";
import type { InvoiceFx } from "@ch/core/api/routes/invoices";
import { ApiError, patchInvoiceFx } from "../lib/api";

/** A plain decimal, as typed — `Number("")` is 0 and `Number("0x1")` is 1, so `Number` alone won't do. */
const DECIMAL = /^\d+(\.\d+)?$/;

const textOf = (fx: InvoiceFx | null): string => (fx === null ? "" : String(fx.rate));

interface UseFxRateDraftArgs {
  invoiceId: string;
  /** The rate the invoice carries now (`null` = "rate pending"). */
  fx: InvoiceFx | null;
  /** After a save: re-read the shell's weeks, so every screen sees the new rate without a reload. */
  onSaved: () => Promise<void> | void;
}

/**
 * The draft, validation and save of one US invoice's exchange rate (T-66, T-67, D27) — shared by
 * the Overview's field, the post-import dialog and the import history's cell, so the three can
 * not drift. A plain decimal; an empty box clears the rate back to "rate pending"; saving goes
 * through `PATCH /invoices/{id}`, and the API's 400 reason is kept in `error` while the typed
 * text stays. A draft equal to the saved value is never sent.
 */
export function useFxRateDraft({ invoiceId, fx: fxProp, onSaved }: UseFxRateDraftArgs) {
  const [fx, setFx] = useState<InvoiceFx | null>(fxProp);
  const [draft, setDraft] = useState(textOf(fxProp));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The invoice re-read with another rate (a save elsewhere, a reload): follow it.
  const propRate = fxProp?.rate ?? null;
  const propEnteredAt = fxProp?.enteredAt ?? null;
  useEffect(() => {
    setFx(fxProp);
    setDraft(textOf(fxProp));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the rate's value, not the object's identity
  }, [propRate, propEnteredAt]);

  const dirty = draft.trim() !== textOf(fx);

  /** Resolves `true` when a PATCH went through; `false` when nothing was sent or the API refused. */
  async function save(): Promise<boolean> {
    if (saving) return false;
    const text = draft.trim();
    if (text === textOf(fx)) {
      setError(null);
      return false;
    }
    if (text !== "" && !DECIMAL.test(text)) {
      setError("Enter the rate as a number, e.g. 1.3712");
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await patchInvoiceFx(invoiceId, text === "" ? null : Number(text));
      setFx(updated.fx);
      setDraft(textOf(updated.fx));
      await onSaved();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { fx, draft, setDraft, dirty, saving, error, save };
}
