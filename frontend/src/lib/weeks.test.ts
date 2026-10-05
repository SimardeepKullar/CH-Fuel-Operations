import { describe, expect, it } from "vitest";
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";
import {
  effectiveSide,
  formatCompactRange,
  formatDatesDifferNote,
  formatDay,
  formatDayYear,
  formatWeekEnding,
  invoiceOnSide,
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

  it("keeps the requested side when the week has it, falls to the other when it does not, and keeps the request for an unknown week", () => {
    expect(effectiveSide(paired, "CAD")).toBe("CAD");
    expect(effectiveSide(usOnly, "CAD")).toBe("USD");
    expect(effectiveSide(caOnly, "USD")).toBe("CAD");
    expect(effectiveSide(null, "USD")).toBe("USD");
    expect(effectiveSide({ weekEnd: "2026-09-23", invoices: [] }, "CAD")).toBe("CAD");
  });
});
