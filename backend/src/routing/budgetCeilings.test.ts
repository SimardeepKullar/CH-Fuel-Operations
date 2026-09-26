import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET_CEILINGS, resolveBudgetCeilings } from "./budgetCeilings.js";

describe("DEFAULT_BUDGET_CEILINGS", () => {
  it("is ORS's measured free-tier daily limits (§8.3, 2026-09-14)", () => {
    expect(DEFAULT_BUDGET_CEILINGS).toEqual({ directions: 200, matrix: 50, geocoding: 100 });
  });
});

describe("resolveBudgetCeilings", () => {
  it("keeps every default when nothing is set", () => {
    expect(resolveBudgetCeilings({})).toEqual({ directions: 200, matrix: 50, geocoding: 100 });
  });

  it("overrides the endpoint that is set and leaves the others", () => {
    expect(resolveBudgetCeilings({ ORS_DAILY_LIMIT_MATRIX: "2000" })).toEqual({
      directions: 200,
      matrix: 2000,
      geocoding: 100,
    });
    expect(
      resolveBudgetCeilings({
        ORS_DAILY_LIMIT_DIRECTIONS: "500",
        ORS_DAILY_LIMIT_GEOCODING: "1000",
      }),
    ).toEqual({ directions: 500, matrix: 50, geocoding: 1000 });
  });

  it("treats a variable that is explicitly undefined as unset", () => {
    expect(resolveBudgetCeilings({ ORS_DAILY_LIMIT_MATRIX: undefined })).toEqual(DEFAULT_BUDGET_CEILINGS);
  });

  it("accepts 0 as a real ceiling, never as 'unset'", () => {
    expect(resolveBudgetCeilings({ ORS_DAILY_LIMIT_DIRECTIONS: "0" })).toEqual({
      directions: 0,
      matrix: 50,
      geocoding: 100,
    });
  });

  it.each([
    ["abc"],
    ["-1"],
    ["1.5"],
    [""],
    [" "],
    [" 5"],
    ["5 "],
    ["1e3"],
    ["0x10"],
    ["+5"],
    ["Infinity"],
    ["NaN"],
    // Larger than a Postgres integer, so the guard's comparison would fail at call time.
    ["2147483648"],
  ])("throws at startup on %j, naming the variable", (raw) => {
    expect(() => resolveBudgetCeilings({ ORS_DAILY_LIMIT_MATRIX: raw })).toThrow(/ORS_DAILY_LIMIT_MATRIX/);
  });

  it("accepts the largest Postgres integer", () => {
    expect(resolveBudgetCeilings({ ORS_DAILY_LIMIT_MATRIX: "2147483647" }).matrix).toBe(2147483647);
  });

  it("names the variable that is malformed, not another one", () => {
    expect(() =>
      resolveBudgetCeilings({ ORS_DAILY_LIMIT_DIRECTIONS: "10", ORS_DAILY_LIMIT_GEOCODING: "many" }),
    ).toThrow(/ORS_DAILY_LIMIT_GEOCODING/);
  });
});
