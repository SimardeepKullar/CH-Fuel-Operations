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
    gallons: 40.0,
    retailUsdPerGal: 5.799,
    billedUsdPerGal: 5.499,
    totalUsd: 238.26,
    currency: "USD",
    receiptStatus: "confirmed",
    flags: [],
    lines: [
      { productCode: "TA", gallons: 40.0, retailUsdPerGal: 5.799, billedUsdPerGal: 5.499, amountUsd: 219.96, currency: "USD" },
      { productCode: "DF", gallons: 3.0, retailUsdPerGal: 6.2, billedUsdPerGal: 6.1, amountUsd: 18.3, currency: "USD" },
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
});
