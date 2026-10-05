"use client";

import type { MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { useWeek } from "../hooks/useWeek";
import {
  SIDES,
  SIDE_FLAGS,
  SIDE_LABELS,
  actualRange,
  formatCompactRange,
  formatDatesDifferNote,
  invoiceOnSide,
  type CurrencySide,
} from "../lib/weeks";

/** Where a chip opens: that invoice, highlighted in Import history (A8.2). */
export function invoiceHistoryHref(invoiceId: string): string {
  return `/import?invoice=${encodeURIComponent(invoiceId)}`;
}

export type ChipState = "in-view" | "not-in-view" | "not-imported" | "available";

/** A present invoice is *in view* when it is the side the screen reads, *not in
 * view* when it is the other side of the switch, and merely *available* when
 * the screen reads no invoice figures at all (`viewSide` null). */
export function chipState(present: boolean, side: CurrencySide, viewSide: CurrencySide | null): ChipState {
  if (!present) return "not-imported";
  if (viewSide === null) return "available";
  return viewSide === side ? "in-view" : "not-in-view";
}

/**
 * The shell-level "Invoices in view" strip (T-64, D26/D28): one chip per side of
 * the selected week, so a figure on screen is never ambiguous about which
 * invoice it came from. The highlighted chip is the side the screen is reading
 * — `viewSide`, published by the same hook that picks the request's
 * `currency`, so the strip cannot say one thing while the page fetches another.
 * Rendered by `TopBar` under the bar, hidden with the selector on Plan screens.
 */
export default function InvoicesInView() {
  const router = useRouter();
  const { weekEntry, viewSide } = useWeek();
  if (weekEntry === null) return null;

  return (
    <div className="invoices-in-view" data-testid="invoices-in-view">
      <span className="invoices-in-view-label">Invoices in view</span>
      {SIDES.map((side) => {
        const invoice = invoiceOnSide(weekEntry, side);
        const state = chipState(invoice !== null, side, viewSide);
        const flag = (
          <span className="invoice-chip-flag" role="img" aria-label={SIDE_LABELS[side]}>
            {SIDE_FLAGS[side]}
          </span>
        );
        if (invoice === null) {
          return (
            <span key={side} className="invoice-chip" data-state={state} data-side={side}>
              {flag} Not imported
            </span>
          );
        }
        const range = actualRange(invoice);
        const href = invoiceHistoryHref(invoice.id);
        const open = (e: MouseEvent) => {
          e.preventDefault();
          router.push(href);
        };
        return (
          <a key={side} className="invoice-chip" data-state={state} data-side={side} href={href} onClick={open}>
            {flag} {invoice.invoiceNumber} · {formatCompactRange(range.start, range.end)}
            {invoice.datesDiffer && (
              <span className="invoice-chip-warn" title={formatDatesDifferNote(invoice)} role="img" aria-label={formatDatesDifferNote(invoice)}>
                ⚠
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}
