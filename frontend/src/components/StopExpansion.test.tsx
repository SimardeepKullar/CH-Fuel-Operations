// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TransactionListItem } from "@ch/core/actuals/transactions";
import StopExpansion from "./StopExpansion";

afterEach(cleanup);

// A worked example in the same shape as PROJECT-SCOPE-v2.md §A19 / transactions.test.ts's
// (synthetic figures — see T-58's history scrub): auth A900000001, JORDAN, card
// 9000005, unit 072, LOVES #294, $238.26.
const A900000001: TransactionListItem = {
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
};

describe("StopExpansion", () => {
  it("shows every product line and an unmissable stop total of $238.26 for A900000001", () => {
    render(<StopExpansion stop={A900000001} />);
    expect(screen.getByText("TA")).toBeTruthy();
    expect(screen.getByText("DF")).toBeTruthy();
    expect(screen.getByTestId("stop-total").textContent).toBe("$238.26");
  });

  it("the stop total is the stored total, not a client re-sum of the lines", () => {
    // Deliberately inconsistent lines vs. totalUsd to prove the component
    // trusts the stored figure rather than adding lines itself.
    const stop: TransactionListItem = { ...A900000001, totalUsd: 999.99 };
    render(<StopExpansion stop={stop} />);
    expect(screen.getByTestId("stop-total").textContent).toBe("$999.99");
  });

  it("raw driver and unit text are rendered through RawResolved (rawOnly), not a second hand-rolled span", () => {
    render(<StopExpansion stop={A900000001} />);
    const rawNodes = document.querySelectorAll('[data-state="unmatched"]');
    // Two rawOnly RawResolved instances: raw driver text, raw unit text.
    expect(rawNodes.length).toBe(2);
  });

  it("an unresolved station renders as Unresolved, not blank or a guess", () => {
    const stop: TransactionListItem = { ...A900000001, station: null };
    render(<StopExpansion stop={stop} />);
    expect(screen.getByText("Unresolved").textContent).toBe("Unresolved");
  });

  it("gallons render em-dash, never 0, when the stop carries no TA line", () => {
    const stop: TransactionListItem = { ...A900000001, gallons: null, lines: [] };
    render(<StopExpansion stop={stop} />);
    const total = screen.getByTestId("stop-total").closest(".stop-expansion-total")!;
    expect(total.textContent).toContain("—");
    expect(total.textContent).not.toContain("0.00 gal");
  });

  it("stacked forces a single-column layout (900px requirement) rather than a two-column overlap", () => {
    render(<StopExpansion stop={A900000001} stacked />);
    expect(screen.getByTestId("stop-expansion").className).toContain("stop-expansion-stacked");
  });

  it("shows the Source row with the page's invoice number when given", () => {
    render(<StopExpansion stop={A900000001} invoiceNumber="999210" />);
    expect(screen.getByText("Source")).toBeTruthy();
    expect(screen.getByText("Invoice 999210")).toBeTruthy();
  });

  it("omits the Source row rather than a blank value while the invoice number hasn't loaded", () => {
    render(<StopExpansion stop={A900000001} />);
    expect(screen.queryByText("Source")).toBeNull();
  });
});
