import { describe, expect, it } from "vitest";
import { taxLabel } from "./overviewTax";

describe("taxLabel (T-65)", () => {
  it("is HST when HST is the only non-zero tax", () => {
    expect(taxLabel({ hst: 5376.44, gst: 0, pst: 0, qst: 0 })).toBe("HST");
  });

  it.each([
    ["GST beside HST", { hst: 10, gst: 5, pst: 0, qst: 0 }],
    ["GST and QST (Quebec)", { hst: 0, gst: 5, pst: 0, qst: 9.98 }],
    ["PST alone", { hst: 0, gst: 0, pst: 7, qst: 0 }],
    ["no tax at all", { hst: 0, gst: 0, pst: 0, qst: 0 }],
  ])("is Sales tax for %s", (_name, tax) => {
    expect(taxLabel(tax)).toBe("Sales tax");
  });
});
