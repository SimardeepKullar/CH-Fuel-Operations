/**
 * The Overview's time scope (T-71): all time, one billing week, or a range of
 * billing weeks. Pure — the URL is the state, so this parses and writes it and
 * picks the weeks a scope covers; nothing here fetches or renders.
 *
 * URL shapes: `?scope=all`, `?scope=week&w=2026-09-09`,
 * `?scope=range&from=2026-08-12&to=2026-09-09` (billing week ends, D26). A
 * missing or unreadable scope is all time, the Overview's default.
 */

export type Scope =
  | { mode: "all" }
  | { mode: "week"; week: string }
  | { mode: "range"; from: string; to: string };

export type ScopeMode = Scope["mode"];

/** Weeks a range defaults to when the dispatcher first picks Range. */
export const DEFAULT_RANGE_WEEKS = 4;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The URL keys the scope owns, so a caller can clear them before writing another scope. */
export const SCOPE_PARAMS = ["scope", "w", "from", "to"] as const;

interface ParamReader {
  get(name: string): string | null;
}

function isDay(value: string | null): value is string {
  return value !== null && ISO_DAY.test(value);
}

/** Reads the scope off the URL. `weekEnds` is every billing week end, ascending; a week or range
 * that names nothing imported falls back to the nearest sensible scope rather than an empty page. */
export function parseScope(params: ParamReader, weekEnds: readonly string[]): Scope {
  const mode = params.get("scope");
  if (mode === "week") {
    const w = params.get("w");
    if (isDay(w) && weekEnds.includes(w)) return { mode: "week", week: w };
    return weekEnds.length === 0 ? { mode: "all" } : { mode: "week", week: weekEnds[weekEnds.length - 1]! };
  }
  if (mode === "range") {
    const from = params.get("from");
    const to = params.get("to");
    if (isDay(from) && isDay(to) && weekEnds.includes(from) && weekEnds.includes(to)) return normaliseRange(from, to);
    return defaultRange(weekEnds);
  }
  return { mode: "all" };
}

/** A reversed range is normalised: from is the earlier week, to the later. ISO days sort as text. */
export function normaliseRange(a: string, b: string): Scope {
  return a <= b ? { mode: "range", from: a, to: b } : { mode: "range", from: b, to: a };
}

/** The last four weeks (fewer if fewer are imported). */
export function defaultRange(weekEnds: readonly string[]): Scope {
  if (weekEnds.length === 0) return { mode: "all" };
  const last = weekEnds[weekEnds.length - 1]!;
  const first = weekEnds[Math.max(0, weekEnds.length - DEFAULT_RANGE_WEEKS)]!;
  return { mode: "range", from: first, to: last };
}

/** What choosing a mode in the segmented control selects: Week → the latest week, Range → the last four. */
export function scopeForMode(mode: ScopeMode, weekEnds: readonly string[]): Scope {
  if (mode === "all" || weekEnds.length === 0) return { mode: "all" };
  if (mode === "week") return { mode: "week", week: weekEnds[weekEnds.length - 1]! };
  return defaultRange(weekEnds);
}

/** The URL's query for a scope, without the leading `?`. */
export function scopeToQuery(scope: Scope): string {
  const q = new URLSearchParams();
  writeScope(q, scope);
  return q.toString();
}

/** Sets a scope's keys on `target`, clearing any other scope's first. Leaves unrelated keys alone. */
export function writeScope(target: URLSearchParams, scope: Scope): void {
  for (const key of SCOPE_PARAMS) target.delete(key);
  target.set("scope", scope.mode);
  if (scope.mode === "week") target.set("w", scope.week);
  if (scope.mode === "range") {
    target.set("from", scope.from);
    target.set("to", scope.to);
  }
}

/** The week ends a scope covers, ascending. `weekEnds` ascending. An unknown week yields none. */
export function weekEndsInScope(scope: Scope, weekEnds: readonly string[]): string[] {
  if (scope.mode === "all") return [...weekEnds];
  if (scope.mode === "week") return weekEnds.filter((w) => w === scope.week);
  const lo = scope.from <= scope.to ? scope.from : scope.to;
  const hi = scope.from <= scope.to ? scope.to : scope.from;
  return weekEnds.filter((w) => w >= lo && w <= hi);
}
