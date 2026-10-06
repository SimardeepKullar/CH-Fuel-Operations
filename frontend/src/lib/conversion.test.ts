import { describe, expect, it } from "vitest";
import { choiceCurrency, choiceUnit, conversionParams, moneyConversionPending, nativeChoice } from "./conversion";

describe("the USD/gal | CAD/L conversion (T-64)", () => {
  it("each invoice's default is the format it came in", () => {
    expect(nativeChoice("USD")).toBe("USD/gal");
    expect(nativeChoice("CAD")).toBe("CAD/L");
  });

  it("names its currency and unit", () => {
    expect(choiceCurrency("CAD/L")).toBe("CAD");
    expect(choiceUnit("CAD/L")).toBe("L");
    expect(choiceCurrency("USD/gal")).toBe("USD");
    expect(choiceUnit("USD/gal")).toBe("gal");
  });

  it("asks the API for units only — no money conversion until T-66 — and nothing for as-printed", () => {
    expect(conversionParams(null)).toEqual({});
    expect(conversionParams("USD/gal")).toEqual({ units: "imperial" });
    expect(conversionParams("CAD/L")).toEqual({ units: "metric" });
  });

  it("flags money that would need the exchange rate", () => {
    expect(moneyConversionPending("USD/gal", "CAD")).toBe(true);
    expect(moneyConversionPending("CAD/L", "USD")).toBe(true);
    expect(moneyConversionPending("USD/gal", "USD")).toBe(false);
    expect(moneyConversionPending(null, "CAD")).toBe(false);
  });
});
