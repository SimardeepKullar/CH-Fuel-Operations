import { findGaps, isoDateRange, type DateRange } from "../ingest/gapReport.js";
import type { InvoiceCurrency } from "../db/types.js";

/** An inclusive run of dates an invoice actually carries transactions for. */
export interface CoveredRange {
  /** ISO date, inclusive. */
  start: string;
  end: string;
}

/** Every date covered by at least one range. Overlapping ranges just
 * double-cover those dates — the union is what matters, not a count. */
function coveredDates(ranges: readonly CoveredRange[]): Set<string> {
  const covered = new Set<string>();
  for (const range of ranges) {
    for (const date of isoDateRange(range.start, range.end)) {
      covered.add(date);
    }
  }
  return covered;
}

/**
 * Any date in `range` not covered by any of `ranges` — the same rule as v1's
 * price-sheet gap report (`ingest/gapReport.ts`'s `findGaps`), reused here
 * rather than reimplemented: an invoice covers a range (usually a week)
 * instead of one day, so the dates it covers are unioned first, then checked
 * against `range` the same way. A week with no invoice at all falls out as
 * consecutive gap days — never interpolated.
 *
 * The ranges are what the invoices *carry*: their first and last transaction
 * date (T-63, D26), not the period BVD printed. 999217 prints Aug 1 – Sep 9
 * and its transactions run Sep 3 – Sep 10, so Aug 1 – Sep 2 is a gap.
 */
export function invoiceGaps(ranges: readonly CoveredRange[], range: DateRange): string[] {
  return findGaps(coveredDates(ranges), range);
}

export interface GapInvoice {
  currency: InvoiceCurrency;
  /** An invoice's actual range; `null` for one with no transactions, which covers nothing. */
  actualStart: string | null;
  actualEnd: string | null;
}

export interface CurrencyGaps {
  currency: InvoiceCurrency;
  /** From this side's earliest actual start to its latest actual end. */
  range: DateRange;
  gaps: string[];
}

/**
 * Coverage per currency: a US invoice never covers a day for the CA side, so
 * each currency is judged against its own invoices' actual ranges and its own
 * span (D26). Sides with no invoice that carries a transaction are absent,
 * never an empty or fully-gapped entry. USD first, then CAD.
 */
export function invoiceGapsByCurrency(invoices: readonly GapInvoice[]): CurrencyGaps[] {
  const result: CurrencyGaps[] = [];
  for (const currency of ["USD", "CAD"] as const) {
    const ranges: CoveredRange[] = [];
    for (const invoice of invoices) {
      if (invoice.currency === currency && invoice.actualStart !== null && invoice.actualEnd !== null) {
        ranges.push({ start: invoice.actualStart, end: invoice.actualEnd });
      }
    }
    if (ranges.length === 0) {
      continue;
    }
    const start = ranges.reduce((min, r) => (r.start < min ? r.start : min), ranges[0]!.start);
    const end = ranges.reduce((max, r) => (r.end > max ? r.end : max), ranges[0]!.end);
    result.push({ currency, range: { start, end }, gaps: invoiceGaps(ranges, { start, end }) });
  }
  return result;
}
