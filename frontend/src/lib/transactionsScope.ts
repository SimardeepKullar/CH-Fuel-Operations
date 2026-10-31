/**
 * Transactions' view of the Overview's scope (T-74). The URL carries the same
 * keys (`scope`, `w`, `from`, `to`) plus `currency` for one side; with no `scope`
 * at all the screen keeps what it always did — the shell's selected billing week.
 *
 * A range can also pin exact printed days (T-87). `from`/`to` stay billing week
 * ends, because that is what an Overview link carries, and `dayFrom`/`dayTo` narrow
 * inside them. The week keys always cover the days, so the request, the strip and
 * the filter options keep reading whole weeks.
 */
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";
import { parseScope, type Scope } from "./overviewScope";

export type SideChoice = "USD" | "CAD" | "all";

interface ParamReader {
  get(name: string): string | null;
  has(name: string): boolean;
}

/** The scope in force: the URL's, or the shell's week when the URL names none. */
export function transactionsScope(params: ParamReader, weekEndsAscending: readonly string[], shellWeek: string | null): Scope {
  if (params.has("scope")) return parseScope(params, weekEndsAscending);
  return shellWeek === null ? { mode: "all" } : { mode: "week", week: shellWeek };
}

export interface ScopeDays {
  from: string;
  to: string;
}

const NO_DAYS: ScopeDays = { from: "", to: "" };

/** The days pinned on a range. Any other scope has none, whatever the URL says. */
export function scopeDays(params: ParamReader, scope: Scope): ScopeDays {
  if (scope.mode !== "range") return NO_DAYS;
  return { from: params.get("dayFrom") ?? "", to: params.get("dayTo") ?? "" };
}

/** A reversed pair is swapped, as `normaliseRange` does for weeks. An empty side stays open. */
export function normaliseDays(from: string, to: string): ScopeDays {
  return from !== "" && to !== "" && from > to ? { from: to, to: from } : { from, to };
}

interface WeekSpan {
  weekEnd: string;
  /** The first and last transaction's day. */
  start: string;
  end: string;
}

/** The range of billing weeks whose transactions touch `days`, or `null` when none does. `weeks` ascending. */
export function rangeForDays(days: ScopeDays, weeks: readonly WeekSpan[]): Scope | null {
  const touching = weeks.filter((w) => (days.to === "" || w.start <= days.to) && (days.from === "" || w.end >= days.from));
  if (touching.length === 0) return null;
  return { mode: "range", from: touching[0]!.weekEnd, to: touching[touching.length - 1]!.weekEnd };
}

/** The list endpoint's week filter for a scope: one week, a range, or nothing (all time). */
export function scopeQuery(scope: Scope): { week?: string; weekFrom?: string; weekTo?: string } {
  if (scope.mode === "week") return { week: scope.week };
  if (scope.mode === "range") return { weekFrom: scope.from, weekTo: scope.to };
  return {};
}

/** The week the filter dropdowns and the "enter rate" link read from: the scope's own, or its latest. */
export function anchorWeek(scope: Scope, weekEndsAscending: readonly string[]): string | null {
  if (scope.mode === "week") return scope.week;
  if (scope.mode === "range") return scope.to;
  return weekEndsAscending[weekEndsAscending.length - 1] ?? null;
}

/**
 * Which side Transactions shows. `?currency=USD|CAD|all` wins; an old `?invoice=<id>` link
 * means that invoice's side. With neither, a single week shows its first invoice (USD before
 * CAD, D28) as it always did, and a range or all time shows both sides.
 */
export function resolveSide(scope: Scope, currencyParam: string | null, invoiceParam: string | null, weeks: readonly PeriodWeek[]): SideChoice {
  if (currencyParam === "USD" || currencyParam === "CAD" || currencyParam === "all") return currencyParam;
  const all: PeriodInvoice[] = weeks.flatMap((w) => w.invoices);
  const legacy = invoiceParam === null || invoiceParam === "all" ? undefined : all.find((i) => i.id === invoiceParam);
  if (legacy !== undefined) return legacy.currency;
  if (invoiceParam === "all") return "all";
  if (scope.mode === "week") {
    const week = weeks.find((w) => w.weekEnd === scope.week);
    return week?.invoices[0]?.currency ?? "all";
  }
  return "all";
}
