import { describe, expect, it } from "vitest";
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";
import { anchorWeek, normaliseDays, rangeForDays, resolveSide, scopeDays, scopeQuery, transactionsScope } from "./transactionsScope";

const q = (s: string) => new URLSearchParams(s);
const inv = (id: string, currency: "USD" | "CAD"): PeriodInvoice => ({
  id,
  invoiceNumber: id,
  currency,
  printedStart: "2026-09-03",
  printedEnd: "2026-09-09",
  actualStart: null,
  actualEnd: null,
  datesDiffer: false,
  fx: null,
});
const weeks: PeriodWeek[] = [
  { weekEnd: "2026-09-16", invoices: [inv("u2", "USD")] },
  { weekEnd: "2026-09-09", invoices: [inv("u1", "USD"), inv("c1", "CAD")] },
];
const ends = ["2026-09-09", "2026-09-16"];

describe("transactionsScope", () => {
  it("falls back to the shell's week when the URL names no scope", () => {
    expect(transactionsScope(q(""), ends, "2026-09-16")).toEqual({ mode: "week", week: "2026-09-16" });
    expect(transactionsScope(q(""), ends, null)).toEqual({ mode: "all" });
  });

  it("reads the Overview's scope keys as the Overview does", () => {
    expect(transactionsScope(q("scope=all"), ends, "2026-09-16")).toEqual({ mode: "all" });
    expect(transactionsScope(q("scope=range&from=2026-09-09&to=2026-09-16"), ends, null)).toEqual({ mode: "range", from: "2026-09-09", to: "2026-09-16" });
  });
});

describe("scopeQuery / anchorWeek", () => {
  it("maps a scope onto the list endpoint's week filter", () => {
    expect(scopeQuery({ mode: "all" })).toEqual({});
    expect(scopeQuery({ mode: "week", week: "2026-09-09" })).toEqual({ week: "2026-09-09" });
    expect(scopeQuery({ mode: "range", from: "2026-09-09", to: "2026-09-16" })).toEqual({ weekFrom: "2026-09-09", weekTo: "2026-09-16" });
  });

  it("anchors on the scope's own week, its end, or the latest", () => {
    expect(anchorWeek({ mode: "week", week: "2026-09-09" }, ends)).toBe("2026-09-09");
    expect(anchorWeek({ mode: "range", from: "2026-09-09", to: "2026-09-16" }, ends)).toBe("2026-09-16");
    expect(anchorWeek({ mode: "all" }, ends)).toBe("2026-09-16");
    expect(anchorWeek({ mode: "all" }, [])).toBeNull();
  });
});

describe("resolveSide", () => {
  const week = { mode: "week", week: "2026-09-09" } as const;
  it("a currency param wins", () => {
    expect(resolveSide(week, "CAD", null, weeks)).toBe("CAD");
    expect(resolveSide({ mode: "all" }, "USD", null, weeks)).toBe("USD");
    expect(resolveSide(week, "all", null, weeks)).toBe("all");
  });
  it("an old ?invoice= link means that invoice's side", () => {
    expect(resolveSide(week, null, "c1", weeks)).toBe("CAD");
    expect(resolveSide(week, null, "all", weeks)).toBe("all");
  });
  it("a single week defaults to its first invoice, a range or all time to both", () => {
    expect(resolveSide(week, null, null, weeks)).toBe("USD");
    expect(resolveSide({ mode: "all" }, null, null, weeks)).toBe("all");
    expect(resolveSide({ mode: "range", from: "2026-09-09", to: "2026-09-16" }, null, null, weeks)).toBe("all");
  });
  it("a week with no invoices shows both", () => {
    expect(resolveSide({ mode: "week", week: "1999-01-01" }, null, null, weeks)).toBe("all");
  });
});

describe("exact days under Range (T-87)", () => {
  const WEEKS = [
    { weekEnd: "2026-09-02", start: "2026-08-27", end: "2026-09-02" },
    { weekEnd: "2026-09-09", start: "2026-09-03", end: "2026-09-10" },
    { weekEnd: "2026-09-16", start: "2026-09-10", end: "2026-09-16" },
  ];
  const RANGE = { mode: "range", from: "2026-09-02", to: "2026-09-09" } as const;

  it("reads days only on a range", () => {
    expect(scopeDays(q("dayFrom=2026-09-08&dayTo=2026-09-09"), RANGE)).toEqual({ from: "2026-09-08", to: "2026-09-09" });
    expect(scopeDays(q("dayFrom=2026-09-08"), { mode: "all" })).toEqual({ from: "", to: "" });
    expect(scopeDays(q("dayFrom=2026-09-08"), { mode: "week", week: "2026-09-09" })).toEqual({ from: "", to: "" });
  });

  it("swaps a reversed pair and leaves an open side open", () => {
    expect(normaliseDays("2026-09-09", "2026-09-08")).toEqual({ from: "2026-09-08", to: "2026-09-09" });
    expect(normaliseDays("2026-09-09", "")).toEqual({ from: "2026-09-09", to: "" });
  });

  it("covers every week the days touch, a shared day included", () => {
    expect(rangeForDays({ from: "2026-09-05", to: "2026-09-06" }, WEEKS)).toEqual({ mode: "range", from: "2026-09-09", to: "2026-09-09" });
    expect(rangeForDays({ from: "2026-09-10", to: "2026-09-10" }, WEEKS)).toEqual({ mode: "range", from: "2026-09-09", to: "2026-09-16" });
    expect(rangeForDays({ from: "2026-09-01", to: "2026-09-12" }, WEEKS)).toEqual({ mode: "range", from: "2026-09-02", to: "2026-09-16" });
  });

  it("an open side runs to the end of the weeks", () => {
    expect(rangeForDays({ from: "2026-09-11", to: "" }, WEEKS)).toEqual({ mode: "range", from: "2026-09-16", to: "2026-09-16" });
    expect(rangeForDays({ from: "", to: "2026-09-01" }, WEEKS)).toEqual({ mode: "range", from: "2026-09-02", to: "2026-09-02" });
  });

  it("days outside every week touch none", () => {
    expect(rangeForDays({ from: "2027-01-01", to: "2027-01-02" }, WEEKS)).toBeNull();
  });
});
