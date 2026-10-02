import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { groupByAuthCode } from "./groupByAuthCode.js";
import { parseInvoiceCsv } from "./parseInvoiceCsv.js";
import { DEFAULT_INVOICE_PRODUCT_CODES } from "./productCode.js";
import { reconcile } from "./reconcile.js";
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
      mkLine({ lineNumber: 2, rawProductCode: "DF", productType: "def", qty: "5.00", amount: "22.50" }),
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
        mkLine({ lineNumber: 1, rawProductCode: "TA", amount: "0.10", qty: "0.10" }),
        mkLine({ lineNumber: 2, rawProductCode: "TA", amount: "0.20", qty: "0.20" }),
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
