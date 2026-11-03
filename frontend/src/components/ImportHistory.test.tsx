// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvoiceListItem } from "@ch/core/api/routes/invoices";
const patchInvoiceFx = vi.fn();
vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, patchInvoiceFx: (...args: unknown[]) => patchInvoiceFx(...args) };
});

const { default: ImportHistory } = await import("./ImportHistory");
const { ApiError } = await import("../lib/api");

afterEach(() => {
  cleanup();
  patchInvoiceFx.mockReset();
});

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

  it("is one row per invoice, with the week input and Move in one cell and the exchange rate in the next (T-77, T-67)", () => {
    render(<ImportHistory rows={[row()]} onReopenQuarantined={vi.fn()} onMoveWeek={vi.fn()} />);
    const entry = screen.getByTestId("import-history-row-inv-1").closest(".import-history-entry")!;
    expect(entry.querySelectorAll(".import-history-row")).toHaveLength(1);
    const week = entry.querySelector(".import-history-row .import-history-week")!;
    expect(week.querySelector("input[type=date]")).toBeTruthy();
    expect(week.textContent).toContain("Move");
    const headers = Array.from(screen.getByTestId("import-history").querySelectorAll(".import-history-head > span")).map((e) => e.textContent);
    expect(headers).toEqual(["Invoice #", "Period", "Total", "Status", "Imported", "Belongs to week ending", "Exchange rate (1 USD to CAD)"]);
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

/** T-67: the exchange-rate column. */
describe("ImportHistory — the exchange-rate column (T-67)", () => {
  const FX = { rate: 1.3712, enteredAt: "2026-10-01T12:00:00.000Z" };
  const input = (id = "inv-1") => screen.getByTestId(`fx-input-${id}`) as HTMLInputElement;
  const update = (id = "inv-1") => screen.getByTestId(`fx-update-${id}`) as HTMLButtonElement;
  const renderRows = (rows: InvoiceListItem[], onFxSaved = vi.fn()) => {
    render(<ImportHistory rows={rows} onReopenQuarantined={vi.fn()} onFxSaved={onFxSaved} />);
    return onFxSaved;
  };

  it("a US row shows an input pre-filled with its rate, an Update button and when it was entered", () => {
    renderRows([row({ fx: FX })]);
    expect(input().value).toBe("1.3712");
    expect(update().textContent).toBe("Update");
    expect(screen.getByTestId("fx-status-inv-1").textContent).toMatch(/^entered Oct 1, 2026$/);
  });

  it("a US row with no rate has an empty input and says 'rate pending'", () => {
    renderRows([row()]);
    expect(input().value).toBe("");
    expect(screen.getByTestId("fx-status-inv-1").textContent).toBe("rate pending");
  });

  it("a CA row has no input and no button — a muted n/a that says CAD invoices are never converted", () => {
    renderRows([row({ id: "inv-ca", currency: "CAD" })]);
    expect(screen.queryByTestId("fx-input-inv-ca")).toBeNull();
    expect(screen.queryByTestId("fx-update-inv-ca")).toBeNull();
    const na = screen.getByTestId("fx-na-inv-ca");
    expect(na.textContent).toBe("n/a");
    expect(na.getAttribute("title")).toBe("CAD invoices are never converted.");
  });

  it("a quarantined US row has no input and shows a dash", () => {
    renderRows([row({ id: "inv-q", status: "quarantined" })]);
    expect(screen.queryByTestId("fx-input-inv-q")).toBeNull();
    expect(screen.getByTestId("fx-none-inv-q").textContent).toBe("—");
  });

  it("Update is disabled until the draft differs from the saved value", () => {
    renderRows([row({ fx: FX })]);
    expect(update().disabled).toBe(true);
    fireEvent.change(input(), { target: { value: "1.40" } });
    expect(update().disabled).toBe(false);
    fireEvent.change(input(), { target: { value: "1.3712" } });
    expect(update().disabled).toBe(true);
  });

  it("Update PATCHes that row's invoice with the number typed, then asks for the weeks to be re-read", async () => {
    patchInvoiceFx.mockResolvedValue({ fx: { rate: 1.4, enteredAt: "2026-11-02T09:30:00.000Z" } });
    const onFxSaved = renderRows([row({ id: "inv-a" }), row({ id: "inv-b", invoiceNumber: "999211" })]);
    fireEvent.change(input("inv-b"), { target: { value: "1.4" } });
    fireEvent.click(update("inv-b"));
    await waitFor(() => expect(patchInvoiceFx).toHaveBeenCalledWith("inv-b", 1.4));
    expect(patchInvoiceFx).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onFxSaved).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("fx-status-inv-b").textContent).toMatch(/^entered /);
    expect(update("inv-b").disabled).toBe(true);
  });

  it("emptying the box and pressing Update PATCHes null and goes back to rate pending", async () => {
    patchInvoiceFx.mockResolvedValue({ fx: null });
    renderRows([row({ fx: FX })]);
    fireEvent.change(input(), { target: { value: "" } });
    fireEvent.click(update());
    await waitFor(() => expect(patchInvoiceFx).toHaveBeenCalledWith("inv-1", null));
    await waitFor(() => expect(screen.getByTestId("fx-status-inv-1").textContent).toBe("rate pending"));
  });

  it("a 400 shows its reason in that row, keeps the typed text, and leaves the other rows alone", async () => {
    patchInvoiceFx.mockRejectedValue(new ApiError({ title: "Bad Request", status: 400, detail: "fxCadPerUsd must be between 0.5 and 3" }));
    renderRows([row({ fx: FX }), row({ id: "inv-b", invoiceNumber: "999211" })]);
    fireEvent.change(input(), { target: { value: "9" } });
    fireEvent.click(update());
    expect((await screen.findByTestId("fx-error-inv-1")).textContent).toContain("between 0.5 and 3");
    expect(input().value).toBe("9");
    expect(screen.queryByTestId("fx-error-inv-b")).toBeNull();
    expect(input("inv-b").value).toBe("");
  });

  it("follows the invoice when the list is re-read with a new rate", () => {
    const { rerender } = render(<ImportHistory rows={[row()]} onReopenQuarantined={vi.fn()} onFxSaved={vi.fn()} />);
    rerender(<ImportHistory rows={[row({ fx: FX })]} onReopenQuarantined={vi.fn()} onFxSaved={vi.fn()} />);
    expect(input().value).toBe("1.3712");
  });
});
