import { describe, expect, it } from "vitest";
import { invoiceGaps } from "./invoiceGapReport.js";

describe("invoiceGaps", () => {
  it("reports no gaps for a single period covering the whole range", () => {
    const periods = [{ periodStart: "2026-01-01", periodEnd: "2026-01-10" }];
    expect(invoiceGaps(periods, { start: "2026-01-01", end: "2026-01-10" })).toEqual([]);
  });

  it("reports the days between two non-adjacent periods", () => {
    const periods = [
      { periodStart: "2026-01-01", periodEnd: "2026-01-03" },
      { periodStart: "2026-01-08", periodEnd: "2026-01-10" },
    ];
    expect(invoiceGaps(periods, { start: "2026-01-01", end: "2026-01-10" })).toEqual([
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
    ]);
  });

  it("treats overlapping periods as a single covered range, not a duplicate", () => {
    const periods = [
      { periodStart: "2026-09-03", periodEnd: "2026-09-09" },
      { periodStart: "2026-09-03", periodEnd: "2026-09-10" },
    ];
    expect(invoiceGaps(periods, { start: "2026-09-01", end: "2026-09-10" })).toEqual([
      "2026-09-01",
      "2026-09-02",
    ]);
  });

  it("reports the full range as gaps when no periods are given", () => {
    expect(invoiceGaps([], { start: "2026-02-01", end: "2026-02-03" })).toEqual([
      "2026-02-01",
      "2026-02-02",
      "2026-02-03",
    ]);
  });
});
