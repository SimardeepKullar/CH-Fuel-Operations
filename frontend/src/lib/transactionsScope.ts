/**
 * Transactions' view of the Overview's scope (T-74). The URL carries the same
 * keys (`scope`, `w`, `from`, `to`) plus `currency` for one side; with no `scope`
 * at all the screen keeps what it always did — the shell's selected billing week.
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
