import { describe, expect, it } from "vitest";
import { PRODUCT_OPTIONS, productLabel } from "./transactionFilterConstants";

describe("PRODUCT_OPTIONS (T-130)", () => {
  it("offers DEF once, as DF, though BVD prints it as DF or DE", () => {
    const def = PRODUCT_OPTIONS.filter((o) => o.label === "DEF");
    expect(def).toEqual([{ value: "DF", label: "DEF" }]);
  });

  it("has no duplicate labels", () => {
    const labels = PRODUCT_OPTIONS.map((o) => o.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("still labels a DE line DEF", () => {
    expect(productLabel("DE")).toBe("DEF");
  });
});
