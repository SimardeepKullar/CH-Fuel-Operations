// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionListItem } from "@ch/core/actuals/transactions";
import TransactionsTable from "./TransactionsTable";
import type { TransactionFiltersState } from "../hooks/useTransactionFilters";

afterEach(cleanup);

const EMPTY_FILTERS: TransactionFiltersState = {
  q: "",
  driverId: "",
  truckId: "",
  cardId: "",
  state: "",
  product: "",
  receiptStatus: "",
  flags: "",
  anomalyOnly: false,
  sort: "",
};

function stop(overrides: Partial<TransactionListItem> = {}): TransactionListItem {
  return {
    id: "stop-1",
    baseAuthCode: "A900000001",
    occurredAt: "2026-09-05T14:30:00.000Z",
    card: { id: "card-1", number: "9000005" },
    driver: { resolved: "JORDAN", raw: "JORDAN", agrees: true },
    truck: { resolved: "072", raw: "072", agrees: true },
    station: { id: "st-1", loveNumber: 294, name: "Love's #294", city: "Dallas", state: "TX" },
    qty: 40.0,
    qtyUnit: "gal",
    retailPerUnit: 5.799,
    billedPerUnit: 5.499,
    total: 238.26,
    currency: "USD",
    // What BVD billed; the same as `currency` unless a conversion says otherwise.
    invoiceCurrency: overrides.invoiceCurrency ?? overrides.currency ?? "USD",
    invoiceNumber: (overrides.invoiceCurrency ?? overrides.currency ?? "USD") === "CAD" ? "999217" : "999210",
    receiptStatus: "confirmed",
    flags: [],
    lines: [
      { productCode: "TA", qty: 40.0, retailPerUnit: 5.799, billedPerUnit: 5.499, amount: 219.96, preTaxAmount: null, hst: 0, gst: 0, pst: 0, qst: 0, qtyUnit: "gal", currency: "USD" },
      { productCode: "DF", qty: 3.0, retailPerUnit: 6.2, billedPerUnit: 6.1, amount: 18.3, preTaxAmount: null, hst: 0, gst: 0, pst: 0, qst: 0, qtyUnit: "gal", currency: "USD" },
    ],
    ...overrides,
  };
}

function baseProps(rows: TransactionListItem[]) {
  return {
    rows,
    totalBeforeSearch: rows.length,
    loading: false,
    error: null,
    currency: "USD" as const,
    qtyUnit: "gal" as const,
    filters: EMPTY_FILTERS,
    setFilter: vi.fn(),
    setFilters: vi.fn(),
    clearFilters: vi.fn(),
    driverOptions: [],
    truckOptions: [],
    cardOptions: [],
    stateOptions: [],
  };
}

function caStop(overrides: Partial<TransactionListItem> = {}): TransactionListItem {
  return stop({
    id: "stop-ca",
    qty: 100,
    qtyUnit: "L",
    retailPerUnit: 2.0,
    billedPerUnit: 1.9046,
    total: 215.22,
    currency: "CAD",
    lines: [
      { productCode: "TA", qty: 100, retailPerUnit: 2.0, billedPerUnit: 1.9046, amount: 215.22, preTaxAmount: 190.46, hst: 24.76, gst: 0, pst: 0, qst: 0, qtyUnit: "L", currency: "CAD" },
    ],
    ...overrides,
  });
}

describe("TransactionsTable", () => {
  it("header, rows and footer are all inside the same scrolling container, so they stay aligned while scrolled", () => {
    render(<TransactionsTable {...baseProps([stop()])} />);
    const scrollInner = document.querySelector(".tx-scroll-inner")!;
    expect(scrollInner.querySelector(".tx-head-row")).not.toBeNull();
    expect(scrollInner.querySelector(".tx-row")).not.toBeNull();
    expect(scrollInner.querySelector(".tx-foot-row")).not.toBeNull();
    // Exactly one scrolling ancestor — not three separately-scrolled panes.
    expect(document.querySelectorAll(".tx-scroll").length).toBe(1);
  });

  it("expanding A900000001 shows both product lines and an unmissable stop total of US$238.26", () => {
    render(<TransactionsTable {...baseProps([stop()])} />);
    expect(screen.queryByTestId("stop-expansion")).toBeNull();

    fireEvent.click(document.querySelector(".tx-row")!);

    expect(screen.getByText("TA")).toBeTruthy();
    expect(screen.getByText("DF")).toBeTruthy();
    expect(screen.getByTestId("stop-total").textContent).toBe("US$238.26");
  });

  it("clicking an expanded row's own toggle collapses it again", () => {
    render(<TransactionsTable {...baseProps([stop()])} />);
    const row = document.querySelector(".tx-row")!;
    fireEvent.click(row);
    expect(screen.queryByTestId("stop-expansion")).not.toBeNull();
    fireEvent.click(row);
    expect(screen.queryByTestId("stop-expansion")).toBeNull();
  });

  it("ArrowDown/ArrowUp move the active row, Enter expands the active row", () => {
    const rows = [stop({ id: "stop-1", baseAuthCode: "A1" }), stop({ id: "stop-2", baseAuthCode: "A2" })];
    render(<TransactionsTable {...baseProps(rows)} />);
    const rowEls = document.querySelectorAll(".tx-row");
    expect(rowEls.length).toBe(2);
    expect(rowEls[0]!.className).toContain("active");

    fireEvent.keyDown(rowEls[0]!, { key: "ArrowDown" });
    expect(document.querySelectorAll(".tx-row")[1]!.className).toContain("active");

    fireEvent.keyDown(document.querySelectorAll(".tx-row")[1]!, { key: "Enter" });
    expect(screen.getByTestId("stop-total")).toBeTruthy();

    fireEvent.keyDown(document.querySelectorAll(".tx-row")[1]!, { key: "ArrowUp" });
    expect(document.querySelectorAll(".tx-row")[0]!.className).toContain("active");
  });

  it("pressing / focuses the search box, even when nothing inside the table has focus", () => {
    render(<TransactionsTable {...baseProps([stop()])} />);
    const search = screen.getByPlaceholderText("Search driver, card, unit, station, auth code…") as HTMLInputElement;
    expect(document.activeElement).not.toBe(search);

    fireEvent.keyDown(window, { key: "/" });

    expect(document.activeElement).toBe(search);
  });

  it("filter selects reflect the current filter values (URL round-trip restores the view)", () => {
    const props = baseProps([stop()]);
    render(
      <TransactionsTable
        {...props}
        filters={{ ...EMPTY_FILTERS, state: "TX", anomalyOnly: true }}
        stateOptions={[{ value: "TX", label: "TX" }]}
      />,
    );
    expect(screen.getByRole("button", { name: /Flags/ }).textContent).toContain("Flagged");
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect((screen.getByLabelText("State / province") as HTMLSelectElement).value).toBe("TX");
  });

  it("an empty result set (after filters) shows the named empty state, not a blank table", () => {
    render(<TransactionsTable {...baseProps([])} />);
    expect(screen.getByText("No transactions match these filters.")).toBeTruthy();
  });

  it("renders anomaly flags at their severity, and RawResolved for driver/unit — never a second raw-text renderer", () => {
    const flagged = stop({ flags: [{ rule: "sub_gallon", severity: "red" }] });
    render(<TransactionsTable {...baseProps([flagged])} />);
    expect(screen.getByText("Sub-gal")).toBeTruthy();
  });

  it("a stop with both a TA and a DF line shows both a Diesel and a DEF badge collapsed", () => {
    render(<TransactionsTable {...baseProps([stop()])} />);
    const products = document.querySelector(".tx-products")!;
    expect(products.textContent).toContain("Diesel");
    expect(products.textContent).toContain("DEF");
    expect(products.querySelectorAll(".product-badge").length).toBe(2);
  });

  it("a stop with one product shows only that badge", () => {
    const dieselOnly = stop({
      lines: [{ productCode: "TA", qty: 40.0, retailPerUnit: 5.799, billedPerUnit: 5.499, amount: 219.96, preTaxAmount: null, hst: 0, gst: 0, pst: 0, qst: 0, qtyUnit: "gal", currency: "USD" }],
    });
    render(<TransactionsTable {...baseProps([dieselOnly])} />);
    const products = document.querySelector(".tx-products")!;
    expect(products.textContent).toBe("Diesel");
    expect(products.querySelectorAll(".product-badge").length).toBe(1);
  });

  it("a stop with two lines of the same product shows one deduped badge", () => {
    const duplicateProduct = stop({
      lines: [
        { productCode: "TA", qty: 30.0, retailPerUnit: 5.799, billedPerUnit: 5.499, amount: 164.97, preTaxAmount: null, hst: 0, gst: 0, pst: 0, qst: 0, qtyUnit: "gal", currency: "USD" },
        { productCode: "TA", qty: 10.0, retailPerUnit: 5.799, billedPerUnit: 5.499, amount: 54.99, preTaxAmount: null, hst: 0, gst: 0, pst: 0, qst: 0, qtyUnit: "gal", currency: "USD" },
      ],
    });
    render(<TransactionsTable {...baseProps([duplicateProduct])} />);
    const products = document.querySelector(".tx-products")!;
    expect(products.querySelectorAll(".product-badge").length).toBe(1);
  });

  it("a row with lines undefined renders no product badges", () => {
    const noLines = stop({ lines: undefined });
    render(<TransactionsTable {...baseProps([noLines])} />);
    const products = document.querySelector(".tx-products")!;
    expect(products.querySelectorAll(".product-badge").length).toBe(0);
  });

  it("Diesel, DEF and Scale badges render in three distinct colour variants", () => {
    const allThree = stop({
      lines: [
        { productCode: "TA", qty: 40.0, retailPerUnit: 5.799, billedPerUnit: 5.499, amount: 219.96, preTaxAmount: null, hst: 0, gst: 0, pst: 0, qst: 0, qtyUnit: "gal", currency: "USD" },
        { productCode: "DF", qty: 3.0, retailPerUnit: 6.2, billedPerUnit: 6.1, amount: 18.3, preTaxAmount: null, hst: 0, gst: 0, pst: 0, qst: 0, qtyUnit: "gal", currency: "USD" },
        { productCode: "S", qty: 0, retailPerUnit: 0, billedPerUnit: 0, amount: 15.25, preTaxAmount: null, hst: 0, gst: 0, pst: 0, qst: 0, qtyUnit: "gal", currency: "USD" },
      ],
    });
    render(<TransactionsTable {...baseProps([allThree])} />);
    const products = document.querySelector(".tx-products")!;
    expect(products.querySelector(".product-badge-diesel")!.textContent).toBe("Diesel");
    expect(products.querySelector(".product-badge-def")!.textContent).toBe("DEF");
    expect(products.querySelector(".product-badge-scale")!.textContent).toBe("Scale");
  });

  it("a stop with a Scale product line drops the Scale flag, keeping other flags", () => {
    const scaleCharge = stop({
      lines: [{ productCode: "S", qty: 0, retailPerUnit: 0, billedPerUnit: 0, amount: 15.25, preTaxAmount: null, hst: 0, gst: 0, pst: 0, qst: 0, qtyUnit: "gal", currency: "USD" }],
      flags: [
        { rule: "charges_no_fuel", severity: "amber" },
        { rule: "sub_gallon", severity: "red" },
      ],
    });
    render(<TransactionsTable {...baseProps([scaleCharge])} />);
    const flags = document.querySelector(".tx-flags")!;
    expect(flags.textContent).not.toContain("Scale");
    expect(flags.textContent).toContain("Sub-gal");
  });

  it("a charges_no_fuel flag also drops when the stop has no Scale line (T-40H)", () => {
    const cashOnly = stop({
      lines: [{ productCode: "C", qty: 0, retailPerUnit: 0, billedPerUnit: 0, amount: 5, preTaxAmount: null, hst: 0, gst: 0, pst: 0, qst: 0, qtyUnit: "gal", currency: "USD" }],
      flags: [
        { rule: "charges_no_fuel", severity: "amber" },
        { rule: "sub_gallon", severity: "red" },
      ],
    });
    render(<TransactionsTable {...baseProps([cashOnly])} />);
    const flags = document.querySelector(".tx-flags")!;
    expect(flags.textContent).not.toContain("Scale");
    expect(flags.textContent).toContain("Sub-gal");
  });

  it("a US week reads Diesel gal, DEF gal and USD headers with US$ cells and footer", () => {
    render(<TransactionsTable {...baseProps([stop()])} />);
    const head = document.querySelector(".tx-head-row")!.textContent!;
    expect(head).toContain("Diesel gal");
    expect(head).toContain("Diesel billed USD/gal");
    expect(head).toContain("DEF gal");
    expect(head).not.toContain("Retail");
    expect(head).toContain("Total USD");
    expect(document.querySelector(".tx-total")!.textContent).toBe("US$238.26");
    expect(document.querySelector(".tx-foot-row")!.textContent).toContain("US$238.26");
    expect(document.querySelector(".tx-caption")!.textContent).toContain("All amounts USD.");
  });

  it("a CA week reads Diesel L and CAD headers with CA$ cells — never a bare dollar sign", () => {
    render(<TransactionsTable {...baseProps([caStop()])} currency="CAD" qtyUnit="L" />);
    const head = document.querySelector(".tx-head-row")!.textContent!;
    expect(head).toContain("Diesel L");
    expect(head).toContain("Diesel billed CAD/L");
    expect(head).toContain("DEF L");
    expect(head).not.toContain("Retail");
    expect(head).toContain("Total CAD");
    expect(document.querySelector(".tx-total")!.textContent).toBe("CA$215.22");
    expect(screen.getByTestId("billed-price-value").textContent).toBe("CA$1.9046");
    const body = document.querySelector(".tx-row")!.textContent!;
    expect(body).toContain("100.00");
    expect(body).not.toMatch(/(^|[^A-Z])\$\d/);
    expect(document.querySelector(".tx-caption")!.textContent).toContain("All amounts CAD.");
  });

  it("a diesel + DEF stop shows each quantity in its own cell and leaves the total whole", () => {
    const both = stop({
      qty: 148.64,
      total: 874.7,
      lines: [
        { productCode: "TA", qty: 148.64, retailPerUnit: 5.8, billedPerUnit: 5.5, amount: 817.52, preTaxAmount: null, hst: 0, gst: 0, pst: 0, qst: 0, qtyUnit: "gal", currency: "USD" },
        { productCode: "DF", qty: 13.28, retailPerUnit: 4.5, billedPerUnit: 4.3, amount: 57.18, preTaxAmount: null, hst: 0, gst: 0, pst: 0, qst: 0, qtyUnit: "gal", currency: "USD" },
      ],
    });
    render(<TransactionsTable {...baseProps([both])} />);
    const cells = [...document.querySelectorAll(".tx-row .tx-gal")].map((c) => c.textContent);
    expect(cells).toEqual(["148.64", "13.28"]);
    expect(document.querySelector(".tx-total")!.textContent).toBe("US$874.70");
  });

  it("a DEF-only stop shows — under the diesel columns, its DEF quantity and a DEF badge; a diesel-only stop shows — under DEF", () => {
    const defOnly = stop({
      id: "def-only",
      qty: null,
      billedPerUnit: null,
      retailPerUnit: null,
      total: 57.18,
      lines: [{ productCode: "DF", qty: 13.28, retailPerUnit: 4.5, billedPerUnit: 4.3, amount: 57.18, preTaxAmount: null, hst: 0, gst: 0, pst: 0, qst: 0, qtyUnit: "gal", currency: "USD" }],
    });
    const dieselOnly = stop({
      id: "diesel-only",
      lines: [{ productCode: "TA", qty: 40, retailPerUnit: 5.799, billedPerUnit: 5.499, amount: 219.96, preTaxAmount: null, hst: 0, gst: 0, pst: 0, qst: 0, qtyUnit: "gal", currency: "USD" }],
    });
    render(<TransactionsTable {...baseProps([defOnly, dieselOnly])} />);
    const rows = [...document.querySelectorAll(".tx-row")];
    expect([...rows[0]!.querySelectorAll(".tx-gal")].map((c) => c.textContent)).toEqual(["—", "13.28"]);
    expect(rows[0]!.querySelector(".product-badge-def")).not.toBeNull();
    expect([...rows[1]!.querySelectorAll(".tx-gal")].map((c) => c.textContent)).toEqual(["40.00", "—"]);
    // Diesel and DEF totals stay separate; the total is the sum of stop totals.
    const foot = [...document.querySelectorAll(".tx-foot-row .tx-foot-cell")].map((c) => c.textContent);
    expect(foot[0]).toBe("40.00");
    expect(foot[2]).toBe("13.28");
    expect(foot[3]).toBe("US$295.44");
  });

  it("footer totals sum litres and CAD for a CA side", () => {
    const rows = [caStop({ id: "a" }), caStop({ id: "b", qty: 50, total: 107.61 })];
    render(<TransactionsTable {...baseProps(rows)} currency="CAD" qtyUnit="L" />);
    const foot = document.querySelector(".tx-foot-row")!.textContent!;
    expect(foot).toContain("150.00");
    expect(foot).toContain("CA$322.83");
    expect(foot).toContain("CA$1.9046");
  });

  it("headers follow the rows when the caller's requested side disagrees", () => {
    render(<TransactionsTable {...baseProps([caStop()])} />);
    expect(document.querySelector(".tx-head-row")!.textContent).toContain("Total CAD");
  });

  it("All invoices as printed: never sums litres with gallons or CAD with USD, and each cell says its unit", () => {
    render(<TransactionsTable {...baseProps([stop(), caStop()])} />);
    const foot = document.querySelector(".tx-foot-row")!;
    const cells = [...foot.querySelectorAll(".tx-foot-cell")].map((c) => c.textContent);
    expect(cells).toEqual(["—", "—", "—", "—"]);
    const head = document.querySelector(".tx-head-row")!.textContent!;
    expect(head).toContain("Diesel qty");
    expect(head).toContain("Diesel billed per unit");
    expect(head).toContain("DEF qty");
    expect(head).toContain("Total");
    expect(head).not.toContain("Total USD");
    const rowsText = [...document.querySelectorAll(".tx-row")].map((r) => r.textContent!);
    expect(rowsText[0]).toContain("40.00 gal");
    expect(rowsText[1]).toContain("100.00 L");
    expect(document.querySelector(".tx-caption")!.textContent).toContain("each invoice's own currency");
  });

  it("All invoices converted to USD/gal at an entered rate: everything is one currency and unit, so it all sums (T-66)", () => {
    const fx = { rate: 1.3712, enteredAt: "2026-10-06T16:00:00.000Z" };
    const caInUsd = caStop({ currency: "USD", invoiceCurrency: "CAD", fx, qty: 26.42, qtyUnit: "gal", billedPerUnit: 5.2577, retailPerUnit: 5.5213, total: 156.96 });
    caInUsd.lines = caInUsd.lines!.map((l) => ({ ...l, currency: "USD", amount: 156.96, preTaxAmount: 138.9, hst: 18.06 }));
    render(<TransactionsTable {...baseProps([stop(), caInUsd])} showInvoice week="2026-09-09" />);

    const cells = [...document.querySelectorAll(".tx-foot-row .tx-foot-cell")].map((c) => c.textContent);
    expect(cells[0]).toBe("66.42");
    expect(cells[2]).toBe("3.00");
    expect(cells[3]).toBe("US$395.22");
    expect(cells[1]).not.toBe("—");
    const head = document.querySelector(".tx-head-row")!.textContent!;
    expect(head).toContain("Diesel billed USD/gal");
    expect(head).toContain("DEF gal");
    expect(head).toContain("Total USD");
    expect(document.querySelector(".tx-caption")!.textContent).toContain("All amounts USD.");
    expect(screen.getByTestId("fx-rate-line").textContent).toContain("Converted at 1.3712 CAD per USD, entered Oct 6, 2026");
    expect(screen.queryByTestId("conversion-pending")).toBeNull();
    // The converted row still names the invoice BVD billed it on.
    expect(screen.getAllByTestId("tx-invoice-tag").map((t) => t.textContent)).toEqual(["🇺🇸 999210", "🇨🇦 999217"]);
  });

  it("a rate-pending row shows 'rate pending' in its money cells, withholds the totals, and links to the Overview to enter it", () => {
    const pending = caStop({ currency: "USD", invoiceCurrency: "CAD", ratePending: true, qty: 26.42, qtyUnit: "gal", billedPerUnit: null, retailPerUnit: null, total: null });
    pending.lines = pending.lines!.map((l) => ({ ...l, currency: "USD", amount: null, preTaxAmount: null, hst: null, gst: null, pst: null, qst: null, retailPerUnit: null, billedPerUnit: null }));
    render(<TransactionsTable {...baseProps([stop(), pending])} week="2026-09-09" />);

    const caRowText = document.querySelectorAll(".tx-row")[1]!.textContent!;
    expect(caRowText).toContain("rate pending");
    expect(caRowText).not.toContain("1.00");
    const cells = [...document.querySelectorAll(".tx-foot-row .tx-foot-cell")].map((c) => c.textContent);
    expect(cells).toEqual(["66.42", "—", "3.00", "—"]);
    expect(screen.getByTestId("conversion-pending").textContent).toContain("rate pending — enter the exchange rate on the Overview");
    expect(screen.getByTestId("enter-rate-link").getAttribute("href")).toBe("/overview?scope=week&w=2026-09-09");
    expect(screen.queryByTestId("fx-rate-line")).toBeNull();

    fireEvent.click(document.querySelectorAll(".tx-row")[1]!);
    // Still a CA stop: its tax columns stay, every one pending.
    expect(screen.getByTestId("stop-hst").textContent).toBe("rate pending");
    expect(screen.getByTestId("stop-total").textContent).toBe("rate pending");
    expect(screen.getByText("Invoice 999217")).toBeTruthy();
  });

  it("the Source row names each row's own invoice", () => {
    render(<TransactionsTable {...baseProps([caStop()])} />);
    fireEvent.click(document.querySelector(".tx-row")!);
    expect(screen.getByText("Invoice 999217")).toBeTruthy();
  });

  it("rows as printed carry no rate line and no pending note", () => {
    render(<TransactionsTable {...baseProps([caStop()])} />);
    expect(screen.queryByTestId("conversion-pending")).toBeNull();
    expect(screen.queryByTestId("fx-rate-line")).toBeNull();
  });

  it("under All invoices each row is tagged with its invoice and country", () => {
    render(<TransactionsTable {...baseProps([stop(), caStop()])} showInvoice />);
    const tags = screen.getAllByTestId("tx-invoice-tag");
    expect(tags.map((t) => t.textContent)).toEqual(["🇺🇸 999210", "🇨🇦 999217"]);
    expect(tags.map((t) => t.dataset.currency)).toEqual(["USD", "CAD"]);
    expect(tags[1]!.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("CA");
  });

  it("a single invoice's rows carry no tag", () => {
    render(<TransactionsTable {...baseProps([stop()])} />);
    expect(screen.queryByTestId("tx-invoice-tag")).toBeNull();
  });

  it("the Date · time header is a sort button: ↓ and aria-sort=descending by default (T-40J)", () => {
    render(<TransactionsTable {...baseProps([stop()])} />);
    const button = screen.getByRole("button", { name: /Date · time/ });
    expect(button.textContent).toContain("↓");
    expect(button.closest("[aria-sort]")!.getAttribute("aria-sort")).toBe("descending");
  });

  it("oldest first shows ↑ and aria-sort=ascending", () => {
    render(<TransactionsTable {...baseProps([stop()])} filters={{ ...EMPTY_FILTERS, sort: "asc" }} />);
    const button = screen.getByRole("button", { name: /Date · time/ });
    expect(button.textContent).toContain("↑");
    expect(button.closest("[aria-sort]")!.getAttribute("aria-sort")).toBe("ascending");
  });

  it("clicking the header flips the sort through setFilter", () => {
    const props = baseProps([stop()]);
    const { unmount } = render(<TransactionsTable {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Date · time/ }));
    expect(props.setFilter).toHaveBeenLastCalledWith("sort", "asc");
    unmount();

    const props2 = baseProps([stop()]);
    render(<TransactionsTable {...props2} filters={{ ...EMPTY_FILTERS, sort: "asc" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Date · time/ }));
    expect(props2.setFilter).toHaveBeenLastCalledWith("sort", "");
  });

  it("rows render in the order given, and the active row resets to the first when the sort changes", () => {
    const a = stop({ id: "a", baseAuthCode: "A1", occurredAt: "2026-09-01T10:00:00.000Z" });
    const b = stop({ id: "b", baseAuthCode: "A2", occurredAt: "2026-09-02T10:00:00.000Z" });
    const { rerender } = render(<TransactionsTable {...baseProps([b, a])} />);
    fireEvent.keyDown(document.querySelectorAll(".tx-row")[0]!, { key: "ArrowDown" });
    expect(document.querySelectorAll(".tx-row")[1]!.className).toContain("active");

    rerender(<TransactionsTable {...baseProps([a, b])} filters={{ ...EMPTY_FILTERS, sort: "asc" }} />);
    const rowEls = document.querySelectorAll(".tx-row");
    expect(rowEls[0]!.className).toContain("active");
    expect(rowEls[1]!.className).not.toContain("active");
    // Keyboard navigation still works on the sorted rows.
    fireEvent.keyDown(rowEls[0]!, { key: "ArrowDown" });
    expect(document.querySelectorAll(".tx-row")[1]!.className).toContain("active");
  });
});

describe("TransactionsTable — printed times (T-81)", () => {
  it("shows the date and time BVD printed, not shifted to the viewer's zone", () => {
    render(
      <TransactionsTable
        {...baseProps([
          caStop({ id: "before", occurredAt: "2026-09-08T23:50:28.000Z" }),
          caStop({ id: "after", occurredAt: "2026-09-09T00:00:47.000Z" }),
        ])}
      />,
    );
    const cells = [...document.querySelectorAll(".tx-row .tx-datetime")].map(
      (c) => `${c.querySelector(".tx-date")!.textContent} ${c.querySelector(".tx-time")!.textContent}`,
    );
    expect(cells.sort()).toEqual(["Sep 8, 2026 23:50:28", "Sep 9, 2026 00:00:47"]);
    // Hovering the time shows the exact printed value, seconds included.
    expect([...document.querySelectorAll(".tx-row .tx-time")].map((e) => e.getAttribute("title")).sort()).toEqual([
      "2026-09-08 23:50:28",
      "2026-09-09 00:00:47",
    ]);
  });
});

describe("TransactionsTable — the unit key (T-87)", () => {
  it("is closed until the i in the Unit header opens it, with the three explanations", () => {
    render(<TransactionsTable {...baseProps([stop()])} />);
    expect(screen.queryByText("as entered at the pump")).toBeNull();
    const info = screen.getByRole("button", { name: "How to read the unit column" });
    expect(info.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(info);

    expect(info.getAttribute("aria-expanded")).toBe("true");
    const key = within(screen.getByRole("dialog", { name: "Reading the unit column" }));
    expect(key.getByText("as entered at the pump")).toBeTruthy();
    expect(key.getByText("resolved from the card assignment")).toBeTruthy();
    expect(key.getByText("the two disagree")).toBeTruthy();
  });

  it("does not sit in the toolbar any more", () => {
    render(<TransactionsTable {...baseProps([stop()])} />);
    expect(screen.queryByText("Reading the columns")).toBeNull();
  });
});
