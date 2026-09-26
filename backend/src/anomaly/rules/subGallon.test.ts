import { describe, expect, it } from "vitest";
import { subGallon, type SubGallonConfig, type SubGallonStop } from "./subGallon.js";

const CONFIG: SubGallonConfig = { minGallons: "1.00", productCodes: ["TA", "DF"] };

describe("subGallon", () => {
  it("flags 0.04 gal / $0.20 at LOVES #277 (999210) as a billing error", () => {
    const stops: SubGallonStop[] = [
      {
        id: "stop-277",
        lines: [{ productCode: "TA", gallons: "0.04", amountUsd: "0.20" }],
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
      { id: "stop-normal", lines: [{ productCode: "TA", gallons: "41.67", amountUsd: "212.52" }] },
    ];

    expect(subGallon(stops, CONFIG)).toEqual([]);
  });

  it("never flags a legitimate zero-gallon charge line (chargesNoFuel's case, not this one)", () => {
    const stops: SubGallonStop[] = [
      { id: "stop-scale", lines: [{ productCode: "S", gallons: "0.00", amountUsd: "15.25" }] },
    ];

    expect(subGallon(stops, CONFIG)).toEqual([]);
  });

  it("ignores a non-fuel product code even when its quantity is tiny", () => {
    const stops: SubGallonStop[] = [
      { id: "stop-oil", lines: [{ productCode: "O", gallons: "0.10", amountUsd: "5.00" }] },
    ];

    expect(subGallon(stops, CONFIG)).toEqual([]);
  });
});
