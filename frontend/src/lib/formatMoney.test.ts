import { describe, expect, it } from "vitest";
import { formatGallons2dp, formatMoneyUsd, formatPricePerGal } from "./formatMoney";

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
