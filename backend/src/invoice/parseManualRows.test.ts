import { describe, expect, it } from "vitest";
import { ManualRowFormatError, parseManualRows, type RawManualRow } from "./parseManualRows.js";

/** Synthetic rows in the PDF's Manual Transactions layout: DATE, AMOUNT, FEE,
 * TOTAL AMOUNT, CUR, DESCRIPTION. Invented, not from any real invoice. */
const row = (cells: string[], lineNumber = 30): RawManualRow => ({ record: cells, lineNumber });

describe("parseManualRows (T-128)", () => {
  it("reads a credit as printed: negative money, the fee, the currency and the description verbatim", () => {
    const [credit] = parseManualRows([row(["2026-01-12 00:00:00", "-11400", "0", "-11400", "US", "CREDIT FOR A SAMPLE ADVANCE"])]);
    expect(credit).toEqual({
      lineNumber: 30,
      occurredAt: "2026-01-12T00:00:00",
      amount: "-11400.00",
      fee: "0.00",
      total: "-11400.00",
      currency: "USD",
      description: "CREDIT FOR A SAMPLE ADVANCE",
    });
  });

  it("reads a CN row as CAD, and a blank description as null", () => {
    const [charge] = parseManualRows([row(["2026-01-12 08:30:00", "25.50", "0", "25.50", "CN", ""])]);
    expect(charge).toMatchObject({ currency: "CAD", description: null, total: "25.50" });
  });

  it("fails loudly when amount + fee is not the printed total, to the cent", () => {
    expect(() => parseManualRows([row(["2026-01-12 00:00:00", "-100", "0", "-99.99", "US", "x"], 41)])).toThrow(
      /line 41: amount -100.00 \+ fee 0.00 != total -99.99/,
    );
  });

  it("fails loudly on an unknown currency code rather than defaulting one", () => {
    expect(() => parseManualRows([row(["2026-01-12 00:00:00", "-100", "0", "-100", "XX", "x"])])).toThrow(ManualRowFormatError);
  });

  it("fails loudly on a timestamp it does not recognise", () => {
    expect(() => parseManualRows([row(["Jan 12", "-100", "0", "-100", "US", "x"])])).toThrow(/unrecognised timestamp/);
  });
});
