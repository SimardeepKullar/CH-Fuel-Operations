import { describe, expect, it } from "vitest";
import { defRatio, type DefRatioConfig, type DefRatioStop } from "./defRatio.js";

const CONFIG: DefRatioConfig = { maxRatio: 0.05, fuelProductCode: "TA", defProductCode: "DF" };

describe("defRatio", () => {
  it("flags 15.60 DEF against 176.44 diesel (8.8%, 999210) as worth a look", () => {
    const stops: DefRatioStop[] = [
      {
        id: "stop-def",
        lines: [
          { productCode: "TA", gallons: "176.44" },
          { productCode: "DF", gallons: "15.60" },
        ],
      },
    ];

    const findings = defRatio(stops, CONFIG);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      subjectType: "fuel_stop",
      subjectId: "stop-def",
      severity: "amber",
    });
    const detail = findings[0]!.detail as { ratio: number };
    expect(detail.ratio).toBeCloseTo(0.0884, 4);
  });

  it("the false-positive guard: a normal ~3% DEF ratio triggers nothing", () => {
    const stops: DefRatioStop[] = [
      {
        id: "stop-normal",
        lines: [
          { productCode: "TA", gallons: "41.67" },
          { productCode: "DF", gallons: "1.25" },
        ],
      },
    ];

    expect(defRatio(stops, CONFIG)).toEqual([]);
  });

  it("skips a stop with no diesel line rather than treating it as 0/0", () => {
    const stops: DefRatioStop[] = [
      { id: "stop-def-only", lines: [{ productCode: "DF", gallons: "5.00" }] },
    ];

    expect(defRatio(stops, CONFIG)).toEqual([]);
  });
});
