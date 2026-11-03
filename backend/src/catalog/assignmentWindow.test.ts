import { describe, expect, it } from "vitest";
import { changedWindow, type DatedTruck } from "./assignmentWindow.js";

const row = (truckId: string, effectiveFrom: string, effectiveTo: string | null = null): DatedTruck => ({
  truckId,
  effectiveFrom,
  effectiveTo,
});

describe("changedWindow", () => {
  it("is null when nothing about who-drove-what changed", () => {
    expect(changedWindow([row("t1", "2026-09-03")], [row("t1", "2026-09-03")])).toBeNull();
  });

  it("a reassignment touches only the days from the new truck's start, open-ended", () => {
    // Example 1: truck 1 from Sep 3, reassigned to truck 4 from Sep 5. Sep 3-4
    // still resolve to truck 1, so only Sep 5 onward can change.
    expect(
      changedWindow(
        [row("t1", "2026-09-03")],
        [row("t1", "2026-09-03", "2026-09-04"), row("t4", "2026-09-05")],
      ),
    ).toEqual({ from: "2026-09-05", to: null });
  });

  it("a back-dated assignment for a truckless driver touches its own span", () => {
    expect(changedWindow([], [row("t2", "2026-09-03")])).toEqual({ from: "2026-09-03", to: null });
  });

  it("moving a start earlier touches the days it gains, and no others", () => {
    // Example 2: truck 2 from Sep 4, back-dated to Sep 3.
    expect(changedWindow([row("t2", "2026-09-04")], [row("t2", "2026-09-03")])).toEqual({
      from: "2026-09-03",
      to: "2026-09-03",
    });
  });

  it("moving an end touches the days it gains or loses", () => {
    expect(
      changedWindow([row("t1", "2026-01-01", "2026-02-28")], [row("t1", "2026-01-01", "2026-02-10")]),
    ).toEqual({ from: "2026-02-11", to: "2026-02-28" });
  });

  it("opening a gap touches the days that become uncovered", () => {
    expect(
      changedWindow(
        [row("t1", "2026-01-01", "2026-02-28"), row("t4", "2026-03-01")],
        [row("t1", "2026-01-01", "2026-02-28"), row("t4", "2026-03-15")],
      ),
    ).toEqual({ from: "2026-03-01", to: "2026-03-14" });
  });

  it("spans from the first changed day to the last when a change touches two places", () => {
    expect(
      changedWindow(
        [row("t1", "2026-01-01", "2026-01-31"), row("t4", "2026-03-01", "2026-03-31")],
        [row("t1", "2026-01-01", "2026-01-20"), row("t4", "2026-03-01", "2026-03-20")],
      ),
    ).toEqual({ from: "2026-01-21", to: "2026-03-31" });
  });

  it("is open-ended when the last changed day is open-ended", () => {
    expect(changedWindow([row("t1", "2026-01-01")], [])).toEqual({ from: "2026-01-01", to: null });
  });
});
