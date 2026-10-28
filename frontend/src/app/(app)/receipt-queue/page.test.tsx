// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceiptQueueItem, ReceiptQueueResult } from "@ch/core/actuals/receipts";

const getReceiptWeek = vi.fn();
const postReceiptCheck = vi.fn();
const confirmReceiptStops = vi.fn();

vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ...actual,
    getReceiptWeek: (...a: unknown[]) => getReceiptWeek(...a),
    postReceiptCheck: (...a: unknown[]) => postReceiptCheck(...a),
    confirmReceiptStops: (...a: unknown[]) => confirmReceiptStops(...a),
  };
});
vi.mock("../../../hooks/useWeek", () => ({
  useWeek: () => ({ week: "2026-10-26", weekEntry: null, loading: false }),
}));

const { default: ReceiptQueuePage } = await import("./page");
const { StandingCountsProvider } = await import("../../../hooks/standingCountsContext");

function item(id: string, o: Partial<ReceiptQueueItem> = {}): ReceiptQueueItem {
  return {
    id,
    occurredAt: "2026-10-21T15:30:00",
    driver: { resolved: "DRIVER A", raw: "DRIVER A", agrees: true },
    driverId: "driver-a",
    truck: { resolved: "201", raw: "201", agrees: true },
    station: { id: "s1", loveNumber: 368, name: "Love's #368", city: "Dallas", state: "TX" },
    qty: 120.5,
    qtyUnit: "gal",
    total: 412.37,
    currency: "USD",
    receiptStatus: "pending",
    hasException: false,
    flags: [],
    ...o,
  };
}

async function renderPage(items: ReceiptQueueItem[]) {
  const result: ReceiptQueueResult = { items, progress: { done: 0, total: items.length } };
  getReceiptWeek.mockResolvedValue(result);
  render(
    <StandingCountsProvider value={{ receipts: result.progress, flags: null, refresh: () => {} }}>
      <ReceiptQueuePage />
    </StandingCountsProvider>,
  );
  await screen.findByTestId("queue-progress");
  await waitFor(() => expect(screen.getByTestId("queue-to-check").textContent).not.toContain("—"));
}

beforeEach(() => {
  getReceiptWeek.mockReset();
  postReceiptCheck.mockReset();
  confirmReceiptStops.mockReset();
  postReceiptCheck.mockResolvedValue({});
  confirmReceiptStops.mockResolvedValue({ confirmedCount: 0 });
});
afterEach(cleanup);

describe("Receipt Queue — table", () => {
  it("lists a row with its unit and a currency-prefixed total", async () => {
    await renderPage([item("a"), item("b", { qty: 80, qtyUnit: "L", currency: "CAD", total: 150 })]);
    const rows = screen.getAllByTestId("queue-row");
    expect(rows).toHaveLength(2);
    const text = rows.map((r) => r.textContent).join("|");
    expect(text).toContain("US$412.37");
    expect(text).toContain("CA$150.00");
    expect(text).toContain("Love's #368 · Dallas, TX");
    expect(text).toContain("80.00 L");
  });

  it("shows unmatched driver text as raw with the tooltip", async () => {
    await renderPage([item("a", { driver: { resolved: null, raw: "DRVR D", agrees: null } })]);
    expect(screen.getAllByTitle("Unmatched invoice text: check this")[0]!.textContent).toBe("DRVR D");
  });

  it("decides optimistically and keeps the row in To check", async () => {
    await renderPage([item("a"), item("b")]);
    fireEvent.click(within(screen.getAllByTestId("queue-row")[0]!).getByLabelText("Yes, receipt uploaded"));
    expect(screen.getByTestId("queue-progress").textContent).toBe("1 of 2 confirmed");
    expect(screen.getAllByTestId("queue-row")).toHaveLength(2);
    expect(postReceiptCheck).toHaveBeenCalledWith(expect.any(String), "confirmed");
  });

  it("reverts and alerts when the save fails", async () => {
    postReceiptCheck.mockRejectedValue(new Error("the server timed out"));
    await renderPage([item("a")]);
    fireEvent.click(screen.getByLabelText("Yes, receipt uploaded"));
    const alert = await screen.findByTestId("queue-failure");
    expect(alert.textContent).toContain("your “Yes” didn’t save because the server timed out");
    expect(alert.textContent).toContain("The row is back to Pending.");
    expect(screen.getByTestId("queue-progress").textContent).toBe("0 of 1 confirmed");
  });

  it("batch-confirms only the shown rows after a confirm step", async () => {
    await renderPage([item("a"), item("b"), item("c", { driver: { resolved: "DRIVER B", raw: "DRIVER B", agrees: true } })]);
    fireEvent.change(screen.getByLabelText("Driver"), { target: { value: "DRIVER A" } });
    fireEvent.click(screen.getByText("Confirm all 2 shown for DRIVER A"));
    expect(confirmReceiptStops).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirm 2"));
    await waitFor(() => expect(confirmReceiptStops).toHaveBeenCalledWith(["a", "b"]));
    expect((await screen.findByRole("status")).textContent).toContain("2 receipts confirmed for DRIVER A.");
  });

  it("searches a date typed as 10/21", async () => {
    await renderPage([item("a"), item("b", { occurredAt: "2026-10-22T09:00:00" })]);
    fireEvent.change(screen.getByPlaceholderText(/Driver, truck/), { target: { value: "10/21" } });
    expect(screen.getAllByTestId("queue-row")).toHaveLength(1);
  });

  it("shows the empty state when nothing is left", async () => {
    await renderPage([item("a", { receiptStatus: "confirmed" })]);
    expect(screen.getByTestId("queue-clear").textContent).toContain("Nothing left to check");
  });

  it("names a CA site by its own name, not Love's", async () => {
    await renderPage([
      item("a", { station: { id: "s2", loveNumber: null, name: "BVD MISSISSAUGA - SHAWSON", city: "MISSISSAUGA", state: "ON" } }),
    ]);
    expect(screen.getByTestId("queue-row").textContent).toContain("BVD MISSISSAUGA - SHAWSON");
    expect(screen.getByTestId("queue-row").textContent).not.toContain("Love");
  });

  it("explains a flag on hover", async () => {
    await renderPage([item("a", { hasException: true, flags: [{ rule: "unit_mismatch", severity: "amber" }] })]);
    expect(screen.getByText("Flagged").closest("span")!.getAttribute("title")).toContain("Unit mismatch: ");
  });
});
