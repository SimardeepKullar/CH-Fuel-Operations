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
    currency: "USD",
    grandTotalUsd: "50929.71",
    productTotals: [
      { productCode: "TA", gallons: "9000.00", amountUsd: "47000.00", discountUsd: "500.00" },
      { productCode: "DF", gallons: "120.00", amountUsd: "500.00", discountUsd: "10.00" },
      { productCode: "S", gallons: null, amountUsd: "1786.58", discountUsd: null },
      { productCode: "Express Codes", gallons: null, amountUsd: "1643.13", discountUsd: null },
      { productCode: "TF", gallons: "0.00", amountUsd: "0.00", discountUsd: "0.00" },
    ],
    reconcile: {
      balanced: true,
      amountImbalances: [],
      gallonImbalances: [],
      grandTotal: { expectedCents: 5092971, parsedCents: 5092971, deltaCents: 0 },
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
