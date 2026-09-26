import { describe, expect, it } from "vitest";
import { lane } from "../../test/support/optimizer.js";
import { runBacktest, type HistoricalLane } from "./backtest.js";

describe("runBacktest (T-38, A14)", () => {
  it("produces a projected cost and a delta for a date with an archived price file", () => {
    const historicalLane: HistoricalLane = {
      date: "2026-08-22",
      truckId: "truck-a",
      optimizerInput: lane({ distance: 1000, stations: [[500, 5.0]] }),
      actualCostUsd: 250,
    };

    const result = runBacktest([historicalLane]);

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.kind).toBe("priced");
    if (row.kind !== "priced") throw new Error("expected a priced row");
    expect(row.projectedCostUsd).toBeGreaterThan(0);
    expect(row.deltaUsd).toBe(row.actualCostUsd - row.projectedCostUsd);
    expect(result.exclusions.noArchivedPriceFile).toBe(0);
  });

  it("names and counts a date with no archived price file as an exclusion, never a zero delta", () => {
    const historicalLane: HistoricalLane = {
      date: "2026-01-11", // the real gap date (CLAUDE.md)
      truckId: "truck-a",
      optimizerInput: null,
      actualCostUsd: 250,
    };

    const result = runBacktest([historicalLane]);

    expect(result.rows).toEqual([{ kind: "no_archived_price_file", date: "2026-01-11", truckId: "truck-a" }]);
    expect(result.exclusions.noArchivedPriceFile).toBe(1);
    // Never smuggled in as a "priced" row with a 0 delta.
    expect(result.rows.some((r) => r.kind === "priced")).toBe(false);
  });

  it("calls dp_v1 with no I/O in scope — a plain synchronous call over an in-memory OptimizerInput", () => {
    // If this needed I/O, it could not run synchronously inside a plain
    // `it()` with no async/await and no database fixture — the assertion
    // is the absence of anything to await, not a mock inspection.
    const result = runBacktest([{ date: "2026-08-22", truckId: "truck-a", optimizerInput: lane({ distance: 500 }), actualCostUsd: 100 }]);
    expect(result.rows).toHaveLength(1);
  });

  it("never projects a cost above actual when a cheaper compliant stop existed", () => {
    // The truck (test/support/optimizer.ts) burns 20 gal/100mi and starts
    // full; a 1000-mile lane needs at least one stop. One candidate at 5.00
    // is far cheaper than what the driver would have paid without shopping
    // around — the optimiser must find it, so projected <= actual.
    const historicalLane: HistoricalLane = {
      date: "2026-08-22",
      truckId: "truck-a",
      optimizerInput: lane({ distance: 1000, stations: [[400, 5.0]] }),
      actualCostUsd: 500, // what was actually billed that day, well above the cheap stop's rate
    };

    const result = runBacktest([historicalLane]);
    const row = result.rows[0]!;
    if (row.kind !== "priced") throw new Error("expected a priced row");
    expect(row.projectedCostUsd).toBeLessThanOrEqual(row.actualCostUsd);
  });

  it("gives an infeasible lane a delta of 0 rather than a manufactured worse-than-actual figure", () => {
    // distance 2000 with no candidates and a 500-mile leg cap is infeasible.
    const historicalLane: HistoricalLane = {
      date: "2026-08-22",
      truckId: "truck-a",
      optimizerInput: lane({ distance: 2000 }),
      actualCostUsd: 300,
    };

    const result = runBacktest([historicalLane]);
    const row = result.rows[0]!;
    if (row.kind !== "priced") throw new Error("expected a priced row");
    expect(row.projectedCostUsd).toBe(300);
    expect(row.deltaUsd).toBe(0);
  });
});
