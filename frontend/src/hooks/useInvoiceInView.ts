"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { usePublishInView, useWeek } from "./useWeek";
import { INVOICE_PARAM, resolveInvoiceSelection, selectionInvoiceIds, type InvoiceSelection } from "../lib/weeks";

/**
 * Which of the selected week's invoices Transactions shows (T-64): one invoice,
 * picked from the "Invoices in view" strip, or all of them. Kept in the URL's
 * `invoice` param, so the strip's chips are plain links and a view is linkable.
 * Publishes the chosen ids to the shell — the strip highlights exactly the
 * invoices this selection asks the API for.
 */
export function useInvoiceInView(): InvoiceSelection {
  const { weekEntry } = useWeek();
  const param = useSearchParams().get(INVOICE_PARAM);
  const selection = useMemo(() => resolveInvoiceSelection(weekEntry, param), [weekEntry, param]);
  usePublishInView(weekEntry === null ? null : selectionInvoiceIds(selection));
  return selection;
}
