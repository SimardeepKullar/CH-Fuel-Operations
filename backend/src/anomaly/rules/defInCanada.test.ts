import { describe, expect, it } from "vitest";
import { defInCanada, type DefInCanadaLine } from "./defInCanada.js";

const def = (qty: string, amount: string, currency: "CAD" | "USD" = "CAD"): DefInCanadaLine => ({
  productCode: "DF",
  qty,
  amount,
  currency,
  qtyUnit: currency === "CAD" ? "L" : "gal",
});
const diesel = (currency: "CAD" | "USD" = "CAD"): DefInCanadaLine => ({
  productCode: "TA",
  qty: "300.00",
  amount: "540.00",
  currency,
  qtyUnit: currency === "CAD" ? "L" : "gal",
});

describe("defInCanada", () => {
  it("flags a CAD stop with a DF line, carrying quantity and amount as printed", () => {
    expect(defInCanada([{ id: "s1", lines: [def("20.50", "41.25")] }], {})).toEqual([
      {
        subjectType: "fuel_stop",
        subjectId: "s1",
        severity: "amber",
        detail: { qty: "20.50", qtyUnit: "L", amount: "41.25", currency: "CAD" },
      },
    ]);
  });

  it("does not flag a CAD stop without a DF line", () => {
    expect(defInCanada([{ id: "s1", lines: [diesel()] }], {})).toEqual([]);
  });

  it("does not flag a US stop with DEF", () => {
    expect(defInCanada([{ id: "s1", lines: [def("5.00", "20.00", "USD"), diesel("USD")] }], {})).toEqual([]);
  });

  it("flags a stop with DEF and diesel once, counting only the DEF lines", () => {
    const findings = defInCanada([{ id: "s1", lines: [diesel(), def("10.10", "20.05"), def("5.05", "10.10")] }], {});
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toEqual({ qty: "15.15", qtyUnit: "L", amount: "30.15", currency: "CAD" });
  });

  it("carries no Usd key in its detail", () => {
    const [finding] = defInCanada([{ id: "s1", lines: [def("1.00", "2.00")] }], {});
    expect(Object.keys(finding!.detail).filter((k) => /usd/i.test(k))).toEqual([]);
  });
});
