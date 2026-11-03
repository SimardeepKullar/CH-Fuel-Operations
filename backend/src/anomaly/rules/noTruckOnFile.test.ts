import { describe, expect, it } from "vitest";
import { noTruckOnFile } from "./noTruckOnFile.js";

const stop = { id: "stop-1", truckId: null, driverId: "driver-1", unitRaw: "2" };

describe("noTruckOnFile", () => {
  it("flags a stop whose driver had no truck that day: amber, reason no_assignment, with the entered unit", () => {
    expect(noTruckOnFile([stop], {})).toEqual([
      {
        subjectType: "fuel_stop",
        subjectId: "stop-1",
        severity: "amber",
        detail: { reason: "no_assignment", unitRaw: "2" },
      },
    ]);
  });

  it("flags a stop whose card has no driver as no_driver", () => {
    expect(noTruckOnFile([{ ...stop, driverId: null, unitRaw: "031" }], {})).toEqual([
      {
        subjectType: "fuel_stop",
        subjectId: "stop-1",
        severity: "amber",
        detail: { reason: "no_driver", unitRaw: "031" },
      },
    ]);
  });

  it("keeps an empty entered unit as an empty string rather than dropping it", () => {
    const [finding] = noTruckOnFile([{ ...stop, unitRaw: "" }], {});
    expect(finding?.detail).toEqual({ reason: "no_assignment", unitRaw: "" });
  });

  it("leaves a stop with a truck alone", () => {
    expect(noTruckOnFile([{ ...stop, truckId: "truck-1" }], {})).toEqual([]);
  });

  it("is never also a unit mismatch: that rule skips a stop with no truck", async () => {
    const { unitMismatch } = await import("./unitMismatch.js");
    expect(unitMismatch([{ id: "stop-1", unitRaw: "2", truckUnitNumber: null }], {})).toEqual([]);
    expect(noTruckOnFile([stop], {})).toHaveLength(1);
  });
});
