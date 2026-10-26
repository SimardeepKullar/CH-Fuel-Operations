/**
 * Synthetic billing weeks for the Overview's nine design states (1a–1i) and
 * their tests. Invented figures — except `todayWeeks`, which carries the real
 * totals of invoices 999210 and 999217 (no driver names, so safe to commit).
 */
import type { CaWeekFigures, DriverWeekSpend, UsWeekFigures, WeekFigures } from "./overviewAggregate";

export type OverviewScenario = "all" | "week" | "range" | "today" | "fxpartial" | "fxnone" | "usonly" | "caonly";

const WEEKS = 14;
const MS_DAY = 86_400_000;

const US_PRICE = [5.71, 5.68, 5.74, 5.69, 5.62, 5.58, 5.6, 5.55, 5.52, 5.57, 5.61, 5.56, 5.53, 5.55];
const CA_PRICE = [2.31, 2.29, 2.33, 2.28, 2.26, 2.24, 2.25, 2.22, 2.2, 2.23, 2.26, 2.21, 2.19, 2.18];
const VOLUME = [1.02, 0.97, 1.05, 0.99, 1.01, 0.96, 1.03, 0.98, 1, 1.04, 0.97, 1.01, 0.99, 0.98];
const US_ANOMALIES = [3, 2, 1, 2, 3, 1, 2, 2, 1, 2, 2, 1, 1, 1];
const CA_ANOMALIES = [1, 1, 2, 1, 0, 1, 1, 2, 1, 1, 0, 1, 1, 0];

/** The ten largest drivers' [USD, CAD] over the 14 weeks; the next six fall under "All other drivers". */
const TOP_DRIVERS: ReadonlyArray<readonly [number, number]> = [
  [11200, 4300],
  [9850, 0],
  [8400, 6100],
  [7600, 900],
  [6900, 2700],
  [5300, 0],
  [4800, 1500],
  [3900, 3200],
  [2700, 0],
  [2100, 800],
];
const OTHER_DRIVER_COUNT = 6;
const OTHER_DRIVERS_USD = 6400;
const OTHER_DRIVERS_CAD = 3100;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function drivers(share: number, usPrice: number, caPrice: number, withUs: boolean, withCa: boolean): DriverWeekSpend[] {
  const rows: DriverWeekSpend[] = TOP_DRIVERS.map(([usd, cad], k) => ({
    driverId: `d${k + 1}`,
    driverName: `Driver ${k + 1}`,
    usd: withUs ? usd * share : 0,
    usGal: withUs ? (usd * share) / usPrice : 0,
    usDiesel: withUs ? usd * share : 0,
    cad: withCa ? cad * share : 0,
    caLitres: withCa ? (cad * share) / caPrice : 0,
    caDiesel: withCa ? cad * share : 0,
  }));
  for (let k = 0; k < OTHER_DRIVER_COUNT; k++) {
    const usd = (OTHER_DRIVERS_USD / OTHER_DRIVER_COUNT) * share;
    const cad = (OTHER_DRIVERS_CAD / OTHER_DRIVER_COUNT) * share;
    rows.push({
      driverId: `o${k + 1}`,
      driverName: `Driver ${TOP_DRIVERS.length + k + 1}`,
      usd: withUs ? usd : 0,
      usGal: withUs ? usd / usPrice : 0,
      usDiesel: withUs ? usd : 0,
      cad: withCa ? cad : 0,
      caLitres: withCa ? cad / caPrice : 0,
      caDiesel: withCa ? cad : 0,
    });
  }
  return rows;
}

/** Invoices 999210 (US) and 999217 (CA), the one week imported today, at a 1.42 rate. */
function todayWeeks(): WeekFigures[] {
  const us: UsWeekFigures = {
    invoice: "999210",
    gal: 8733.11,
    diesel: 48450.68,
    def: 845.4,
    defGal: 174.43,
    other: 1633.63,
    disc: 5088.61,
    stops: 66,
    receiptsExpected: 66,
    receiptsConfirmed: 0,
    anomalies: 13,
  };
  const ca: CaWeekFigures = {
    invoice: "999217",
    litres: 21318.77,
    dieselWithTax: 46559.28,
    dieselPreTax: 41202.86,
    defWithTax: 174.05,
    defPreTax: 154.03,
    defLitres: 113.09,
    disc: 6759.96,
    stops: 38,
    receiptsExpected: 38,
    receiptsConfirmed: 0,
    anomalies: 4,
  };
  return [{ weekEnd: "2026-09-09", start: "2026-09-03", end: "2026-09-09", fx: 1.42, us, ca, drivers: drivers(1 / WEEKS, us.diesel / us.gal, ca.dieselWithTax / ca.litres, true, true) }];
}

/** Fourteen weeks from 2025-08-04, one rate of 1.42 throughout, then the scenario's holes. */
export function overviewFixture(scenario: OverviewScenario = "all"): WeekFigures[] {
  if (scenario === "today") return todayWeeks();
  const monday = Date.UTC(2025, 7, 4);
  return VOLUME.map((v, i): WeekFigures => {
    const start = new Date(monday + 7 * i * MS_DAY);
    const end = new Date(monday + (7 * i + 6) * MS_DAY);
    const gal = 7514 * v;
    const litres = 17450 * v;
    const dieselWithTax = litres * CA_PRICE[i]!;
    const defLitres = litres * 0.012;
    const defWithTax = defLitres * 1.54;
    const usReceipts = Math.round(15 * v);
    const caReceipts = Math.round(9.3 * v);
    let us: UsWeekFigures | null = {
      invoice: String(999140 + i * 5),
      gal,
      diesel: gal * US_PRICE[i]!,
      def: gal * 0.021 * 4.85,
      defGal: gal * 0.021,
      other: gal * 0.19,
      disc: gal * 0.58,
      stops: Math.round(48.6 * v),
      receiptsExpected: usReceipts,
      receiptsConfirmed: Math.round(usReceipts * Math.min(0.95, 0.38 + i * 0.035)),
      anomalies: US_ANOMALIES[i]!,
    };
    let ca: CaWeekFigures | null = {
      invoice: String(999142 + i * 5),
      litres,
      dieselWithTax,
      dieselPreTax: dieselWithTax / 1.13,
      defWithTax,
      defPreTax: defWithTax / 1.13,
      defLitres,
      disc: litres * 0.29,
      stops: Math.round(30.1 * v),
      receiptsExpected: caReceipts,
      receiptsConfirmed: Math.round(caReceipts * Math.min(0.95, 0.36 + i * 0.035)),
      anomalies: CA_ANOMALIES[i]!,
    };
    let fx: number | null = 1.42;
    if (scenario === "fxpartial" && [5, 9, 12].includes(i)) fx = null;
    if (scenario === "fxnone") fx = null;
    if (scenario === "usonly" && i === 10) ca = null;
    if (scenario === "caonly" && i === 11) us = null;
    return {
      weekEnd: isoDay(end),
      start: isoDay(start),
      end: isoDay(end),
      fx,
      us,
      ca,
      drivers: drivers(v / WEEKS, US_PRICE[i]!, CA_PRICE[i]!, us !== null, ca !== null),
    };
  });
}

/** The week ends of a fixture, ascending — what the scope helpers take. */
export function weekEndsOf(weeks: readonly WeekFigures[]): string[] {
  return weeks.map((w) => w.weekEnd);
}

/** The reference's starting scope per scenario: the weeks `week`, `range`, `usonly` and `caonly` open on. */
export const SCENARIO_START: Record<OverviewScenario, { mode: "all" | "week" | "range"; week?: number; from?: number; to?: number }> = {
  all: { mode: "all" },
  week: { mode: "week", week: 13 },
  range: { mode: "range", from: 10, to: 13 },
  today: { mode: "all" },
  fxpartial: { mode: "all" },
  fxnone: { mode: "all" },
  usonly: { mode: "week", week: 10 },
  caonly: { mode: "week", week: 11 },
};
