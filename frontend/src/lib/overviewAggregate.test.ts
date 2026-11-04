import { describe, expect, it } from "vitest";
import { aggregateWeeks, LITRES_PER_GALLON, receiptPercent, trendChange, trendPeriods, trendSeries, type WeekFigures } from "./overviewAggregate";
import { overviewFixture } from "./overviewFixtures";

const sumOf = (weeks: WeekFigures[], pick: (w: WeekFigures) => number) => weeks.reduce((t, w) => t + pick(w), 0);

describe("aggregateWeeks — sums and weighted prices", () => {
  const weeks = overviewFixture("all");
  const agg = aggregateWeeks(weeks);

  it("sums money and quantities over every week", () => {
    expect(agg.us!.gal).toBeCloseTo(sumOf(weeks, (w) => w.us!.gal), 6);
    expect(agg.us!.total).toBeCloseTo(sumOf(weeks, (w) => w.us!.diesel + w.us!.def + w.us!.other), 4);
    expect(agg.ca!.litres).toBeCloseTo(sumOf(weeks, (w) => w.ca!.litres), 6);
    expect(agg.us!.weeks).toBe(14);
  });

  it("prices are Σ$/Σqty, not a mean of weekly prices", () => {
    const weekly = weeks.map((w) => w.us!.diesel / w.us!.gal);
    const mean = weekly.reduce((a, b) => a + b, 0) / weekly.length;
    const weighted = sumOf(weeks, (w) => w.us!.diesel) / sumOf(weeks, (w) => w.us!.gal);
    expect(agg.us!.avgPrice).toBeCloseTo(weighted, 10);
    expect(Math.abs(agg.us!.avgPrice! - mean)).toBeGreaterThan(1e-5);
    const caWeighted = sumOf(weeks, (w) => w.ca!.dieselWithTax) / sumOf(weeks, (w) => w.ca!.litres);
    expect(agg.ca!.avgPrice).toBeCloseTo(caWeighted, 10);
  });

  it("CA before-HST price uses the pre-tax dollars", () => {
    expect(agg.ca!.avgPricePreTax).toBeCloseTo(sumOf(weeks, (w) => w.ca!.dieselPreTax) / agg.ca!.litres, 10);
    expect(agg.ca!.hst).toBeCloseTo(agg.ca!.total - agg.ca!.other - agg.ca!.dieselPreTax - agg.ca!.defPreTax, 6);
  });

  it("weekly low/high are each week's own weighted price", () => {
    const weekly = weeks.map((w) => w.us!.diesel / w.us!.gal);
    expect(agg.us!.weeklyLow).toBeCloseTo(Math.min(...weekly), 10);
    expect(agg.us!.weeklyHigh).toBeCloseTo(Math.max(...weekly), 10);
  });

  it("receipts are Σconfirmed / Σexpected and anomalies are summed", () => {
    expect(agg.us!.receiptsExpected).toBe(sumOf(weeks, (w) => w.us!.receiptsExpected));
    expect(agg.us!.receiptsConfirmed).toBe(sumOf(weeks, (w) => w.us!.receiptsConfirmed));
    expect(agg.us!.anomalies).toBe(sumOf(weeks, (w) => w.us!.anomalies));
    expect(agg.ca!.anomalies).toBe(sumOf(weeks, (w) => w.ca!.anomalies));
  });
});

describe("total spend is fuel + DEF + other charges", () => {
  const agg = aggregateWeeks(overviewFixture("all"));
  it("US, CA and combined each add the three parts", () => {
    expect(agg.us!.total).toBeCloseTo(agg.us!.diesel + agg.us!.def + agg.us!.other, 6);
    expect(agg.ca!.total).toBeCloseTo(agg.ca!.dieselWithTax + agg.ca!.defWithTax + agg.ca!.other, 6);
    const c = agg.combined!;
    expect(c.total).toBeCloseTo(c.usTotal + c.caTotal, 6);
    expect(agg.us!.converted!.total).toBeCloseTo(agg.us!.converted!.diesel + agg.us!.converted!.def + agg.us!.converted!.other, 6);
  });
});

describe("aggregateWeeks — conversion and the combined band", () => {
  it("converts each week at its own rate, never another week's", () => {
    const [a, b] = overviewFixture("all").slice(0, 2) as [WeekFigures, WeekFigures];
    a.fx = 1.3;
    b.fx = 1.5;
    const agg = aggregateWeeks([a, b]);
    expect(agg.us!.converted!.diesel).toBeCloseTo(a.us!.diesel * 1.3 + b.us!.diesel * 1.5, 6);
    expect(agg.us!.converted!.litres).toBeCloseTo((a.us!.gal + b.us!.gal) * LITRES_PER_GALLON, 6);
    expect(agg.combined!.diesel).toBeCloseTo(a.us!.diesel * 1.3 + b.us!.diesel * 1.5 + a.ca!.dieselWithTax + b.ca!.dieselWithTax, 6);
    expect(agg.fx.meanRate).toBeCloseTo(1.4, 10);
  });

  it("a CA-only week needs no rate: it is combined as billed and is not counted as missing one (T-68)", () => {
    const [a, b] = overviewFixture("all").slice(0, 2) as [WeekFigures, WeekFigures];
    a.fx = 1.3;
    b.us = null;
    b.fx = null;
    const agg = aggregateWeeks([a, b]);
    expect(agg.fx).toMatchObject({ weeksWithData: 1, covered: 1, missing: [], meanRate: 1.3 });
    expect(agg.combined!.coveredWeeks).toBe(2);
    expect(agg.combined!.caTotal).toBeCloseTo(a.ca!.dieselWithTax + a.ca!.defWithTax + a.ca!.other + b.ca!.dieselWithTax + b.ca!.defWithTax + b.ca!.other, 6);

    // A US week with no rate is left out of the combined figures, as before.
    a.fx = null;
    const unrated = aggregateWeeks([a, b]);
    expect(unrated.fx).toMatchObject({ weeksWithData: 1, covered: 0, missing: [a.weekEnd] });
    expect(unrated.combined!.coveredWeeks).toBe(1);
  });

  it("combined price is Σ diesel CAD / Σ litres", () => {
    const agg = aggregateWeeks(overviewFixture("all"));
    expect(agg.combined!.pricePerLitre).toBeCloseTo(agg.combined!.diesel / agg.combined!.litres, 10);
  });

  it("uses only weeks that have a rate, and names the rest", () => {
    const weeks = overviewFixture("fxpartial");
    const agg = aggregateWeeks(weeks);
    expect(agg.fx.weeksWithData).toBe(14);
    expect(agg.fx.covered).toBe(11);
    expect(agg.fx.missing).toEqual([5, 9, 12].map((i) => weeks[i]!.weekEnd));
    expect(agg.combined!.coveredWeeks).toBe(11);
    const covered = weeks.filter((w) => w.fx !== null);
    expect(agg.us!.converted!.coveredWeeks).toBe(11);
    expect(agg.us!.converted!.diesel).toBeCloseTo(covered.reduce((t, w) => t + w.us!.diesel * 1.42, 0), 6);
    // The side's own figures still cover all 14 weeks.
    expect(agg.us!.weeks).toBe(14);
  });

  it("with no rate anywhere there is no combined figure and no 1.0 fallback", () => {
    const agg = aggregateWeeks(overviewFixture("fxnone"));
    expect(agg.combined).toBeNull();
    expect(agg.us!.converted).toBeNull();
    expect(agg.fx).toMatchObject({ weeksWithData: 14, covered: 0, meanRate: null });
    expect(agg.fx.missing).toHaveLength(14);
  });
});

describe("aggregateWeeks — absent sides", () => {
  it("a US-only week leaves the CA side null and combined US-only", () => {
    const weeks = overviewFixture("usonly").slice(10, 11);
    const agg = aggregateWeeks(weeks);
    expect(agg.ca).toBeNull();
    expect(agg.combined!.litres).toBeCloseTo(weeks[0]!.us!.gal * LITRES_PER_GALLON, 6);
    expect(agg.combined!.hst).toBe(0);
  });

  it("a CA-only week leaves the US side null", () => {
    const agg = aggregateWeeks(overviewFixture("caonly").slice(11, 12));
    expect(agg.us).toBeNull();
    expect(agg.ca).not.toBeNull();
  });

  it("no weeks aggregate to nothing, without NaN", () => {
    const agg = aggregateWeeks([]);
    expect(agg).toEqual({ us: null, ca: null, combined: null, fx: { weeksWithData: 0, covered: 0, missing: [], meanRate: null } });
  });

  it("a week with no fuel has a null price, not 0 or NaN", () => {
    const [w] = overviewFixture("all");
    w!.us!.gal = 0;
    w!.us!.diesel = 0;
    const agg = aggregateWeeks([w!]);
    expect(agg.us!.avgPrice).toBeNull();
    expect(agg.us!.weeklyLow).toBeNull();
    expect(agg.us!.discPerGal).toBeNull();
    expect(trendSeries([w!], "us")).toEqual([null]);
  });
});

describe("today's real data — invoices 999210 and 999217", () => {
  const agg = aggregateWeeks(overviewFixture("today"));

  it("reproduces the printed totals", () => {
    expect(agg.us!.avgPrice).toBeCloseTo(48450.68 / 8733.11, 10);
    expect(agg.us!.total).toBeCloseTo(48450.68 + 845.4 + 1633.63, 6);
    // 999217's printed grand total: fuel with HST plus the Scale charge, which prints a final amount alone.
    expect(agg.ca!.total).toBeCloseTo(46837.33, 6);
    expect(receiptPercent(agg.us!.receiptsConfirmed, agg.us!.receiptsExpected)).toBe(0);
  });

  it("has finite numbers everywhere", () => {
    const numbers: number[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "number") numbers.push(v);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(agg);
    expect(numbers.length).toBeGreaterThan(30);
    expect(numbers.every(Number.isFinite)).toBe(true);
  });
});

describe("receiptPercent", () => {
  it("rounds, and is null with nothing expected", () => {
    expect(receiptPercent(131, 210)).toBe(62);
    expect(receiptPercent(0, 0)).toBeNull();
  });
});

describe("trendSeries / trendChange", () => {
  it("is one value per week, null where a side has no invoice", () => {
    const weeks = overviewFixture("usonly");
    const series = trendSeries(weeks, "ca");
    expect(series).toHaveLength(14);
    expect(series[10]).toBeNull();
    expect(series[0]).toBeCloseTo(2.31, 10);
  });

  it("compares the latest non-null point with the first non-null point", () => {
    expect(trendChange([null, 5, null, 5.5, null])).toEqual({ latest: 5.5, firstIndex: 1, first: 5, percent: 10 });
  });

  it("has no percent for one point and nothing for none", () => {
    expect(trendChange([null, 5])?.percent).toBeNull();
    expect(trendChange([null, null])).toBeNull();
    expect(trendChange([])).toBeNull();
  });
});

describe("trendPeriods — weekly and monthly billed price (T-89)", () => {
  const usFig = (gal: number, diesel: number) => ({ invoice: "i", gal, diesel, def: 0, defGal: 0, other: 0, disc: 0, stops: 1, receiptsExpected: 0, receiptsConfirmed: 0, anomalies: 0 });
  const caFig = (litres: number, withTax: number, preTax: number) => ({
    invoice: "i", litres, dieselWithTax: withTax, dieselPreTax: preTax, defWithTax: 0, defPreTax: 0, defLitres: 0, other: 0, disc: 0, stops: 1, receiptsExpected: 0, receiptsConfirmed: 0, anomalies: 0,
  });
  const week = (weekEnd: string, start: string, us: ReturnType<typeof usFig> | null, ca: ReturnType<typeof caFig> | null): WeekFigures => ({
    weekEnd, start, end: weekEnd, fx: null, us, ca, drivers: [],
  });

  // Sep 2's transactions start Aug 27: it is a September week, because the key is the week end (D26).
  const weeks = [
    week("2026-09-02", "2026-08-27", usFig(1000, 5000), caFig(2000, 4600, 4070.8)),
    week("2026-09-09", "2026-09-03", usFig(3000, 18000), caFig(1000, 2400, 2123.9)),
    week("2026-10-07", "2026-10-01", usFig(500, 2500), null),
    week("2026-10-14", "2026-10-08", null, null),
    week("2026-10-21", "2026-10-15", usFig(0, 0), caFig(1000, 2200, 1946.9)),
  ];

  it("a week ending Sep 2 counts in September though its transactions start Aug 27", () => {
    const months = trendPeriods(weeks, "us", "month");
    expect(months.map((m) => m.key)).toEqual(["2026-09", "2026-10"]);
    expect(months[0]!.weeks).toBe(2);
    expect(months[0]!.start).toBe("2026-08-27");
  });

  it("a month is Σ diesel ÷ Σ quantity, not the mean of the weekly prices, exactly", () => {
    const [sep] = trendPeriods(weeks, "us", "month");
    // (5000 + 18000) / (1000 + 3000) = 5.75; the mean of 5.00 and 6.00 would be 5.50.
    expect(sep!.priceTenThousandths).toBe(57500);
    expect(sep!.qtyHundredths).toBe(400000);
  });

  it("CA gives with-HST and before-HST prices over the same litres", () => {
    const [sep] = trendPeriods(weeks, "ca", "month");
    // 7000 / 3000 = 2.3333; 6194.7 / 3000 = 2.0649
    expect(sep!.priceTenThousandths).toBe(23333);
    expect(sep!.preTaxTenThousandths).toBe(20649);
    expect(trendPeriods(weeks, "us", "month")[0]!.preTaxTenThousandths).toBeNull();
  });

  it("a week with no fuel is null, never 0, and does not zero its month", () => {
    const oct = trendPeriods(weeks, "us", "month")[1]!;
    expect(oct.weeks).toBe(1);
    expect(oct.priceTenThousandths).toBe(50000);
    const weekly = trendPeriods(weeks, "us", "week");
    expect(weekly[3]!.priceTenThousandths).toBeNull();
    expect(weekly[4]!.priceTenThousandths).toBeNull();
  });

  it("a month with no diesel on the side is null", () => {
    const caOnlyOctWeeks = [weeks[2]!];
    const [oct] = trendPeriods(caOnlyOctWeeks, "ca", "month");
    expect(oct!.priceTenThousandths).toBeNull();
    expect(oct!.preTaxTenThousandths).toBeNull();
    expect(oct!.weeks).toBe(0);
  });

  it("week grain is one period per week with T-72's price", () => {
    const periods = trendPeriods(weeks, "us", "week");
    expect(periods.map((p) => p.key)).toEqual(weeks.map((w) => w.weekEnd));
    const series = trendSeries(weeks, "us");
    periods.forEach((p, i) => {
      expect(p.priceTenThousandths === null ? null : p.priceTenThousandths / 10000).toBe(series[i] === null ? null : Number(series[i]!.toFixed(4)));
    });
  });

  it("change is against the immediately prior period, and — (null) after a no-fuel one", () => {
    const weekly = trendPeriods(weeks, "ca", "week");
    // Sep 2 2.3000 → Sep 9 2.4000
    expect(weekly[0]!.changePercent).toBeNull();
    expect(weekly[1]!.changePercent).toBeCloseTo(((24000 - 23000) / 23000) * 100, 10);
    // Oct 7 (no CA) is null, Oct 14 (none) is null, Oct 21 follows a no-fuel period: null.
    expect(weekly[2]!.changePercent).toBeNull();
    expect(weekly[4]!.changePercent).toBeNull();
  });

  it("each side keeps its own unit: quantities are never mixed", () => {
    expect(trendPeriods(weeks, "us", "week")[0]!.qtyHundredths).toBe(100000);
    expect(trendPeriods(weeks, "ca", "week")[0]!.qtyHundredths).toBe(200000);
  });

  it("carries no Usd-keyed field", () => {
    expect(Object.keys(trendPeriods(weeks, "us", "month")[0]!).some((k) => /usd/i.test(k))).toBe(false);
  });
});

describe("aggregateWeeks â€” HST on the combined band (T-92)", () => {
  /** One week with round figures: US 1000 gal at $5 diesel; CA 2000 L, diesel 1130 with tax / 1000 pre-tax, DEF 113 / 100. */
  function week(): WeekFigures {
    const base = overviewFixture("all")[0]!;
    return {
      ...base,
      fx: 1.5,
      us: { ...base.us!, gal: 1000, diesel: 5000, def: 0, defGal: 0, other: 0 },
      ca: { ...base.ca!, litres: 2000, dieselWithTax: 1130, dieselPreTax: 1000, defWithTax: 113, defPreTax: 100, defLitres: 10, other: 0 },
    };
  }

  it("diesel and DEF HST are the CA side's, and the US side adds none", () => {
    const c = aggregateWeeks([week()]).combined!;
    expect(c.dieselHst).toBe(130);
    expect(c.defHst).toBe(13);
    expect(c.hst).toBe(143);
    expect(c.caWeeks).toBe(1);
  });

  it("pre-tax price is (US diesel x rate + CA diesel pre-tax) / litres", () => {
    const c = aggregateWeeks([week()]).combined!;
    const litres = 1000 * LITRES_PER_GALLON + 2000;
    expect(c.pricePreTaxPerLitre).toBe((5000 * 1.5 + 1000) / litres);
    expect(c.pricePreTaxPerLitre!).toBeLessThan(c.pricePerLitre!);
  });

  it("a US-only week has no CA weeks and no HST", () => {
    const w = { ...week(), ca: null };
    const c = aggregateWeeks([w]).combined!;
    expect(c.caWeeks).toBe(0);
    expect(c.hst).toBe(0);
    expect(c.pricePreTaxPerLitre).toBe(c.pricePerLitre);
  });
});

