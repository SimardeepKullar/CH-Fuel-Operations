import { describe, expect, it } from "vitest";
import { aggregateWeeks, LITRES_PER_GALLON, receiptPercent, trendChange, trendSeries, type WeekFigures } from "./overviewAggregate";
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
    expect(agg.ca!.hst).toBeCloseTo(agg.ca!.total - agg.ca!.dieselPreTax - agg.ca!.defPreTax, 6);
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
    expect(agg.ca!.total).toBeCloseTo(46559.28 + 174.05, 6);
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
