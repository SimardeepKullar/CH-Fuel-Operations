// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  anomalyOnly: false,
};

function stop(overrides: Partial<TransactionListItem> = {}): TransactionListItem {
  return {
    id: "stop-1",
    baseAuthCode: "A900000001",
    occurredAt: "2026-09-05T14:30:00.000Z",
    card: { id: "card-1", number: "9000005" },
    driver: { resolved: "JORDAN", raw: "JORDAN", agrees: true },
    truck: { resolved: "072", raw: "072", agrees: true },
    station: { id: "st-1", loveNumber: 294, city: "Dallas", state: "TX" },
    qty: 40.0,
    qtyUnit: "gal",
    retailPerUnit: 5.799,
    billedPerUnit: 5.499,
    total: 238.26,
    currency: "USD",
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
    invoiceNumber: "999210",
    filters: EMPTY_FILTERS,
    setFilter: vi.fn(),
    clearFilters: vi.fn(),
    driverOptions: [],
    truckOptions: [],
    cardOptions: [],
    stateOptions: [],
  };
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

  it("expanding A900000001 shows both product lines and an unmissable stop total of $238.26", () => {
    render(<TransactionsTable {...baseProps([stop()])} />);
    expect(screen.queryByTestId("stop-expansion")).toBeNull();

    fireEvent.click(document.querySelector(".tx-row")!);

    expect(screen.getByText("TA")).toBeTruthy();
    expect(screen.getByText("DF")).toBeTruthy();
    expect(screen.getByTestId("stop-total").textContent).toBe("$238.26");
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
    const search = screen.getByPlaceholderText("Search driver, card, unit, station, auth code") as HTMLInputElement;
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
    const stateSelect = screen.getByDisplayValue("TX") as HTMLSelectElement;
    expect(stateSelect.value).toBe("TX");
    const anomalyCheckbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(anomalyCheckbox.checked).toBe(true);
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
});
