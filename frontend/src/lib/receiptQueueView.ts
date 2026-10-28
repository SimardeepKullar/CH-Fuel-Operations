import type { ReceiptQueueItem } from "@ch/core/actuals/receipts";
import type { ReceiptStatus } from "@ch/core/db/types";

export type QueueView = "check" | "confirmed" | "all";

export interface QueueFilters {
  q: string;
  driver: string;
  /** A local `YYYY-MM-DD`; "" is any day. */
  day: string;
  flaggedOnly: boolean;
}

export const NO_FILTERS: QueueFilters = { q: "", driver: "", day: "", flaggedOnly: false };

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

/** The dispatcher's local calendar day, `YYYY-MM-DD` — the same clock the row's time prints in. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** `Wed Oct 21`. */
export function formatQueueDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(iso)).replace(",", "");
}

/** `3:30 PM`. */
export function formatQueueTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function stationLabel(item: ReceiptQueueItem): string {
  if (item.station === null) return "Unresolved";
  return `${item.station.name} · ${item.station.city}, ${item.station.state}`;
}

/** What a typed search is matched against: driver, truck, station, invoice number, and the row's date as "Oct 21" and "10/21". */
function haystack(row: QueueRow): string {
  const d = new Date(row.occurredAt);
  return [
    driverName(row),
    row.driver.raw,
    truckName(row),
    row.truck.raw,
    `truck ${truckName(row)}`,
    stationLabel(row),
    row.invoiceNumber,
    formatQueueDay(row.occurredAt),
    `${d.getMonth() + 1}/${d.getDate()}`,
  ]
    .join(" ")
    .toLowerCase();
}

export function matchesFilters(row: QueueRow, f: QueueFilters): boolean {
  if (f.driver !== "" && driverName(row) !== f.driver) return false;
  if (f.day !== "" && localDay(row.occurredAt) !== f.day) return false;
  if (f.flaggedOnly && !row.hasException) return false;
  const q = f.q.trim().toLowerCase();
  return q === "" || haystack(row).includes(q);
}

export function hasFilters(f: QueueFilters): boolean {
  return f.q.trim() !== "" || f.driver !== "" || f.day !== "" || f.flaggedOnly;
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
