/**
 * What the Overview shows for a scope, as plain labelled models (T-71): the
 * banner readout, the invoices strip, the FX notice, the two region cards and
 * the combined band. Pure — components only lay these out. The numbers come
 * from `aggregateWeeks`; this file chooses and formats them, following the
 * design hand-off's copy exactly. The charts' models are in `overviewCharts`.
 */
import { aggregateWeeks, receiptPercent, type CaAggregate, type ScopeAggregate, type UsAggregate, type WeekFigures } from "./overviewAggregate";
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

const usd = (n: number): string => "$" + Math.round(n).toLocaleString("en-US");
const qty = (n: number): string => Math.round(n).toLocaleString("en-US");
const price4 = (n: number): string => "$" + n.toFixed(4);

export interface Tile {
  label: string;
  /** The country letters before the number (`US`, `CA`), or empty. */
  cc: string;
  value: string;
  unit: string;
  sub: string;
  /** Top right: the CAD equivalent. */
  eq: string;
  /** Bottom right note. */
  note: string;
  color: string;
  /** A link in the sub line (the anomalies tile). */
  link: { text: string; href: string } | null;
}

function tile(label: string, cc: string, value: string, unit: string, sub: string, o: Partial<Pick<Tile, "eq" | "note" | "color" | "link">> = {}): Tile {
  return { label, cc, value, unit, sub, eq: o.eq ?? "", note: o.note ?? "", color: o.color ?? NAVY, link: o.link ?? null };
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

export interface CombinedView {
  show: boolean;
  /** No week in scope has a rate: the band says it needs one. */
  none: boolean;
  sub: string;
  rate: string;
  rateLabel: string;
  tiles: CombinedTile[];
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
}

/** The weeks a scope covers, from every imported week (ascending). */
export function weeksInScope(all: readonly WeekFigures[], scope: Scope): WeekFigures[] {
  const ends = new Set(weekEndsInScope(scope, all.map((w) => w.weekEnd)));
  return all.filter((w) => ends.has(w.weekEnd));
}

const weekRange = (w: WeekFigures): string => rangeLabel(w.start, w.end);

function head(side: Side, inScope: readonly WeekFigures[], currency: string): string {
  const first = inScope[0]!;
  const last = inScope[inScope.length - 1]!;
  if (inScope.length === 1) return `Invoice ${(side === "us" ? first.us : first.ca)!.invoice} · ${weekRange(first)} · ${currency}`;
  return `${inScope.length} invoices · ${formatDay(first.start)} – ${formatDay(last.end)} · ${currency}`;
}

function usRegion(agg: UsAggregate | null, weeks: readonly WeekFigures[], span: string, anomaliesHref: string, scopeShort: string): RegionView {
  const base = { side: "us" as const, code: "US" as const, name: "United States", accent: NAVY, absentMessage: `No US invoice for ${span}` };
  if (agg === null) return { ...base, present: false, sub: "USD · gallons", big: [], small: [] };
  const inScope = weeks.filter((w) => w.us !== null);
  const conv = agg.converted;
  const partial = conv !== null && conv.coveredWeeks < agg.weeks;
  const suffix = partial ? ` · ${conv.coveredWeeks} of ${agg.weeks} wks` : "";
  const eq = (cad: number | null, withSuffix = false): string => (cad === null || conv === null ? "" : `≈ CA${usd(cad)}${withSuffix ? suffix : ""}`);
  const pct = receiptPercent(agg.receiptsConfirmed, agg.receiptsExpected);
  const several = agg.weeks > 1;

  return {
    ...base,
    present: true,
    sub: head("us", inScope, "USD · gallons"),
    big: [
      tile("Average billed price", "US", agg.avgPrice === null ? "—" : price4(agg.avgPrice), "/ gal",
        several
          ? agg.weeklyLow === null ? "" : `Weekly low $${agg.weeklyLow.toFixed(2)} · high $${agg.weeklyHigh!.toFixed(2)}`
          : agg.discPerGal === null ? "" : `Discount ${price4(agg.discPerGal)} / gal off retail`,
        { eq: conv?.pricePerLitre == null ? "" : `≈ CA${price4(conv.pricePerLitre)} / L${suffix}` }),
      tile("Total spend", "US", usd(agg.total), "", `Includes US${usd(agg.other)} other charges`, { eq: eq(conv?.total ?? null, true) }),
    ],
    small: [
      tile("Diesel", "US", usd(agg.diesel), "", `${qty(agg.gal)} gal`, { eq: eq(conv?.diesel ?? null) }),
      tile("DEF", "US", usd(agg.def), "", `${qty(agg.defGal)} gal`, { eq: eq(conv?.def ?? null) }),
      tile("Discount captured", "US", usd(agg.disc), "", agg.discPerGal === null ? "" : `$${agg.discPerGal.toFixed(3)} / gal average`, { eq: eq(conv?.disc ?? null) }),
      tile("Stops", "", qty(agg.stops), "", several ? `About ${Math.round(agg.stops / agg.weeks)} per week` : "Fuel stops on this invoice"),
      tile("Receipt compliance", "", pct === null ? "—" : `${pct}%`, "", `${agg.receiptsConfirmed} of ${agg.receiptsExpected} confirmed`, { color: receiptColor(pct) }),
      tile("Anomalies flagged", "", String(agg.anomalies), "", "", { color: AMBER, link: { text: `Open in Transactions, ${scopeShort} →`, href: anomaliesHref } }),
    ],
  };
}

function caRegion(agg: CaAggregate | null, weeks: readonly WeekFigures[], span: string, anomaliesHref: string, scopeShort: string): RegionView {
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
      tile("Billed price, with HST", "CA", agg.avgPrice === null ? "—" : price4(agg.avgPrice), "/ L",
        agg.avgPricePreTax === null ? "" : `CA${price4(agg.avgPricePreTax)} / L before HST`,
        { note: several && agg.weeklyLow !== null ? `Weekly $${agg.weeklyLow.toFixed(2)} – $${agg.weeklyHigh!.toFixed(2)}` : "" }),
      tile("Total spend, with HST", "CA", usd(agg.total), "", `${qty(agg.litres)} L diesel`, { note: hst(agg.hst) }),
    ],
    small: [
      tile("Diesel", "CA", usd(agg.dieselWithTax), "", `${qty(agg.litres)} L`, { note: hst(agg.dieselHst) }),
      tile("DEF", "CA", usd(agg.defWithTax), "", `${qty(agg.defLitres)} L`, { note: hst(agg.defHst) }),
      tile("Discount captured", "CA", usd(agg.disc), "", agg.discPerLitre === null ? "Before tax" : `Before tax · $${agg.discPerLitre.toFixed(3)} / L`),
      tile("Stops", "", qty(agg.stops), "", several ? `About ${Math.round(agg.stops / agg.weeks)} per week` : "Fuel stops on this invoice"),
      tile("Receipt compliance", "", pct === null ? "—" : `${pct}%`, "", `${agg.receiptsConfirmed} of ${agg.receiptsExpected} confirmed`, { color: receiptColor(pct) }),
      tile("Anomalies flagged", "", String(agg.anomalies), "", "", { color: AMBER, link: { text: `Open in Transactions, ${scopeShort} →`, href: anomaliesHref } }),
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

function combinedView(agg: ScopeAggregate, single: boolean, hasUs: boolean, hasCa: boolean): CombinedView {
  const { combined, fx } = agg;
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
    tiles:
      combined === null
        ? []
        : [
            { label: "Total spend, with HST", cc: "CA", value: usd(combined.total), unit: "", sub: `Includes HST CA${usd(combined.hst)}` },
            { label: "Diesel", cc: "CA", value: usd(combined.diesel), unit: "", sub: `${qty(combined.litres)} L` },
            { label: "DEF", cc: "CA", value: usd(combined.def), unit: "", sub: `${qty(combined.defLitres)} L` },
            { label: "Discount captured", cc: "CA", value: usd(combined.disc), unit: "", sub: "Both sides, before tax" },
            {
              label: "Billed price, with HST",
              cc: "CA",
              value: combined.pricePerLitre === null ? "—" : price4(combined.pricePerLitre),
              unit: "/ L",
              sub: "Diesel, weighted by litres",
            },
          ],
  };
}

/** The banner readout: `All time · 14 weeks · Aug 4 – Nov 9`. */
export function scopeReadout(scope: Scope, count: number, span: string): string {
  if (scope.mode === "all") return `All time · ${count} week${count === 1 ? "" : "s"} · ${span}`;
  if (scope.mode === "week") return `Billing week · ${span}`;
  return `Range · ${count} week${count === 1 ? "" : "s"} · ${span}`;
}

/** Everything but the charts, for `scope` over every imported week. `transactionsHref(side)` builds the anomalies link. */
export function buildOverviewView(all: readonly WeekFigures[], scope: Scope, transactionsHref: (side: Side) => string): OverviewView {
  const weeks = weeksInScope(all, scope);
  const agg = aggregateWeeks(weeks);
  const single = weeks.length === 1;
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const span = first === undefined || last === undefined ? "" : single ? weekRange(first) : `${formatDay(first.start)} – ${formatDay(last.end)}`;
  const scopeShort = scope.mode === "all" ? "all time" : scope.mode === "week" ? "this week" : "this range";
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
    us: usRegion(agg.us, weeks, span, transactionsHref("us"), scopeShort),
    ca: caRegion(agg.ca, weeks, span, transactionsHref("ca"), scopeShort),
    combined: combinedView(agg, single, usCount > 0, caCount > 0),
  };
}
