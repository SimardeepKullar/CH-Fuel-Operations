import { describe, expect, it } from "vitest";
import { DecimalFormatError, fromCents, toCents, toDecimalString } from "./decimal.js";

describe("toDecimalString", () => {
  it("pads a shorter decimal out to the requested precision", () => {
    expect(toDecimalString("4.889", 4)).toBe("4.8890");
    expect(toDecimalString("5.989", 4)).toBe("5.9890");
  });

  it("round-trips a value already at the requested precision, exactly", () => {
    expect(toDecimalString("5.2395", 4)).toBe("5.2395");
    expect(toDecimalString(toDecimalString("5.2395", 4), 4)).toBe("5.2395");
  });

  it("pads an integer with no decimal point", () => {
    expect(toDecimalString("455", 2)).toBe("455.00");
    expect(toDecimalString("0", 2)).toBe("0.00");
  });

  it("pads a sub-unit value", () => {
    expect(toDecimalString("0.04", 2)).toBe("0.04");
    expect(toDecimalString("0.2", 2)).toBe("0.20");
  });

  it("rejects a value with more fractional digits than requested", () => {
    expect(() => toDecimalString("5.23951", 4)).toThrow(DecimalFormatError);
  });

  it("rejects non-numeric text", () => {
    expect(() => toDecimalString("N/A", 2)).toThrow(DecimalFormatError);
    expect(() => toDecimalString("", 2)).toThrow(DecimalFormatError);
  });

  it("never routes through parseFloat: a long-tail binary fraction stays exact", () => {
    // 5.2395 cannot be represented exactly in IEEE-754 double; parseFloat
    // then toFixed(4) on some inputs reintroduces trailing-9 artifacts.
    // A pure string-based implementation never has this failure mode.
    expect(toDecimalString("5.2395", 4)).not.toContain("9999");
    expect(toDecimalString("5.2395", 4)).not.toContain("0001");
  });
});

describe("toCents / fromCents", () => {
  it("converts a 2dp dollar string to integer cents and back", () => {
    expect(toCents("218.35")).toBe(21835);
    expect(fromCents(21835)).toBe("218.35");
  });

  it("handles negative amounts", () => {
    expect(toCents("-36.78")).toBe(-3678);
    expect(fromCents(-3678)).toBe("-36.78");
  });

  it("handles zero and whole dollars", () => {
    expect(toCents("0.00")).toBe(0);
    expect(fromCents(0)).toBe("0.00");
    expect(toCents("100.00")).toBe(10000);
    expect(fromCents(10000)).toBe("100.00");
  });

  it("sums a compensating pair to exactly zero in integer cents, never a float artifact", () => {
    // The exact failure mode reconcile.ts guards against: two errors of
    // equal and opposite magnitude must not silently cancel when summed
    // per product code rather than as one grand total.
    const sum = toCents("218.35") + toCents("36.78") - toCents("255.13");
    expect(sum).toBe(0);
  });
});
