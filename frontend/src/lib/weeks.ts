/**
 * Labels and lookups over `GET /periods` (T-64, D26). Pure — the week
 * selector, the "Invoices in view" strip and the Import screen's mismatch
 * note all format a billing week and its invoices the same way.
 */
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";

export type CurrencySide = "USD" | "CAD";

export const SIDES: readonly CurrencySide[] = ["USD", "CAD"];

export const SIDE_LABELS: Record<CurrencySide, string> = { USD: "US", CAD: "CA" };

/**
 * The spec's emoji flags (A9). Windows has no flag glyphs in Segoe UI Emoji, so
 * there they draw as the letters "US" / "CA" — which still reads correctly
 * beside a number. Every flag in the UI comes from here, so a different mark
 * is a one-line change.
 */
export const SIDE_FLAGS: Record<CurrencySide, string> = { USD: "🇺🇸", CAD: "🇨🇦" };

/** The invoice fields a range label needs — a `PeriodInvoice` and an `InvoiceListItem` both fit. */
export interface InvoiceRange {
  printedStart: string;
  printedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(iso: string): { year: number; month: string; monthIndex: number; day: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y!, month: MONTHS[m! - 1]!, monthIndex: m! - 1, day: d! };
}

/** `2026-09-03` -> `"Sep 3"`. */
export function formatDay(iso: string): string {
  const p = parts(iso);
  return `${p.month} ${p.day}`;
}

/** `2026-09-09` -> `"Sep 9, 2026"`. */
export function formatDayYear(iso: string): string {
  return `${formatDay(iso)}, ${parts(iso).year}`;
}

/** `Sep 3–9` within a month, `Aug 30–Sep 5` across one — the strip's compact range. */
export function formatCompactRange(start: string, end: string): string {
  const s = parts(start);
  const e = parts(end);
  return s.monthIndex === e.monthIndex && s.year === e.year ? `${s.month} ${s.day}–${e.day}` : `${formatDay(start)}–${formatDay(end)}`;
}

/** `"Week ending Sep 9, 2026"`. */
export function formatWeekEnding(weekEnd: string): string {
  return `Week ending ${formatDayYear(weekEnd)}`;
}

/** The range the transactions actually ran; the printed one for a file with none. */
export function actualRange(invoice: InvoiceRange): { start: string; end: string } {
  return { start: invoice.actualStart ?? invoice.printedStart, end: invoice.actualEnd ?? invoice.printedEnd };
}

/** The amber note's text: `Printed Aug 1 – Sep 9; transactions Sep 3 – Sep 10`. */
export function formatDatesDifferNote(invoice: InvoiceRange): string {
  const actual = actualRange(invoice);
  return `Printed ${formatDay(invoice.printedStart)} – ${formatDay(invoice.printedEnd)}; transactions ${formatDay(actual.start)} – ${formatDay(actual.end)}`;
}

export function invoiceOnSide(week: PeriodWeek | null | undefined, side: CurrencySide): PeriodInvoice | null {
  return week?.invoices.find((invoice) => invoice.currency === side) ?? null;
}

/**
 * The side a screen should actually read: the one asked for, unless the week
 * has no invoice on it, in which case the other side if that one is imported.
 * A week with neither (or no week) keeps the request, so the screen asks and
 * gets an empty answer instead of guessing.
 */
export function effectiveSide(week: PeriodWeek | null | undefined, requested: CurrencySide): CurrencySide {
  if (invoiceOnSide(week, requested)) return requested;
  const other: CurrencySide = requested === "USD" ? "CAD" : "USD";
  return invoiceOnSide(week, other) ? other : requested;
}
