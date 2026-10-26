import { describe, expect, it } from "vitest";
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";
import { anchorWeek, resolveSide, scopeQuery, transactionsScope } from "./transactionsScope";

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
