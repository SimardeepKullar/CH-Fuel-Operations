import { describe, expect, it } from "vitest";
import { LITERS_PER_GALLON } from "../domain/units.js";
import { convertNullable, fxRateProblem, LITERS_PER_GALLON_RATIO, moneyConverter, qtyConverter, qtyUnitFor } from "./units.js";

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

describe("fxRateProblem (T-66)", () => {
  it("accepts a rate inside 0.5–3.0 with up to six decimal places, the band's edges included", () => {
    for (const rate of [1.3712, 0.5, 3, 1.371234, 2]) {
      expect(fxRateProblem(rate), String(rate)).toBeNull();
    }
  });

  it("names why a rate is refused: not a number, not positive, outside the band, too precise", () => {
    expect(fxRateProblem("1.3712")).toContain("must be a number");
    expect(fxRateProblem(Number.NaN)).toContain("must be a number");
    expect(fxRateProblem(null)).toContain("must be a number");
    expect(fxRateProblem(0)).toContain("greater than 0");
    expect(fxRateProblem(-1)).toContain("greater than 0");
    expect(fxRateProblem(0.4)).toContain("between 0.5 and 3.0");
    expect(fxRateProblem(3.1)).toContain("between 0.5 and 3.0");
    expect(fxRateProblem(13.712)).toContain("between 0.5 and 3.0");
    expect(fxRateProblem(1.3712345)).toContain("at most 6 decimal places");
  });
});

describe("moneyConverter (T-66)", () => {
  const RATE = { rate: "1.371200", enteredAt: new Date("2026-10-06T16:00:00.000Z") };

  it("CAD -> USD divides each figure by the entered rate, rounded once to the cent", () => {
    const money = moneyConverter("CAD", "USD", RATE, "L", null);
    expect(money.currency).toBe("USD");
    expect(money.fx).toEqual({ rate: 1.3712, enteredAt: "2026-10-06T16:00:00.000Z" });
    expect(money.ratePending).toBe(false);
    expect(money.money("714.57")).toBe(521.13);
    expect(money.money("-82.21")).toBe(-59.95);
    expect(money.money("0.00")).toBe(0);
  });

  it("converts a per-unit price to four places, taking a unit change inside that one rounding", () => {
    expect(moneyConverter("CAD", "USD", RATE, "L", null).perUnit("2.1522")).toBe(1.5696);
    expect(moneyConverter("CAD", "USD", RATE, "L", "imperial").perUnit("2.1522")).toBe(5.9415);
  });

  it("USD -> CAD multiplies by the rate", () => {
    expect(moneyConverter("USD", "CAD", RATE, "gal", null).money("255.13")).toBe(349.83);
    expect(moneyConverter("USD", "CAD", RATE, "gal", null).perUnit("5.2395")).toBe(7.1844);
    expect(moneyConverter("USD", "CAD", RATE, "gal", "metric").perUnit("5.2395")).toBe(1.8979);
  });

  it("rounds half away from zero on the exact figure, where float arithmetic would not", () => {
    // 2.01 × 0.5 is exactly 1.005; as floats it is 1.00499…, which Math.round takes to 1.00.
    const half = moneyConverter("USD", "CAD", { rate: "0.500000", enteredAt: RATE.enteredAt }, "gal", null);
    expect(half.money("2.01")).toBe(1.01);
    expect(half.money("-2.01")).toBe(-1.01);
  });

  it("with no entered rate, every figure is null and the row is rate pending — never 1.0", () => {
    const money = moneyConverter("CAD", "USD", null, "L", "imperial");
    expect(money).toMatchObject({ currency: "USD", fx: null, ratePending: true });
    expect(money.money("714.57")).toBeNull();
    expect(money.perUnit("2.1522")).toBeNull();
  });

  it("leaves a figure already in the requested currency exactly as without a conversion", () => {
    for (const requested of [null, "CAD"] as const) {
      const money = moneyConverter("CAD", requested, RATE, "L", "imperial");
      expect(money).toMatchObject({ currency: "CAD", fx: null, ratePending: false });
      expect(money.money("714.57")).toBe(714.57);
      expect(money.perUnit("2.1522")).toBe(qtyConverter("L", "imperial").perUnit(2.1522));
    }
  });

  it("uses the same litres per gallon as the quantity conversion", () => {
    expect(Number(LITERS_PER_GALLON_RATIO.n) / Number(LITERS_PER_GALLON_RATIO.d)).toBe(LITERS_PER_GALLON);
  });
});
