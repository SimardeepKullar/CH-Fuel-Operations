/** One assignment of a single driver, with calendar dates as `YYYY-MM-DD`. */
export interface DatedTruck {
  truckId: string;
  effectiveFrom: string;
  /** Inclusive; `null` means current. */
  effectiveTo: string | null;
}

/** An inclusive run of days; `to: null` is open-ended ("to the last stop"). */
export interface DateWindow {
  from: string;
  to: string | null;
}

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

function dayString(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function truckOn(rows: readonly DatedTruck[], day: number): string | null {
  for (const r of rows) {
    if (dayNumber(r.effectiveFrom) <= day && (r.effectiveTo === null || dayNumber(r.effectiveTo) >= day)) {
      return r.truckId;
    }
  }
  return null;
}

/**
 * The days on which a driver's resolved truck differs between two sets of
 * their assignments, as one window from the first differing day to the last
 * (open-ended when the last differing day is). `null` when none differ.
 *
 * Resolution is by date, so a stop outside the window cannot change — which is
 * why a write re-resolves only this window, and why a reassignment from day D
 * leaves every earlier stop where it was (T-78). Compares the truck *on each
 * day*, not the rows, so a row whose dates moved but whose days still resolve
 * to the same truck touches nothing.
 *
 * Pure — no database, no HTTP, no clock.
 */
export function changedWindow(
  before: readonly DatedTruck[],
  after: readonly DatedTruck[],
): DateWindow | null {
  // The truck on a day only changes at a row's first day or the day after its
  // last, so comparing at each such breakpoint (and carrying the answer to the
  // next) covers every day.
  const breakpoints = new Set<number>();
  for (const r of [...before, ...after]) {
    breakpoints.add(dayNumber(r.effectiveFrom));
    if (r.effectiveTo !== null) {
      breakpoints.add(dayNumber(r.effectiveTo) + 1);
    }
  }
  const starts = [...breakpoints].sort((a, b) => a - b);

  let first: number | null = null;
  let last: number | null = null; // `Infinity` while the last differing run is open
  for (const [i, start] of starts.entries()) {
    if (truckOn(before, start) === truckOn(after, start)) {
      continue;
    }
    const next = starts[i + 1];
    first ??= start;
    last = next === undefined ? Infinity : next - 1;
  }

  if (first === null || last === null) {
    return null;
  }
  return { from: dayString(first), to: last === Infinity ? null : dayString(last) };
}
