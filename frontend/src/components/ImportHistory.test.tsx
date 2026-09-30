// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvoiceListItem } from "@ch/core/api/routes/invoices";
import ImportHistory from "./ImportHistory";

afterEach(cleanup);

function row(overrides: Partial<InvoiceListItem> = {}): InvoiceListItem {
  return {
    id: "inv-1",
    invoiceNumber: "999210",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    grandTotalUsd: 50929.71,
    status: "imported",
    importedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("ImportHistory (T-42)", () => {
  it("lists invoice number, period, total, status and imported-at", () => {
    render(<ImportHistory rows={[row()]} onReopenQuarantined={vi.fn()} />);
    const text = screen.getByTestId("import-history").textContent!;
    expect(text).toContain("999210");
    expect(text).toContain("2026-08-01");
    expect(text).toContain("2026-08-31");
    expect(text).toContain("50929.71");
    expect(text).toContain("Imported");
  });

  it("a quarantined row can be reopened by clicking it", () => {
    const onReopen = vi.fn();
    render(<ImportHistory rows={[row({ id: "inv-2", status: "quarantined" })]} onReopenQuarantined={onReopen} />);
    fireEvent.click(screen.getByTestId("import-history-row-inv-2"));
    expect(onReopen).toHaveBeenCalledWith("inv-2");
  });

  it("an imported row is not clickable to reopen", () => {
    const onReopen = vi.fn();
    render(<ImportHistory rows={[row()]} onReopenQuarantined={onReopen} />);
    fireEvent.click(screen.getByTestId("import-history-row-inv-1"));
    expect(onReopen).not.toHaveBeenCalled();
  });

  it("shows an empty state with no invoices yet, and a loading state while fetching", () => {
    const { rerender } = render(<ImportHistory rows={[]} loading onReopenQuarantined={vi.fn()} />);
    expect(screen.getByText("Loading history…")).toBeTruthy();

    rerender(<ImportHistory rows={[]} onReopenQuarantined={vi.fn()} />);
    expect(screen.getByText("No invoices imported yet")).toBeTruthy();
  });
});
