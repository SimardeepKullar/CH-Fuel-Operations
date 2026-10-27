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
    currency: "USD",
    grandTotal: 50929.71,
    billingWeekEnd: "2026-08-31",
    actualStart: "2026-08-01",
    actualEnd: "2026-08-31",
    datesDiffer: false,
    status: "imported",
    importedAt: "2026-09-01T12:00:00.000Z",
    fx: null,
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
    expect(text).toContain("US$50,929.71");
    expect(text).toContain("Imported");
  });

  it("labels each total with its invoice's currency, so a CAD total never reads as USD (T-61)", () => {
    render(<ImportHistory rows={[row(), row({ id: "inv-ca", invoiceNumber: "700001", currency: "CAD", grandTotal: 3839.54 })]} onReopenQuarantined={vi.fn()} />);
    expect(screen.getByTestId("import-history-row-inv-1").textContent).toContain("US$50,929.71");
    expect(screen.getByTestId("import-history-row-inv-ca").textContent).toContain("CA$3,839.54");
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

  it("is one row per invoice, with the week input and Move in that row's last cell (T-77)", () => {
    render(<ImportHistory rows={[row()]} onReopenQuarantined={vi.fn()} onMoveWeek={vi.fn()} />);
    const entry = screen.getByTestId("import-history-row-inv-1").closest(".import-history-entry")!;
    expect(entry.querySelectorAll(".import-history-row")).toHaveLength(1);
    const week = entry.querySelector(".import-history-row .import-history-week")!;
    expect(week.querySelector("input[type=date]")).toBeTruthy();
    expect(week.textContent).toContain("Move");
    const headers = Array.from(screen.getByTestId("import-history").querySelectorAll(".import-history-head > span")).map((e) => e.textContent);
    expect(headers).toEqual(["Invoice #", "Period", "Total", "Status", "Imported", "Belongs to week ending"]);
  });

  it("badges the invoice by country instead of a flag, and pills the status (T-77)", () => {
    render(<ImportHistory rows={[row(), row({ id: "inv-ca", currency: "CAD", status: "quarantined" })]} onReopenQuarantined={vi.fn()} />);
    const us = screen.getByTestId("import-history-row-inv-1");
    expect(us.querySelector(".ss-badge-us")!.textContent).toBe("US");
    expect(us.querySelector(".import-history-status-imported")).toBeTruthy();
    const ca = screen.getByTestId("import-history-row-inv-ca");
    expect(ca.querySelector(".ss-badge-ca")!.textContent).toBe("CA");
    expect(ca.querySelector(".import-history-status-quarantined")).toBeTruthy();
  });

  it("a quarantined row has no week control and no dates-differ note", () => {
    render(<ImportHistory rows={[row({ id: "inv-q", status: "quarantined", datesDiffer: true })]} onReopenQuarantined={vi.fn()} onMoveWeek={vi.fn()} />);
    expect(screen.getByTestId("import-history-row-inv-q").querySelector("input[type=date]")).toBeNull();
    expect(screen.queryByTestId("dates-differ-note-inv-q")).toBeNull();
  });

  it("shows the imported-at as 'Mon D, YYYY · h:mm:ss AM/PM' (T-77)", () => {
    const importedAt = new Date(2026, 9, 19, 11, 35, 32).toISOString();
    render(<ImportHistory rows={[row({ importedAt })]} onReopenQuarantined={vi.fn()} />);
    expect(screen.getByTestId("import-history-row-inv-1").textContent).toContain("Oct 19, 2026 · 11:35:32 AM");
  });

  it("titles the panel and its subtitle verbatim (T-77)", () => {
    render(<ImportHistory rows={[row()]} onReopenQuarantined={vi.fn()} />);
    const panel = screen.getByTestId("import-history");
    expect(panel.textContent).toContain("Import history");
    expect(panel.textContent).toContain("Move an invoice if it landed in the wrong billing week");
  });

  describe("search (T-77)", () => {
    const rowsFor = () => [
      row(),
      row({ id: "inv-ca", invoiceNumber: "999217", currency: "CAD", grandTotal: 46837.33, periodStart: "2026-08-01", periodEnd: "2026-09-09" }),
      row({ id: "inv-q", invoiceNumber: "100001", status: "quarantined", periodStart: "2026-01-05", periodEnd: "2026-01-11" }),
    ];
    const type = (value: string) => fireEvent.change(screen.getByTestId("history-search"), { target: { value } });
    const shown = () => Array.from(document.querySelectorAll("[data-testid^=import-history-row-]")).map((e) => e.getAttribute("data-testid"));

    it("finds an invoice by number, and shows every row again when cleared", () => {
      render(<ImportHistory rows={rowsFor()} onReopenQuarantined={vi.fn()} />);
      type("999217");
      expect(shown()).toEqual(["import-history-row-inv-ca"]);
      type("");
      expect(shown()).toHaveLength(3);
    });

    it("matches a date, a country, a status and a total", () => {
      render(<ImportHistory rows={rowsFor()} onReopenQuarantined={vi.fn()} />);
      type("2026-01-05");
      expect(shown()).toEqual(["import-history-row-inv-q"]);
      type("ca");
      expect(shown()).toEqual(["import-history-row-inv-ca"]);
      type("quarantined");
      expect(shown()).toEqual(["import-history-row-inv-q"]);
      type("46,837");
      expect(shown()).toEqual(["import-history-row-inv-ca"]);
    });

    it("needs every term to match, and says so when nothing does", () => {
      render(<ImportHistory rows={rowsFor()} onReopenQuarantined={vi.fn()} />);
      type("999217 quarantined");
      expect(shown()).toEqual([]);
      expect(screen.getByText("No invoice matches")).toBeTruthy();
    });
  });
});
