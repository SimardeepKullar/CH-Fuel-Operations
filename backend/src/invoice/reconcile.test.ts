import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { groupByAuthCode } from "./groupByAuthCode.js";
import { parseInvoiceCsv } from "./parseInvoiceCsv.js";
import { DEFAULT_INVOICE_PRODUCT_CODES } from "./productCode.js";
import { reconcile, withinRoundingBound } from "./reconcile.js";
import type { ValidatedInvoiceLine } from "./parseInvoiceCsv.js";
import type { FuelStopGroup } from "./groupByAuthCode.js";
import type { ExpressRow } from "./parseExpressRows.js";
import type { PrintedProductTotal, PrintedTotals } from "./parseInvoiceCsv.js";

function mkLine(overrides: Partial<ValidatedInvoiceLine>): ValidatedInvoiceLine {
  return {
    lineNumber: 1,
    authCode: "A1-TA",
    baseAuthCode: "A1",
    cardNumber: "1000001",
    driverNameRaw: "DRIVER",
    unitRaw: "101",
    occurredAt: "2026-01-05T10:00:00",
    siteNumber: "90001",
    stationNameRaw: "SAMPLE #1",
    stationCity: "SAMPLETON",
    stationState: "TX",
    rawProductCode: "TA",
    productType: "highway_diesel",
    currency: "USD",
    qty: "50.00",
    retailPerUnit: "5.5000",
    billedPerUnit: "5.1234",
    preTaxAmount: "256.17",
    hst: "0.00",
    gst: "0.00",
    pst: "0.00",
    qst: "0.00",
    discRate: "0.3766",
    discount: "18.83",
    amount: "256.17",
    ...overrides,
  };
}

/** A line whose own columns agree, as BVD prints them: Pre Tax = Final (no
 * tax), Disc Rate = Retail − Billed, Disc AMT = QTY × Disc Rate. */
function pricedLine(
  overrides: Partial<ValidatedInvoiceLine> & Pick<ValidatedInvoiceLine, "qty" | "billedPerUnit" | "amount">,
): ValidatedInvoiceLine {
  return mkLine({
    retailPerUnit: overrides.billedPerUnit,
    discRate: "0.0000",
    discount: "0.00",
    preTaxAmount: overrides.amount,
    ...overrides,
  });
}

function mkGroup(lines: ValidatedInvoiceLine[]): FuelStopGroup {
  const first = lines[0]!;
  return {
    baseAuthCode: first.baseAuthCode,
    cardNumber: first.cardNumber,
    unitRaw: first.unitRaw,
    driverNameRaw: first.driverNameRaw,
    stationNameRaw: first.stationNameRaw,
    stationCity: first.stationCity,
    stationState: first.stationState,
    siteNumber: first.siteNumber,
    occurredAt: first.occurredAt,
    total: "0.00", // unused by reconcile()
    totalQty: "0.00", // unused by reconcile()
    lines,
  };
}

// A base scenario: one TA line ($256.17 / 50.00gal) + one DF line ($22.50 /
// 5.00gal), printed totals matching exactly, no express rows.
function baseGroups(): FuelStopGroup[] {
  return [
    mkGroup([
      mkLine({ lineNumber: 1, rawProductCode: "TA", productType: "highway_diesel", qty: "50.00", amount: "256.17" }),
      pricedLine({ lineNumber: 2, rawProductCode: "DF", productType: "def", qty: "5.00", billedPerUnit: "4.5000", amount: "22.50" }),
    ]),
  ];
}

interface PrintedRow {
  qty: string | null;
  amount: string;
}

/** A printed totals row with no tax — a US invoice's shape. */
function printedRow(productCode: string, qty: string | null, amount: string): PrintedProductTotal {
  return { productCode, qty, amount, discount: null, preTaxAmount: qty === null ? null : amount, hst: "0.00", gst: "0.00", pst: "0.00", qst: "0.00" };
}

function totalsOf(products: PrintedProductTotal[], grandTotal: string): PrintedTotals {
  return { products, grandTotalRow: printedRow("Grand Total", null, grandTotal), grandTotal };
}

function baseTotals(overrides: Record<string, PrintedRow> = {}, grandTotal = "278.67"): PrintedTotals {
  const defaults: Record<string, PrintedRow> = {
    TA: { qty: "50.00", amount: "256.17" },
    DF: { qty: "5.00", amount: "22.50" },
  };
  const merged: Record<string, PrintedRow> = { ...defaults, ...overrides };
  return totalsOf(
    Object.entries(merged).map(([productCode, row]) => printedRow(productCode, row.qty, row.amount)),
    grandTotal,
  );
}

describe("reconcile — pure", () => {
  it("balances when parsed sums match every printed figure exactly", () => {
    const result = reconcile(baseGroups(), [], baseTotals());
    expect(result.balanced).toBe(true);
    expect(result.amountImbalances).toEqual([]);
    expect(result.gallonImbalances).toEqual([]);
    expect(result.grandTotal.deltaCents).toBe(0);
  });

  it("one cent short on DF fails only DF, with a delta of -0.01, while TA passes", () => {
    const totals = baseTotals({ DF: { qty: "5.00", amount: "22.51" } }, "278.68");
    const result = reconcile(baseGroups(), [], totals);
    expect(result.balanced).toBe(false);
    expect(result.amountImbalances).toHaveLength(1);
    expect(result.amountImbalances[0]).toMatchObject({ productCode: "DF", deltaCents: -1 });
    expect(result.amountImbalances.some((i) => i.productCode === "TA")).toBe(false);
  });

  it("a compensating pair (DF short $36.78, TA long $36.78) fails BOTH codes, even though the grand total still balances", () => {
    // Printed TA is $36.78 less than parsed (parsed over-counts diesel);
    // printed DF is $36.78 more than parsed (parsed under-counts DEF) — the
    // legacy sheet's exact failure mode. The grand total is unaffected
    // (219.39 + 59.28 = 278.67), which is exactly why a single grand-total
    // check would rubber-stamp this.
    const totals = baseTotals({
      TA: { qty: "50.00", amount: "219.39" },
      DF: { qty: "5.00", amount: "59.28" },
    });
    const result = reconcile(baseGroups(), [], totals);
    expect(result.balanced).toBe(false);
    expect(result.grandTotal.deltaCents).toBe(0);
    const codes = result.amountImbalances.map((i) => i.productCode).sort();
    expect(codes).toEqual(["DF", "TA"]);
  });

  it("reports a gallons imbalance independently of amount — amounts can match while gallons don't", () => {
    const totals = baseTotals({ TA: { qty: "51.00", amount: "256.17" } });
    const result = reconcile(baseGroups(), [], totals);
    expect(result.balanced).toBe(false);
    expect(result.amountImbalances).toEqual([]);
    expect(result.gallonImbalances).toHaveLength(1);
    expect(result.gallonImbalances[0]).toMatchObject({ productCode: "TA", deltaCents: -100 });
  });

  it("never drifts through floating point: classic 0.1+0.2-style sums land on exact integer cents", () => {
    const groups = [
      mkGroup([
        pricedLine({ lineNumber: 1, rawProductCode: "TA", amount: "0.10", qty: "0.10", billedPerUnit: "1.0000" }),
        pricedLine({ lineNumber: 2, rawProductCode: "TA", amount: "0.20", qty: "0.20", billedPerUnit: "1.0000" }),
      ]),
    ];
    const totals = totalsOf([printedRow("TA", "0.30", "0.30")], "0.30");
    const result = reconcile(groups, [], totals);
    expect(result.balanced).toBe(true);
    expect(result.grandTotal.deltaCents).toBe(0);
    expect(Object.is(result.grandTotal.deltaCents, -0)).toBe(false);
  });

  it("reconciles express rows against the printed 'Express Codes' total", () => {
    const expressRows: ExpressRow[] = [
      {
        lineNumber: 10,
        occurredAt: "2026-01-05T08:00:00",
        expressCode: "9000001",
        authCodeRef: "E1000001",
        unitRaw: "101",
        trailerRaw: null,
        driverNameRaw: "DRIVER",
        cdlRaw: null,
        tripNumberRaw: null,
        amount: "50.00",
        fee: "3.00",
        total: "53.00",
        currency: "USD",
        payee: "lumper",
        note: null,
        category: null,
      },
    ];
    const totals = baseTotals({ "Express Codes": { qty: null, amount: "53.00" } }, "331.67");
    const result = reconcile(baseGroups(), expressRows, totals);
    expect(result.balanced).toBe(true);
  });
});

// A real invoice, if the operator has dropped one in locally
// (data/bvd-invoices/, gitignored). Skips automatically when absent.
const REAL_PATH = fileURLToPath(
  new URL("../../../data/bvd-invoices/invoice_999210.csv", import.meta.url),
);
const hasRealFixture = existsSync(REAL_PATH);

describe.skipIf(!hasRealFixture)("reconcile — real invoice 999210 (local fixture only)", () => {
  it("balances on all product codes, express, and the grand total", () => {
    const parsed = parseInvoiceCsv(readFileSync(REAL_PATH), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_999210.csv");
    const groups = groupByAuthCode(parsed.lines);
    const result = reconcile(groups, parsed.expressRows, parsed.printedTotals);
    expect(result.amountImbalances).toEqual([]);
    expect(result.gallonImbalances).toEqual([]);
    expect(result.balanced).toBe(true);
    expect(result.grandTotal.parsedCents).toBe(5092971);
  });
});

// T-61: every line's own columns, and the printed totals' tax columns. All
// figures synthetic except D24's worked example, which the scope quotes.
describe("reconcile — line and totals checks (T-61)", () => {
  /** A CAD line with 13% HST inside Final AMT, as the CA invoice prints it. */
  function caLine(overrides: Partial<ValidatedInvoiceLine> = {}): ValidatedInvoiceLine {
    return mkLine({
      currency: "CAD",
      qty: "318.62", retailPerUnit: "2.4990", billedPerUnit: "2.2427",
      preTaxAmount: "632.36", hst: "82.21", discRate: "0.2563", discount: "81.66", amount: "714.57",
      ...overrides,
    });
  }
  const caTotals = (lines: ValidatedInvoiceLine[]) => {
    const sum = (f: (l: ValidatedInvoiceLine) => string) => fromCentsTest(lines.reduce((s, l) => s + Math.round(Number(f(l)) * 100), 0));
    const ta: PrintedProductTotal = {
      productCode: "TA", qty: sum((l) => l.qty), amount: sum((l) => l.amount), discount: sum((l) => l.discount),
      preTaxAmount: sum((l) => l.preTaxAmount), hst: sum((l) => l.hst), gst: "0.00", pst: "0.00", qst: "0.00",
    };
    return { products: [ta], grandTotalRow: { ...ta, productCode: "Grand Total" }, grandTotal: ta.amount };
  };
  function fromCentsTest(c: number) {
    return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
  }

  it("balances a CAD line: Pre Tax + HST = Final, Retail − Billed = Disc Rate, QTY × Billed = Final (D24's example)", () => {
    const lines = [caLine()];
    const result = reconcile([mkGroup(lines)], [], caTotals(lines));
    expect(result.lineImbalances).toEqual([]);
    expect(result.totalsImbalances).toEqual([]);
    expect(result.balanced).toBe(true);
  });

  it("flags a cent's gap between Pre Tax + taxes and Final AMT — exact, no tolerance", () => {
    const lines = [caLine({ hst: "82.20" })];
    const result = reconcile([mkGroup(lines)], [], caTotals([caLine()]));
    expect(result.lineImbalances.map((l) => l.check)).toContain("TAX_SUM");
    expect(result.balanced).toBe(false);
  });

  it("flags Retail − Billed ≠ Disc Rate by a single ten-thousandth", () => {
    const lines = [caLine({ discRate: "0.2564" })];
    const result = reconcile([mkGroup(lines)], [], caTotals(lines));
    expect(result.lineImbalances.map((l) => l.check)).toContain("DISC_RATE");
  });

  it("accepts QTY × Billed a cent off Final AMT — inside the printed figures' rounding bound", () => {
    // 300.00 × 2.2427 = 672.81; BVD prints 672.80 from an unrounded quantity.
    const lines = [caLine({ qty: "300.00", preTaxAmount: "595.40", hst: "77.40", discount: "76.89", amount: "672.80" })];
    const result = reconcile([mkGroup(lines)], [], caTotals(lines));
    expect(result.lineImbalances).toEqual([]);
  });

  it("flags a line whose Final AMT cannot come from its QTY × Billed — a mis-columned row", () => {
    // Final AMT holding the pre-tax figure: 714.57 − 632.36 is far outside the bound.
    const lines = [caLine({ amount: "632.36", preTaxAmount: "560.19", hst: "72.17" })];
    const result = reconcile([mkGroup(lines)], [], caTotals(lines));
    expect(result.lineImbalances.map((l) => l.check)).toEqual(["QTY_X_BILLED"]);
  });

  it("flags Disc AMT outside the bound of QTY × Disc Rate", () => {
    const lines = [caLine({ discount: "80.00" })];
    const result = reconcile([mkGroup(lines)], [], caTotals(lines));
    expect(result.lineImbalances.map((l) => l.check)).toEqual(["QTY_X_DISC_RATE"]);
  });

  it("skips the QTY checks on a zero-QTY Scale line, which still satisfies Pre Tax + HST = Final", () => {
    const scale = caLine({
      rawProductCode: "S", productType: "scale", qty: "0.00", retailPerUnit: "0.0000", billedPerUnit: "0.0000",
      preTaxAmount: "23.01", hst: "2.99", discRate: "0.0000", discount: "0.00", amount: "26.00",
    });
    const result = reconcile([mkGroup([scale])], [], {
      products: [{ productCode: "S", qty: null, amount: "26.00", discount: null, preTaxAmount: null, hst: "0.00", gst: "0.00", pst: "0.00", qst: "0.00" }],
      grandTotalRow: { productCode: "Grand Total", qty: "0.00", amount: "26.00", discount: "0.00", preTaxAmount: "0.00", hst: "0.00", gst: "0.00", pst: "0.00", qst: "0.00" },
      grandTotal: "26.00",
    });
    expect(result.lineImbalances).toEqual([]);
    expect(result.totalsImbalances).toEqual([]);
    expect(result.balanced).toBe(true);
  });

  it("requires the grand total's Pre Tax and HST to sum the priced rows only, not the final-only Scale row", () => {
    const lines = [caLine()];
    const totals = caTotals(lines);
    // Folding the scale's 23.01 into the grand pre-tax is the error.
    const wrong = { ...totals, grandTotalRow: { ...totals.grandTotalRow, preTaxAmount: "655.37" } };
    expect(reconcile([mkGroup(lines)], [], wrong).totalsImbalances).toEqual([
      { productCode: "Grand Total", check: "GRAND_PRE_TAX", expectedCents: 63236, printedCents: 65537 },
    ]);
    const wrongHst = { ...totals, grandTotalRow: { ...totals.grandTotalRow, hst: "85.20" } };
    expect(reconcile([mkGroup(lines)], [], wrongHst).totalsImbalances.map((t) => t.check)).toEqual(["GRAND_TAX"]);
  });

  it("flags a printed product row whose Pre Tax + taxes ≠ its Final", () => {
    const lines = [caLine()];
    const totals = caTotals(lines);
    const wrong = { ...totals, products: [{ ...totals.products[0]!, hst: "82.22" }] };
    expect(reconcile([mkGroup(lines)], [], wrong).totalsImbalances.map((t) => t.check)).toContain("TAX_SUM");
  });
});

describe("withinRoundingBound (T-61)", () => {
  it("is exact integer arithmetic on the half-unit bound", () => {
    // 0.04 × 5.5000 = 0.22; the bound is ½¢ + 0.0275 + 0.000002 = 0.032502,
    // so 0.19 to 0.25 inclusive can print and nothing else.
    expect(withinRoundingBound(4, 55_000, 19)).toBe(true);
    expect(withinRoundingBound(4, 55_000, 25)).toBe(true);
    expect(withinRoundingBound(4, 55_000, 18)).toBe(false);
    expect(withinRoundingBound(4, 55_000, 26)).toBe(false);
  });
});
