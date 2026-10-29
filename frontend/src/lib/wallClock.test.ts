import { describe, expect, it } from "vitest";
import { printedDate, printedDayKey, printedMonthDay, printedTime, printedWeekdayDate } from "./wallClock";

// Two lines BVD printed either side of midnight: 2026-09-08 23:50:28 and
// 2026-09-09 00:00:47, stored as those instants in UTC.
const BEFORE_MIDNIGHT = "2026-09-08T23:50:28.000Z";
const AFTER_MIDNIGHT = "2026-09-09T00:00:47.000Z";

describe("wall-clock rendering (T-81)", () => {
  it("runs in a zone where local time and the printed clock differ", () => {
    expect(new Date(AFTER_MIDNIGHT).getDate()).toBe(8);
  });

  it("renders the date and time BVD printed, not the viewer's local one", () => {
    expect(printedDate(BEFORE_MIDNIGHT)).toBe("Sep 8");
    expect(printedTime(BEFORE_MIDNIGHT)).toBe("11:50 PM");
    expect(printedDate(AFTER_MIDNIGHT)).toBe("Sep 9");
    expect(printedTime(AFTER_MIDNIGHT)).toBe("12:00 AM");
  });

  it("keys and labels the day as printed", () => {
    expect(printedDayKey(AFTER_MIDNIGHT)).toBe("2026-09-09");
    expect(printedWeekdayDate(AFTER_MIDNIGHT)).toBe("Wed Sep 9");
    expect(printedMonthDay(AFTER_MIDNIGHT)).toBe("9/9");
    expect(printedDayKey(BEFORE_MIDNIGHT)).toBe("2026-09-08");
  });
});
