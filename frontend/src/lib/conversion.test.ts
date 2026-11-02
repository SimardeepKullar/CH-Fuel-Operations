import { describe, expect, it } from "vitest";
import { choiceCurrency, choiceUnit, conversionParams, formatFxEnteredAt, nativeChoice, toggleFor } from "./conversion";

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

  it("asks the API for the unit and the currency (T-66) — and nothing for as-printed", () => {
    expect(conversionParams(null)).toEqual({});
    expect(conversionParams("USD/gal")).toEqual({ units: "imperial", convertTo: "USD" });
    expect(conversionParams("CAD/L")).toEqual({ units: "metric", convertTo: "CAD" });
  });

  it("toggleFor: a CA invoice is never converted, so it has no control; the US invoice and All default to USD/gal (T-68)", () => {
    expect(toggleFor("CAD")).toEqual({ visible: false, native: "CAD/L" });
    expect(toggleFor("USD")).toEqual({ visible: true, native: "USD/gal" });
    expect(toggleFor("all")).toEqual({ visible: true, native: "USD/gal" });
  });

  it("formats when a rate was entered as a date with its year", () => {
    expect(formatFxEnteredAt("2026-10-06T16:00:00.000Z")).toContain("Oct 6, 2026");
  });
});
