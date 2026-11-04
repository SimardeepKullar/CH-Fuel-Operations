import { describe, expect, it } from "vitest";
import { unitMismatch } from "./unitMismatch.js";
import { unitNotEntered } from "./unitNotEntered.js";

describe("unitNotEntered", () => {
  it("flags a blank or whitespace-only unit, amber, and leaves an entered one alone", () => {
    const findings = unitNotEntered(
      [
        { id: "a", unitRaw: "" },
        { id: "b", unitRaw: "  " },
        { id: "c", unitRaw: "074" },
        { id: "d", unitRaw: "0" },
      ],
      {},
    );
    expect(findings).toEqual([
      { subjectType: "fuel_stop", subjectId: "a", severity: "amber", detail: { reason: "no_unit" } },
      { subjectType: "fuel_stop", subjectId: "b", severity: "amber", detail: { reason: "no_unit" } },
    ]);
  });

  it("is the only rule to speak on a blank unit: unitMismatch skips it even when a truck resolved", () => {
    expect(unitMismatch([{ id: "a", unitRaw: "", truckUnitNumber: "074" }], {})).toEqual([]);
  });
});
