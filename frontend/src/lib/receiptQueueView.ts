import type { ReceiptQueueItem } from "@ch/core/actuals/receipts";
import type { ReceiptStatus } from "@ch/core/db/types";
import { printedAt } from "./wallClock";

export type QueueView = "check" | "confirmed" | "all";

export interface QueueFilters {
  q: string;
  driver: string;
  /** The printed `YYYY-MM-DD` (see `wallClock.ts`); "" is any day. */
  day: string;
  flaggedOnly: boolean;
  /** A BVD invoice number; "" is every invoice. */
  invoice: string;
}

export const NO_FILTERS: QueueFilters = { q: "", driver: "", day: "", flaggedOnly: false, invoice: "" };

/** A row as the screen sees it: the fetched item with this session's decision laid over its status. */
export interface QueueRow extends ReceiptQueueItem {
  status: ReceiptStatus;
}

export function driverName(item: ReceiptQueueItem): string {
  return item.driver.resolved ?? item.driver.raw;
}

export function truckName(item: ReceiptQueueItem): string {
  return item.truck.resolved ?? item.truck.raw;
}

export function stationLabel(item: ReceiptQueueItem): string {
  if (item.station === null) return "Unresolved";
  return `${item.station.name} · ${item.station.city}, ${item.station.state}`;
}

/** What a typed search is matched against: driver, truck, station, invoice number, and the row's date as "Oct 21, 2026", "10/21" and "2026-10-21", and its time. */
function haystack(row: QueueRow): string {
  return [
    driverName(row),
    row.driver.raw,
    truckName(row),
    row.truck.raw,
    `truck ${truckName(row)}`,
    stationLabel(row),
    row.invoiceNumber,
    printedAt(row.occurredAt).date,
    printedAt(row.occurredAt).slashDate,
    printedAt(row.occurredAt).full,
  ]
    .join(" ")
    .toLowerCase();
}

export function matchesFilters(row: QueueRow, f: QueueFilters): boolean {
  if (f.invoice !== "" && row.invoiceNumber !== f.invoice) return false;
  if (f.driver !== "" && driverName(row) !== f.driver) return false;
  if (f.day !== "" && printedAt(row.occurredAt).dayKey !== f.day) return false;
  if (f.flaggedOnly && !row.hasException) return false;
  const q = f.q.trim().toLowerCase();
  return q === "" || haystack(row).includes(q);
}

export function hasFilters(f: QueueFilters): boolean {
  return f.q.trim() !== "" || f.driver !== "" || f.day !== "" || f.flaggedOnly || f.invoice !== "";
}

/** The invoices the rows came from, each once, the one with the latest purchase first. */
export function invoiceOptions(rows: readonly QueueRow[]): { number: string; currency: QueueRow["currency"] }[] {
  const latest = new Map<string, QueueRow>();
  for (const row of rows) {
    const seen = latest.get(row.invoiceNumber);
    if (seen === undefined || row.occurredAt > seen.occurredAt) latest.set(row.invoiceNumber, row);
  }
  return [...latest.values()]
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
    .map((r) => ({ number: r.invoiceNumber, currency: r.currency }));
}

/**
 * The rows a view lists, newest first. "To check" is pending plus missing; a row in `kept` — decided
 * this session — stays listed there until the view or a filter changes, so rows do not jump away mid-run.
 */
export function visibleRows(rows: readonly QueueRow[], view: QueueView, f: QueueFilters, kept: ReadonlySet<string>): QueueRow[] {
  return rows
    .filter((r) => {
      if (view === "check" && r.status === "confirmed" && !kept.has(r.id)) return false;
      if (view === "confirmed" && r.status !== "confirmed") return false;
      return matchesFilters(r, f);
    })
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : a.id.localeCompare(b.id)));
}
