import { describe, expect, it } from "vitest";
import { printedAt, printedDayBounds } from "./wallClock";

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

describe("printedDayBounds (T-83)", () => {
  it("builds UTC day bounds as text, whatever the viewer's zone", () => {
    expect(printedDayBounds("2026-09-08", "2026-09-09")).toEqual({
      dateFrom: "2026-09-08T00:00:00Z",
      dateTo: "2026-09-09T23:59:59.999Z",
    });
  });

  it("either bound alone works; an empty or malformed one is absent", () => {
    expect(printedDayBounds("2026-09-08", "")).toEqual({ dateFrom: "2026-09-08T00:00:00Z" });
    expect(printedDayBounds("", "2026-09-09")).toEqual({ dateTo: "2026-09-09T23:59:59.999Z" });
    expect(printedDayBounds("", "")).toEqual({});
    expect(printedDayBounds("9/8/2026", "tomorrow")).toEqual({});
  });

  it("puts a stop printed 2026-09-09 00:00:47 inside to=2026-09-09 and outside to=2026-09-08", () => {
    const stop = Date.parse(AFTER_MIDNIGHT);
    expect(stop <= Date.parse(printedDayBounds("", "2026-09-09").dateTo!)).toBe(true);
    expect(stop <= Date.parse(printedDayBounds("", "2026-09-08").dateTo!)).toBe(false);
  });

  it("puts a stop printed 2026-09-08 23:50:28 inside from=2026-09-08", () => {
    expect(Date.parse(BEFORE_MIDNIGHT) >= Date.parse(printedDayBounds("2026-09-08", "").dateFrom!)).toBe(true);
    expect(Date.parse(BEFORE_MIDNIGHT) >= Date.parse(printedDayBounds("2026-09-09", "").dateFrom!)).toBe(false);
  });
});
