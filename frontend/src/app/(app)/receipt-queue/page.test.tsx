// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceiptQueueItem, ReceiptQueueResult } from "@ch/core/actuals/receipts";

const getReceiptQueue = vi.fn();
const postReceiptCheck = vi.fn();
const confirmDriverReceipts = vi.fn();

vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ...actual,
    getReceiptQueue: (...args: unknown[]) => getReceiptQueue(...args),
    postReceiptCheck: (...args: unknown[]) => postReceiptCheck(...args),
    confirmDriverReceipts: (...args: unknown[]) => confirmDriverReceipts(...args),
  };
});

const { default: ReceiptQueuePage } = await import("./page");
const { StandingCountsProvider } = await import("../../../hooks/standingCountsContext");

function item(id: string, overrides: Partial<ReceiptQueueItem> = {}): ReceiptQueueItem {
  return {
    id,
    occurredAt: "2026-02-03T15:30:00.000Z",
    driver: { resolved: "DRIVER A", raw: "DRIVER A", agrees: true },
    driverId: "driver-a",
    truck: { resolved: "201", raw: "201", agrees: true },
    station: { id: "s1", loveNumber: 368, city: "Dallas", state: "TX" },
    qty: 120.5,
    qtyUnit: "gal",
    total: 412.37,
    currency: "USD",
    receiptStatus: "pending",
    hasException: false,
    ...overrides,
  };
}

function queue(items: ReceiptQueueItem[], progress = { done: 12, total: 60 }): ReceiptQueueResult {
  return { items, progress };
}

async function renderPage(result: ReceiptQueueResult, refresh?: () => void) {
  getReceiptQueue.mockResolvedValue(result);
  render(
    <StandingCountsProvider value={{ receipts: result.progress, flags: null, refresh }}>
      <ReceiptQueuePage />
    </StandingCountsProvider>,
  );
  await screen.findByTestId("queue-progress");
}

beforeEach(() => {
  getReceiptQueue.mockReset();
  postReceiptCheck.mockReset();
  confirmDriverReceipts.mockReset();
  postReceiptCheck.mockResolvedValue({});
});

afterEach(cleanup);

describe("Receipt Queue — the card and the shortcuts (43.1)", () => {
  it("shows one item with the context needed to find its receipt", async () => {
    await renderPage(queue([item("a"), item("b", { driver: { resolved: "DRIVER B", raw: "DRIVER B", agrees: true } })]));

    expect(screen.getAllByTestId("queue-card")).toHaveLength(1);
    expect(screen.getByTestId("queue-driver").textContent).toBe("DRIVER A");
    expect(screen.getByTestId("queue-truck").textContent).toContain("201");
    expect(screen.getByTestId("queue-station").textContent).toBe("Love’s #368 · Dallas, TX");
    expect(screen.getByTestId("queue-qty").textContent).toBe("120.50");
    expect(screen.getByTestId("queue-total").textContent).toBe("US$412.37");
    expect(screen.getByText(/Feb 3, 2026/)).toBeTruthy();
  });

  it("labels a litre quantity as litres and a CAD total as CAD", async () => {
    await renderPage(queue([item("a", { qty: 80, qtyUnit: "L", currency: "CAD", total: 150 })]));
    expect(screen.getByText("Litres")).toBeTruthy();
    expect(screen.getByTestId("queue-total").textContent).toBe("CA$150.00");
  });

  it("shows the Y / N / S shortcuts on screen", async () => {
    await renderPage(queue([item("a")]));
    const group = screen.getByRole("group", { name: "Receipt decision" });
    expect(within(group).getByText("Y")).toBeTruthy();
    expect(within(group).getByText("N")).toBeTruthy();
    expect(within(group).getByText("S")).toBeTruthy();
  });

  it("Y confirms the item with no click first, and the next item takes the card", async () => {
    await renderPage(queue([item("a"), item("b", { driver: { resolved: "DRIVER B", raw: "DRIVER B", agrees: true } })]));

    fireEvent.keyDown(window, { key: "y" });

    expect(postReceiptCheck).toHaveBeenCalledWith("a", "confirmed");
    await waitFor(() => expect(screen.getByTestId("queue-driver").textContent).toBe("DRIVER B"));
  });

  it("N records the receipt as missing", async () => {
    await renderPage(queue([item("a")]));
    fireEvent.keyDown(window, { key: "N" });
    expect(postReceiptCheck).toHaveBeenCalledWith("a", "missing");
  });

  it("the buttons decide too", async () => {
    await renderPage(queue([item("a")]));
    fireEvent.click(screen.getByRole("button", { name: /Receipt uploaded/ }));
    expect(postReceiptCheck).toHaveBeenCalledWith("a", "confirmed");
  });

  it("ignores a shortcut typed into a control, and one with a modifier", async () => {
    await renderPage(queue([item("a", { driverId: "driver-a" })]));
    const select = screen.getByRole("combobox", { name: "Driver" });
    fireEvent.keyDown(select, { key: "y" });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(postReceiptCheck).not.toHaveBeenCalled();
  });

  it("progress reads 12 of 60, moves to 13 on Y and stays on N", async () => {
    await renderPage(queue([item("a"), item("b"), item("c")]));
    expect(screen.getByTestId("queue-progress").textContent).toBe("12 of 60");

    fireEvent.keyDown(window, { key: "y" });
    await waitFor(() => expect(screen.getByTestId("queue-progress").textContent).toBe("13 of 60"));

    fireEvent.keyDown(window, { key: "n" });
    await waitFor(() => expect(postReceiptCheck).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("queue-progress").textContent).toBe("13 of 60");
    expect(screen.getByTestId("queue-remaining").textContent).toBe("1 to review");
  });

  it("skip advances without writing, and the skipped item comes back after the rest", async () => {
    await renderPage(
      queue([
        item("a", { driver: { resolved: "DRIVER A", raw: "DRIVER A", agrees: true } }),
        item("b", { driver: { resolved: "DRIVER B", raw: "DRIVER B", agrees: true } }),
      ]),
    );

    fireEvent.keyDown(window, { key: "s" });
    expect(screen.getByTestId("queue-driver").textContent).toBe("DRIVER B");
    expect(postReceiptCheck).not.toHaveBeenCalled();
    expect(screen.getByTestId("queue-remaining").textContent).toBe("2 to review");

    fireEvent.keyDown(window, { key: "s" });
    expect(screen.getByTestId("queue-driver").textContent).toBe("DRIVER A");
  });

  it("an optimistic decision that fails rolls back visibly", async () => {
    postReceiptCheck.mockRejectedValue(new Error("connection reset"));
    await renderPage(queue([item("a")]));

    fireEvent.keyDown(window, { key: "y" });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not save Y");
    expect(alert.textContent).toContain("connection reset");
    expect(alert.textContent).toContain("back in the queue");
    expect(screen.getByTestId("queue-card")).toBeTruthy();
    expect(screen.getByTestId("queue-progress").textContent).toBe("12 of 60");
  });

  it("asks the shell to re-read its counts after a saved decision", async () => {
    const refresh = vi.fn();
    await renderPage(queue([item("a")]), refresh);
    fireEvent.keyDown(window, { key: "y" });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("says so when the queue is empty", async () => {
    await renderPage(queue([], { done: 60, total: 60 }));
    expect(screen.getByTestId("queue-clear")).toBeTruthy();
    expect(screen.queryByTestId("queue-card")).toBeNull();
  });

  it("shows a retry when the queue cannot be loaded", async () => {
    getReceiptQueue.mockRejectedValue(new Error("down"));
    render(<ReceiptQueuePage />);
    expect(await screen.findByTestId("queue-load-error")).toBeTruthy();
  });
});

describe("Receipt Queue — batch confirm and the phone layout (43.2)", () => {
  const three = () => [
    item("a1"),
    item("a2"),
    item("a3", { receiptStatus: "missing" }),
    item("b1", { driverId: "driver-b", driver: { resolved: "DRIVER B", raw: "DRIVER B", agrees: true } }),
  ];

  it("states the count before it writes, then writes once for the driver", async () => {
    confirmDriverReceipts.mockResolvedValue({ driverId: "driver-a", confirmedCount: 3 });
    await renderPage(queue(three()));

    fireEvent.change(screen.getByRole("combobox", { name: "Driver" }), { target: { value: "driver-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm all…" }));

    const step = screen.getByTestId("batch-confirm-step");
    expect(step.textContent).toContain("Confirm 3 receipts for DRIVER A");
    expect(step.textContent).toContain("1 of them you marked missing");
    expect(confirmDriverReceipts).not.toHaveBeenCalled();

    getReceiptQueue.mockResolvedValue(queue([three()[3]!], { done: 15, total: 60 }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm 3" }));

    expect(confirmDriverReceipts).toHaveBeenCalledTimes(1);
    expect(confirmDriverReceipts).toHaveBeenCalledWith("driver-a");
    await waitFor(() => expect(screen.getByTestId("queue-progress").textContent).toBe("15 of 60"));
    expect(getReceiptQueue).toHaveBeenCalledTimes(2);
  });

  it("cancelling writes nothing", async () => {
    await renderPage(queue(three()));
    fireEvent.change(screen.getByRole("combobox", { name: "Driver" }), { target: { value: "driver-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm all…" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("batch-confirm-step")).toBeNull();
    expect(confirmDriverReceipts).not.toHaveBeenCalled();
  });

  it("a failed batch says nothing was written and leaves the queue as it was", async () => {
    confirmDriverReceipts.mockRejectedValue(new Error("boom"));
    await renderPage(queue(three()));
    fireEvent.change(screen.getByRole("combobox", { name: "Driver" }), { target: { value: "driver-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm all…" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm 1" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("nothing was written");
    expect(screen.getByTestId("queue-remaining").textContent).toBe("4 to review");
  });

  it("an item whose driver never resolved is not offered for batch confirm", async () => {
    await renderPage(queue([item("x", { driverId: null, driver: { resolved: null, raw: "MYSTERY", agrees: null } })]));
    const select = screen.getByRole("combobox", { name: "Driver" }) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(within(select).getByText("No driver to confirm")).toBeTruthy();
  });

  it("an exceptions-only queue (2 of 60) does not imply 58 pending decisions", async () => {
    await renderPage(
      queue([item("e1", { hasException: true }), item("e2", { hasException: true, driverId: "driver-b" })], { done: 58, total: 60 }),
    );
    expect(screen.getByTestId("queue-progress").textContent).toBe("58 of 60");
    expect(screen.getByTestId("queue-remaining").textContent).toBe("2 to review");
    expect(screen.getByTestId("queue-flagged")).toBeTruthy();
    expect(screen.queryByText(/58 to review|58 pending/)).toBeNull();
  });

  it("an unflagged item shows no exception badge — the card never assumes one", async () => {
    await renderPage(queue([item("a")]));
    expect(screen.queryByTestId("queue-flagged")).toBeNull();
  });
});

describe("Receipt Queue — phone sizing", () => {
  // jsdom does no layout, so the 390px promises are held at the source: every control declares a
  // 44px floor, and the phone rule pins the decision buttons to the bottom edge.
  const css = readFileSync(path.join(__dirname, "../../../receiptQueue.css"), "utf8");

  function minHeight(selector: string): number {
    const block = css.match(new RegExp(`${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`));
    const px = block?.[1]?.match(/min-height:\s*(\d+)px/);
    return px ? Number(px[1]) : 0;
  }

  it.each([".rq-action", ".rq-action-skip", ".rq-batch-select", ".rq-batch-button"])("%s is at least 44px tall", (selector) => {
    expect(minHeight(selector)).toBeGreaterThanOrEqual(44);
  });

  it("pins the decision buttons to the bottom on a phone", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 700px)"));
    expect(phone).toMatch(/\.rq-actions\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0/);
  });

  it("lets nothing push the page wider than the viewport", () => {
    expect(css).toMatch(/\.rq-page\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
