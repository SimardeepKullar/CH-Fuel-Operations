/**
 * Invoice timestamps (`occurredAt` on a fuel stop or express row) are BVD's
 * printed wall clock, stored as that instant in UTC — the invoice prints no
 * zone (`importInvoice.ts`'s `asUtcTimestamp`). They are formatted here, in
 * UTC, so `2026-09-08 23:50:28` reads `Sep 8 · 11:50 PM` wherever the
 * dispatcher sits. Formatting one in the viewer's zone shifts it by the
 * zone's offset and can move it to the previous day (T-81).
 *
 * This is for printed times only. A moment the app itself recorded —
 * `importedAt`, `fxEnteredAt`, a plan's `createdAt` — is a real instant and
 * renders in the viewer's zone, where it is formatted.
 */

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const WEEKDAY_DATE = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

/** `Sep 8`. */
export function printedDate(iso: string): string {
  return DATE.format(new Date(iso));
}

/** `Wed Sep 9`. */
export function printedWeekdayDate(iso: string): string {
  return WEEKDAY_DATE.format(new Date(iso)).replace(",", "");
}

/** `11:50 PM`. */
export function printedTime(iso: string): string {
  return TIME.format(new Date(iso));
}

/** The printed calendar day, `YYYY-MM-DD`. */
export function printedDayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** `9/9` — the printed day as a dispatcher types it into a search. */
export function printedMonthDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
