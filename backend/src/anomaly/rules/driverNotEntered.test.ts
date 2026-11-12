import { describe, expect, it } from "vitest";
import { driverNotEntered } from "./driverNotEntered.js";

describe("driverNotEntered", () => {
  it("flags a blank or whitespace-only driver name, red, and leaves a printed one alone", () => {
    const findings = driverNotEntered(
      [
        { id: "a", driverNameRaw: "" },
        { id: "b", driverNameRaw: "  " },
        { id: "c", driverNameRaw: "DRIVER ONE" },
      ],
      {},
    );
    expect(findings).toEqual([
      { subjectType: "fuel_stop", subjectId: "a", severity: "red", detail: { reason: "no_driver_name" } },
      { subjectType: "fuel_stop", subjectId: "b", severity: "red", detail: { reason: "no_driver_name" } },
    ]);
  });
});
