import { describe, expect, it } from "vitest";
import { subGallon, type SubGallonConfig, type SubGallonStop } from "./subGallon.js";

const CONFIG: SubGallonConfig = { minGallons: "1.00", productCodes: ["TA"] };

describe("subGallon", () => {
  it("flags 0.04 gal / $0.20 at LOVES #277 (999210) as a billing error", () => {
    const stops: SubGallonStop[] = [
      {
        id: "stop-277",
        lines: [{ productCode: "TA", qty: "0.04", qtyUnit: "gal", amount: "0.20", currency: "USD" }],
      },
    ];

    const findings = subGallon(stops, CONFIG);

    expect(findings).toEqual([
      {
        subjectType: "fuel_stop",
        subjectId: "stop-277",
        severity: "red",
        detail: { productCode: "TA", gallons: "0.04", amountUsd: "0.20", minGallons: "1.00" },
      },
    ]);
  });

  it("the false-positive guard: a normal 41.67 gal fill triggers nothing", () => {
    const stops: SubGallonStop[] = [
      { id: "stop-normal", lines: [{ productCode: "TA", qty: "41.67", qtyUnit: "gal", amount: "212.52", currency: "USD" }] },
    ];

    expect(subGallon(stops, CONFIG)).toEqual([]);
  });

  it("never flags a legitimate zero-gallon charge line (chargesNoFuel's case, not this one)", () => {
    const stops: SubGallonStop[] = [
      { id: "stop-scale", lines: [{ productCode: "S", qty: "0.00", qtyUnit: "gal", amount: "15.25", currency: "USD" }] },
    ];

    expect(subGallon(stops, CONFIG)).toEqual([]);
  });

  it("ignores a non-fuel product code even when its quantity is tiny", () => {
    const stops: SubGallonStop[] = [
      { id: "stop-oil", lines: [{ productCode: "O", qty: "0.10", qtyUnit: "gal", amount: "5.00", currency: "USD" }] },
    ];

    expect(subGallon(stops, CONFIG)).toEqual([]);
  });

  it("T-40F: a sub-gallon DEF line is not flagged — DEF top-offs routinely run well under a gallon", () => {
    const stops: SubGallonStop[] = [
      { id: "stop-def", lines: [{ productCode: "DF", qty: "0.04", qtyUnit: "gal", amount: "0.20", currency: "USD" }] },
    ];

    expect(subGallon(stops, CONFIG)).toEqual([]);
  });
});

describe("subGallon — litres (D25, T-61)", () => {
  const caLine = (productCode: string, qty: string, amount: string) =>
    ({ productCode, qty, qtyUnit: "L", amount, currency: "CAD" }) as const;
  const config: SubGallonConfig = { minGallons: "1.00", productCodes: ["TA"] };

  it("judges a litre line in gallons: 3.00 L (0.79 gal) of diesel is flagged, recorded in litres and CAD", () => {
    const findings = subGallon([{ id: "stop-3l", lines: [caLine("TA", "3.00", "6.52")] }], config);
    expect(findings).toEqual([
      {
        subjectType: "fuel_stop",
        subjectId: "stop-3l",
        severity: "red",
        detail: { productCode: "TA", qty: "3.00", qtyUnit: "L", amount: "6.52", currency: "CAD", minGallons: "1.00" },
      },
    ]);
  });

  it("does not flag 3.79 L, just over a gallon — the threshold stays in gallons, not litres", () => {
    expect(subGallon([{ id: "stop-379", lines: [caLine("TA", "3.79", "8.23")] }], config)).toEqual([]);
  });

  it("leaves a 0.01 L DEF line exempt, as DEF always is (T-40F)", () => {
    expect(subGallon([{ id: "stop-def", lines: [caLine("DF", "0.01", "0.01")] }], config)).toEqual([]);
  });
});
