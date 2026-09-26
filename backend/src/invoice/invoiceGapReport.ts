import { findGaps, isoDateRange, type DateRange } from "../ingest/gapReport.js";

export interface InvoicePeriod {
  /** ISO date, inclusive — an invoice's own `periodStart`/`periodEnd`. */
  periodStart: string;
  periodEnd: string;
}

/** Every date covered by at least one invoice's period. Overlapping periods
 * (two invoices billing the same week, §A5) just double-cover those dates —
 * the union is what matters, not a count. */
function coveredDates(periods: readonly InvoicePeriod[]): Set<string> {
  const covered = new Set<string>();
  for (const period of periods) {
    for (const date of isoDateRange(period.periodStart, period.periodEnd)) {
      covered.add(date);
    }
  }
  return covered;
}

/**
 * Any date in `range` not covered by any invoice's period — the same rule as
 * v1's price-sheet gap report (`ingest/gapReport.ts`'s `findGaps`), reused
 * here rather than reimplemented: an invoice covers a range (usually a week)
 * instead of one day, so the dates it covers are unioned first, then checked
 * against `range` the same way. A week with no invoice at all falls out as
 * consecutive gap days — never interpolated.
 */
export function invoiceGaps(periods: readonly InvoicePeriod[], range: DateRange): string[] {
  return findGaps(coveredDates(periods), range);
}
