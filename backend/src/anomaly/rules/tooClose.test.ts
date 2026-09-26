import { describe, expect, it } from "vitest";
import { tooClose, type TooCloseConfig, type TooCloseStop } from "./tooClose.js";

const CONFIG: TooCloseConfig = { maxMinutesApart: 120 };

describe("tooClose", () => {
  it("flags the later of two fills at LOVES #275, 78 minutes apart (999210), as worth a look", () => {
    const stops: TooCloseStop[] = [
      { id: "stop-a", cardId: "card-1", stationId: "loves-275", occurredAt: new Date("2026-09-04T10:00:00Z") },
      { id: "stop-b", cardId: "card-1", stationId: "loves-275", occurredAt: new Date("2026-09-04T11:18:00Z") },
    ];

    expect(tooClose(stops, CONFIG)).toEqual([
      {
        subjectType: "fuel_stop",
        subjectId: "stop-b",
        severity: "amber",
        detail: { pairedWithStopId: "stop-a", minutesApart: 78, maxMinutesApart: 120 },
      },
    ]);
  });

  it("the false-positive guard: a single stop triggers nothing", () => {
    const stops: TooCloseStop[] = [
      { id: "stop-only", cardId: "card-1", stationId: "loves-500", occurredAt: new Date("2026-09-04T14:00:00Z") },
    ];

    expect(tooClose(stops, CONFIG)).toEqual([]);
  });

  it("does not flag the same card at the same station well outside the window", () => {
    const stops: TooCloseStop[] = [
      { id: "stop-a", cardId: "card-1", stationId: "loves-275", occurredAt: new Date("2026-09-04T10:00:00Z") },
      { id: "stop-b", cardId: "card-1", stationId: "loves-275", occurredAt: new Date("2026-09-04T13:00:00Z") },
    ];

    expect(tooClose(stops, CONFIG)).toEqual([]);
  });

  it("does not flag two different cards at the same station close in time", () => {
    const stops: TooCloseStop[] = [
      { id: "stop-a", cardId: "card-1", stationId: "loves-275", occurredAt: new Date("2026-09-04T10:00:00Z") },
      { id: "stop-b", cardId: "card-2", stationId: "loves-275", occurredAt: new Date("2026-09-04T10:30:00Z") },
    ];

    expect(tooClose(stops, CONFIG)).toEqual([]);
  });

  it("does not flag the same card at two different stations close in time", () => {
    const stops: TooCloseStop[] = [
      { id: "stop-a", cardId: "card-1", stationId: "loves-275", occurredAt: new Date("2026-09-04T10:00:00Z") },
      { id: "stop-b", cardId: "card-1", stationId: "loves-300", occurredAt: new Date("2026-09-04T10:30:00Z") },
    ];

    expect(tooClose(stops, CONFIG)).toEqual([]);
  });

  it("never pairs stops with an unresolved station", () => {
    const stops: TooCloseStop[] = [
      { id: "stop-a", cardId: "card-1", stationId: null, occurredAt: new Date("2026-09-04T10:00:00Z") },
      { id: "stop-b", cardId: "card-1", stationId: null, occurredAt: new Date("2026-09-04T10:30:00Z") },
    ];

    expect(tooClose(stops, CONFIG)).toEqual([]);
  });
});
