import { describe, expect, it } from "vitest";
import { defaultRange, normaliseRange, parseScope, scopeForMode, scopeToQuery, weekEndsInScope, writeScope } from "./overviewScope";

const WEEKS = ["2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26", "2026-09-02", "2026-09-09"];
const q = (s: string) => new URLSearchParams(s);

describe("parseScope", () => {
  it("is all time with no scope", () => {
    expect(parseScope(q(""), WEEKS)).toEqual({ mode: "all" });
    expect(parseScope(q("scope=nonsense"), WEEKS)).toEqual({ mode: "all" });
    expect(parseScope(q("scope=all"), WEEKS)).toEqual({ mode: "all" });
  });

  it("reads a week, falling back to the latest for an unknown one", () => {
    expect(parseScope(q("scope=week&w=2026-08-19"), WEEKS)).toEqual({ mode: "week", week: "2026-08-19" });
    expect(parseScope(q("scope=week&w=1999-01-01"), WEEKS)).toEqual({ mode: "week", week: "2026-09-09" });
    expect(parseScope(q("scope=week"), WEEKS)).toEqual({ mode: "week", week: "2026-09-09" });
  });

  it("reads a range and normalises a reversed one", () => {
    expect(parseScope(q("scope=range&from=2026-08-12&to=2026-09-02"), WEEKS)).toEqual({ mode: "range", from: "2026-08-12", to: "2026-09-02" });
    expect(parseScope(q("scope=range&from=2026-09-02&to=2026-08-12"), WEEKS)).toEqual({ mode: "range", from: "2026-08-12", to: "2026-09-02" });
  });

  it("falls back to the last four weeks for a range it cannot read", () => {
    expect(parseScope(q("scope=range&from=bad&to=2026-09-02"), WEEKS)).toEqual({ mode: "range", from: "2026-08-19", to: "2026-09-09" });
  });

  it("is all time when nothing is imported", () => {
    expect(parseScope(q("scope=week&w=2026-09-09"), [])).toEqual({ mode: "all" });
    expect(parseScope(q("scope=range"), [])).toEqual({ mode: "all" });
  });
});

describe("scopeForMode / defaultRange", () => {
  it("Week defaults to the latest week, Range to the last four", () => {
    expect(scopeForMode("week", WEEKS)).toEqual({ mode: "week", week: "2026-09-09" });
    expect(scopeForMode("range", WEEKS)).toEqual({ mode: "range", from: "2026-08-19", to: "2026-09-09" });
    expect(scopeForMode("all", WEEKS)).toEqual({ mode: "all" });
  });

  it("a range over fewer than four weeks takes what exists", () => {
    expect(defaultRange(["2026-09-09"])).toEqual({ mode: "range", from: "2026-09-09", to: "2026-09-09" });
  });

  it("normaliseRange orders from and to", () => {
    expect(normaliseRange("b", "a")).toEqual({ mode: "range", from: "a", to: "b" });
  });
});

describe("scopeToQuery / writeScope", () => {
  it("round-trips through the URL", () => {
    for (const scope of [{ mode: "all" }, { mode: "week", week: "2026-08-19" }, { mode: "range", from: "2026-08-12", to: "2026-09-02" }] as const) {
      expect(parseScope(q(scopeToQuery(scope)), WEEKS)).toEqual(scope);
    }
  });

  it("clears the previous scope's keys and keeps unrelated ones", () => {
    const target = q("scope=range&from=2026-08-12&to=2026-09-02&anomalyOnly=true");
    writeScope(target, { mode: "week", week: "2026-09-09" });
    expect(target.get("from")).toBeNull();
    expect(target.get("to")).toBeNull();
    expect(target.get("w")).toBe("2026-09-09");
    expect(target.get("anomalyOnly")).toBe("true");
  });
});

describe("weekEndsInScope", () => {
  it("covers all, one, or an inclusive range", () => {
    expect(weekEndsInScope({ mode: "all" }, WEEKS)).toEqual(WEEKS);
    expect(weekEndsInScope({ mode: "week", week: "2026-08-19" }, WEEKS)).toEqual(["2026-08-19"]);
    expect(weekEndsInScope({ mode: "range", from: "2026-08-12", to: "2026-08-26" }, WEEKS)).toEqual(["2026-08-12", "2026-08-19", "2026-08-26"]);
  });

  it("tolerates a reversed range and an unknown week", () => {
    expect(weekEndsInScope({ mode: "range", from: "2026-08-26", to: "2026-08-12" }, WEEKS)).toHaveLength(3);
    expect(weekEndsInScope({ mode: "week", week: "1999-01-01" }, WEEKS)).toEqual([]);
  });
});
