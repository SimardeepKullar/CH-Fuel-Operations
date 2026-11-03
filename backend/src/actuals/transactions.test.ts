import { describe, expect, it } from "vitest";
import { displayCase, truckRawResolved } from "./transactions.js";

describe("displayCase", () => {
  it("title-cases all-caps text, keeps BVD, and leaves mixed case alone", () => {
    expect(displayCase("BVD MISSISSAUGA - SHAWSON")).toBe("BVD Mississauga - Shawson");
    expect(displayCase("MISSISSAUGA")).toBe("Mississauga");
    expect(displayCase("BVD Comber")).toBe("BVD Comber");
    expect(displayCase("")).toBe("");
  });
});

describe("truckRawResolved", () => {
  it("agrees when the unit was entered without its leading zero, and keeps the raw text as entered", () => {
    expect(truckRawResolved({ truck_unit_number: "050", unit_raw: "50" })).toEqual({
      resolved: "050",
      raw: "50",
      agrees: true,
    });
  });

  it("disagrees on a real mismatch and is null when no truck resolved", () => {
    expect(truckRawResolved({ truck_unit_number: "072", unit_raw: "0" }).agrees).toBe(false);
    expect(truckRawResolved({ truck_unit_number: null, unit_raw: "50" }).agrees).toBeNull();
  });
});
