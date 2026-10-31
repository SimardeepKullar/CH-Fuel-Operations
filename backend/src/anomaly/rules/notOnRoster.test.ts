import { describe, expect, it } from "vitest";
import { notOnRoster } from "./notOnRoster.js";

const stop = {
  id: "stop-1",
  cardNumber: "9000099",
  cardDriverId: null,
  driverNameRaw: "PAT LEFT",
  unitRaw: "031",
};

describe("notOnRoster", () => {
  it("flags a stop on a card with no driver, red, keeping what was printed", () => {
    expect(notOnRoster([stop], {})).toEqual([
      {
        subjectType: "fuel_stop",
        subjectId: "stop-1",
        severity: "red",
        detail: { cardNumber: "9000099", driverNameRaw: "PAT LEFT", unitRaw: "031" },
      },
    ]);
  });

  it("leaves a stop on a card with a driver alone", () => {
    expect(notOnRoster([{ ...stop, cardDriverId: "driver-1" }], {})).toEqual([]);
  });
});
