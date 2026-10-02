import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  InvoiceFormatError,
  parseInvoiceCsv,
  validateProductLine,
} from "./parseInvoiceCsv.js";
import { DEFAULT_INVOICE_PRODUCT_CODES } from "./productCode.js";

// Synthetic, invented data — committed, runs on a fresh clone and in CI.
// See docs/BUILD-PLAN-v2.md step 27.1.
const REDACTED_PATH = fileURLToPath(
  new URL("../../test/fixtures/invoices/sample-redacted.csv", import.meta.url),
);
const redacted = () => readFileSync(REDACTED_PATH);

// A real invoice, if the operator has dropped one in locally
// (data/bvd-invoices/, gitignored — never committed). Skips automatically
// when absent, same as this repo's DATABASE_URL-gated integration tests.
const REAL_PATH = fileURLToPath(
  new URL("../../../data/bvd-invoices/invoice_999210.csv", import.meta.url),
);
const hasRealFixture = existsSync(REAL_PATH);

describe("parseInvoiceCsv — structural (synthetic fixture)", () => {
  it("parses the header", () => {
    const result = parseInvoiceCsv(redacted(), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100001.csv");
    expect(result.header).toEqual({
      // Derived, because the real export carries no header block: the number
      // from the filename, the period from the file's own transaction dates,
      // and invoice/due date from the period end.
      invoiceNumber: "100001",
      periodStart: "2026-01-05",
      periodEnd: "2026-01-07",
      invoiceDate: "2026-01-08",
      dueDate: "2026-01-09",
      currency: "USD",
      supplierName: "BVD Petroleum",
      supplierAddress: "130 Delta Park Blvd, Brampton, ON L6T 5E7",
      billToName: "2043733 ONTARIO INC.",
      billToAddress: "5 MATAGAMI STREET, BRAMPTON, ON, Canada, L6Y 0M9",
    });
  });

  it("refuses a filename with no invoice number in it, rather than inventing one", () => {
    expect(() => parseInvoiceCsv(redacted(), DEFAULT_INVOICE_PRODUCT_CODES, "export.csv")).toThrow(
      InvoiceFormatError,
    );
  });

  it("reports no express tractor or driver — this export has no such columns", () => {
    const result = parseInvoiceCsv(redacted(), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100001.csv");
    expect(result.expressRows).toHaveLength(2);
    for (const row of result.expressRows) {
      expect(row.unitRaw).toBeNull();
      expect(row.driverNameRaw).toBeNull();
    }
  });

  it("parses the printed per-code totals, trusted as given", () => {
    const result = parseInvoiceCsv(redacted(), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100001.csv");
    const byCode = Object.fromEntries(
      result.printedTotals.products.map((p) => [p.productCode, p]),
    );
    expect(byCode.TA).toEqual({ productCode: "TA", qty: "130.00", amount: "672.17", discount: "50.83", preTaxAmount: "672.17", hst: "0.00", gst: "0.00", pst: "0.00", qst: "0.00"});
    expect(byCode.DF).toEqual({ productCode: "DF", qty: "5.00", amount: "22.50", discount: "0.00", preTaxAmount: "22.50", hst: "0.00", gst: "0.00", pst: "0.00", qst: "0.00"});
    expect(byCode.S).toEqual({ productCode: "S", qty: null, amount: "15.00", discount: null, preTaxAmount: null, hst: "0.00", gst: "0.00", pst: "0.00", qst: "0.00"});
    expect(byCode["Express Codes"]).toEqual({
      productCode: "Express Codes",
      qty: null,
      amount: "131.00",
      discount: null,
      preTaxAmount: null,
      hst: "0.00",
      gst: "0.00",
      pst: "0.00",
      qst: "0.00",
    });
    expect(result.printedTotals.grandTotal).toBe("840.67");
  });

  it("parses every product line with no rejections", () => {
    const result = parseInvoiceCsv(redacted(), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100001.csv");
    expect(result.rejections).toEqual([]);
    expect(result.lines).toHaveLength(4);
  });

  it("parses 4dp prices exactly, as decimal-safe strings", () => {
    const result = parseInvoiceCsv(redacted(), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100001.csv");
    const ta = result.lines.find((l) => l.baseAuthCode === "B100001" && l.rawProductCode === "TA")!;
    expect(ta.billedPerUnit).toBe("5.1234");
    expect(ta.retailPerUnit).toBe("5.5000");
  });

  it("performs no I/O and prints nothing", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    parseInvoiceCsv(redacted(), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100001.csv");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects a header whose shape differs, rather than coercing it", () => {
    const mutated = redacted()
      .toString("utf8")
      .replace("Auth Code, Driver Name, Unit #,", "Auth Code, Driver,");
    expect(() => parseInvoiceCsv(mutated, DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100001.csv")).toThrow(
      InvoiceFormatError,
    );
  });

  // Found against the real corpus during T-48's backfill (11 of 20 real
  // September invoices have zero express charges): when an invoice has none
  // at all, BVD omits the entire "Express Codes" section — marker, header
  // and all — and goes straight from the last card's fuel data into "Grand
  // Totals". The printed totals section still carries an "Express Codes"
  // row (amount 0), same as when the section is present; only the raw
  // section itself is missing.
  it("parses an invoice with zero express charges, where the whole Express Codes section is omitted", () => {
    const csv = [
      "Fuel Card Transactions",
      "Transactions for Card # 1000001",
      "Auth Code, Driver Name, Unit #, Date, Site #, Site Name, Site City, Prov/ST, Prod, QTY, Retail, Billed, Pre Tax AMT, HST, GST, PST, QST, Disc Rate, Disc AMT, Final AMT, CUR",
      "B100001-TA,DRIVER ONE,101,2026-01-05 10:00:00,90001,SAMPLE #1,SAMPLETON,TX,TA,50.00,5.5000,5.1234,256.17,0,0,0,0,0.375,18.83,256.17,US,",
      ",,,,,Transaction Subtotal,,,,50.00,,,256.17,0,0,0,0,,18.83,256.17,,",
      ",,,,,Card Subtotal,TA,,,50.00,,,256.17,0,0,0,0,0.375,18.83,256.17,US,",
      ",,,,,,TF,,,0,,,0,0,0,0,0,0,0,0,US,",
      ",,,,,,Fuel Totals,,,50.00,,,256.17,0,0,0,0,0.375,18.83,256.17,US,",
      ",,,,,,DF,,,0,,,0,0,0,0,0,0,0,0,US,",
      ",,,,,,Sub Total,,,,,,256.17,0,0,0,0,,18.83,256.17,US,",
      "Grand Totals",
      "PRODUCT, QTY, PRE TAX AMT, HST, GST, PST, QST, DISC RATE, DISC AMT, FINAL AMOUNT, CUR",
      "TA,50.00,256.17,0,0,0,0,0.375,18.83,256.17,US,",
      "Express Codes,,,,,,,,,0,US,",
      "Grand Total,50.00,256.17,0,0,0,0,0.375,18.83,256.17,US,",
    ].join("\n");

    const result = parseInvoiceCsv(csv, DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100005.csv");
    expect(result.rejections).toEqual([]);
    expect(result.expressRows).toEqual([]);
    expect(result.printedTotals.grandTotal).toBe("256.17");
  });
});

describe.skipIf(!hasRealFixture)("parseInvoiceCsv — real invoice 999210 (local fixture only)", () => {
  it("parses the header", () => {
    const result = parseInvoiceCsv(readFileSync(REAL_PATH), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_999210.csv");
    // Every one of these is derived, and every one matches what the same
    // invoice's PDF prints outright — which is what makes the derivation
    // rules measured rather than assumed. See parseInvoicePdf.test.ts.
    expect(result.header).toEqual({
      invoiceNumber: "999210",
      periodStart: "2026-09-03",
      periodEnd: "2026-09-09",
      invoiceDate: "2026-09-10",
      dueDate: "2026-09-11",
      currency: "USD",
      supplierName: "BVD Petroleum",
      supplierAddress: "130 Delta Park Blvd, Brampton, ON L6T 5E7",
      billToName: "2043733 ONTARIO INC.",
      billToAddress: "5 MATAGAMI STREET, BRAMPTON, ON, Canada, L6Y 0M9",
    });
  });

  it("parses the printed per-code totals, trusted as given", () => {
    const result = parseInvoiceCsv(readFileSync(REAL_PATH), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_999210.csv");
    const byCode = Object.fromEntries(
      result.printedTotals.products.map((p) => [p.productCode, p]),
    );
    expect(byCode.TA).toEqual({
      productCode: "TA",
      qty: "8733.11",
      amount: "48450.68",
      discount: "5088.61",
      preTaxAmount: "48450.68",
      hst: "0.00",
      gst: "0.00",
      pst: "0.00",
      qst: "0.00",
    });
    expect(byCode.DF).toEqual({ productCode: "DF", qty: "174.43", amount: "845.40", discount: "0.00", preTaxAmount: "845.40", hst: "0.00", gst: "0.00", pst: "0.00", qst: "0.00"});
    expect(byCode.S).toEqual({ productCode: "S", qty: null, amount: "90.50", discount: null, preTaxAmount: null, hst: "0.00", gst: "0.00", pst: "0.00", qst: "0.00"});
    expect(byCode["Express Codes"]).toEqual({
      productCode: "Express Codes",
      qty: null,
      amount: "1543.13",
      discount: null,
      preTaxAmount: null,
      hst: "0.00",
      gst: "0.00",
      pst: "0.00",
      qst: "0.00",
    });
    expect(result.printedTotals.grandTotal).toBe("50929.71");
  });

  it("parses ~60 real stops (66 distinct base auth codes, 86 product lines), with no rejections", () => {
    const result = parseInvoiceCsv(readFileSync(REAL_PATH), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_999210.csv");
    expect(result.rejections).toEqual([]);
    expect(result.lines).toHaveLength(86);
    expect(new Set(result.lines.map((l) => l.baseAuthCode)).size).toBe(66);
  });

  it("parses 4dp prices with no rounding, exactly as printed", () => {
    const result = parseInvoiceCsv(readFileSync(REAL_PATH), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_999210.csv");
    const worked = result.lines.filter((l) => l.baseAuthCode === "A252014353");
    const ta = worked.find((l) => l.rawProductCode === "TA")!;
    const df = worked.find((l) => l.rawProductCode === "DF")!;
    expect(ta.billedPerUnit).toBe("5.2395");
    expect(ta.retailPerUnit).toBe("5.9890"); // printed as "5.989"
    expect(df.billedPerUnit).toBe("4.8890"); // printed as "4.889"
  });

  it("parses the sub-gallon swipe (0.04) and a large fill (243.95)", () => {
    const result = parseInvoiceCsv(readFileSync(REAL_PATH), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_999210.csv");
    expect(result.lines.some((l) => l.qty === "0.04")).toBe(true);
    expect(result.lines.some((l) => l.qty === "243.95")).toBe(true);
  });
});

describe("validateProductLine", () => {
  const baseRow = [
    "A999999999-TA", "SOME DRIVER", "099", "2026-09-05 10:00:00", "12345",
    "LOVES #1", "SOMEWHERE", "TX", "TA", "100.00", "5.999", "5.5000",
    "550.00", "0", "0", "0", "0", "0.5", "50.00", "550.00", "US",
  ];

  it("fails an unmapped product code, never default-mapping it to diesel", () => {
    const row = [...baseRow];
    row[0] = "A999999999-ZZ";
    row[8] = "ZZ";
    const result = validateProductLine(row, 42, "1000001", DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.code).toBe("UNMAPPED_PRODUCT");
      expect(result.rejection.lineNumber).toBe(42);
      expect(result.rejection.authCode).toBe("A999999999-ZZ");
      expect(result.rejection.rawProduct).toBe("ZZ");
    }
  });

  it("accepts every documented code (TF, AD, O, L, C) before it ever appears on a real invoice", () => {
    for (const code of ["TF", "AD", "O", "L", "C"]) {
      const row = [...baseRow];
      row[0] = `A999999999-${code}`;
      row[8] = code;
      const result = validateProductLine(row, 1, "1000001", DEFAULT_INVOICE_PRODUCT_CODES);
      expect(result.ok).toBe(true);
    }
  });

  it("rejects a malformed auth code with SCHEMA_ERROR", () => {
    const row = [...baseRow];
    row[0] = "NOAUTHCODE";
    const result = validateProductLine(row, 7, "1000001", DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.code).toBe("SCHEMA_ERROR");
      expect(result.rejection.lineNumber).toBe(7);
    }
  });
});

// T-61: the CUR column. Each case is composed in the test from the synthetic
// CSV, never committed as its own fixture.
describe("parseInvoiceCsv — currency (T-61)", () => {
  const sample = () => redacted().toString("utf8");
  /** The first fuel line's CUR cell replaced; every other row untouched. */
  const withFirstFuelCur = (code: string) => sample().replace("22.50,US,", `22.50,${code},`);

  it("reads every US row as USD, on the header and every line", () => {
    const result = parseInvoiceCsv(redacted(), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100001.csv");
    expect(result.header.currency).toBe("USD");
    expect(result.lines.every((l) => l.currency === "USD")).toBe(true);
    expect(result.expressRows.every((r) => r.currency === "USD")).toBe(true);
  });

  it("keeps the tax, discount-rate and discount cells of every line", () => {
    const result = parseInvoiceCsv(redacted(), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100001.csv");
    const ta = result.lines.find((l) => l.authCode === "B100001-TA")!;
    expect(ta).toMatchObject({
      preTaxAmount: "256.17", hst: "0.00", gst: "0.00", pst: "0.00", qst: "0.00",
      discRate: "0.3750", discount: "18.83", amount: "256.17",
    });
  });

  it("rejects a CN invoice whole with CA_CSV_UNVERIFIED — a CA invoice imports from the PDF only (D30)", () => {
    const allCn = sample().replace(/,US,/g, ",CN,");
    const parse = () => parseInvoiceCsv(Buffer.from(allCn), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100001.csv");
    expect(parse).toThrow(InvoiceFormatError);
    try {
      parse();
    } catch (err) {
      expect((err as InvoiceFormatError).code).toBe("CA_CSV_UNVERIFIED");
    }
  });

  it("quarantines a row whose CUR is neither US nor CN as UNKNOWN_CURRENCY, never defaulting it", () => {
    const result = parseInvoiceCsv(Buffer.from(withFirstFuelCur("EU")), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100001.csv");
    expect(result.rejections).toEqual([
      expect.objectContaining({ authCode: "B100001-DF", code: "UNKNOWN_CURRENCY", rawProduct: "DF" }),
    ]);
    expect(result.lines.map((l) => l.authCode)).not.toContain("B100001-DF");
    expect(result.header.currency).toBe("USD");
  });

  it("rejects an invoice whose rows mix US and CN with MIXED_CURRENCY, never splitting it (D24)", () => {
    const parse = () =>
      parseInvoiceCsv(Buffer.from(withFirstFuelCur("CN")), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100001.csv");
    expect(parse).toThrow(/MIXED_CURRENCY/);
    try {
      parse();
    } catch (err) {
      expect((err as InvoiceFormatError).code).toBe("MIXED_CURRENCY");
    }
  });
});
