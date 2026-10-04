import { describe, expect, it } from "vitest";
import { normalizeAnomalyDetail } from "./anomalyDetail.js";

describe("normalizeAnomalyDetail (T-63)", () => {
  it("renames a legacy US sub_gallon finding and says it is USD in gallons", () => {
    expect(
      normalizeAnomalyDetail({ productCode: "TA", gallons: "0.50", amountUsd: "2.61", minGallons: "1.00" }),
    ).toEqual({ productCode: "TA", qty: "0.50", amount: "2.61", minGallons: "1.00", currency: "USD", qtyUnit: "gal" });
  });

  it("renames a legacy charges_no_fuel and a legacy price_above_published finding", () => {
    expect(normalizeAnomalyDetail({ totalUsd: "26.00", productCodes: ["S"] })).toEqual({
      total: "26.00",
      productCodes: ["S"],
      currency: "USD",
    });
    expect(
      normalizeAnomalyDetail({ billedUsdPerGal: "5.2395", publishedUsdPerGal: "5.1000", maxOverageUsdPerGal: "0.05" }),
    ).toEqual({ billedPerUnit: "5.2395", publishedPerUnit: "5.1000", maxOveragePerUnit: "0.05", currency: "USD" });
  });

  it("leaves a CA finding, which already carries a currency and unit, exactly as stored", () => {
    const ca = { productCode: "TA", qty: "3.00", qtyUnit: "L", amount: "6.52", currency: "CAD", minGallons: "1.00" };
    expect(normalizeAnomalyDetail(ca)).toEqual(ca);
  });

  it("strips any other Usd key a future rule might write, and never invents a currency for a finding with none", () => {
    expect(normalizeAnomalyDetail({ somethingUsd: 1, other: 2 })).toEqual({ something: 1, other: 2, currency: "USD" });
    expect(normalizeAnomalyDetail({ other: 2 })).toEqual({ other: 2 });
  });

  it("walks nested objects and arrays, and passes non-objects through", () => {
    expect(normalizeAnomalyDetail({ lines: [{ amountUsd: 1 }] })).toEqual({ lines: [{ amount: 1, currency: "USD" }] });
    expect(normalizeAnomalyDetail(null)).toBeNull();
    expect(normalizeAnomalyDetail("x")).toBe("x");
  });
});
