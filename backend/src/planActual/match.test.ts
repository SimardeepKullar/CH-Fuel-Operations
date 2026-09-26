import { describe, expect, it } from "vitest";
import { match, type FuelStopForMatch, type PlanStopForMatch } from "./match.js";

const TRUCK_A = "truck-a";
const STATION_1 = "station-1";
const DISPATCHED_AT = new Date("2026-09-10T08:00:00Z");

function planStop(overrides: Partial<PlanStopForMatch> = {}): PlanStopForMatch {
  return {
    planId: "plan-1",
    planStopId: "planstop-1",
    dispatchedAt: DISPATCHED_AT,
    truckId: TRUCK_A,
    stationId: STATION_1,
    expectedUsdPerGal: 5.0,
    ...overrides,
  };
}

function fuelStop(overrides: Partial<FuelStopForMatch> = {}): FuelStopForMatch {
  return {
    fuelStopId: "fuelstop-1",
    occurredAt: new Date("2026-09-10T09:00:00Z"),
    stationId: STATION_1,
    truckId: TRUCK_A,
    dieselGallons: 100,
    billedUsdPerGal: 5.5,
    splitFill: false,
    ...overrides,
  };
}

describe("match (T-38, A14)", () => {
  it("matches a plan stop and a fuel stop at the same site within the window, computing plannedUsd/actualUsd/deltaUsd", () => {
    const result = match([planStop()], [fuelStop()]);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toEqual({
      kind: "matched",
      planId: "plan-1",
      planStopId: "planstop-1",
      fuelStopId: "fuelstop-1",
      plannedUsd: 100 * 5.0,
      actualUsd: 100 * 5.5,
      deltaUsd: 100 * (5.5 - 5.0),
    });
  });

  it("returns a recommendation with no fuel stop as a skipped_recommendation row", () => {
    const result = match([planStop()], []);

    expect(result.matches).toEqual([
      {
        kind: "skipped_recommendation",
        planId: "plan-1",
        planStopId: "planstop-1",
        fuelStopId: null,
        plannedUsd: null,
        actualUsd: null,
        deltaUsd: null,
      },
    ]);
  });

  it("returns a fuel stop with no recommendation as an unplanned_stop row", () => {
    const result = match([], [fuelStop()]);

    expect(result.matches).toEqual([
      {
        kind: "unplanned_stop",
        planId: null,
        planStopId: null,
        fuelStopId: "fuelstop-1",
        plannedUsd: null,
        actualUsd: null,
        deltaUsd: null,
      },
    ]);
  });

  it("produces no matches for a non-dispatched plan", () => {
    const result = match([planStop({ dispatchedAt: null })], [fuelStop()]);

    // Nothing is attributed to the non-dispatched plan's stop, and its
    // window's fuel stop is real spend with no dispatched recommendation
    // to reconcile against — an unplanned_stop, not a skip for the plan.
    expect(result.matches).toEqual([
      {
        kind: "unplanned_stop",
        planId: null,
        planStopId: null,
        fuelStopId: "fuelstop-1",
        plannedUsd: null,
        actualUsd: null,
        deltaUsd: null,
      },
    ]);
  });

  it("resolves two fuel stops in one window deterministically by nearest-in-time to dispatchedAt; the loser is unplanned_stop, not dropped", () => {
    const near = fuelStop({ fuelStopId: "near", occurredAt: new Date("2026-09-10T08:30:00Z") }); // 30 min after dispatch
    const far = fuelStop({ fuelStopId: "far", occurredAt: new Date("2026-09-10T20:00:00Z") }); // 12 hours after dispatch

    const result = match([planStop()], [far, near]);

    expect(result.matches).toHaveLength(2);
    expect(result.matches).toContainEqual({
      kind: "matched",
      planId: "plan-1",
      planStopId: "planstop-1",
      fuelStopId: "near",
      plannedUsd: 100 * 5.0,
      actualUsd: 100 * 5.5,
      deltaUsd: 100 * (5.5 - 5.0),
    });
    expect(result.matches).toContainEqual({
      kind: "unplanned_stop",
      planId: null,
      planStopId: null,
      fuelStopId: "far",
      plannedUsd: null,
      actualUsd: null,
      deltaUsd: null,
    });
  });

  it("names and counts the three exclusion classes", () => {
    const result = match(
      [planStop()],
      [
        fuelStop(), // matched normally
        fuelStop({ fuelStopId: "split-a", splitFill: true }),
        fuelStop({ fuelStopId: "split-b", splitFill: true }),
        fuelStop({ fuelStopId: "no-station", stationId: null }),
      ],
      { noArchivedPriceFileCount: 4 },
    );

    expect(result.exclusions).toEqual({ splitFill: 2, unresolvedStation: 1, noArchivedPriceFile: 4 });
    // Excluded rows never appear as matches/skips/unplanned — they are
    // counted, not silently dropped, but also not smuggled in as a row.
    expect(result.matches.map((m) => m.fuelStopId)).toEqual(["fuelstop-1"]);
  });

  it("defaults noArchivedPriceFile to 0 when the caller has nothing to report (the live endpoint never produces this exclusion)", () => {
    const result = match([], []);
    expect(result.exclusions).toEqual({ splitFill: 0, unresolvedStation: 0, noArchivedPriceFile: 0 });
  });

  it("never matches a plan stop with no chosen truck (T-38's truck-identity gap)", () => {
    const result = match([planStop({ truckId: null })], [fuelStop()]);

    expect(result.matches).toEqual([
      {
        kind: "unplanned_stop",
        planId: null,
        planStopId: null,
        fuelStopId: "fuelstop-1",
        plannedUsd: null,
        actualUsd: null,
        deltaUsd: null,
      },
    ]);
  });

  it("never double-counts one fuel stop against two dispatched plan stops sharing a truck/day/station", () => {
    const result = match(
      [planStop({ planId: "plan-1", planStopId: "ps-1" }), planStop({ planId: "plan-2", planStopId: "ps-2" })],
      [fuelStop()],
    );

    expect(result.matches).toHaveLength(2);
    const kinds = result.matches.map((m) => m.kind).sort();
    expect(kinds).toEqual(["matched", "skipped_recommendation"]);
  });

  it("keeps a stop outside the date window from matching (different UTC day)", () => {
    const nextDay = fuelStop({ occurredAt: new Date("2026-09-11T08:00:00Z") });
    const result = match([planStop()], [nextDay]);

    expect(result.matches).toEqual([
      {
        kind: "skipped_recommendation",
        planId: "plan-1",
        planStopId: "planstop-1",
        fuelStopId: null,
        plannedUsd: null,
        actualUsd: null,
        deltaUsd: null,
      },
      {
        kind: "unplanned_stop",
        planId: null,
        planStopId: null,
        fuelStopId: "fuelstop-1",
        plannedUsd: null,
        actualUsd: null,
        deltaUsd: null,
      },
    ]);
  });

  it("plannedUsd/actualUsd use the actual gallons bought, not a fixed quantity", () => {
    const result = match([planStop({ expectedUsdPerGal: 4.5 })], [fuelStop({ dieselGallons: 62.4, billedUsdPerGal: 5.1234 })]);

    const row = result.matches[0]!;
    expect(row.plannedUsd).toBeCloseTo(62.4 * 4.5, 6);
    expect(row.actualUsd).toBeCloseTo(62.4 * 5.1234, 6);
    expect(row.deltaUsd).toBeCloseTo(row.actualUsd! - row.plannedUsd!, 6);
  });
});
