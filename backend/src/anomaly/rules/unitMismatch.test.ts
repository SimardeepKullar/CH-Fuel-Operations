import { describe, expect, it } from "vitest";
import { unitMismatch, type UnitMismatchStop } from "./unitMismatch.js";

describe("unitMismatch", () => {
  it("flags '0' entered on card 9000005 against assigned truck 072 (A10's own example) as worth a look", () => {
    const stops: UnitMismatchStop[] = [
      { id: "stop-9000005", unitRaw: "0", truckUnitNumber: "072" },
    ];

    expect(unitMismatch(stops, {})).toEqual([
      {
        subjectType: "fuel_stop",
        subjectId: "stop-9000005",
        severity: "amber",
        detail: { unitRaw: "0", truckUnitNumber: "072" },
      },
    ]);
  });

  it("the false-positive guard: a matching unit triggers nothing", () => {
    const stops: UnitMismatchStop[] = [{ id: "stop-normal", unitRaw: "240", truckUnitNumber: "240" }];

    expect(unitMismatch(stops, {})).toEqual([]);
  });

  it("never flags when the truck itself didn't resolve — null is not a lesser mismatch", () => {
    const stops: UnitMismatchStop[] = [{ id: "stop-unresolved", unitRaw: "0", truckUnitNumber: null }];

    expect(unitMismatch(stops, {})).toEqual([]);
  });

  it("tolerates surrounding whitespace on the entered unit", () => {
    const stops: UnitMismatchStop[] = [{ id: "stop-ws", unitRaw: " 072 ", truckUnitNumber: "072" }];

    expect(unitMismatch(stops, {})).toEqual([]);
  });

  it("does not flag a unit entered without its leading zero ('50' against '050')", () => {
    const stops: UnitMismatchStop[] = [{ id: "stop-pad", unitRaw: "50", truckUnitNumber: "050" }];

    expect(unitMismatch(stops, {})).toEqual([]);
  });

  it("still flags '0' and '3224' against a real truck once leading zeros are ignored", () => {
    const stops: UnitMismatchStop[] = [
      { id: "stop-zero", unitRaw: "0", truckUnitNumber: "072" },
      { id: "stop-trailer", unitRaw: "3224", truckUnitNumber: "064" },
    ];

    expect(unitMismatch(stops, {}).map((finding) => finding.subjectId)).toEqual(["stop-zero", "stop-trailer"]);
  });
});
