import { describe, expect, it, vi } from "vitest";
import { ExpressRowFormatError, parseExpressRows, type RawExpressRow } from "./parseExpressRows.js";

/**
 * Synthetic rows — invented, not from any real invoice — in the emailed PDF's
 * 14-column layout: DATE, EXP. CODE, AUTH CODE, TRACTOR, TRAILER,
 * DRIVER NAME/ID, CDL, TRIP #, AMOUNT CASHED, FEE, TOTAL, CUR, Payee, NOTES.
 *
 * Shapes the DoD cares about: a normal row, a blank-driver row (tractor
 * present, driver not — the real blank case), and the flat $3.00 fee.
 */
const PDF_ROWS: RawExpressRow[] = [
  {
    lineNumber: 10,
    record: ["2026-01-05 08:00:00", "9000001", "E1000001", "101", "", "SAMPLE DRIVER", "", "", "50.00", "3", "53.00", "US", "lumper", ""],
  },
  {
    lineNumber: 11,
    record: ["2026-01-06 09:00:00", "9000002", "E1000002", "102", "", "", "", "", "75.00", "3", "78.00", "US", "lumper", ""],
  },
  {
    lineNumber: 12,
    record: ["2026-01-07 10:00:00", "9000003", "E1000003", "103", "", "OTHER DRIVER", "", "", "40.00", "3", "43.00", "US", "repair", ""],
  },
];

/** The portal CSV's 9-column layout, which carries no tractor/driver at all. */
const CSV_ROWS: RawExpressRow[] = [
  {
    lineNumber: 10,
    record: ["2026-01-05 08:00:00", "9000001", "E1000001", "50.00", "3", "53.00", "US", "lumper", ""],
  },
  {
    lineNumber: 11,
    record: ["2026-01-06 09:00:00", "9000002", "E1000002", "75.00", "3", "78.00", "US", "lumper", ""],
  },
];

describe("parseExpressRows — pdf layout", () => {
  it("parses a normal row and the blank-driver row (tractor present, driver not)", () => {
    const rows = parseExpressRows(PDF_ROWS, "pdf");
    expect(rows.find((r) => r.expressCode === "9000001")).toMatchObject({
      unitRaw: "101",
      driverNameRaw: "SAMPLE DRIVER",
      amountUsd: "50.00",
      feeUsd: "3.00",
      totalUsd: "53.00",
      payee: "lumper",
    });

    expect(rows.find((r) => r.expressCode === "9000002")).toMatchObject({
      unitRaw: "102",
      driverNameRaw: null,
      totalUsd: "78.00",
    });
  });

  it("carries the trailer, CDL and trip columns rather than dropping them", () => {
    const row = parseExpressRows(PDF_ROWS, "pdf")[0]!;
    expect(row).toMatchObject({ trailerRaw: null, cdlRaw: null, tripNumberRaw: null });
  });

  it("asserts the flat $3.00 fee on every row", () => {
    expect(parseExpressRows(PDF_ROWS, "pdf").every((r) => r.feeUsd === "3.00")).toBe(true);
  });

  it("fails loudly on a fee that is not $3.00, rather than passing it through", () => {
    const badFee: RawExpressRow[] = [
      { lineNumber: 999, record: ["2026-01-05 07:43:16", "1", "E1", "101", "", "", "", "", "100", "3.50", "103.50", "US", "lumper", ""] },
    ];
    expect(() => parseExpressRows(badFee, "pdf")).toThrow(ExpressRowFormatError);
  });

  it("sums the sample's express amounts as expected", () => {
    const rows = parseExpressRows(PDF_ROWS, "pdf");
    const totalCents = rows.reduce((sum, r) => sum + Math.round(Number(r.totalUsd) * 100), 0);
    expect(totalCents).toBe(17400); // 53.00 + 78.00 + 43.00
  });

  it("performs no I/O and prints nothing", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    parseExpressRows(PDF_ROWS, "pdf");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("parseExpressRows — csv layout", () => {
  it("reads the money columns from their own positions, not the PDF's", () => {
    const rows = parseExpressRows(CSV_ROWS, "csv");
    expect(rows[0]).toMatchObject({
      expressCode: "9000001",
      authCodeRef: "E1000001",
      amountUsd: "50.00",
      feeUsd: "3.00",
      totalUsd: "53.00",
      payee: "lumper",
    });
  });

  it("reports no tractor or driver, because the export carries neither column", () => {
    for (const row of parseExpressRows(CSV_ROWS, "csv")) {
      expect(row.unitRaw).toBeNull();
      expect(row.driverNameRaw).toBeNull();
      expect(row.trailerRaw).toBeNull();
    }
  });

  it("agrees with the pdf layout on the money for the same rows", () => {
    const fromPdf = parseExpressRows(PDF_ROWS, "pdf");
    const fromCsv = parseExpressRows(CSV_ROWS, "csv");
    for (const csvRow of fromCsv) {
      const pdfRow = fromPdf.find((r) => r.expressCode === csvRow.expressCode)!;
      expect(csvRow.amountUsd).toBe(pdfRow.amountUsd);
      expect(csvRow.totalUsd).toBe(pdfRow.totalUsd);
      expect(csvRow.authCodeRef).toBe(pdfRow.authCodeRef);
    }
  });
});
