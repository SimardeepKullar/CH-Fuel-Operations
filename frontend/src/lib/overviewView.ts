/**
 * What the Overview shows for a scope, as plain labelled models (T-71): the
 * banner readout, the invoices strip, the FX notice, the two region cards and
 * the combined band. Pure — components only lay these out. The numbers come
 * from `aggregateWeeks`; this file chooses and formats them, following the
 * design hand-off's copy exactly. The charts' models are in `overviewCharts`.
 */
import { aggregateWeeks, receiptPercent, trendSeries, type CaAggregate, type ScopeAggregate, type UsAggregate, type WeekFigures } from "./overviewAggregate";
import { weekEndsInScope, type Scope } from "./overviewScope";
import { formatDay } from "./weeks";

export type Side = "us" | "ca";

const NAVY = "#16205c";
const CYAN = "#00a6e2";
const AMBER = "#b7791f";
const RED = "#c13b3b";

/** `Sep 3 – 9` within a month, `Aug 30 – Sep 5` across one. */
export function rangeLabel(start: string, end: string): string {
  return start.slice(0, 7) === end.slice(0, 7) ? `${formatDay(start)} – ${Number(end.slice(8))}` : `${formatDay(start)} – ${formatDay(end)}`;
}

const TWO = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const usd = (n: number): string => "$" + n.toLocaleString("en-US", TWO);
const qty = (n: number): string => n.toLocaleString("en-US", TWO);
const RECEIPTS_HREF = "/receipt-queue";
const TOTAL_SUB = "Fuel + DEF + Other Charges";
const OTHER_SUB = "Scale, express and fees";
const price4 = (n: number): string => "$" + n.toFixed(4);

export interface Tile {
  label: string;
  /** The country letters before the number (`US`, `CA`), or empty. */
  cc: string;
  value: string;
  unit: string;
  sub: string;
  /** Bottom right note. */
  note: string;
  color: string;
  /** A link in the sub line (the anomalies tile). */
  link: { text: string; href: string } | null;
}

function tile(label: string, cc: string, value: string, unit: string, sub: string, o: Partial<Pick<Tile, "note" | "color" | "link">> = {}): Tile {
  return { label, cc, value, unit, sub, note: o.note ?? "", color: o.color ?? NAVY, link: o.link ?? null };
}

const receiptColor = (pct: number | null): string => (pct === null ? NAVY : pct < 50 ? RED : pct < 85 ? AMBER : NAVY);

export interface RegionView {
  side: Side;
  code: "US" | "CA";
  name: string;
  accent: string;
  /** `null` when the scope holds no invoice for this side. */
  present: boolean;
  sub: string;
  /** The empty state's heading when `present` is false. */
  absentMessage: string;
  big: Tile[];
  small: Tile[];
  /** The US card in CA units (CAD, litres) at each week's rate; `null` when no week has a rate. */
  caUnits?: RegionView | null;
}

export interface StripChip {
  code: "US" | "CA";
  text: string;
  /** The side has no invoice this week: a dashed chip. */
  absent: boolean;
}

export interface InvoicesView {
  single: boolean;
  /** One chip per side, for a single week. */
  weekChips: StripChip[];
  /** `All invoices` or `Invoices in range`. */
  summaryLabel: string;
  count: number;
  split: string;
  /** Every invoice in scope, for the expandable list. */
  allChips: StripChip[];
}

export interface FxNoticeView {
  text: string;
  missing: string;
}

export interface CombinedTile {
  label: string;
  cc: string;
  value: string;
  unit: string;
  sub: string;
}

/** One side's share of the combined total, in CAD. */
export interface CombinedShare {
  label: string;
  value: string;
  /** Whole percent; the two shares add to 100. */
  pct: number;
  color: string;
}

export interface CombinedAttention {
  anomalies: { count: number; link: { text: string; href: string } };
  /** `null` when no stop expected a receipt. */
  receipts: { value: string; color: string; sub: string; link: { text: string; href: string } } | null;
}

export interface CombinedView {
  show: boolean;
  /** No week in scope has a rate: the band says it needs one. */
  none: boolean;
  sub: string;
  rate: string;
  rateLabel: string;
  /** The headline: total fuel spend, combined. */
  total: CombinedTile | null;
  /** US (converted) and Canada, each a share of the total; `null` when either is absent. */
  shares: [CombinedShare, CombinedShare] | null;
  /** Average billed price, diesel, DEF, other charges, discount captured; empty with no rate. */
  kpis: CombinedTile[];
  /** Counts across both sides, so shown whether or not a rate exists. */
  attention: CombinedAttention;
}

export interface OverviewView {
  weeks: WeekFigures[];
  agg: ScopeAggregate;
  single: boolean;
  /** `Sep 3 – 9` for one week, otherwise first start – last end. */
  span: string;
  readout: string;
  rateMeta: string;
  invoices: InvoicesView;
  fxNotice: FxNoticeView | null;
  us: RegionView;
  ca: RegionView;
  combined: CombinedView;
  /** More than one week in scope: the billed-price trend is worth drawing. */
  showTrend: boolean;
}

/** The weeks a scope covers, from every imported week (ascending). */
export function weeksInScope(all: readonly WeekFigures[], scope: Scope): WeekFigures[] {
  const ends = new Set(weekEndsInScope(scope, all.map((w) => w.weekEnd)));
  return all.filter((w) => ends.has(w.weekEnd));
}

/** `+1.2% vs wk of Oct 6` for a single week against the week before it, or `` when either lacks that side. */
export function weekOverWeek(all: readonly WeekFigures[], week: WeekFigures, side: Side): string {
  const prior = all[all.findIndex((w) => w.weekEnd === week.weekEnd) - 1];
  if (prior === undefined) return "";
  const now = trendSeries([week], side)[0] ?? null;
  const before = trendSeries([prior], side)[0] ?? null;
  if (now === null || before === null || before === 0) return "";
  const pct = ((now - before) / before) * 100;
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}% vs wk of ${formatDay(prior.start)}`;
}

const lead = (change: string, rest: string): string => (change === "" ? rest : rest === "" ? change : `${change} · ${rest}`);

const weekRange = (w: WeekFigures): string => rangeLabel(w.start, w.end);

function head(side: Side, inScope: readonly WeekFigures[], currency: string): string {
  const first = inScope[0]!;
  const last = inScope[inScope.length - 1]!;
  if (inScope.length === 1) return `Invoice ${(side === "us" ? first.us : first.ca)!.invoice} · ${weekRange(first)} · ${currency}`;
  return `${inScope.length} invoices · ${formatDay(first.start)} – ${formatDay(last.end)} · ${currency}`;
}

function usRegion(agg: UsAggregate | null, weeks: readonly WeekFigures[], span: string, anomaliesHref: string, wow: string): RegionView {
  const base = { side: "us" as const, code: "US" as const, name: "United States", accent: NAVY, absentMessage: `No US invoice for ${span}` };
  if (agg === null) return { ...base, present: false, sub: "USD · gallons", big: [], small: [] };
  const inScope = weeks.filter((w) => w.us !== null);
  const conv = agg.converted;
  const partial = conv !== null && conv.coveredWeeks < agg.weeks;
  const suffix = partial ? ` · ${conv.coveredWeeks} of ${agg.weeks} wks` : "";
  const pct = receiptPercent(agg.receiptsConfirmed, agg.receiptsExpected);
  const several = agg.weeks > 1;
  const shared = [
    tile("Receipt compliance", "", pct === null ? "—" : `${pct}%`, "", `${agg.receiptsConfirmed} of ${agg.receiptsExpected} confirmed`, { color: receiptColor(pct), link: { text: "View →", href: RECEIPTS_HREF } }),
    tile("Anomalies flagged", "", String(agg.anomalies), "", "Review in Transactions", { color: AMBER, link: { text: "View →", href: anomaliesHref } }),
  ];
  const caUnits: RegionView | null =
    conv === null
      ? null
      : {
          ...base,
          present: true,
          sub: head("us", inScope, `CAD · litres, at each week’s rate${suffix}`),
          big: [
            tile("Total spend", "CA", usd(conv.total), "", TOTAL_SUB),
            tile("Average billed price", "CA", conv.pricePerLitre === null ? "—" : price4(conv.pricePerLitre), "/ L", `Converted at each week’s rate${suffix}`),
          ],
          small: [
            tile("Diesel", "CA", usd(conv.diesel), "", `${qty(conv.litres)} L`),
            tile("DEF", "CA", usd(conv.def), "", `${qty(conv.defLitres)} L`),
            tile("Other charges", "CA", usd(conv.other), "", OTHER_SUB),
            tile("Discount captured", "CA", usd(conv.disc), "", conv.litres > 0 ? `$${(conv.disc / conv.litres).toFixed(3)} / L average` : ""),
            ...shared,
          ],
        };

  return {
    ...base,
    present: true,
    caUnits,
    sub: head("us", inScope, "USD · gallons"),
    big: [
      tile("Total spend", "US", usd(agg.total), "", TOTAL_SUB),
      tile("Average billed price", "US", agg.avgPrice === null ? "—" : price4(agg.avgPrice), "/ gal",
        several
          ? agg.weeklyLow === null ? "" : `Weekly low $${agg.weeklyLow.toFixed(2)} · high $${agg.weeklyHigh!.toFixed(2)}`
          : lead(wow, agg.discPerGal === null ? "" : `Discount ${price4(agg.discPerGal)} / gal off retail`)),
    ],
    small: [
      tile("Diesel", "US", usd(agg.diesel), "", `${qty(agg.gal)} gal`),
      tile("DEF", "US", usd(agg.def), "", `${qty(agg.defGal)} gal`),
      tile("Other charges", "US", usd(agg.other), "", OTHER_SUB),
      tile("Discount captured", "US", usd(agg.disc), "", agg.discPerGal === null ? "" : `$${agg.discPerGal.toFixed(3)} / gal average`),
      ...shared,
    ],
  };
}

function caRegion(agg: CaAggregate | null, weeks: readonly WeekFigures[], span: string, anomaliesHref: string, wow: string): RegionView {
  const base = { side: "ca" as const, code: "CA" as const, name: "Canada", accent: CYAN, absentMessage: `No Canadian invoice for ${span}` };
  if (agg === null) return { ...base, present: false, sub: "CAD · litres", big: [], small: [] };
  const inScope = weeks.filter((w) => w.ca !== null);
  const pct = receiptPercent(agg.receiptsConfirmed, agg.receiptsExpected);
  const several = agg.weeks > 1;
  const hst = (n: number): string => `HST CA${usd(n)}`;

  return {
    ...base,
    present: true,
    sub: head("ca", inScope, "CAD incl. HST · litres"),
    big: [
      tile("Total spend, with HST", "CA", usd(agg.total), "", TOTAL_SUB, { note: hst(agg.hst) }),
      tile("Billed price, with HST", "CA", agg.avgPrice === null ? "—" : price4(agg.avgPrice), "/ L",
        lead(wow, agg.avgPricePreTax === null ? "" : `CA${price4(agg.avgPricePreTax)} / L before HST`),
        { note: several && agg.weeklyLow !== null ? `Weekly $${agg.weeklyLow.toFixed(2)} – $${agg.weeklyHigh!.toFixed(2)}` : "" }),
    ],
    small: [
      tile("Diesel", "CA", usd(agg.dieselWithTax), "", `${qty(agg.litres)} L`, { note: hst(agg.dieselHst) }),
      tile("DEF", "CA", usd(agg.defWithTax), "", `${qty(agg.defLitres)} L`, { note: hst(agg.defHst) }),
      tile("Other charges", "CA", usd(agg.other), "", OTHER_SUB),
      tile("Discount captured", "CA", usd(agg.disc), "", agg.discPerLitre === null ? "Before tax" : `Before tax · $${agg.discPerLitre.toFixed(3)} / L`),
      tile("Receipt compliance", "", pct === null ? "—" : `${pct}%`, "", `${agg.receiptsConfirmed} of ${agg.receiptsExpected} confirmed`, { color: receiptColor(pct), link: { text: "View →", href: RECEIPTS_HREF } }),
      tile("Anomalies flagged", "", String(agg.anomalies), "", "Review in Transactions", { color: AMBER, link: { text: "View →", href: anomaliesHref } }),
    ],
  };
}

function chips(week: WeekFigures): StripChip[] {
  const out: StripChip[] = [];
  if (week.us) out.push({ code: "US", text: `${week.us.invoice} · ${weekRange(week)}`, absent: false });
  if (week.ca) out.push({ code: "CA", text: `${week.ca.invoice} · ${weekRange(week)}`, absent: false });
  return out;
}

function weekChip(side: Side, week: WeekFigures): StripChip {
  const present = side === "us" ? week.us : week.ca;
  if (present) return { code: side === "us" ? "US" : "CA", text: `${present.invoice} · ${weekRange(week)}`, absent: false };
  return { code: side === "us" ? "US" : "CA", text: side === "us" ? "No US invoice this week" : "No Canadian invoice this week", absent: true };
}

function combinedView(agg: ScopeAggregate, single: boolean, hasUs: boolean, hasCa: boolean, anomaliesHref: string): CombinedView {
  const { combined, fx } = agg;
  const anomalies = (agg.us?.anomalies ?? 0) + (agg.ca?.anomalies ?? 0);
  const expected = (agg.us?.receiptsExpected ?? 0) + (agg.ca?.receiptsExpected ?? 0);
  const confirmed = (agg.us?.receiptsConfirmed ?? 0) + (agg.ca?.receiptsConfirmed ?? 0);
  const usPct = combined === null || combined.total <= 0 ? 0 : Math.round((combined.usTotal / combined.total) * 100);
  const partial = fx.covered < fx.weeksWithData && fx.covered > 0;
  const none = fx.weeksWithData > 0 && fx.covered === 0;
  const sub =
    "US converted to CAD at each week’s rate · litres" +
    (partial ? ` · covers ${fx.covered} of ${fx.weeksWithData} weeks` : "") +
    (single && !hasCa ? " · US only this week" : "") +
    (single && !hasUs ? " · Canada only this week" : "");
  return {
    show: combined !== null,
    none,
    sub,
    rate: fx.meanRate === null ? "—" : fx.meanRate.toFixed(2),
    rateLabel: single ? "CAD per USD" : fx.covered > 0 ? `CAD per USD · avg of ${fx.covered} wk${fx.covered > 1 ? "s" : ""}` : "CAD per USD",
    total: combined === null ? null : { label: "Total Spend - Combined", cc: "CA", value: usd(combined.total), unit: "", sub: TOTAL_SUB },
    shares:
      combined === null || !hasUs || !hasCa || combined.total <= 0
        ? null
        : [
            { label: "United States", value: `CA${usd(combined.usTotal)}`, pct: usPct, color: NAVY },
            { label: "Canada", value: `CA${usd(combined.caTotal)}`, pct: 100 - usPct, color: CYAN },
          ],
    kpis:
      combined === null
        ? []
        : [
            {
              label: "Average billed price",
              cc: "CA",
              value: combined.pricePerLitre === null ? "—" : price4(combined.pricePerLitre),
              unit: "/ L",
              sub: `With HST · ${qty(combined.litres)} L`,
            },
            { label: "Diesel", cc: "CA", value: usd(combined.diesel), unit: "", sub: `${qty(combined.litres)} L` },
            { label: "DEF", cc: "CA", value: usd(combined.def), unit: "", sub: `${qty(combined.defLitres)} L` },
            { label: "Other charges", cc: "CA", value: usd(combined.other), unit: "", sub: OTHER_SUB },
            { label: "Discount captured", cc: "CA", value: usd(combined.disc), unit: "", sub: "" },
          ],
    attention: {
      anomalies: { count: anomalies, link: { text: "View →", href: anomaliesHref } },
      receipts:
        expected === 0
          ? null
          : {
              value: `${receiptPercent(confirmed, expected) ?? 0}%`,
              color: receiptColor(receiptPercent(confirmed, expected)),
              sub: `${confirmed} of ${expected} confirmed`,
              link: { text: "View →", href: RECEIPTS_HREF },
            },
    },
  };
}

/** The banner readout: `All time · 14 weeks · Aug 4 – Nov 9`. */
export function scopeReadout(scope: Scope, count: number, span: string): string {
  if (scope.mode === "all") return `All time · ${count} week${count === 1 ? "" : "s"} · ${span}`;
  if (scope.mode === "week") return `Billing week · ${span}`;
  return `Range · ${count} week${count === 1 ? "" : "s"} · ${span}`;
}

/** Everything but the charts, for `scope` over every imported week. `transactionsHref(side)` builds the anomalies link. */
export function buildOverviewView(all: readonly WeekFigures[], scope: Scope, transactionsHref: (side: Side | "all") => string): OverviewView {
  const weeks = weeksInScope(all, scope);
  const agg = aggregateWeeks(weeks);
  const single = weeks.length === 1;
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const span = first === undefined || last === undefined ? "" : single ? weekRange(first) : `${formatDay(first.start)} – ${formatDay(last.end)}`;
  const usCount = weeks.filter((w) => w.us).length;
  const caCount = weeks.filter((w) => w.ca).length;
  const { fx } = agg;

  const rateMeta = single
    ? first?.fx != null
      ? `Exchange rate ${first.fx.toFixed(2)} CAD per USD`
      : "No exchange rate entered"
    : `Exchange rates entered for ${fx.covered} of ${fx.weeksWithData} weeks`;

  const missingWeeks = weeks.filter((w) => (w.us || w.ca) && w.fx === null);
  const fxNotice: FxNoticeView | null =
    missingWeeks.length === 0
      ? null
      : {
          text:
            fx.covered === 0
              ? single
                ? `No exchange rate for ${span}. Converted (CAD) figures are hidden.`
                : `None of the ${fx.weeksWithData} weeks have an exchange rate. Converted (CAD) figures are hidden.`
              : `${missingWeeks.length} of ${fx.weeksWithData} weeks have no exchange rate. Converted figures cover ${fx.covered} weeks.`,
          missing: single ? "" : "Missing: " + missingWeeks.map((w) => `week of ${formatDay(w.start)}`).join(", "),
        };

  return {
    weeks,
    agg,
    single,
    span,
    readout: scopeReadout(scope, weeks.length, span),
    rateMeta,
    invoices: {
      single,
      weekChips: single && first ? [weekChip("us", first), weekChip("ca", first)] : [],
      summaryLabel: scope.mode === "all" ? "All invoices" : "Invoices in range",
      count: usCount + caCount,
      split: `${usCount} US · ${caCount} CA`,
      allChips: weeks.flatMap(chips),
    },
    fxNotice,
    showTrend: weeks.length > 1,
    us: usRegion(agg.us, weeks, span, transactionsHref("us"), single && first ? weekOverWeek(all, first, "us") : ""),
    ca: caRegion(agg.ca, weeks, span, transactionsHref("ca"), single && first ? weekOverWeek(all, first, "ca") : ""),
    combined: combinedView(agg, single, usCount > 0, caCount > 0, transactionsHref("all")),
  };
}
