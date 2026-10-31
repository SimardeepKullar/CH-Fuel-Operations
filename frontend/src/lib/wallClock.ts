/**
 * Invoice timestamps (`occurredAt` on a fuel stop or express row) are BVD's
 * printed wall clock, stored as that instant in UTC — the invoice prints no
 * zone (`importInvoice.ts`'s `asUtcTimestamp`) — and the API sends them as
 * `2026-09-08T23:50:28.000Z`. The digits already are what the invoice
 * printed, so they are read as text and never pass through `Date` or `Intl`,
 * which would shift them into the viewer's zone (T-81).
 *
 * This is for printed times only. A moment the app itself recorded —
 * `importedAt`, `fxEnteredAt`, a plan's `createdAt` — is a real instant and
 * renders in the viewer's zone, where it is formatted.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface PrintedAt {
  /** `Sep 8, 2026`. */
  date: string;
  /** 24-hour with seconds, as BVD prints it: `23:50:28`. */
  time: string;
  /** `2026-09-08` — the Receipt Queue's day filter and grouping key. */
  dayKey: string;
  /** `9/8/2026` — the date as a dispatcher types it into a search (`9/8` matches it too). */
  slashDate: string;
  /** `2026-09-08 23:50:28` — the full printed value, for a tooltip. */
  full: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The `dateFrom` / `dateTo` a `From` / `To` day pair sends to `GET /transactions`
 * (T-83). A day is a printed day, so the bounds are UTC text — `T00:00:00Z` and
 * `T23:59:59.999Z` — and never a local `Date`. An empty or malformed day sends nothing.
 */
export function printedDayBounds(from: string, to: string): { dateFrom?: string; dateTo?: string } {
  return {
    ...(DAY.test(from) ? { dateFrom: `${from}T00:00:00Z` } : {}),
    ...(DAY.test(to) ? { dateTo: `${to}T23:59:59.999Z` } : {}),
  };
}

export function printedAt(iso: string): PrintedAt {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return {
    date: `${MONTHS[month - 1]} ${day}, ${iso.slice(0, 4)}`,
    time: iso.slice(11, 19),
    dayKey: iso.slice(0, 10),
    slashDate: `${month}/${day}/${iso.slice(0, 4)}`,
    full: `${iso.slice(0, 10)} ${iso.slice(11, 19)}`,
  };
}
