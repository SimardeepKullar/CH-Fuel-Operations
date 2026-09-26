import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { parseInvoiceCsv } from "./parseInvoiceCsv.js";
import { parseInvoicePdf } from "./parseInvoicePdf.js";
import { groupByAuthCode } from "./groupByAuthCode.js";
import { reconcile } from "./reconcile.js";
import { DEFAULT_INVOICE_PRODUCT_CODES } from "./productCode.js";

// Synthetic, invented data — committed, runs on a fresh clone and in CI.
// Regenerate with test/fixtures/invoices/generateSamplePdf.ts. It describes
// the same invoice as sample-redacted.csv, so the two can be compared.
const REDACTED_PDF = fileURLToPath(
  new URL("../../test/fixtures/invoices/sample-redacted.pdf", import.meta.url),
);
const REDACTED_CSV = fileURLToPath(
  new URL("../../test/fixtures/invoices/sample-redacted.csv", import.meta.url),
);
const redacted = () => readFileSync(REDACTED_PDF);

// A real invoice, if the operator has dropped one in locally
// (data/bvd-invoices/, gitignored). Skips automatically when absent.
const REAL_PDF = fileURLToPath(
  new URL("../../../data/bvd-invoices/BVD_invoice_999210.pdf", import.meta.url),
);
const REAL_CSV = fileURLToPath(
  new URL("../../../data/bvd-invoices/invoice_999210.csv", import.meta.url),
);
const hasRealFixture = existsSync(REAL_PDF);
const hasRealPair = hasRealFixture && existsSync(REAL_CSV);

describe("parseInvoicePdf", () => {
  it("produces the exact same output shape as parseInvoiceCsv (type-level)", () => {
    // Compile-time only: if the two parsers' return shapes ever diverge,
    // `npm run typecheck` fails here — this is what "the two parsers are
    // interchangeable" means in practice (D13).
    expectTypeOf<Awaited<ReturnType<typeof parseInvoicePdf>>>().toEqualTypeOf<
      ReturnType<typeof parseInvoiceCsv>
    >();
  });
});

describe("parseInvoicePdf — structural (synthetic fixture)", () => {
  it("reads the header table the PDF prints, rather than deriving it", async () => {
    const result = await parseInvoicePdf(redacted(), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.header).toMatchObject({
      invoiceNumber: "100001",
      periodStart: "2026-01-05",
      periodEnd: "2026-01-07",
      invoiceDate: "2026-01-08",
      dueDate: "2026-01-09",
    });
  });

  it("parses product lines and the printed grand total", async () => {
    const result = await parseInvoicePdf(redacted(), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.rejections).toEqual([]);
    expect(result.lines).toHaveLength(4);
    expect(result.printedTotals.grandTotalUsd).toBe("840.67");
  });

  it("carries express tractor and driver, which the CSV export cannot", async () => {
    const result = await parseInvoicePdf(redacted(), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.expressRows).toHaveLength(2);
    expect(result.expressRows[0]).toMatchObject({
      expressCode: "9000001",
      unitRaw: "101",
      driverNameRaw: "DRIVER ONE",
      // Payee and notes are separate columns, so a multi-word payee must not
      // spill into the note.
      payee: "lumper fees",
      note: null,
    });
    // A genuinely blank driver is real data, not a defect.
    expect(result.expressRows[1]).toMatchObject({ unitRaw: "102", driverNameRaw: null });
  });

  it("reconciles against its own printed totals", async () => {
    const result = await parseInvoicePdf(redacted(), DEFAULT_INVOICE_PRODUCT_CODES);
    const outcome = reconcile(groupByAuthCode(result.lines), result.expressRows, result.printedTotals);
    expect(outcome.balanced).toBe(true);
  });

  it("agrees with the CSV export of the same invoice on everything the CSV carries", async () => {
    const fromPdf = await parseInvoicePdf(redacted(), DEFAULT_INVOICE_PRODUCT_CODES);
    const fromCsv = parseInvoiceCsv(
      readFileSync(REDACTED_CSV), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100001.csv",
    );

    expect(fromPdf.header).toEqual(fromCsv.header);
    expect(fromPdf.printedTotals).toEqual(fromCsv.printedTotals);
    expect(fromPdf.lines.map((l) => [l.authCode, l.gallons, l.amountUsd])).toEqual(
      fromCsv.lines.map((l) => [l.authCode, l.gallons, l.amountUsd]),
    );
    // ...and differ only where the CSV has no columns at all.
    expect(fromCsv.expressRows.every((r) => r.unitRaw === null)).toBe(true);
    expect(fromPdf.expressRows.some((r) => r.unitRaw !== null)).toBe(true);
  });

  it("performs no I/O beyond reading the given buffer, and prints nothing", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await parseInvoicePdf(redacted(), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe.skipIf(!hasRealFixture)("parseInvoicePdf — real invoice 999210 (local fixture only)", () => {
  it("parses the real header table, including the real bill-to address", async () => {
    const result = await parseInvoicePdf(readFileSync(REAL_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.header).toEqual({
      invoiceNumber: "999210",
      periodStart: "2026-09-03",
      periodEnd: "2026-09-09",
      invoiceDate: "2026-09-10",
      dueDate: "2026-09-11",
      supplierName: "BVD Petroleum",
      supplierAddress: "130 Delta Park Blvd, Brampton, ON L6T 5E7",
      billToName: "2043733 ONTARIO INC.",
      billToAddress: "5 MATAGAMI STREET, BRAMPTON, ON, Canada, L6Y 0M9",
    });
  });

  it("parses all 86 product lines across 9 pages with no rejections", async () => {
    const result = await parseInvoicePdf(readFileSync(REAL_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.rejections).toEqual([]);
    expect(result.lines).toHaveLength(86);
    expect(new Set(result.lines.map((l) => l.baseAuthCode)).size).toBe(66);
  });

  it("parses multi-word driver names and cities without mis-splitting the row", async () => {
    const result = await parseInvoicePdf(readFileSync(REAL_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    const drivers = new Set(result.lines.map((l) => l.driverNameRaw));
    expect(drivers).toContain("KULWANT SINGH BAL");
    expect(drivers).toContain("JUGRAJ SINGH SAMRA");
    expect(result.lines.some((l) => l.stationCity === "Sulphur Springs")).toBe(true);
  });

  it("parses the printed totals, thousands separators and all", async () => {
    const result = await parseInvoicePdf(readFileSync(REAL_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    const byCode = Object.fromEntries(result.printedTotals.products.map((p) => [p.productCode, p]));
    expect(byCode.TA).toEqual({
      productCode: "TA", gallons: "8733.11", amountUsd: "48450.68", discountUsd: "5088.61",
    });
    expect(byCode.DF).toEqual({
      productCode: "DF", gallons: "174.43", amountUsd: "845.40", discountUsd: "0.00",
    });
    // Printed as a bare final amount with no other columns.
    expect(byCode.S).toEqual({ productCode: "S", gallons: null, amountUsd: "90.50", discountUsd: null });
    expect(result.printedTotals.grandTotalUsd).toBe("50929.71");
  });

  it("reconciles: the whole invoice balances to its own printed figures", async () => {
    const result = await parseInvoicePdf(readFileSync(REAL_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    const outcome = reconcile(groupByAuthCode(result.lines), result.expressRows, result.printedTotals);
    expect(outcome.amountImbalances).toEqual([]);
    expect(outcome.gallonImbalances).toEqual([]);
    expect(outcome.balanced).toBe(true);
    expect(outcome.grandTotal.parsedCents).toBe(5092971);
  });

  it("parses all 6 real express rows with their tractor and driver, flat $3.00 fee intact", async () => {
    const result = await parseInvoicePdf(readFileSync(REAL_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.expressRows).toHaveLength(6);
    expect(result.expressRows.every((r) => r.feeUsd === "3.00")).toBe(true);

    // Every real express row carries a tractor; only the driver is ever blank.
    expect(result.expressRows.every((r) => r.unitRaw !== null)).toBe(true);
    const byCode = Object.fromEntries(result.expressRows.map((r) => [r.expressCode, r]));
    expect(byCode["6552061"]).toMatchObject({ unitRaw: "1019", driverNameRaw: "Gurjit", totalUsd: "243.35" });
    expect(byCode["6570949"]).toMatchObject({ unitRaw: "064", driverNameRaw: "Jugraj", totalUsd: "460.60" });
    expect(byCode["6571780"]).toMatchObject({ unitRaw: "073", driverNameRaw: null, totalUsd: "203.00" });
    expect(byCode["6551741"]).toMatchObject({ unitRaw: "066", driverNameRaw: "Gurshiv", payee: "lumper fees" });
  });
});

describe.skipIf(!hasRealPair)("parseInvoicePdf vs parseInvoiceCsv — the same real invoice", () => {
  it("agrees on the header, every money field, and every express amount", async () => {
    const fromPdf = await parseInvoicePdf(readFileSync(REAL_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    const fromCsv = parseInvoiceCsv(readFileSync(REAL_CSV), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_999210.csv");

    // The CSV's header is entirely derived; that it matches the PDF's printed
    // header is what makes the derivation rules measured, not assumed.
    expect(fromCsv.header).toEqual(fromPdf.header);
    expect(fromCsv.printedTotals).toEqual(fromPdf.printedTotals);

    const key = (r: typeof fromPdf.lines) =>
      new Map(r.map((l) => [l.authCode, l]));
    const pdfLines = key(fromPdf.lines);
    const csvLines = key(fromCsv.lines);
    expect(csvLines.size).toBe(pdfLines.size);
    for (const [auth, csvLine] of csvLines) {
      const pdfLine = pdfLines.get(auth)!;
      expect([csvLine.gallons, csvLine.billedUsdPerGal, csvLine.amountUsd, csvLine.unitRaw, csvLine.driverNameRaw])
        .toEqual([pdfLine.gallons, pdfLine.billedUsdPerGal, pdfLine.amountUsd, pdfLine.unitRaw, pdfLine.driverNameRaw]);
    }
  });

  it("differs only where the CSV export has no columns: express tractor and driver", async () => {
    const fromPdf = await parseInvoicePdf(readFileSync(REAL_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    const fromCsv = parseInvoiceCsv(readFileSync(REAL_CSV), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_999210.csv");

    const csvByCode = Object.fromEntries(fromCsv.expressRows.map((r) => [r.expressCode, r]));
    for (const pdfRow of fromPdf.expressRows) {
      const csvRow = csvByCode[pdfRow.expressCode]!;
      expect(csvRow.totalUsd).toBe(pdfRow.totalUsd);
      expect(csvRow.payee).toBe(pdfRow.payee);
      expect(csvRow.unitRaw).toBeNull();
      expect(csvRow.driverNameRaw).toBeNull();
    }
    expect(fromPdf.expressRows.every((r) => r.unitRaw !== null)).toBe(true);
  });
});
