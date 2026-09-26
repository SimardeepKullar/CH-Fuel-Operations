export interface DateRange {
  /** ISO date (yyyy-mm-dd), inclusive. */
  start: string;
  /** ISO date (yyyy-mm-dd), inclusive. */
  end: string;
}

function parseIsoDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1));
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `date` shifted by `days`, as an ISO date. Calendar-correct across month
 * and year boundaries because the arithmetic runs in UTC. */
export function addIsoDays(date: string, days: number): string {
  const shifted = parseIsoDate(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return formatIsoDate(shifted);
}

/** Every ISO date from `start` to `end`, inclusive, in order. */
export function isoDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = parseIsoDate(start);
  const endDate = parseIsoDate(end);
  while (cursor.getTime() <= endDate.getTime()) {
    dates.push(formatIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Any date in `range` absent from `presentDates`. This is why `valid_on` is
 * a plain date rather than "valid until superseded" (BUILD-PLAN 7.2) — a
 * carried-forward stale price would hide exactly the gap this reports.
 */
export function findGaps(presentDates: Iterable<string>, range: DateRange): string[] {
  const present = new Set(presentDates);
  return isoDateRange(range.start, range.end).filter((date) => !present.has(date));
}
