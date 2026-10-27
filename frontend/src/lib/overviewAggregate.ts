/**
 * The Overview's aggregation over any list of billing weeks (T-70/T-71).
 * Pure and currency-honest: each side stays in what BVD billed (US in USD and
 * gallons, CA in CAD incl. HST and litres) and is only ever added to its own
 * side. Rules, from the design hand-off:
 *
 * - Money and quantities are sums over the weeks in scope.
 * - Prices are weighted, Σ$ / Σqty — never a mean of weekly prices.
 * - A week with no fuel is `null`, never 0, and `null` never breaks a sum.
 * - Conversion and the combined figures use only weeks that have a rate, each
 *   at its own rate. No rate is never a 1.0 rate.
 * - The rate shown is the mean of the covered weeks' rates, for display only.
 */

import type {
  OverviewWeek,
  OverviewWeekCa,
  OverviewWeekDriver,
  OverviewWeekUs,
} from "@ch/core/actuals/overviewWeeks";

export const LITRES_PER_GALLON = 3.78541;

/** One US invoice's figures, in USD and gallons. */
export type UsWeekFigures = OverviewWeekUs;
/** One CA invoice's figures, in CAD and litres. `*WithTax` is the printed Final AMT. */
export type CaWeekFigures = OverviewWeekCa;
/** One driver's spend in one week, on either or both sides. */
export type DriverWeekSpend = OverviewWeekDriver;
/** Everything the Overview needs of one billing week — `GET /overview/weeks`'s entry. */
export type WeekFigures = OverviewWeek;

const sum = <T>(items: readonly T[], pick: (item: T) => number): number => items.reduce((total, item) => total + pick(item), 0);

/** `num / den`, `null` for an empty denominator — a week with no fuel has no price. */
export function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

/** Whole-number percent of confirmed receipts; `null` when none were expected. */
export function receiptPercent(confirmed: number, expected: number): number | null {
  return expected > 0 ? Math.round((confirmed / expected) * 100) : null;
}

export interface UsAggregate {
  weeks: number;
  gal: number;
  diesel: number;
  def: number;
  defGal: number;
  other: number;
  disc: number;
  stops: number;
  total: number;
  /** Σ diesel $ / Σ gal. */
  avgPrice: number | null;
  /** The lowest and highest week's own weighted price; `null` with no week that bought diesel. */
  weeklyLow: number | null;
  weeklyHigh: number | null;
  discPerGal: number | null;
  receiptsExpected: number;
  receiptsConfirmed: number;
  anomalies: number;
  /** The same figures in CAD, over only the weeks with a rate; `null` when none has one. */
  converted: UsConverted | null;
}

export interface UsConverted {
  /** Weeks with a US invoice and a rate. */
  coveredWeeks: number;
  total: number;
  diesel: number;
  def: number;
  other: number;
  disc: number;
  litres: number;
  defLitres: number;
  /** Σ diesel CAD / Σ litres over the covered weeks. */
  pricePerLitre: number | null;
}

export interface CaAggregate {
  weeks: number;
  litres: number;
  dieselWithTax: number;
  dieselPreTax: number;
  defWithTax: number;
  defPreTax: number;
  defLitres: number;
  /** Scale and express charges. */
  other: number;
  disc: number;
  stops: number;
  /** Diesel + DEF with tax, plus other charges: the invoice grand total. */
  total: number;
  hst: number;
  dieselHst: number;
  defHst: number;
  avgPrice: number | null;
  avgPricePreTax: number | null;
  weeklyLow: number | null;
  weeklyHigh: number | null;
  discPerLitre: number | null;
  receiptsExpected: number;
  receiptsConfirmed: number;
  anomalies: number;
}

export interface CombinedAggregate {
  /** Weeks with any invoice and a rate. */
  coveredWeeks: number;
  total: number;
  /** The two parts of `total` over the same weeks: US converted at each week's rate, and CA as billed. */
  usTotal: number;
  caTotal: number;
  diesel: number;
  def: number;
  disc: number;
  hst: number;
  litres: number;
  defLitres: number;
  /** Σ diesel CAD / Σ litres. */
  pricePerLitre: number | null;
}

export interface FxCoverage {
  /** Weeks in scope with any invoice. */
  weeksWithData: number;
  /** Of those, the ones with a rate. */
  covered: number;
  /** The week ends with an invoice and no rate, ascending. */
  missing: string[];
  /** Mean of the covered weeks' rates (display only); `null` when none. */
  meanRate: number | null;
}

export interface ScopeAggregate {
  us: UsAggregate | null;
  ca: CaAggregate | null;
  combined: CombinedAggregate | null;
  fx: FxCoverage;
}

function aggregateUs(weeks: readonly WeekFigures[]): UsAggregate | null {
  const withUs = weeks.filter((w): w is WeekFigures & { us: UsWeekFigures } => w.us !== null);
  if (withUs.length === 0) return null;
  const us = (pick: (u: UsWeekFigures) => number) => sum(withUs, (w) => pick(w.us));
  const gal = us((u) => u.gal);
  const diesel = us((u) => u.diesel);
  const def = us((u) => u.def);
  const other = us((u) => u.other);
  const disc = us((u) => u.disc);
  const weekly = withUs.map((w) => ratio(w.us.diesel, w.us.gal)).filter((p): p is number => p !== null);

  const covered = withUs.filter((w): w is typeof w & { fx: number } => w.fx !== null);
  const conv = (pick: (u: UsWeekFigures) => number) => sum(covered, (w) => pick(w.us) * w.fx);
  const litres = sum(covered, (w) => w.us.gal * LITRES_PER_GALLON);
  const dieselCad = conv((u) => u.diesel);

  return {
    weeks: withUs.length,
    gal,
    diesel,
    def,
    defGal: us((u) => u.defGal),
    other,
    disc,
    stops: us((u) => u.stops),
    total: diesel + def + other,
    avgPrice: ratio(diesel, gal),
    weeklyLow: weekly.length > 0 ? Math.min(...weekly) : null,
    weeklyHigh: weekly.length > 0 ? Math.max(...weekly) : null,
    discPerGal: ratio(disc, gal),
    receiptsExpected: us((u) => u.receiptsExpected),
    receiptsConfirmed: us((u) => u.receiptsConfirmed),
    anomalies: us((u) => u.anomalies),
    converted:
      covered.length === 0
        ? null
        : {
            coveredWeeks: covered.length,
            total: conv((u) => u.diesel + u.def + u.other),
            diesel: dieselCad,
            def: conv((u) => u.def),
            other: conv((u) => u.other),
            disc: conv((u) => u.disc),
            litres,
            defLitres: sum(covered, (w) => w.us.defGal * LITRES_PER_GALLON),
            pricePerLitre: ratio(dieselCad, litres),
          },
  };
}

function aggregateCa(weeks: readonly WeekFigures[]): CaAggregate | null {
  const withCa = weeks.filter((w): w is WeekFigures & { ca: CaWeekFigures } => w.ca !== null);
  if (withCa.length === 0) return null;
  const ca = (pick: (c: CaWeekFigures) => number) => sum(withCa, (w) => pick(w.ca));
  const litres = ca((c) => c.litres);
  const dieselWithTax = ca((c) => c.dieselWithTax);
  const dieselPreTax = ca((c) => c.dieselPreTax);
  const defWithTax = ca((c) => c.defWithTax);
  const defPreTax = ca((c) => c.defPreTax);
  const disc = ca((c) => c.disc);
  const weekly = withCa.map((w) => ratio(w.ca.dieselWithTax, w.ca.litres)).filter((p): p is number => p !== null);
  return {
    weeks: withCa.length,
    litres,
    dieselWithTax,
    dieselPreTax,
      defWithTax,
    defPreTax,
    defLitres: ca((c) => c.defLitres),
    other: ca((c) => c.other),
    disc,
    stops: ca((c) => c.stops),
    total: dieselWithTax + defWithTax + ca((c) => c.other),
    hst: dieselWithTax - dieselPreTax + defWithTax - defPreTax,
    dieselHst: dieselWithTax - dieselPreTax,
    defHst: defWithTax - defPreTax,
    avgPrice: ratio(dieselWithTax, litres),
    avgPricePreTax: ratio(dieselPreTax, litres),
    weeklyLow: weekly.length > 0 ? Math.min(...weekly) : null,
    weeklyHigh: weekly.length > 0 ? Math.max(...weekly) : null,
    discPerLitre: ratio(disc, litres),
    receiptsExpected: ca((c) => c.receiptsExpected),
    receiptsConfirmed: ca((c) => c.receiptsConfirmed),
    anomalies: ca((c) => c.anomalies),
  };
}

/** US converted at each covered week's own rate plus CA as billed, over weeks that have a rate. */
function aggregateCombined(covered: readonly (WeekFigures & { fx: number })[]): CombinedAggregate | null {
  if (covered.length === 0) return null;
  const us = (w: WeekFigures & { fx: number }, pick: (u: UsWeekFigures) => number) => (w.us === null ? 0 : pick(w.us) * w.fx);
  const ca = (w: WeekFigures, pick: (c: CaWeekFigures) => number) => (w.ca === null ? 0 : pick(w.ca));
  const diesel = sum(covered, (w) => us(w, (u) => u.diesel) + ca(w, (c) => c.dieselWithTax));
  const litres = sum(covered, (w) => (w.us === null ? 0 : w.us.gal * LITRES_PER_GALLON) + ca(w, (c) => c.litres));
  return {
    coveredWeeks: covered.length,
    total: sum(covered, (w) => us(w, (u) => u.diesel + u.def + u.other) + ca(w, (c) => c.dieselWithTax + c.defWithTax + c.other)),
    usTotal: sum(covered, (w) => us(w, (u) => u.diesel + u.def + u.other)),
    caTotal: sum(covered, (w) => ca(w, (c) => c.dieselWithTax + c.defWithTax + c.other)),
    diesel,
    def: sum(covered, (w) => us(w, (u) => u.def) + ca(w, (c) => c.defWithTax)),
    disc: sum(covered, (w) => us(w, (u) => u.disc) + ca(w, (c) => c.disc)),
    hst: sum(covered, (w) => ca(w, (c) => c.dieselWithTax - c.dieselPreTax + c.defWithTax - c.defPreTax)),
    litres,
    defLitres: sum(covered, (w) => (w.us === null ? 0 : w.us.defGal * LITRES_PER_GALLON) + ca(w, (c) => c.defLitres)),
    pricePerLitre: ratio(diesel, litres),
  };
}

/** Every figure the Overview shows, for any list of weeks (one, a range, or all). */
export function aggregateWeeks(weeks: readonly WeekFigures[]): ScopeAggregate {
  const withData = weeks.filter((w) => w.us !== null || w.ca !== null);
  const covered = withData.filter((w): w is WeekFigures & { fx: number } => w.fx !== null);
  return {
    us: aggregateUs(weeks),
    ca: aggregateCa(weeks),
    combined: aggregateCombined(covered),
    fx: {
      weeksWithData: withData.length,
      covered: covered.length,
      missing: withData.filter((w) => w.fx === null).map((w) => w.weekEnd),
      meanRate: covered.length === 0 ? null : sum(covered, (w) => w.fx) / covered.length,
    },
  };
}

export type TrendSide = "us" | "ca";

/** One value per week, in order: the side's weighted billed price, `null` where it bought no diesel. */
export function trendSeries(weeks: readonly WeekFigures[], side: TrendSide): (number | null)[] {
  return weeks.map((w) => {
    if (side === "us") return w.us === null ? null : ratio(w.us.diesel, w.us.gal);
    return w.ca === null ? null : ratio(w.ca.dieselWithTax, w.ca.litres);
  });
}

export interface TrendChange {
  latest: number;
  /** Index of the first non-null point. */
  firstIndex: number;
  first: number;
  /** Percent, latest against first; `null` with a single point. */
  percent: number | null;
}

/** The latest non-null point against the first non-null point. `null` when the series has no point. */
export function trendChange(series: readonly (number | null)[]): TrendChange | null {
  const points = series.map((value, index) => ({ value, index })).filter((p): p is { value: number; index: number } => p.value !== null);
  if (points.length === 0) return null;
  const first = points[0]!;
  const latest = points[points.length - 1]!;
  return {
    latest: latest.value,
    firstIndex: first.index,
    first: first.value,
    percent: points.length > 1 && first.value !== 0 ? ((latest.value - first.value) / first.value) * 100 : null,
  };
}
