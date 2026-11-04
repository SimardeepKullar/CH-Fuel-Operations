// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WeekFigures } from "../../lib/overviewAggregate";
import { buildTrends } from "../../lib/overviewCharts";
import TrendCard from "./TrendCard";

const us = (gal: number, diesel: number) => ({ invoice: "i", gal, diesel, def: 0, defGal: 0, other: 0, disc: 0, stops: 1, receiptsExpected: 0, receiptsConfirmed: 0, anomalies: 0 });
const ca = (litres: number, withTax: number, preTax: number) => ({
  invoice: "i", litres, dieselWithTax: withTax, dieselPreTax: preTax, defWithTax: 0, defPreTax: 0, defLitres: 0, other: 0, disc: 0, stops: 1, receiptsExpected: 0, receiptsConfirmed: 0, anomalies: 0,
});
const week = (start: string, end: string, u: ReturnType<typeof us> | null, c: ReturnType<typeof ca> | null): WeekFigures => ({ weekEnd: end, start, end, fx: null, us: u, ca: c, drivers: [] });

// Two months, four billing weeks; the Oct 7 week bought no Canadian fuel.
const WEEKS = [
  week("2026-09-03", "2026-09-09", us(3000, 18000), ca(1000, 2400, 2123.9)),
  week("2026-09-10", "2026-09-16", us(1000, 5000), ca(2000, 4600, 4070.8)),
  week("2026-10-01", "2026-10-07", us(500, 2500), null),
  week("2026-10-15", "2026-10-21", us(2000, 11000), ca(1000, 2200, 1946.9)),
];
const ONE_MONTH = [
  week("2026-10-01", "2026-10-07", us(500, 2500), ca(1000, 2400, 2123.9)),
  week("2026-10-08", "2026-10-14", us(500, 2600), ca(1000, 2300, 2035.4)),
  week("2026-10-15", "2026-10-21", us(500, 2700), ca(1000, 2200, 1946.9)),
  week("2026-10-22", "2026-10-28", us(500, 2800), ca(1000, 2100, 1858.4)),
];

const trendOf = (weeks: WeekFigures[], side: 0 | 1, grain: "week" | "month") => buildTrends(weeks, { mode: "all" }, "x", grain)[side];

function renderCard(side: 0 | 1, grain: "week" | "month" = "week", weeks = WEEKS) {
  const onGrainChange = vi.fn();
  const trend = trendOf(weeks, side, grain);
  render(<TrendCard trend={trend} onGrainChange={onGrainChange} />);
  return { onGrainChange, trend, points: screen.getAllByTestId("trend-point").slice(0, trend.chart!.values.length) };
}

/** The tooltip's `key: value` rows as a record. */
function rows(): Record<string, string> {
  const tip = screen.getByTestId("trend-tip");
  const out: Record<string, string> = {};
  tip.querySelectorAll("span").forEach((r) => {
    out[r.querySelector("i")!.textContent!] = r.querySelector("em")!.textContent!;
  });
  return out;
}

afterEach(cleanup);

describe("TrendCard tooltip (T-89)", () => {
  it("hovering a US week shows its range, billed price, gallons and — for the first change", () => {
    const { points } = renderCard(0);
    fireEvent.mouseEnter(points[0]!);
    expect(within(screen.getByTestId("trend-tip")).getByText("Sep 3–9")).toBeTruthy();
    expect(rows()).toEqual({ Billed: "US$6.0000 / gal", Quantity: "3,000.00 gal", Change: "—" });
  });

  it("the next week shows the change against the prior week", () => {
    const { points } = renderCard(0);
    fireEvent.mouseEnter(points[1]!);
    expect(rows()).toEqual({ Billed: "US$5.0000 / gal", Quantity: "1,000.00 gal", Change: "−16.7%" });
  });

  it("focusing a point shows the same figures as hovering it", () => {
    const { points } = renderCard(0);
    fireEvent.mouseEnter(points[1]!);
    const hovered = rows();
    fireEvent.mouseLeave(points[1]!);
    fireEvent.focus(points[1]!);
    expect(rows()).toEqual(hovered);
  });

  it("a CA week shows the with-HST and before-HST prices and litres", () => {
    const { points } = renderCard(1);
    fireEvent.mouseEnter(points[0]!);
    expect(rows()).toEqual({ "With HST": "CA$2.4000 / L", "Before HST": "CA$2.1239 / L", Quantity: "1,000.00 L", Change: "—" });
  });

  it("a period with no fuel shows — for every figure, never 0, and the period after it shows — for change", () => {
    const { points } = renderCard(1);
    fireEvent.mouseEnter(points[2]!);
    expect(rows()).toEqual({ "With HST": "—", "Before HST": "—", Quantity: "—", Change: "—" });
    fireEvent.mouseLeave(points[2]!);
    fireEvent.mouseEnter(points[3]!);
    expect(rows().Change).toBe("—");
  });

  it("Month view shows the month, its week count and its quantity-weighted price", () => {
    const { points } = renderCard(0, "month");
    fireEvent.mouseEnter(points[0]!);
    expect(within(screen.getByTestId("trend-tip")).getByText("Sep 2026 · 2 wks")).toBeTruthy();
    // (18000 + 5000) / (3000 + 1000) = 5.75, not the mean of 6.00 and 5.00.
    expect(rows()).toEqual({ Billed: "US$5.7500 / gal", Quantity: "4,000.00 gal", Change: "—" });
    fireEvent.mouseLeave(points[0]!);
    fireEvent.mouseEnter(points[1]!);
    expect(rows()).toEqual({ Billed: "US$5.4000 / gal", Quantity: "2,500.00 gal", Change: "−6.1%" });
  });

  it("the headline and the latest point's tooltip read the same price", () => {
    for (const grain of ["week", "month"] as const) {
      cleanup();
      const { trend, points } = renderCard(0, grain);
      fireEvent.mouseEnter(points[points.length - 1]!);
      const tipPrice = rows().Billed!.replace("US$", "").split(" ")[0]!;
      expect(trend.value).toBe("$" + Number(tipPrice).toFixed(2));
    }
  });

  it("hides on mouse leave, on blur and on Escape", () => {
    const { points } = renderCard(0);
    fireEvent.mouseEnter(points[0]!);
    fireEvent.mouseLeave(points[0]!);
    expect(screen.queryByTestId("trend-tip")).toBeNull();
    fireEvent.focus(points[0]!);
    expect(screen.getByTestId("trend-tip")).toBeTruthy();
    fireEvent.blur(points[0]!);
    expect(screen.queryByTestId("trend-tip")).toBeNull();
    fireEvent.focus(points[0]!);
    fireEvent.keyDown(points[0]!, { key: "Escape" });
    expect(screen.queryByTestId("trend-tip")).toBeNull();
  });

  it("a tap opens a point's tooltip", () => {
    const { points } = renderCard(0);
    fireEvent.click(points[1]!);
    expect(screen.getByTestId("trend-tip")).toBeTruthy();
  });

  it("every point is keyboard-focusable, labelled with its figures, and has a hit target well over the dot", () => {
    const { points, trend } = renderCard(1);
    expect(points).toHaveLength(4);
    points.forEach((p, i) => {
      expect(p.getAttribute("tabindex")).toBe("0");
      expect(p.getAttribute("aria-label")).toBe(trend.chart!.tips[i]!.text);
      expect(Number(p.getAttribute("r"))).toBeGreaterThanOrEqual(18);
    });
    expect(Number(screen.getAllByTestId("trend-point")[4]!.getAttribute("r"))).toBeGreaterThanOrEqual(24);
  });

  it("anchors the tooltip inside the card at the first and last points", () => {
    const { points } = renderCard(0);
    fireEvent.mouseEnter(points[0]!);
    expect(screen.getByTestId("trend-tip").className).toContain("ov-trend-tip-start");
    fireEvent.mouseLeave(points[0]!);
    fireEvent.mouseEnter(points[3]!);
    expect(screen.getByTestId("trend-tip").className).toContain("ov-trend-tip-end");
  });

  it("carries no Usd-keyed field in the tooltip model", () => {
    const tips = trendOf(WEEKS, 0, "month").chart!.tips;
    expect(JSON.stringify(tips)).not.toMatch(/usd/i);
  });
});

describe("TrendCard Week / Month toggle (T-89)", () => {
  it("pressing Month asks for the month grain; Week is pressed by default", () => {
    const { onGrainChange } = renderCard(0);
    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(onGrainChange).toHaveBeenCalledWith("month");
  });

  it("Month switches the line, the labels and the headline together", () => {
    const week = trendOf(WEEKS, 0, "week");
    const month = trendOf(WEEKS, 0, "month");
    expect(week.chart!.values).toHaveLength(4);
    expect(month.chart!.values).toEqual([5.75, 5.4]);
    expect(month.chart!.labels).toEqual(["Sep 2026", "Oct 2026"]);
    expect(month.value).toBe("$5.40");
    expect(month.delta).toBe("−6.1% since Sep 2026");
    expect(week.delta).not.toBe(month.delta);
  });

  it("Month is disabled, and the card stays weekly, when the scope covers one month", () => {
    const { trend } = renderCard(0, "month", ONE_MONTH);
    expect(trend.canMonth).toBe(false);
    expect(trend.grain).toBe("week");
    expect((screen.getByRole("button", { name: "Month" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the toggle is absent when no chart is drawn", () => {
    cleanup();
    const trend = buildTrends(WEEKS.slice(0, 2), { mode: "all" }, "x")[0];
    render(<TrendCard trend={trend} onGrainChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Month" })).toBeNull();
  });
});
