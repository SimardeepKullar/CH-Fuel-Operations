import { describe, expect, it } from "vitest";
import { invoiceGaps, invoiceGapsByCurrency } from "./invoiceGapReport.js";

describe("invoiceGaps", () => {
  it("reports no gaps for a single range covering the whole span", () => {
    const ranges = [{ start: "2026-01-01", end: "2026-01-10" }];
    expect(invoiceGaps(ranges, { start: "2026-01-01", end: "2026-01-10" })).toEqual([]);
  });

  it("reports the days between two non-adjacent ranges", () => {
    const ranges = [
      { start: "2026-01-01", end: "2026-01-03" },
      { start: "2026-01-08", end: "2026-01-10" },
    ];
    expect(invoiceGaps(ranges, { start: "2026-01-01", end: "2026-01-10" })).toEqual([
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
    ]);
  });

  it("treats overlapping ranges as a single covered range, not a duplicate", () => {
    const ranges = [
      { start: "2026-09-03", end: "2026-09-09" },
      { start: "2026-09-03", end: "2026-09-10" },
    ];
    expect(invoiceGaps(ranges, { start: "2026-09-01", end: "2026-09-10" })).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("reports the full range as gaps when no ranges are given", () => {
    expect(invoiceGaps([], { start: "2026-02-01", end: "2026-02-03" })).toEqual([
      "2026-02-01",
      "2026-02-02",
      "2026-02-03",
    ]);
  });

  it("999217's actual range leaves Aug 1 – Sep 2 uncovered, though it printed a start of Aug 1 (T-63)", () => {
    // Printed 2026-08-01 .. 2026-09-09; transactions 2026-09-03 .. 2026-09-10.
    const gaps = invoiceGaps([{ start: "2026-09-03", end: "2026-09-10" }], { start: "2026-08-01", end: "2026-09-10" });
    expect(gaps).toHaveLength(33);
    expect(gaps[0]).toBe("2026-08-01");
    expect(gaps[gaps.length - 1]).toBe("2026-09-02");
    // The printed range would have called them covered:
    expect(invoiceGaps([{ start: "2026-08-01", end: "2026-09-09" }], { start: "2026-08-01", end: "2026-09-10" })).toEqual(["2026-09-10"]);
  });
});

describe("invoiceGapsByCurrency", () => {
  it("judges each currency against its own invoices only: a US invoice covers nothing for the CA side", () => {
    const sides = invoiceGapsByCurrency([
      { currency: "USD", actualStart: "2026-08-01", actualEnd: "2026-08-07" },
      { currency: "USD", actualStart: "2026-08-15", actualEnd: "2026-08-21" },
      { currency: "CAD", actualStart: "2026-08-01", actualEnd: "2026-08-07" },
      { currency: "CAD", actualStart: "2026-08-15", actualEnd: "2026-08-21" },
      // A US invoice spanning the CA gap must not close it.
      { currency: "USD", actualStart: "2026-08-08", actualEnd: "2026-08-14" },
    ]);
    expect(sides.map((s) => s.currency)).toEqual(["USD", "CAD"]);
    expect(sides[0]).toMatchObject({ range: { start: "2026-08-01", end: "2026-08-21" }, gaps: [] });
    expect(sides[1]!.range).toEqual({ start: "2026-08-01", end: "2026-08-21" });
    expect(sides[1]!.gaps).toEqual([
      "2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14",
    ]);
  });

  it("omits a side with nothing to cover, and skips an invoice with no transactions", () => {
    expect(invoiceGapsByCurrency([])).toEqual([]);
    expect(invoiceGapsByCurrency([{ currency: "CAD", actualStart: null, actualEnd: null }])).toEqual([]);
    const sides = invoiceGapsByCurrency([
      { currency: "USD", actualStart: "2026-03-01", actualEnd: "2026-03-03" },
      { currency: "CAD", actualStart: null, actualEnd: null },
    ]);
    expect(sides.map((s) => s.currency)).toEqual(["USD"]);
  });
});
