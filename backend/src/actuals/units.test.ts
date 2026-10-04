import { describe, expect, it } from "vitest";
import { convertNullable, qtyConverter, qtyUnitFor } from "./units.js";

const LITRES_PER_GALLON = 3.785411784;

describe("qtyUnitFor", () => {
  it("is litres for CAD and gallons for USD (D25)", () => {
    expect(qtyUnitFor("CAD")).toBe("L");
    expect(qtyUnitFor("USD")).toBe("gal");
  });
});

describe("qtyConverter (D25: the API converts, storage never does)", () => {
  it("is the identity when no unit is asked for, or the asked-for unit is the stored one", () => {
    for (const conv of [qtyConverter("L", null), qtyConverter("L", "metric"), qtyConverter("gal", null), qtyConverter("gal", "imperial")]) {
      expect(conv.qty(21318.77)).toBe(21318.77);
      expect(conv.perUnit(2.2427)).toBe(2.2427);
    }
    expect(qtyConverter("L", null).qtyUnit).toBe("L");
    expect(qtyConverter("gal", "imperial").qtyUnit).toBe("gal");
  });

  it("litres to gallons: quantity divides by 3.785411784, a CAD-per-litre price multiplies by it", () => {
    const conv = qtyConverter("L", "imperial");
    expect(conv.qtyUnit).toBe("gal");
    expect(conv.qty(21318.77)).toBeCloseTo(21318.77 / LITRES_PER_GALLON, 4);
    expect(conv.perUnit(2.2427)).toBeCloseTo(2.2427 * LITRES_PER_GALLON, 5);
  });

  it("gallons to litres is the inverse in both directions", () => {
    const conv = qtyConverter("gal", "metric");
    expect(conv.qtyUnit).toBe("L");
    expect(conv.qty(100)).toBeCloseTo(378.5412, 4);
    expect(conv.perUnit(5.2395)).toBeCloseTo(5.2395 / LITRES_PER_GALLON, 5);
  });

  it("keeps the total value of a line: qty * price is the same in either unit", () => {
    const toGal = qtyConverter("L", "imperial");
    expect(toGal.qty(318.62) * toGal.perUnit(2.2427)).toBeCloseTo(318.62 * 2.2427, 2);
  });

  it("is a no-op on zero and never turns a null into a number", () => {
    expect(qtyConverter("L", "imperial").qty(0)).toBe(0);
    expect(convertNullable(qtyConverter("L", "imperial").perUnit, null)).toBeNull();
    expect(convertNullable(qtyConverter("L", "imperial").perUnit, 0)).toBe(0);
  });
});
