import { describe, expect, it } from "vitest";
import { printedAt } from "./wallClock";

// Two lines BVD printed either side of midnight: 2026-09-08 23:50:28 and
// 2026-09-09 00:00:47, stored as those instants in UTC.
const BEFORE_MIDNIGHT = "2026-09-08T23:50:28.000Z";
const AFTER_MIDNIGHT = "2026-09-09T00:00:47.000Z";

describe("printedAt (T-81)", () => {
  it("runs in a zone where local time and the printed clock differ", () => {
    expect(new Date(AFTER_MIDNIGHT).getDate()).toBe(8);
  });

  it("reads the date and time BVD printed, not the viewer's local ones", () => {
    expect(printedAt(BEFORE_MIDNIGHT)).toEqual({ date: "Sep 8, 2026", time: "23:50:28", dayKey: "2026-09-08", slashDate: "9/8/2026", full: "2026-09-08 23:50:28" });
    expect(printedAt(AFTER_MIDNIGHT)).toEqual({ date: "Sep 9, 2026", time: "00:00:47", dayKey: "2026-09-09", slashDate: "9/9/2026", full: "2026-09-09 00:00:47" });
  });

  it("drops the leading zero on the day and keeps it on the time", () => {
    expect(printedAt("2026-10-03T07:05:09.000Z")).toEqual({ date: "Oct 3, 2026", time: "07:05:09", dayKey: "2026-10-03", slashDate: "10/3/2026", full: "2026-10-03 07:05:09" });
  });
});
