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
  /** `Sep 8`. */
  date: string;
  /** 24-hour, as BVD prints it: `23:50`. */
  time: string;
  /** `2026-09-08` — the Receipt Queue's day filter and grouping key. */
  dayKey: string;
  /** `9/8` — the date as a dispatcher types it into a search. */
  monthDay: string;
  /** `2026-09-08 23:50:28` — the full printed value, for a tooltip. */
  full: string;
}

export function printedAt(iso: string): PrintedAt {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return {
    date: `${MONTHS[month - 1]} ${day}`,
    time: iso.slice(11, 16),
    dayKey: iso.slice(0, 10),
    monthDay: `${month}/${day}`,
    full: `${iso.slice(0, 10)} ${iso.slice(11, 19)}`,
  };
}
