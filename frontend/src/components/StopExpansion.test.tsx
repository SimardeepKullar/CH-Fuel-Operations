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
};

// A CA stop (D28): litres, CAD, and the 13% HST printed beside the per-litre price.
// Synthetic figures: 100.00 L at CA$1.9046 pre-tax = CA$190.46, HST CA$24.76, Final CA$215.22.
const CA_STOP: TransactionListItem = {
  ...A900000001,
  id: "stop-ca",
  qty: 100,
  qtyUnit: "L",
  retailPerUnit: 2.0,
  billedPerUnit: 2.1522,
  total: 215.22,
  currency: "CAD",
  lines: [
    { productCode: "TA", qty: 100, retailPerUnit: 2.0, billedPerUnit: 2.1522, amount: 215.22, preTaxAmount: 190.46, hst: 24.76, gst: 0, pst: 0, qst: 0, qtyUnit: "L", currency: "CAD" },
  ],
};

describe("StopExpansion", () => {
  it("shows every product line and an unmissable stop total of US$238.26 for A900000001", () => {
    render(<StopExpansion stop={A900000001} />);
    expect(screen.getByText("TA")).toBeTruthy();
    expect(screen.getByText("DF")).toBeTruthy();
    expect(screen.getByTestId("stop-total").textContent).toBe("US$238.26");
  });

  it("the stop total is the stored total, not a client re-sum of the lines", () => {
    // Deliberately inconsistent lines vs. totalUsd to prove the component
    // trusts the stored figure rather than adding lines itself.
    const stop: TransactionListItem = { ...A900000001, total: 999.99 };
    render(<StopExpansion stop={stop} />);
    expect(screen.getByTestId("stop-total").textContent).toBe("US$999.99");
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
    const stop: TransactionListItem = { ...A900000001, qty: null, lines: [] };
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

  it("a CA stop shows litres, CAD headers and Pre-tax, HST, GST, PST, QST and Final separately", () => {
    render(<StopExpansion stop={CA_STOP} />);
    const head = document.querySelector(".stop-expansion-lines-head")!.textContent!;
    for (const label of ["Litres", "Retail CAD/L", "Billed CAD/L", "Pre-tax CAD", "HST CAD", "GST CAD", "PST CAD", "QST CAD", "Final CAD"]) {
      expect(head).toContain(label);
    }
    const line = document.querySelector(".stop-expansion-line")!.textContent!;
    expect(line).toContain("100.00");
    expect(line).toContain("CA$2.1522");
    expect(line).toContain("CA$190.46");
    expect(line).toContain("CA$24.76");
    expect(line).toContain("CA$215.22");
    expect(screen.getByTestId("stop-pretax").textContent).toBe("CA$190.46");
    expect(screen.getByTestId("stop-hst").textContent).toBe("CA$24.76");
    expect(screen.getByTestId("stop-total").textContent).toBe("CA$215.22");
  });

  it("a CA stop's Pre-tax total is an em dash when a line printed no Pre Tax AMT, not a sum that leaves it out", () => {
    const stop: TransactionListItem = {
      ...CA_STOP,
      lines: [...CA_STOP.lines!, { ...CA_STOP.lines![0]!, productCode: "S", preTaxAmount: null, hst: 0, amount: 104 }],
    };
    render(<StopExpansion stop={stop} />);
    expect(screen.getByTestId("stop-pretax").textContent).toBe("—");
  });

  it("a US stop keeps one Amount column and no tax columns, with USD in the headers", () => {
    render(<StopExpansion stop={A900000001} />);
    const head = document.querySelector(".stop-expansion-lines-head")!.textContent!;
    expect(head).toContain("Gallons");
    expect(head).toContain("Billed USD/gal");
    expect(head).toContain("Amount USD");
    expect(head).not.toContain("HST");
    expect(screen.queryByTestId("stop-hst")).toBeNull();
  });

  it("omits the Source row rather than a blank value while the invoice number hasn't loaded", () => {
    render(<StopExpansion stop={A900000001} />);
    expect(screen.queryByText("Source")).toBeNull();
  });
});
