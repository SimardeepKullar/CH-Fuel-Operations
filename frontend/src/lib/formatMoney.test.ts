import { describe, expect, it } from "vitest";
import {
  QTY_UNIT_NAMES,
  formatGallons2dp,
  formatMoney,
  formatMoneyUsd,
  formatPricePerGal,
  formatPricePerUnit,
  formatQty2dp,
  nativeQtyUnit,
  sumMoney,
} from "./formatMoney";

describe("formatMoneyUsd", () => {
  it("formats to exactly 2dp", () => {
    expect(formatMoneyUsd(255.13)).toBe("$255.13");
    expect(formatMoneyUsd(0)).toBe("$0.00");
  });

  it("rounds rather than truncating", () => {
    expect(formatMoneyUsd(3.999)).toBe("$4.00");
  });

  it("renders a negative amount with a leading sign, not a bare negative $ amount", () => {
    expect(formatMoneyUsd(-12.5)).toBe("-$12.50");
  });
});

describe("formatPricePerGal", () => {
  it("formats to exactly 4dp — 5.24 never appears where 5.2395 is the value", () => {
    expect(formatPricePerGal(5.2395)).toBe("$5.2395");
    expect(formatPricePerGal(5.2395)).not.toBe("$5.24");
  });

  it("pads trailing zeros to keep 4dp", () => {
    expect(formatPricePerGal(3.5)).toBe("$3.5000");
  });
});

describe("formatGallons2dp", () => {
  it("formats to exactly 2dp", () => {
    expect(formatGallons2dp(52.3)).toBe("52.30");
    expect(formatGallons2dp(0.04)).toBe("0.04");
  });
});

describe("currency-aware formatting (T-64)", () => {
  it("never renders a bare dollar sign: money carries US$ or CA$", () => {
    expect(formatMoney(255.13, "USD")).toBe("US$255.13");
    expect(formatMoney(255.13, "CAD")).toBe("CA$255.13");
    expect(formatMoney(-12.5, "CAD")).toBe("-CA$12.50");
  });

  it("per-unit prices keep 4dp in either currency", () => {
    expect(formatPricePerUnit(1.9046, "CAD")).toBe("CA$1.9046");
    expect(formatPricePerUnit(3.5, "USD")).toBe("US$3.5000");
  });

  it("quantities are 2dp whatever the unit", () => {
    expect(formatQty2dp(52.3)).toBe("52.30");
    expect(QTY_UNIT_NAMES.L).toBe("Litres");
    expect(QTY_UNIT_NAMES.gal).toBe("Gallons");
  });

  it("each side's own unit is the one BVD prints", () => {
    expect(nativeQtyUnit("USD")).toBe("gal");
    expect(nativeQtyUnit("CAD")).toBe("L");
  });

  it("sums money in cents, without float drift", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([190.46, 24.76])).toBe(215.22);
    expect(sumMoney([])).toBe(0);
  });
});
