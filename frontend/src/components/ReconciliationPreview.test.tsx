// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportReport } from "@ch/core/invoice/report";
import ReconciliationPreview from "./ReconciliationPreview";

afterEach(cleanup);

function report(overrides: Partial<ImportReport> = {}): ImportReport {
  return {
    invoiceNumber: "999210",
    fileSha256: "abc123",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    billingWeekEnd: "2026-08-31",
    actualStart: null,
    actualEnd: null,
    currency: "USD",
    qtyUnit: "gal",
    grandTotal: "50929.71",
    productTotals: [
      { productCode: "TA", qty: "9000.00", amount: "47000.00", discount: "500.00" },
      { productCode: "DF", qty: "120.00", amount: "500.00", discount: "10.00" },
      { productCode: "S", qty: null, amount: "1786.58", discount: null },
      { productCode: "Express Codes", qty: null, amount: "1643.13", discount: null },
      { productCode: "TF", qty: "0.00", amount: "0.00", discount: "0.00" },
    ],
    reconcile: {
      balanced: true,
      amountImbalances: [],
      gallonImbalances: [],
      grandTotal: { expectedCents: 5092971, parsedCents: 5092971, deltaCents: 0 },
      lineImbalances: [],
      totalsImbalances: [],
    },
    parserRejectionCount: 0,
    unknownCardNumbers: [],
    unknownTruckUnits: [],
    rejections: [],
    stationMisses: [],
    truckAssignmentMisses: [],
    expressBlankUnits: [],
    ...overrides,
  };
}

describe("ReconciliationPreview (T-42 step 42.1)", () => {
  it("shows the per-product-code balance check summing to the printed grand total", () => {
    render(<ReconciliationPreview report={report()} onConfirm={vi.fn()} />);
    const text = screen.getByTestId("reconciliation-preview").textContent!;
    expect(text).toContain("TA");
    expect(text).toContain("DF");
    expect(text).toContain("S");
    expect(text).toContain("Express Codes");
    expect(text).toContain("$47000.00");
    expect(screen.getByTestId("import-balance-total").textContent).toContain("$50929.71");
  });

  it("leaves an always-zero row (e.g. TF) out of the balance table", () => {
    render(<ReconciliationPreview report={report()} onConfirm={vi.fn()} />);
    expect(screen.queryByText("TF")).toBeNull();
  });

  it("states that the invoice is already written, and confirm just acknowledges", () => {
    const onConfirm = vi.fn();
    render(<ReconciliationPreview report={report()} onConfirm={onConfirm} />);
    expect(screen.getByTestId("reconciliation-preview").textContent!.toLowerCase()).toContain("already been written");

    fireEvent.click(screen.getByTestId("confirm-button"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
