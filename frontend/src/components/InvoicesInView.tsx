"use client";

import type { MouseEvent, ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWeek } from "../hooks/useWeek";
import {
  ALL_INVOICES,
  SIDES,
  SIDE_FLAGS,
  SIDE_LABELS,
  actualRange,
  formatCompactRange,
  formatDatesDifferNote,
  invoiceOnSide,
  invoiceViewHref,
} from "../lib/weeks";

export type ChipState = "in-view" | "not-in-view" | "not-imported" | "available";

/** A present invoice is *in view* when the screen's figures come from it, *not in
 * view* otherwise, and merely *available* when the screen reads no invoice
 * figures at all (`inViewIds` null). */
export function chipState(invoiceId: string | null, inViewIds: readonly string[] | null): ChipState {
  if (invoiceId === null) return "not-imported";
  if (inViewIds === null) return "available";
  return inViewIds.includes(invoiceId) ? "in-view" : "not-in-view";
}

/**
 * The shell-level "Invoices in view" strip (T-64, D26/D28) — every invoice in the
 * selected week, and the picker for which of them Transactions shows. A chip
 * opens that invoice on Transactions; "All invoices" (when the week has more than
 * one) shows every one together. The highlighted chips are the invoices the
 * screen's figures actually came from, published by the same hook that builds the
 * request, so the strip cannot say one thing while the page fetches another.
 * Rendered by `TopBar` under the bar, hidden with the selector on Plan screens.
 */
export default function InvoicesInView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { week, weekEntry, inViewIds } = useWeek();
  if (weekEntry === null || week === null) return null;

  const link = (key: string, value: string, state: ChipState, extra: Record<string, string>, children: ReactNode) => {
    const target = invoiceViewHref(pathname, searchParams, week, value);
    const open = (e: MouseEvent) => {
      e.preventDefault();
      router.push(target);
    };
    return (
      <a key={key} className="invoice-chip" data-state={state} href={target} onClick={open} {...extra}>
        {children}
      </a>
    );
  };

  const allIds = weekEntry.invoices.map((invoice) => invoice.id);
  const allInView = inViewIds !== null && allIds.length > 1 && allIds.every((id) => inViewIds.includes(id));

  return (
    <div className="invoices-in-view" data-testid="invoices-in-view">
      <span className="invoices-in-view-label">Invoices in view</span>
      {SIDES.map((side) => {
        const invoice = invoiceOnSide(weekEntry, side);
        const flag = (
          <span className="invoice-chip-flag" role="img" aria-label={SIDE_LABELS[side]}>
            {SIDE_FLAGS[side]}
          </span>
        );
        if (invoice === null) {
          return (
            <span key={side} className="invoice-chip" data-state="not-imported" data-side={side}>
              {flag} Not imported
            </span>
          );
        }
        const range = actualRange(invoice);
        const note = formatDatesDifferNote(invoice);
        return link(
          side,
          invoice.id,
          chipState(invoice.id, inViewIds),
          { "data-side": side },
          <>
            {flag} {invoice.invoiceNumber} · {formatCompactRange(range.start, range.end)}
            {invoice.datesDiffer && (
              <span className="invoice-chip-warn" title={note} role="img" aria-label={note}>
                ⚠
              </span>
            )}
          </>,
        );
      })}
      {allIds.length > 1 &&
        link(
          "all",
          ALL_INVOICES,
          inViewIds === null ? "available" : allInView ? "in-view" : "not-in-view",
          { "data-all": "true" },
          <>All invoices</>,
        )}
    </div>
  );
}
