import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { parseInvoiceCsv } from "./parseInvoiceCsv.js";
import { InvoicePdfFormatError, parseInvoicePdf } from "./parseInvoicePdf.js";
import { groupByAuthCode } from "./groupByAuthCode.js";
import { reconcile } from "./reconcile.js";
import { DEFAULT_INVOICE_PRODUCT_CODES } from "./productCode.js";
import { realName } from "../../test/support/realNames.js";

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
      currency: "USD",
    });
  });

  it("parses product lines and the printed grand total", async () => {
    const result = await parseInvoicePdf(redacted(), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.rejections).toEqual([]);
    expect(result.lines).toHaveLength(4);
    expect(result.printedTotals.grandTotal).toBe("840.67");
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
    expect(fromPdf.lines.map((l) => [l.authCode, l.qty, l.amount])).toEqual(
      fromCsv.lines.map((l) => [l.authCode, l.qty, l.amount]),
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

// T-50: one committed PDF per failure mode, rendered from invented data by
// generateSamplePdf.ts. Read inside each `it`, never at describe level.
const edgePdf = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../test/fixtures/invoices/${name}.pdf`, import.meta.url)));

describe("parseInvoicePdf — edge-case fixtures (T-50)", () => {
  it("edge-totals-mismatch: parses, but a grand total a dollar over its rows does not reconcile", async () => {
    const result = await parseInvoicePdf(edgePdf("edge-totals-mismatch"), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.rejections).toEqual([]);
    // 694.67 priced + 15.00 scale + 53.00 express = 762.67, printed as 763.67.
    expect(result.printedTotals.grandTotal).toBe("763.67");
    const outcome = reconcile(groupByAuthCode(result.lines), result.expressRows, result.printedTotals);
    expect(outcome.balanced).toBe(false);
  });

  it("edge-changed-header: refuses a fuel table whose column header changed, rather than reading prices by position", async () => {
    await expect(parseInvoicePdf(edgePdf("edge-changed-header"), DEFAULT_INVOICE_PRODUCT_CODES)).rejects.toThrow(
      InvoicePdfFormatError,
    );
  });

  it("refuses fuel rows when the header no longer opens with the expected column, instead of skipping it as a roll-up", async () => {
    const { EDGE_CASES, FUEL_COLUMNS, renderInvoicePdf } = await import("../../test/fixtures/invoices/generateSamplePdf.js");
    const renamed = { ...EDGE_CASES["edge-changed-header"], fuelColumns: ["Authorization", ...FUEL_COLUMNS.slice(1)] };
    await expect(parseInvoicePdf(await renderInvoicePdf(renamed), DEFAULT_INVOICE_PRODUCT_CODES)).rejects.toThrow(
      /a fuel row came before the fuel table's column header/,
    );
  });

  it("edge-page-break: reads every line of a card that runs across a page, under 1-, 2- and 3-word driver names", async () => {
    const result = await parseInvoicePdf(edgePdf("edge-page-break"), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.rejections).toEqual([]);
    expect(result.lines).toHaveLength(24);
    expect(new Set(result.lines.map((l) => l.cardNumber))).toEqual(new Set(["1000001"]));
    expect(new Set(result.lines.map((l) => l.driverNameRaw))).toEqual(new Set(["REMY", "DRIVER TWO", "ANA DE SOUSA"]));
    expect(result.lines.every((l) => l.stationCity === "Sampleton" && l.unitRaw === "101")).toBe(true);
    const outcome = reconcile(groupByAuthCode(result.lines), result.expressRows, result.printedTotals);
    expect(outcome.balanced).toBe(true);
  });

  it("edge-express-blanks: a blank driver, a blank tractor and both blank stay null, not shifted into each other", async () => {
    const result = await parseInvoicePdf(edgePdf("edge-express-blanks"), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.expressRows.map((r) => [r.expressCode, r.unitRaw, r.driverNameRaw])).toEqual([
      ["9000001", "101", null],
      ["9000002", null, "PAT LEE"],
      ["9000003", null, null],
    ]);
    // A whole-dollar amount printed without cents.
    expect(result.expressRows[0]).toMatchObject({ amount: "50.00", fee: "3.00", total: "53.00" });
    const outcome = reconcile(groupByAuthCode(result.lines), result.expressRows, result.printedTotals);
    expect(outcome.balanced).toBe(true);
  });

  it("edge-thousands: strips the thousands separators the PDF prints, on lines, totals and express rows", async () => {
    const result = await parseInvoicePdf(edgePdf("edge-thousands"), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.rejections).toEqual([]);
    expect(result.lines.map((l) => [l.authCode, l.amount])).toEqual([
      ["B300001-TA", "1280.85"],
      ["B300002-TA", "1094.60"],
    ]);
    expect(result.expressRows[0]).toMatchObject({ amount: "1200.00", total: "1203.00" });
    expect(result.printedTotals.grandTotal).toBe("3578.45");
    const outcome = reconcile(groupByAuthCode(result.lines), result.expressRows, result.printedTotals);
    expect(outcome.balanced).toBe(true);
  });

  it("edge-unmapped-product: quarantines the one line whose product code no mapping knows, and keeps the rest", async () => {
    const result = await parseInvoicePdf(edgePdf("edge-unmapped-product"), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.rejections).toEqual([
      expect.objectContaining({ authCode: "B400001-ZZ", code: "UNMAPPED_PRODUCT", rawProduct: "ZZ" }),
    ]);
    expect(result.lines.map((l) => l.authCode)).toEqual(["B100001-TA", "B100001-DF"]);
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
      currency: "USD",
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
    expect(drivers).toContain(realName("pdf999210.multiWordDriverA"));
    expect(drivers).toContain(realName("pdf999210.multiWordDriverB"));
    expect(result.lines.some((l) => l.stationCity === "Sulphur Springs")).toBe(true);
  });

  it("parses the printed totals, thousands separators and all", async () => {
    const result = await parseInvoicePdf(readFileSync(REAL_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    const byCode = Object.fromEntries(result.printedTotals.products.map((p) => [p.productCode, p]));
    expect(byCode.TA).toEqual({
      productCode: "TA", qty: "8733.11", amount: "48450.68", discount: "5088.61",
      preTaxAmount: "48450.68", hst: "0.00", gst: "0.00", pst: "0.00", qst: "0.00",
    });
    expect(byCode.DF).toEqual({
      productCode: "DF", qty: "174.43", amount: "845.40", discount: "0.00",
      preTaxAmount: "845.40", hst: "0.00", gst: "0.00", pst: "0.00", qst: "0.00",
    });
    // Printed as a bare final amount with no other columns.
    expect(byCode.S).toEqual({ productCode: "S", qty: null, amount: "90.50", discount: null, preTaxAmount: null, hst: "0.00", gst: "0.00", pst: "0.00", qst: "0.00"});
    expect(result.printedTotals.grandTotal).toBe("50929.71");
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
    expect(result.expressRows.every((r) => r.fee === "3.00")).toBe(true);

    // Every real express row carries a tractor; only the driver is ever blank.
    expect(result.expressRows.every((r) => r.unitRaw !== null)).toBe(true);
    const byCode = Object.fromEntries(result.expressRows.map((r) => [r.expressCode, r]));
    expect(byCode["6552061"]).toMatchObject({ unitRaw: "1019", driverNameRaw: realName("pdf999210.expressDriver6552061"), total: "243.35" });
    expect(byCode["6570949"]).toMatchObject({ unitRaw: "064", driverNameRaw: realName("pdf999210.expressDriver6570949"), total: "460.60" });
    expect(byCode["6571780"]).toMatchObject({ unitRaw: "073", driverNameRaw: null, total: "203.00" });
    expect(byCode["6551741"]).toMatchObject({ unitRaw: "066", driverNameRaw: realName("pdf999210.expressDriver6551741"), payee: "lumper fees" });
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
      expect([csvLine.qty, csvLine.billedPerUnit, csvLine.amount, csvLine.unitRaw, csvLine.driverNameRaw])
        .toEqual([pdfLine.qty, pdfLine.billedPerUnit, pdfLine.amount, pdfLine.unitRaw, pdfLine.driverNameRaw]);
    }
  });

  it("differs only where the CSV export has no columns: express tractor and driver", async () => {
    const fromPdf = await parseInvoicePdf(readFileSync(REAL_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    const fromCsv = parseInvoiceCsv(readFileSync(REAL_CSV), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_999210.csv");

    const csvByCode = Object.fromEntries(fromCsv.expressRows.map((r) => [r.expressCode, r]));
    for (const pdfRow of fromPdf.expressRows) {
      const csvRow = csvByCode[pdfRow.expressCode]!;
      expect(csvRow.total).toBe(pdfRow.total);
      expect(csvRow.payee).toBe(pdfRow.payee);
      expect(csvRow.unitRaw).toBeNull();
      expect(csvRow.driverNameRaw).toBeNull();
    }
    expect(fromPdf.expressRows.every((r) => r.unitRaw !== null)).toBe(true);
  });
});

// T-61: a CA invoice. sample-ca.pdf is synthetic, written in the CA layout
// (see generateSamplePdf.ts); variants are rendered from its spec in the
// test, never committed.
const CA_PDF = fileURLToPath(new URL("../../test/fixtures/invoices/sample-ca.pdf", import.meta.url));
const REAL_CA_PDF = fileURLToPath(new URL("../../../data/bvd-invoices/BVD_invoice_999217.pdf", import.meta.url));

/** The CA fixture with one fuel row's CUR replaced. */
async function caPdfWithCur(authCode: string, code: string): Promise<Buffer> {
  const { CA_INVOICE, renderInvoicePdf } = await import("../../test/fixtures/invoices/generateSamplePdf.js");
  const spec = structuredClone(CA_INVOICE);
  const row = spec.cards.flatMap((c) => c.rows).find((r) => r[0] === authCode)!;
  row[row.length - 1] = code;
  return renderInvoicePdf(spec);
}

describe("parseInvoicePdf — CA invoice (synthetic fixture, T-61)", () => {
  it("reads every row as CAD: header, lines, express and totals", async () => {
    const result = await parseInvoicePdf(readFileSync(CA_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.header.currency).toBe("CAD");
    expect(result.lines).toHaveLength(9);
    expect(result.rejections).toEqual([]);
    expect(result.lines.every((l) => l.currency === "CAD")).toBe(true);
    expect(result.expressRows.map((r) => r.currency)).toEqual(["CAD"]);
  });

  it("keeps the printed period, even though it starts weeks before the first transaction", async () => {
    const { header } = await parseInvoicePdf(readFileSync(CA_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(header).toMatchObject({ periodStart: "2026-08-01", periodEnd: "2026-09-09", invoiceDate: "2026-09-10", dueDate: "2026-09-11" });
  });

  it("keeps litres, CAD per litre at 4dp, and every tax cell as printed", async () => {
    const result = await parseInvoicePdf(readFileSync(CA_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    const first = result.lines.find((l) => l.authCode === "A700000101-TA")!;
    expect(first).toMatchObject({
      qty: "300.00", retailPerUnit: "2.4990", billedPerUnit: "2.2427",
      preTaxAmount: "595.40", hst: "77.40", gst: "0.00", pst: "0.00", qst: "0.00",
      discRate: "0.2563", discount: "76.89", amount: "672.80",
    });
    // Thousands separators stripped at the boundary, as on the US invoice.
    expect(result.lines.find((l) => l.authCode === "A700000105-TA")).toMatchObject({ preTaxAmount: "1165.00", amount: "1316.45" });
    const scale = result.lines.find((l) => l.rawProductCode === "S")!;
    expect(scale).toMatchObject({ qty: "0.00", preTaxAmount: "23.01", hst: "2.99", amount: "26.00" });
  });

  it("splits a site name with no '#' from its city at the layout's tab", async () => {
    const result = await parseInvoicePdf(readFileSync(CA_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    const sites = new Map(result.lines.map((l) => [l.siteNumber, [l.stationNameRaw, l.stationCity, l.stationState]]));
    expect(sites.get("58803")).toEqual(["BVD MISSISSAUGA - SHAWSON", "MISSISSAUGA", "ON"]);
    expect(sites.get("58073")).toEqual(["BVD NIAGARA", "Niagara on the Lake", "ON"]);
    expect(sites.get("58156")).toEqual(["BVD COMBER", "Comber", "ON"]);
  });

  it("reads the transaction after the printed period end, and the driver's name and unit, unchanged", async () => {
    const result = await parseInvoicePdf(readFileSync(CA_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.lines.find((l) => l.authCode === "A700000108-TA")).toMatchObject({
      occurredAt: "2026-09-10T00:45:19", driverNameRaw: "LENNOX", unitRaw: "031", cardNumber: "9000047",
    });
  });

  it("reads the grand total row's pre-tax and tax columns, which cover TA/TF/DF only", async () => {
    const { printedTotals } = await parseInvoicePdf(readFileSync(CA_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(printedTotals.grandTotal).toBe("3839.54");
    expect(printedTotals.grandTotalRow).toMatchObject({ qty: "1725.66", preTaxAmount: "3336.77", hst: "433.77" });
    expect(printedTotals.products.find((p) => p.productCode === "S")).toMatchObject({ amount: "26.00", preTaxAmount: null, hst: "0.00" });
  });

  it("quarantines a row ending in an unknown CUR as UNKNOWN_CURRENCY", async () => {
    const result = await parseInvoicePdf(await caPdfWithCur("A700000107-TA", "EU"), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.rejections).toEqual([expect.objectContaining({ authCode: "A700000107-TA", code: "UNKNOWN_CURRENCY" })]);
    expect(result.lines).toHaveLength(8);
    expect(result.header.currency).toBe("CAD");
  });

  it("rejects an invoice mixing US and CN rows whole, with MIXED_CURRENCY", async () => {
    await expect(
      parseInvoicePdf(await caPdfWithCur("A700000107-TA", "US"), DEFAULT_INVOICE_PRODUCT_CODES),
    ).rejects.toMatchObject({ name: "InvoiceFormatError", code: "MIXED_CURRENCY" });
  });

  it("still reads the US fixture as USD on every line", async () => {
    const result = await parseInvoicePdf(redacted(), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.header.currency).toBe("USD");
    expect(result.lines.every((l) => l.currency === "USD")).toBe(true);
  });
});

// The real CA invoice, gitignored. Asserts counts and totals only — no card
// number or driver name appears in this file (T-58).
describe.skipIf(!existsSync(REAL_CA_PDF))("parseInvoicePdf — real CA invoice 999217 (local fixture only)", () => {
  it("parses 60 CAD lines on 34 cards at 9 sites, with nothing rejected", async () => {
    const result = await parseInvoicePdf(readFileSync(REAL_CA_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(result.header.currency).toBe("CAD");
    expect(result.rejections).toHaveLength(0);
    expect(result.lines).toHaveLength(60);
    expect(result.lines.every((l) => l.currency === "CAD")).toBe(true);
    expect(new Set(result.lines.map((l) => l.cardNumber)).size).toBe(34);
    expect(new Set(result.lines.map((l) => l.siteNumber)).size).toBe(9);
    expect(result.expressRows).toHaveLength(0);
  });

  it("reads the printed totals: grand 46,837.33 = pre-tax 41,356.89 + HST 5,376.44 + Scale 104.00", async () => {
    const { printedTotals } = await parseInvoicePdf(readFileSync(REAL_CA_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    expect(printedTotals.grandTotal).toBe("46837.33");
    expect(printedTotals.grandTotalRow).toMatchObject({ preTaxAmount: "41356.89", hst: "5376.44" });
    const byCode = Object.fromEntries(printedTotals.products.map((p) => [p.productCode, p]));
    expect(byCode.TA).toMatchObject({ qty: "21318.77" });
    expect(byCode.DF).toMatchObject({ qty: "113.09" });
    expect(byCode.S).toMatchObject({ amount: "104.00" });
  });

  it("splits every site name from its city: 9 distinct (site, name, city) triples", async () => {
    const result = await parseInvoicePdf(readFileSync(REAL_CA_PDF), DEFAULT_INVOICE_PRODUCT_CODES);
    const triples = new Set(result.lines.map((l) => `${l.siteNumber}|${l.stationNameRaw}|${l.stationCity}`));
    expect(triples.size).toBe(9);
    expect(result.lines.every((l) => l.stationNameRaw.startsWith("BVD ") && l.stationCity !== "")).toBe(true);
  });
});
