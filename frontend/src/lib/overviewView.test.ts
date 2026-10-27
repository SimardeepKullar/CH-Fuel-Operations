import { describe, expect, it } from "vitest";
import { overviewFixture, SCENARIO_START, weekEndsOf, type OverviewScenario } from "./overviewFixtures";
import { buildDriverView, buildTrends, chartGeometry, niceStep, paddedRange } from "./overviewCharts";
import type { Scope } from "./overviewScope";
import { buildOverviewView, rangeLabel, weekOverWeek } from "./overviewView";

const href = (side: string) => `/transactions?side=${side}`;

function scopeFor(scenario: OverviewScenario): Scope {
  const weeks = overviewFixture(scenario);
  const ends = weekEndsOf(weeks);
  const s = SCENARIO_START[scenario];
  if (s.mode === "week") return { mode: "week", week: ends[s.week!]! };
  if (s.mode === "range") return { mode: "range", from: ends[s.from!]!, to: ends[s.to!]! };
  return { mode: "all" };
}

const view = (scenario: OverviewScenario) => buildOverviewView(overviewFixture(scenario), scopeFor(scenario), href);

describe("rangeLabel", () => {
  it("collapses a shared month", () => {
    expect(rangeLabel("2026-09-03", "2026-09-09")).toBe("Sep 3 – 9");
    expect(rangeLabel("2026-08-30", "2026-09-05")).toBe("Aug 30 – Sep 5");
  });
});

describe("1a all time", () => {
  const v = view("all");
  it("reads out the scope and the weeks", () => {
    expect(v.readout).toBe("All time · 14 weeks · Aug 4 – Nov 9");
    expect(v.rateMeta).toBe("Exchange rates entered for 14 of 14 weeks");
    expect(v.invoices).toMatchObject({ single: false, summaryLabel: "All invoices", count: 28, split: "14 US · 14 CA" });
    expect(v.fxNotice).toBeNull();
  });
  it("has the US tiles with weekly low/high and a CA-units variant", () => {
    expect(v.us.big[1]!.label).toBe("Average billed price");
    expect(v.us.big[1]!.sub).toBe("Weekly low $5.52 · high $5.74");
    const ca = v.us.caUnits!;
    expect(ca.big[1]!.value).toMatch(/^\$\d\.\d{4}$/);
    expect(ca.big[1]!.unit).toBe("/ L");
    expect(ca.small[0]!.sub).toMatch(/ L$/);
    expect(ca.small.map((t) => t.label)).toEqual(v.us.small.map((t) => t.label));
    expect(v.us.small.map((t) => t.label)).toEqual(["Diesel", "DEF", "Other charges", "Discount captured", "Receipt compliance", "Anomalies flagged"]);
    expect(v.us.small[5]!.link).toEqual({ text: "View →", href: "/transactions?side=us" });
  });
  it("has the CA tiles with HST notes", () => {
    expect(v.ca.big[1]!.label).toBe("Billed price, with HST");
    expect(v.ca.big[0]!.note).toMatch(/^HST CA\$/);
    expect(v.ca.sub).toBe("14 invoices · Aug 4 – Nov 9 · CAD incl. HST · litres");
  });
  it("has the combined headline, split, price, discount and attention counts", () => {
    expect(v.combined.total!.label).toBe("Total Spend - Combined");
    expect(v.combined.kpis.map((k) => k.label)).toEqual(["Average billed price", "Diesel", "DEF", "Other charges", "Discount captured"]);
    const [us, ca] = v.combined.shares!;
    expect(us.pct + ca.pct).toBe(100);
    expect(v.combined.attention.anomalies.count).toBe(v.agg.us!.anomalies + v.agg.ca!.anomalies);
    expect(v.combined.rate).toBe("1.42");
    expect(v.combined.rateLabel).toBe("CAD per USD · avg of 14 wks");
  });
});

describe("1b single week", () => {
  const v = view("week");
  it("shows two chips and the single-week sub lines", () => {
    expect(v.invoices.single).toBe(true);
    expect(v.invoices.weekChips.map((c) => c.absent)).toEqual([false, false]);
    expect(v.readout).toMatch(/^Billing week · /);
    expect(v.rateMeta).toBe("Exchange rate 1.42 CAD per USD");
    expect(v.us.big[1]!.sub).toMatch(/^[+−]\d\.\d% vs wk of Oct 27 · Discount \$\d\.\d{4} \/ gal off retail$/);
    expect(v.us.small[2]!.sub).toBe("Scale, express and fees");
    expect(v.combined.rateLabel).toBe("CAD per USD");
  });
});

describe("1c four-week range", () => {
  const v = view("range");
  it("is a range of four weeks", () => {
    expect(v.readout).toMatch(/^Range · 4 weeks · /);
    expect(v.invoices.summaryLabel).toBe("Invoices in range");
    expect(v.invoices.count).toBe(8);
    expect(v.us.small[5]!.link!.href).toBe("/transactions?side=us");
  });
});

describe("1d today's real data", () => {
  const v = view("today");
  it("shows invoice 999210 and 999217", () => {
    expect(v.readout).toBe("All time · 1 week · Sep 3 – 9");
    expect(v.us.sub).toBe("Invoice 999210 · Sep 3 – 9 · USD · gallons");
    expect(v.ca.sub).toBe("Invoice 999217 · Sep 3 – 9 · CAD incl. HST · litres");
    expect(v.us.big[1]!.value).toBe("$5.5479");
    expect(v.us.small[4]).toMatchObject({ value: "0%", color: "#c13b3b", sub: "0 of 66 confirmed" });
  });
  it("renders no NaN or Infinity in any label", () => {
    const text = JSON.stringify([v.us, v.ca, v.combined, v.invoices, v.readout, v.rateMeta]);
    expect(text).not.toMatch(/NaN|Infinity|undefined/);
  });
  it("has no chart: one of four weeks imported", () => {
    const [us, ca] = buildTrends(overviewFixture("today"), { mode: "all" }, v.span);
    for (const t of [us, ca]) {
      expect(t.chart).toBeNull();
      expect(t.progress).toEqual({ filled: 1, total: 4 });
      expect(t.note).toBe("1 of 4 weeks imported. The trend line appears once 4 weeks are in.");
      expect(t.delta).toBe("");
    }
    expect(us.value).toBe("$5.55");
    expect(ca.value).toBe("$2.18");
  });
  it("has drivers that stack with a rate", () => {
    const d = buildDriverView(overviewFixture("today"), { mode: "all" }, "us");
    expect(d.split).toBe(false);
    expect(d.columns.length).toBeGreaterThan(0);
  });
});

describe("1e rate missing for three weeks", () => {
  const v = view("fxpartial");
  it("shows the partial notice and coverage", () => {
    expect(v.fxNotice!.text).toBe("3 of 14 weeks have no exchange rate. Converted figures cover 11 weeks.");
    expect(v.fxNotice!.missing).toBe("Missing: week of Sep 8, week of Oct 6, week of Oct 27");
    expect(v.combined.sub).toContain("covers 11 of 14 weeks");
    expect(v.us.caUnits!.big[1]!.sub).toMatch(/· 11 of 14 wks$/);
    expect(v.rateMeta).toBe("Exchange rates entered for 11 of 14 weeks");
  });
  it("says the US driver segments cover 11 weeks", () => {
    expect(buildDriverView(overviewFixture("fxpartial"), { mode: "all" }, "us").sub).toMatch(/US segments cover 11 of 14 weeks$/);
  });
});

describe("1f no rate anywhere", () => {
  const v = view("fxnone");
  it("hides converted figures and asks for a rate", () => {
    expect(v.fxNotice!.text).toBe("None of the 14 weeks have an exchange rate. Converted (CAD) figures are hidden.");
    expect(v.combined).toMatchObject({ show: false, none: true, rate: "—" });
    expect(v.us.caUnits).toBeNull();
  });
  it("splits the drivers into one currency per view", () => {
    const us = buildDriverView(overviewFixture("fxnone"), { mode: "all" }, "us");
    const ca = buildDriverView(overviewFixture("fxnone"), { mode: "all" }, "ca");
    expect(us).toMatchObject({ split: true, unit: "USD" });
    expect(ca).toMatchObject({ split: true, unit: "CAD" });
    // The CA view leaves out drivers with no Canadian spend.
    expect(ca.columns.some((c) => c.name === "Driver 2")).toBe(false);
    expect(us.columns.some((c) => c.name === "Driver 2")).toBe(true);
    expect(ca.columns.every((c) => c.caHeight > 0 && c.usHeight === 0)).toBe(true);
  });
});

describe("1g US invoice only (week of Oct 13)", () => {
  const v = view("usonly");
  it("keeps the CA card and leaves it out of combined", () => {
    expect(v.ca.present).toBe(false);
    expect(v.ca.absentMessage).toBe("No Canadian invoice for Oct 13 – 19");
    expect(v.invoices.weekChips.map((c) => [c.code, c.absent])).toEqual([
      ["US", false],
      ["CA", true],
    ]);
    expect(v.invoices.weekChips[1]!.text).toBe("No Canadian invoice this week");
    expect(v.combined.sub).toContain("US only this week");
  });
  it("shows no Canadian fuel in the CA trend", () => {
    const [, ca] = buildTrends(overviewFixture("usonly"), scopeFor("usonly"), v.span);
    expect(ca.none).toBe("No Canadian fuel in this scope.");
  });
});

describe("1h CA invoice only (week of Oct 20)", () => {
  const v = view("caonly");
  it("keeps the US card as an empty state", () => {
    expect(v.us.present).toBe(false);
    expect(v.us.absentMessage).toBe("No US invoice for Oct 20 – 26");
    expect(v.combined.sub).toContain("Canada only this week");
  });
});

describe("trend charts", () => {
  it("draws a chart over 14 weeks with the change since the first week", () => {
    const [us, ca] = buildTrends(overviewFixture("all"), { mode: "all" }, "x");
    expect(us.chart!.values).toHaveLength(14);
    expect(us.value).toBe("$5.55");
    expect(us.delta).toBe("−2.8% since Aug 4");
    expect(ca.delta).toBe("−5.6% since Aug 4");
  });

  it("a three-week range is a headline with the quiet line, not a chart", () => {
    const weeks = overviewFixture("all");
    const ends = weekEndsOf(weeks);
    const [us] = buildTrends(weeks, { mode: "range", from: ends[11]!, to: ends[13]! }, "x");
    expect(us.chart).toBeNull();
    expect(us.note).toBe("3 of 4 weeks in this range. The trend line appears once 4 weeks are in.");
    expect(us.progress).toEqual({ filled: 3, total: 4 });
  });

  it("a single week compares with the week before, in the tiles", () => {
    const weeks = overviewFixture("all");
    expect(weekOverWeek(weeks, weeks[13]!, "us")).toMatch(/^[+−]\d\.\d% vs wk of Oct 27$/);
    expect(weekOverWeek(weeks, weeks[13]!, "ca")).toMatch(/^[+−]\d\.\d% vs wk of Oct 27$/);
    expect(weekOverWeek(weeks, weeks[0]!, "us")).toBe("");
  });

  it("no change when that side has no invoice in either week", () => {
    const weeks = overviewFixture("usonly");
    expect(weekOverWeek(weeks, weeks[10]!, "ca")).toBe("");
  });

  it("the trend shows only when the scope covers more than one week", () => {
    const weeks = overviewFixture("all");
    const v = (scope: Scope) => buildOverviewView(weeks, scope, () => "/t").showTrend;
    expect(v({ mode: "week", week: weekEndsOf(weeks)[5]! })).toBe(false);
    expect(v({ mode: "all" })).toBe(true);
    expect(v({ mode: "range", from: weekEndsOf(weeks)[4]!, to: weekEndsOf(weeks)[5]! })).toBe(true);
  });

  it("a week with no fuel breaks the line", () => {
    const weeks = overviewFixture("usonly");
    const [, ca] = buildTrends(weeks, { mode: "all" }, "x");
    expect(ca.chart!.values[10]).toBeNull();
    const g = chartGeometry(ca.chart!.values, false);
    expect(g.points[10]).toBeNull();
    expect(g.points[11]).not.toBeNull();
    expect(g.lastIndex).toBe(13);
  });

  it("pads the y range by 25% and at least 0.02", () => {
    expect(paddedRange([2, 3, null])).toEqual({ lo: 1.75, hi: 3.25 });
    expect(paddedRange([5, 5])).toEqual({ lo: 4.98, hi: 5.02 });
  });

  it("has four gridlines with two-decimal labels", () => {
    const g = chartGeometry([2.2, 2.3], false);
    expect(g.gridLabels).toHaveLength(4);
    expect(g.gridLabels.every((l) => /^\d\.\d{2}$/.test(l.text))).toBe(true);
  });
});

describe("driver columns", () => {
  const d = buildDriverView(overviewFixture("all"), { mode: "all" }, "us");

  it("lists the top ten by US spend, then the rest as one column", () => {
    expect(d.columns).toHaveLength(11);
    expect(d.columns[0]!.name).toBe("Driver 1");
    expect(d.columns[10]).toMatchObject({ name: "All other drivers", sub: "6 drivers" });
    expect(d.sub).toBe("Stacked in CAD · US converted at each week’s rate · sorted by US spend");
  });

  it("a driver with no CA spend has only the navy segment", () => {
    const col = d.columns[1]!;
    expect(col.name).toBe("Driver 2");
    expect(col.caHeight).toBe(0);
    expect(col.usHeight).toBeGreaterThan(0);
    expect(d.columns.every((c) => c.usHeight + c.caHeight <= 100)).toBe(true);
  });

  it("tooltips carry both currencies and both units", () => {
    const col = d.columns[2]!;
    expect(col.usTooltip.title).toBe("Driver 3 · United States");
    expect(col.usTooltip.rows[0]!.value).toMatch(/^US\$[\d,]+\.\d{2} · CA\$[\d,]+\.\d{2}$/);
    expect(col.usTooltip.rows[1]!.value).toMatch(/ gal$/);
    expect(col.usTooltip.rows[2]!.value).toMatch(/^US\$\d\.\d{4} \/ gal$/);
    expect(col.caTooltip.rows[1]!.value).toMatch(/ L$/);
    expect(col.caTooltip.rows[2]!.value).toMatch(/^CA\$\d\.\d{4} \/ L$/);
  });

  it("has five nice ticks", () => {
    expect(d.ticks).toHaveLength(5);
    expect(d.ticks[0]).toEqual({ bottom: 0, label: "0" });
    expect(niceStep(20000)).toBe(5000);
    expect(niceStep(9000)).toBe(2500);
  });
});
