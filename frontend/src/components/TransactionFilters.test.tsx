// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TransactionFilters from "./TransactionFilters";
import type { TransactionFiltersState } from "../hooks/useTransactionFilters";

afterEach(cleanup);

const NONE: TransactionFiltersState = { q: "", driverId: "", truckId: "", cardId: "", state: "", product: "", receiptStatus: "", flags: "", anomalyOnly: false, sort: "" };

function setup(filters: Partial<TransactionFiltersState> = {}) {
  const props = {
    filters: { ...NONE, ...filters },
    setFilter: vi.fn(),
    setFilters: vi.fn(),
    clearFilters: vi.fn(),
    driverOptions: [{ value: "d1", label: "Jordan Reyes" }],
    truckOptions: [{ value: "t1", label: "072" }],
    cardOptions: [{ value: "c1", label: "9000005" }],
    stateOptions: [{ value: "MO", label: "MO" }],
    shown: 12,
    total: 68,
  };
  render(<TransactionFilters {...props} />);
  return props;
}

const button = (name: RegExp) => screen.getByRole("button", { name });

describe("TransactionFilters — nothing filtered (T-87)", () => {
  it("shows every filter reading All, the count, and no chips or Clear", () => {
    setup();
    for (const label of ["Driver", "Truck", "Product", "Receipt"]) {
      expect(screen.getByLabelText(label).closest("label")!.textContent).toContain("All");
    }
    expect(button(/Flags/).textContent).toContain("All");
    expect(button(/More/)).toBeTruthy();
    expect(document.querySelector(".tx-bar-count")!.textContent).toBe("12 of 68");
    expect(screen.queryByRole("group", { name: "Active filters" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(screen.queryByText("Clear all")).toBeNull();
  });

  it("keeps Card and State out of the bar until More opens", () => {
    setup();
    expect(screen.queryByLabelText("Card")).toBeNull();
    fireEvent.click(button(/More/));
    expect(screen.getByLabelText("Card")).toBeTruthy();
    expect(screen.getByLabelText("State / province")).toBeTruthy();
  });

  it("has no date boxes and no Flagged only checkbox", () => {
    setup();
    expect(screen.queryByLabelText("From")).toBeNull();
    expect(screen.queryByLabelText("To")).toBeNull();
    expect(screen.queryByText("Flagged only")).toBeNull();
  });

  it("a choice in a dropdown reports its key and value", () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText("Driver"), { target: { value: "d1" } });
    expect(props.setFilter).toHaveBeenCalledWith("driverId", "d1");
    fireEvent.click(button(/More/));
    fireEvent.change(screen.getByLabelText("State / province"), { target: { value: "MO" } });
    expect(props.setFilter).toHaveBeenCalledWith("state", "MO");
  });

  it("/ focuses the search box", () => {
    setup();
    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(screen.getByLabelText("Search transactions"));
  });
});

describe("TransactionFilters — active state (T-87)", () => {
  it("marks an active filter and shows its option's name", () => {
    setup({ driverId: "d1" });
    const driver = screen.getByLabelText("Driver").closest("label")!;
    expect(driver.classList.contains("on")).toBe(true);
    expect(driver.textContent).toContain("Jordan Reyes");
    expect(screen.getByLabelText("Truck").closest("label")!.classList.contains("on")).toBe(false);
  });

  it("More counts Card and State only, on a badge", () => {
    setup({ cardId: "c1", state: "MO", driverId: "d1" });
    expect(button(/More/).classList.contains("on")).toBe(true);
    expect(document.querySelector(".tx-dd-badge")!.textContent).toBe("2");
  });

  it("More has no badge while neither is on", () => {
    setup({ driverId: "d1" });
    expect(document.querySelector(".tx-dd-badge")).toBeNull();
  });
});

describe("TransactionFilters — the merged Flags control (T-87)", () => {
  it("lists All, Flagged and each visible rule, without Scale", () => {
    setup();
    fireEvent.click(button(/Flags/));
    expect((screen.getByLabelText("All") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("Flagged")).toBeTruthy();
    expect(screen.getByLabelText("Sub-gal")).toBeTruthy();
    expect(screen.queryByLabelText("Scale")).toBeNull();
  });

  it("Flagged is the old Flagged only, and drops any picked rules", () => {
    const props = setup({ flags: "sub_gallon" });
    fireEvent.click(button(/Flags/));
    fireEvent.click(screen.getByLabelText("Flagged"));
    expect(props.setFilters).toHaveBeenCalledWith({ flags: "", anomalyOnly: true });
  });

  it("an anomalyOnly link from the Overview reads as Flagged", () => {
    setup({ anomalyOnly: true });
    expect(button(/Flags/).textContent).toContain("Flagged");
    fireEvent.click(button(/Flags/));
    expect((screen.getByLabelText("Flagged") as HTMLInputElement).checked).toBe(true);
  });

  it("ticking a rule adds to the selection and turns Flagged off; unticking removes it", () => {
    const props = setup({ flags: "sub_gallon", anomalyOnly: true });
    fireEvent.click(button(/Flags/));
    fireEvent.click(screen.getByLabelText("Too close"));
    expect(props.setFilters).toHaveBeenCalledWith({ flags: "sub_gallon,too_close", anomalyOnly: false });
    fireEvent.click(screen.getByLabelText("Sub-gal"));
    expect(props.setFilters).toHaveBeenCalledWith({ flags: "", anomalyOnly: false });
  });

  it("All clears both", () => {
    const props = setup({ flags: "sub_gallon" });
    fireEvent.click(button(/Flags/));
    fireEvent.click(screen.getByLabelText("All"));
    expect(props.setFilters).toHaveBeenCalledWith({ flags: "", anomalyOnly: false });
  });

  it("says which rule, or how many", () => {
    setup({ flags: "too_close" });
    expect(button(/Flags/).textContent).toContain("Too close");
    cleanup();
    setup({ flags: "too_close,sub_gallon" });
    expect(button(/Flags/).textContent).toContain("2 flags");
  });
});

describe("TransactionFilters — chips (T-87)", () => {
  const chips = () => within(screen.getByRole("group", { name: "Active filters" }));

  it("one chip per active filter, each flag on its own", () => {
    setup({ q: "dallas", driverId: "d1", truckId: "t1", product: "TA", receiptStatus: "missing", cardId: "c1", state: "MO", flags: "sub_gallon,too_close" });
    const text = [...document.querySelectorAll(".tx-chip")].map((c) => c.textContent);
    expect(text).toEqual([
      "Search: dallas",
      "Driver: Jordan Reyes",
      "Truck: 072",
      "Product: Diesel",
      "Receipt: Missing",
      "Flags: Sub-gal",
      "Flags: Too close",
      "Card: 9000005",
      "State: MO",
    ]);
  });

  it("Flagged has a chip", () => {
    setup({ anomalyOnly: true });
    expect(document.querySelector(".tx-chip")!.textContent).toBe("Flags: Flagged");
  });

  it("× clears that filter alone", () => {
    const props = setup({ driverId: "d1", flags: "sub_gallon,too_close" });
    fireEvent.click(chips().getByRole("button", { name: "Remove driver filter" }));
    expect(props.setFilters).toHaveBeenCalledWith({ driverId: "" });
    fireEvent.click(chips().getByRole("button", { name: "Remove Sub-gal flag filter" }));
    expect(props.setFilters).toHaveBeenCalledWith({ flags: "too_close" });
  });

  it("a driver whose option has not loaded still has a removable chip", () => {
    setup({ driverId: "unknown" });
    expect(document.querySelector(".tx-chip")!.textContent).toBe("Driver: Selected");
  });

  it("Clear all clears the filters", () => {
    const props = setup({ driverId: "d1" });
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(props.clearFilters).toHaveBeenCalledTimes(1);
  });

  it("sort alone is not a filter", () => {
    setup({ sort: "asc" });
    expect(screen.queryByRole("group", { name: "Active filters" })).toBeNull();
  });
});
