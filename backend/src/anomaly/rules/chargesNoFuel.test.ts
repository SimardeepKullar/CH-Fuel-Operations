import { describe, expect, it } from "vitest";
import { chargesNoFuel, type ChargesNoFuelConfig, type ChargesNoFuelStop } from "./chargesNoFuel.js";

const CONFIG: ChargesNoFuelConfig = { fuelProductCodes: ["TA", "DF"] };

describe("chargesNoFuel", () => {
  it("flags a card carrying only a $15.25 scale charge (999210) as worth a look", () => {
    const stops: ChargesNoFuelStop[] = [
      { id: "stop-scale", lines: [{ productCode: "S", qty: "0.00", amount: "15.25", currency: "USD" }] },
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
      { id: "stop-normal", lines: [{ productCode: "TA", qty: "41.67", amount: "212.52", currency: "USD" }] },
    ];

    expect(chargesNoFuel(stops, CONFIG)).toEqual([]);
  });

  it("does not flag a stop with zero fuel gallons and zero charges", () => {
    const stops: ChargesNoFuelStop[] = [
      { id: "stop-empty", lines: [{ productCode: "S", qty: "0.00", amount: "0.00", currency: "USD" }] },
    ];

    expect(chargesNoFuel(stops, CONFIG)).toEqual([]);
  });
});

describe("chargesNoFuel — a CA invoice (T-61)", () => {
  it("flags a CAD scale-only stop and names its currency rather than filing it under totalUsd", () => {
    const findings = chargesNoFuel(
      [{ id: "stop-ca-scale", lines: [{ productCode: "S", qty: "0.00", amount: "26.00", currency: "CAD" }] }],
      { fuelProductCodes: ["TA"] },
    );
    expect(findings).toEqual([
      { subjectType: "fuel_stop", subjectId: "stop-ca-scale", severity: "amber", detail: { total: 26, currency: "CAD", productCodes: ["S"] } },
    ]);
  });
});
