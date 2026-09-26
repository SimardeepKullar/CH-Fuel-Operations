import { describe, expect, it } from "vitest";
import { chargesNoFuel, type ChargesNoFuelConfig, type ChargesNoFuelStop } from "./chargesNoFuel.js";

const CONFIG: ChargesNoFuelConfig = { fuelProductCodes: ["TA", "DF"] };

describe("chargesNoFuel", () => {
  it("flags a card carrying only a $15.25 scale charge (999210) as worth a look", () => {
    const stops: ChargesNoFuelStop[] = [
      { id: "stop-scale", lines: [{ productCode: "S", gallons: "0.00", amountUsd: "15.25" }] },
    ];

    expect(chargesNoFuel(stops, CONFIG)).toEqual([
      {
        subjectType: "fuel_stop",
        subjectId: "stop-scale",
        severity: "amber",
        detail: { totalUsd: 15.25, productCodes: ["S"] },
      },
    ]);
  });

  it("the false-positive guard: a stop with real fuel gallons triggers nothing", () => {
    const stops: ChargesNoFuelStop[] = [
      { id: "stop-normal", lines: [{ productCode: "TA", gallons: "41.67", amountUsd: "212.52" }] },
    ];

    expect(chargesNoFuel(stops, CONFIG)).toEqual([]);
  });

  it("does not flag a stop with zero fuel gallons and zero charges", () => {
    const stops: ChargesNoFuelStop[] = [
      { id: "stop-empty", lines: [{ productCode: "S", gallons: "0.00", amountUsd: "0.00" }] },
    ];

    expect(chargesNoFuel(stops, CONFIG)).toEqual([]);
  });
});
