import { describe, expect, it } from "vitest";
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";
import {
  formatCompactRange,
  formatDatesDifferNote,
  formatDay,
  formatDayYear,
  formatWeekEnding,
  invoiceOnSide,
  invoiceViewHref,
  resolveInvoiceSelection,
  selectionInvoiceIds,
} from "./weeks";

function invoice(currency: "USD" | "CAD"): PeriodInvoice {
  return {
    id: currency,
    invoiceNumber: currency === "USD" ? "999210" : "999217",
    currency,
    printedStart: "2026-08-01",
    printedEnd: "2026-09-09",
    actualStart: "2026-09-03",
    actualEnd: "2026-09-10",
    datesDiffer: true,
  };
}

describe("week labels", () => {
  it("formats days without a time zone shifting them", () => {
    expect(formatDay("2026-09-03")).toBe("Sep 3");
    expect(formatDayYear("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatWeekEnding("2026-09-09")).toBe("Week ending Sep 9, 2026");
  });

  it("compacts a range within a month and spells out one across months or years", () => {
    expect(formatCompactRange("2026-09-03", "2026-09-09")).toBe("Sep 3–9");
    expect(formatCompactRange("2026-08-30", "2026-09-05")).toBe("Aug 30–Sep 5");
    expect(formatCompactRange("2025-12-28", "2026-01-03")).toBe("Dec 28–Jan 3");
  });

  it("spells the dates-differ note exactly as the ticket does", () => {
    expect(formatDatesDifferNote(invoice("CAD"))).toBe("Printed Aug 1 – Sep 9; transactions Sep 3 – Sep 10");
  });

  it("falls back to the printed range for an invoice with no transactions", () => {
    expect(formatDatesDifferNote({ ...invoice("CAD"), actualStart: null, actualEnd: null })).toBe(
      "Printed Aug 1 – Sep 9; transactions Aug 1 – Sep 9",
    );
  });
});

describe("side lookups", () => {
  const paired: PeriodWeek = { weekEnd: "2026-09-09", invoices: [invoice("USD"), invoice("CAD")] };
  const usOnly: PeriodWeek = { weekEnd: "2026-09-02", invoices: [invoice("USD")] };
  const caOnly: PeriodWeek = { weekEnd: "2026-09-16", invoices: [invoice("CAD")] };

  it("finds the invoice on a side, or null", () => {
    expect(invoiceOnSide(paired, "CAD")?.invoiceNumber).toBe("999217");
    expect(invoiceOnSide(usOnly, "CAD")).toBeNull();
    expect(invoiceOnSide(null, "USD")).toBeNull();
  });

  it("resolves ?invoice= to one invoice, all of them, or the week's first by default", () => {
    expect(resolveInvoiceSelection(paired, "CAD")).toMatchObject({ kind: "one", invoice: { invoiceNumber: "999217" } });
    expect(resolveInvoiceSelection(paired, null)).toMatchObject({ kind: "one", invoice: { invoiceNumber: "999210" } });
    expect(resolveInvoiceSelection(caOnly, null)).toMatchObject({ kind: "one", invoice: { invoiceNumber: "999217" } });
    // An id from another week (the selector moved) falls back rather than showing nothing.
    expect(resolveInvoiceSelection(usOnly, "CAD")).toMatchObject({ kind: "one", invoice: { invoiceNumber: "999210" } });
    expect(selectionInvoiceIds(resolveInvoiceSelection(paired, "all"))).toEqual(["USD", "CAD"]);
    expect(resolveInvoiceSelection(null, "all")).toEqual({ kind: "none" });
    expect(selectionInvoiceIds({ kind: "none" })).toEqual([]);
  });

  it("builds a chip's link onto Transactions, keeping the page's own params only when already there", () => {
    const params = new URLSearchParams({ q: "dallas", invoice: "x" });
    expect(invoiceViewHref("/transactions", params, "2026-09-09", "all")).toBe("/transactions?q=dallas&invoice=all&week=2026-09-09");
    expect(invoiceViewHref("/overview", params, "2026-09-09", "CAD")).toBe("/transactions?week=2026-09-09&invoice=CAD");
  });
});
