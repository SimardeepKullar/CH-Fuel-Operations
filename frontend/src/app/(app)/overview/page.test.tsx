// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OverviewResult } from "@ch/core/actuals/overview";
import type { InvoiceListItem } from "@ch/core/api/routes/invoices";
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";

const replace = vi.fn();
const push = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => "/overview",
  useSearchParams: () => searchParams,
}));

const getHealth = vi.fn();
const listPeriods = vi.fn();
const getOverview = vi.fn();
const patchInvoiceFx = vi.fn();

vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ApiError: actual.ApiError,
    getHealth: (...args: unknown[]) => getHealth(...args),
    listPeriods: (...args: unknown[]) => listPeriods(...args),
    getOverview: (...args: unknown[]) => getOverview(...args),
    patchInvoiceFx: (...args: unknown[]) => patchInvoiceFx(...args),
  };
});

const { ApiError } = await import("../../../lib/api");

const { default: OverviewPageInner } = await import("./page");
const { WeekProvider } = await import("../../../hooks/useWeek");

function OverviewPage() {
  return (
    <WeekProvider>
      <OverviewPageInner />
    </WeekProvider>
  );
}

function usSide(): NonNullable<OverviewResult["us"]> {
  return {
    currency: "USD",
    qtyUnit: "gal",
    kpis: {
      week: "2026-09-03",
      invoiceId: "inv-1",
      total: { amount: 50929.71, currency: "USD" },
      tax: { beforeTax: 50929.71, tax: 0, withTax: 50929.71, hst: 0, gst: 0, pst: 0, qst: 0, currency: "USD" },
      diesel: { qty: 9000, amount: 47000, preTax: 47000, tax: 0, currency: "USD" },
      def: { qty: 120, amount: 500, preTax: 500, tax: 0, currency: "USD" },
      avgBilledPerUnit: 5.2395,
      avgBilledPreTaxPerUnit: 5.2395,
      discount: { total: 1200.5, avgPerUnit: 0.1334, currency: "USD" },
      otherCharges: { total: 1543.13, scale: 1000, express: 500, expressFee: 43.13, currency: "USD" },
      receiptCompliance: { confirmed: 55, total: 60 },
      anomaliesFlagged: 3,
    },
    trend: [{ week: "2026-09-03", invoiceId: "inv-1", avgBilledPerUnit: 5.2395 }],
    topSpendByDriver: [{ driverId: "driver-1", driverName: "JORDAN", total: 500, qty: 90, avgBilledPerUnit: 5.5 }],
    anomalyDigest: [
      { id: "anom-1", fuelStopId: "stop-1", rule: "sub_gallon", severity: "red", detail: {}, detectedAt: "2026-09-05T14:30:00.000Z" },
    ],
  };
}

function caSide(overrides: Partial<NonNullable<OverviewResult["ca"]>["kpis"]["tax"]> = {}): NonNullable<OverviewResult["ca"]> {
  const tax = { beforeTax: 41460.89, tax: 5376.44, withTax: 46837.33, hst: 5376.44, gst: 0, pst: 0, qst: 0, currency: "CAD" as const, ...overrides };
  return {
    currency: "CAD",
    qtyUnit: "L",
    kpis: {
      week: "2026-09-09",
      invoiceId: "inv-ca",
      total: { amount: tax.withTax, currency: "CAD" },
      tax,
      diesel: { qty: 21318.77, amount: 46559.28, preTax: 41202.86, tax: 5356.42, currency: "CAD" },
      def: { qty: 113.09, amount: 174.05, preTax: 154.03, tax: 20.02, currency: "CAD" },
      avgBilledPerUnit: 2.1522,
      avgBilledPreTaxPerUnit: 1.9046,
      discount: { total: 6759.96, avgPerUnit: 0.3171, currency: "CAD" },
      otherCharges: { total: 104, scale: 104, express: 0, expressFee: 0, currency: "CAD" },
      receiptCompliance: { confirmed: 0, total: 59 },
      anomaliesFlagged: 1,
    },
    trend: [],
    topSpendByDriver: [],
    anomalyDigest: [],
  };
}

function combinedPanel(overrides: Partial<NonNullable<OverviewResult["combined"]>> = {}): NonNullable<OverviewResult["combined"]> {
  return {
    currency: "USD",
    qtyUnit: "gal",
    partial: false,
    missingSide: null,
    ratePending: false,
    spend: { beforeTax: 84000.12, tax: 3920.97, withTax: 87000.5 },
    diesel: { qty: 14631.2, beforeTax: 70000.1, tax: 3906.12, withTax: 73906.22 },
    def: { qty: 150, beforeTax: 600.5, tax: 14.6, withTax: 615.1 },
    discount: 6130.78,
    avgBilledPreTaxPerUnit: 4.7843,
    avgBilledPerUnit: 5.0511,
    ...overrides,
  };
}

/** A US-only week unless overridden: the shape the first tests were written against. */
function overviewResult(overrides: Partial<OverviewResult> = {}): OverviewResult {
  return {
    us: usSide(),
    ca: null,
    combined: combinedPanel({ partial: true, missingSide: "CAD", spend: { beforeTax: 50929.71, tax: 0, withTax: 50929.71 } }),
    fx: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  replace.mockClear();
  push.mockClear();
  getHealth.mockReset();
  listPeriods.mockReset();
  getOverview.mockReset();
  patchInvoiceFx.mockReset();
  searchParams = new URLSearchParams();
});

describe("OverviewPage (T-41)", () => {
  it("makes exactly one API call — GET /overview, scoped to the shell's selected period", async () => {
    searchParams = new URLSearchParams({ week: "2026-09-03" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    getOverview.mockResolvedValue(overviewResult());

    render(<OverviewPage />);

    await waitFor(() => expect(screen.getByTestId("kpi-avg-billed-value")).toBeTruthy());
    expect(getOverview).toHaveBeenCalledTimes(1);
    expect(getOverview).toHaveBeenCalledWith("2026-09-03", {});
  });

  it("average billed price is the headline figure and discount rides as its subline (A9.1)", async () => {
    searchParams = new URLSearchParams({ week: "2026-09-03" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    getOverview.mockResolvedValue(overviewResult());

    render(<OverviewPage />);

    await waitFor(() => expect(screen.getByTestId("kpi-avg-billed-value")).toBeTruthy());
    expect(screen.getByTestId("kpi-avg-billed-value").textContent).toBe("US$5.2395");
    expect(screen.getByTestId("kpi-avg-billed-sub").textContent).toBe("discount captured US$1200.50");
    const dominantSize = parseFloat(getComputedStyle(screen.getByTestId("kpi-avg-billed-value")).fontSize);
    const totalSize = parseFloat(getComputedStyle(screen.getByTestId("kpi-total-value")).fontSize);
    expect(dominantSize).toBeGreaterThan(totalSize);
  });

  it("shows the designed empty state for a period with no invoice, not an indefinite spinner", async () => {
    searchParams = new URLSearchParams({ week: "2026-09-10" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    getOverview.mockResolvedValue({ us: null, ca: null, combined: null, fx: null });

    render(<OverviewPage />);

    await waitFor(() => expect(screen.getByText("No invoice imported yet")).toBeTruthy());
    expect(getOverview).toHaveBeenCalledTimes(1);
  });

  it("no invoice has ever imported (period never resolves): shows the empty state without ever calling GET /overview", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: null, openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });

    render(<OverviewPage />);

    await waitFor(() => expect(screen.getByText("No invoice imported yet")).toBeTruthy());
    expect(getOverview).not.toHaveBeenCalled();
  });

  it("a failed fetch surfaces the error rather than an indefinite loading state", async () => {
    searchParams = new URLSearchParams({ week: "2026-09-03" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    getOverview.mockRejectedValue(new Error("network down"));

    render(<OverviewPage />);

    await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());
  });
});

const US_INVOICE: PeriodInvoice = {
  id: "inv-us",
  invoiceNumber: "999210",
  currency: "USD",
  printedStart: "2026-09-03",
  printedEnd: "2026-09-09",
  actualStart: "2026-09-03",
  actualEnd: "2026-09-09",
  datesDiffer: false,
  fx: null,
};

function caInvoice(fx: PeriodInvoice["fx"] = null): PeriodInvoice {
  return {
    id: "inv-ca",
    invoiceNumber: "999217",
    currency: "CAD",
    printedStart: "2026-08-01",
    printedEnd: "2026-09-09",
    actualStart: "2026-09-03",
    actualEnd: "2026-09-10",
    datesDiffer: true,
    fx,
  };
}

const week = (invoices: PeriodInvoice[]): PeriodWeek => ({ weekEnd: "2026-09-09", invoices });

/** What `PATCH /invoices/{id}` returns — only `fx` is read from it. */
function patched(fx: InvoiceListItem["fx"]): InvoiceListItem {
  return {
    id: "inv-ca",
    invoiceNumber: "999217",
    periodStart: "2026-08-01",
    periodEnd: "2026-09-09",
    billingWeekEnd: "2026-09-09",
    actualStart: "2026-09-03",
    actualEnd: "2026-09-10",
    datesDiffer: true,
    currency: "CAD",
    grandTotal: 3839.54,
    status: "imported",
    importedAt: "2026-09-11T12:00:00.000Z",
    fx,
  };
}

const ENTERED = { rate: 1.3712, enteredAt: "2026-10-06T16:00:00.000Z" };

function rateInput(): HTMLInputElement {
  return screen.getByLabelText("Exchange rate (CAD per USD)") as HTMLInputElement;
}

function enter(value: string) {
  fireEvent.change(rateInput(), { target: { value } });
  fireEvent.keyDown(rateInput(), { key: "Enter" });
}

describe("OverviewPage — the CA invoice's exchange rate (T-66 step 66.2)", () => {
  function renderWeek(invoices: PeriodInvoice[], after: PeriodInvoice[] = invoices) {
    searchParams = new URLSearchParams({ week: "2026-09-09" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValueOnce({ weeks: [week(invoices)] }).mockResolvedValue({ weeks: [week(after)] });
    getOverview.mockResolvedValue(overviewResult());
    render(<OverviewPage />);
  }

  it("a week with a CA invoice and no rate shows the field and 'rate pending'", async () => {
    renderWeek([US_INVOICE, caInvoice()]);

    await waitFor(() => expect(screen.getByTestId("fx-rate")).toBeTruthy());
    expect(screen.getByText("Exchange rate (CAD per USD)")).toBeTruthy();
    expect(rateInput().value).toBe("");
    expect(screen.getByTestId("fx-rate-status").textContent).toContain("rate pending");
  });

  it("entering 1.3712 PATCHes the CA invoice, then shows the rate and when it was entered without a reload", async () => {
    renderWeek([US_INVOICE, caInvoice()], [US_INVOICE, caInvoice(ENTERED)]);
    patchInvoiceFx.mockResolvedValue(patched(ENTERED));
    await waitFor(() => expect(screen.getByTestId("fx-rate")).toBeTruthy());

    enter("1.3712");

    await waitFor(() => expect(patchInvoiceFx).toHaveBeenCalledWith("inv-ca", 1.3712));
    await waitFor(() => expect(screen.getByTestId("fx-rate-status").textContent).toContain("1.3712 CAD per USD"));
    expect(screen.getByTestId("fx-rate-status").textContent).toContain("entered Oct 6, 2026");
    expect(rateInput().value).toBe("1.3712");
    // The shell re-read its weeks, so every screen sees the rate; the Overview re-read too, since the combined figures depend on it.
    await waitFor(() => expect(listPeriods).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getOverview).toHaveBeenCalledTimes(2));
  });

  it("an entered rate shows on arrival, and editing it PATCHes again; leaving the box saves too", async () => {
    renderWeek([US_INVOICE, caInvoice(ENTERED)]);
    const corrected = { rate: 1.38, enteredAt: "2026-10-07T16:00:00.000Z" };
    patchInvoiceFx.mockResolvedValue(patched(corrected));
    await waitFor(() => expect(rateInput().value).toBe("1.3712"));
    expect(screen.getByTestId("fx-rate-status").textContent).toContain("entered Oct 6, 2026");

    fireEvent.change(rateInput(), { target: { value: "1.38" } });
    fireEvent.blur(rateInput());

    await waitFor(() => expect(patchInvoiceFx).toHaveBeenCalledWith("inv-ca", 1.38));
    await waitFor(() => expect(screen.getByTestId("fx-rate-status").textContent).toContain("entered Oct 7, 2026"));
  });

  it("leaving the box unchanged sends nothing", async () => {
    renderWeek([US_INVOICE, caInvoice(ENTERED)]);
    await waitFor(() => expect(rateInput().value).toBe("1.3712"));

    fireEvent.blur(rateInput());
    enter("1.3712");

    expect(patchInvoiceFx).not.toHaveBeenCalled();
  });

  it("emptying the box clears the rate back to pending", async () => {
    renderWeek([US_INVOICE, caInvoice(ENTERED)]);
    patchInvoiceFx.mockResolvedValue(patched(null));
    await waitFor(() => expect(rateInput().value).toBe("1.3712"));

    enter("");

    await waitFor(() => expect(patchInvoiceFx).toHaveBeenCalledWith("inv-ca", null));
    await waitFor(() => expect(screen.getByTestId("fx-rate-status").textContent).toContain("rate pending"));
  });

  it("a 400 shows its reason beside the field and keeps what was typed", async () => {
    renderWeek([US_INVOICE, caInvoice()]);
    const reason = "the exchange rate must be between 0.5 and 3.0 CAD per USD";
    patchInvoiceFx.mockRejectedValue(new ApiError({ title: "Bad Request", status: 400, detail: reason }));
    await waitFor(() => expect(screen.getByTestId("fx-rate")).toBeTruthy());

    enter("13.712");

    await waitFor(() => expect(screen.getByTestId("fx-rate-error").textContent).toBe(reason));
    expect(rateInput().value).toBe("13.712");
    expect(screen.getByTestId("fx-rate-status").textContent).toContain("rate pending");
  });

  it("text that is not a number is refused in place, with no PATCH", async () => {
    renderWeek([US_INVOICE, caInvoice()]);
    await waitFor(() => expect(screen.getByTestId("fx-rate")).toBeTruthy());

    enter("1,37");

    expect(screen.getByTestId("fx-rate-error").textContent).toContain("as a number");
    expect(patchInvoiceFx).not.toHaveBeenCalled();
  });

  it("a US-only week shows no rate field", async () => {
    renderWeek([US_INVOICE]);

    await waitFor(() => expect(screen.getByTestId("kpi-avg-billed-value")).toBeTruthy());
    expect(screen.queryByTestId("fx-rate")).toBeNull();
    expect(screen.queryByText("Exchange rate (CAD per USD)")).toBeNull();
  });

  it("a CA-only week still offers the field, beside the US panel's 'Not imported'", async () => {
    searchParams = new URLSearchParams({ week: "2026-09-09" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [week([caInvoice()])] });
    getOverview.mockResolvedValue(
      overviewResult({ us: null, ca: caSide(), combined: combinedPanel({ partial: true, missingSide: "USD", ratePending: true }) }),
    );

    render(<OverviewPage />);

    await waitFor(() => expect(screen.getByText("US — Not imported")).toBeTruthy());
    expect(screen.getByTestId("fx-rate-status").textContent).toContain("rate pending");
  });
});

describe("OverviewPage — US, CA and combined panels (T-65 step 65.2)", () => {
  function renderBoth(result: OverviewResult, invoices: PeriodInvoice[] = [US_INVOICE, caInvoice(ENTERED)]) {
    searchParams = new URLSearchParams({ week: "2026-09-09" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [week(invoices)] });
    getOverview.mockResolvedValue(result);
    render(<OverviewPage />);
  }
  const both = (combined: Partial<NonNullable<OverviewResult["combined"]>> = {}, ca = caSide()): OverviewResult => ({
    us: usSide(),
    ca,
    combined: combinedPanel(combined),
    fx: ENTERED,
  });
  const text = (id: string) => screen.getByTestId(id).textContent;

  it("US on the left, CA on the right, combined below", async () => {
    renderBoth(both());
    await waitFor(() => expect(screen.getByTestId("combined-panel")).toBeTruthy());

    const us = screen.getByTestId("us-panel");
    const ca = screen.getByTestId("ca-panel");
    const combined = screen.getByTestId("combined-panel");
    expect(us.compareDocumentPosition(ca) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ca.compareDocumentPosition(combined) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(us.parentElement).toBe(ca.parentElement);
    expect(combined.parentElement).not.toBe(us.parentElement);
  });

  it("the CA panel shows before tax, tax and with tax, and both per-litre rates", async () => {
    renderBoth(both());
    await waitFor(() => expect(screen.getByTestId("ca-panel")).toBeTruthy());

    expect(text("ca-spend-before")).toBe("CA$41460.89");
    expect(text("ca-spend-tax")).toBe("CA$5376.44");
    expect(text("ca-spend-with")).toBe("CA$46837.33");
    expect(text("ca-diesel-before")).toBe("CA$41202.86");
    expect(text("ca-diesel-with")).toBe("CA$46559.28");
    expect(text("ca-def-tax")).toBe("CA$20.02");
    expect(text("ca-discount")).toBe("CA$6759.96");
    expect(text("ca-rate-before")).toBe("CA$1.9046");
    expect(text("ca-rate-with")).toBe("CA$2.1522");
    expect(screen.getByTestId("ca-panel").textContent).toContain("CAD/L");
  });

  it("labels the CA tax column HST when HST is the only tax, Sales tax otherwise", async () => {
    renderBoth(both());
    await waitFor(() => expect(screen.getByTestId("ca-tax-label")).toBeTruthy());
    expect(text("ca-tax-label")).toBe("HST");
    cleanup();

    renderBoth(both({}, caSide({ hst: 0, gst: 2688.22, qst: 2688.22 })));
    await waitFor(() => expect(screen.getByTestId("ca-tax-label")).toBeTruthy());
    expect(text("ca-tax-label")).toBe("Sales tax");
  });

  it("the US panel shows one value per figure — no tax split", async () => {
    renderBoth(both());
    await waitFor(() => expect(screen.getByTestId("us-panel")).toBeTruthy());
    expect(text("kpi-total-value")).toBe("US$50929.71");
    expect(screen.getByTestId("us-panel").textContent).not.toMatch(/before tax|with tax/i);
  });

  it("the combined panel says 'before HST', never 'pre-tax', with the rate and its date beside the figures", async () => {
    renderBoth(both());
    await waitFor(() => expect(screen.getByTestId("combined-panel")).toBeTruthy());

    const panel = screen.getByTestId("combined-panel");
    expect(panel.textContent).toContain("Before HST");
    expect(panel.textContent?.toLowerCase()).not.toContain("pre-tax");
    expect(text("combined-spend-before")).toBe("US$84000.12");
    expect(text("combined-spend-tax")).toBe("US$3920.97");
    expect(text("combined-spend-with")).toBe("US$87000.50");
    expect(text("combined-rate-with")).toBe("US$5.0511");
    expect(text("combined-currency")).toBe("USD · per gal");
    expect(panel.contains(screen.getByTestId("fx-rate"))).toBe(true);
    expect(text("fx-rate-status")).toContain("1.3712 CAD per USD");
    expect(text("fx-rate-status")).toContain("entered Oct 6, 2026");
    expect(screen.queryByTestId("combined-partial")).toBeNull();
    expect(screen.queryByTestId("combined-pending")).toBeNull();
  });

  it("a US-only week: the CA panel is 'Not imported' and the combined panel is 'Partial — CA invoice not imported'", async () => {
    renderBoth(overviewResult(), [US_INVOICE]);
    await waitFor(() => expect(screen.getByTestId("combined-panel")).toBeTruthy());

    expect(screen.getByTestId("ca-not-imported").textContent).toContain("CA — Not imported");
    expect(text("combined-partial")).toBe("Partial — CA invoice not imported");
    expect(screen.queryByTestId("fx-rate")).toBeNull();
    expect(text("combined-spend-with")).toBe("US$50929.71");
  });

  it("a CA-only week says 'Partial — US invoice not imported'", async () => {
    renderBoth({ us: null, ca: caSide(), combined: combinedPanel({ partial: true, missingSide: "USD" }), fx: ENTERED }, [
      caInvoice(ENTERED),
    ]);
    await waitFor(() => expect(screen.getByTestId("combined-panel")).toBeTruthy());
    expect(text("combined-partial")).toBe("Partial — US invoice not imported");
    expect(screen.getByTestId("us-not-imported")).toBeTruthy();
  });

  it("with no rate every converted figure reads 'rate pending' — never a number — and the rate field is right there", async () => {
    const pending = {
      ratePending: true,
      spend: { beforeTax: null, tax: null, withTax: null },
      diesel: { qty: 14631.2, beforeTax: null, tax: null, withTax: null },
      def: { qty: 150, beforeTax: null, tax: null, withTax: null },
      discount: null,
      avgBilledPreTaxPerUnit: null,
      avgBilledPerUnit: null,
    };
    renderBoth({ ...both(pending), fx: null }, [US_INVOICE, caInvoice()]);
    await waitFor(() => expect(screen.getByTestId("combined-panel")).toBeTruthy());

    for (const id of [
      "combined-spend-before",
      "combined-spend-tax",
      "combined-spend-with",
      "combined-diesel-before",
      "combined-diesel-with",
      "combined-def-tax",
      "combined-discount",
      "combined-rate-before",
      "combined-rate-with",
    ]) {
      expect(text(id), id).toBe("rate pending");
    }
    expect(text("combined-pending")).toContain("rate pending");
    expect(screen.getByTestId("combined-panel").contains(screen.getByTestId("fx-rate"))).toBe(true);
    // The sides themselves are unaffected.
    expect(text("ca-spend-with")).toBe("CA$46837.33");
    expect(text("kpi-total-value")).toBe("US$50929.71");
  });

  it("a footnote gives each datesDiffer invoice's actual range", async () => {
    renderBoth(both());
    await waitFor(() => expect(screen.getByTestId("combined-footnote")).toBeTruthy());
    expect(screen.getAllByTestId("combined-footnote")).toHaveLength(1);
    expect(text("combined-footnote")).toBe("999217: Printed Aug 1 – Sep 9; transactions Sep 3 – Sep 10");
  });

  it("both invoices are in view: the ids published to the strip are both", async () => {
    searchParams = new URLSearchParams({ week: "2026-09-09" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [week([US_INVOICE, caInvoice(ENTERED)])] });
    getOverview.mockResolvedValue(both());
    const { useWeek } = await import("../../../hooks/useWeek");
    function Probe() {
      return <span data-testid="in-view-ids">{JSON.stringify(useWeek().inViewIds)}</span>;
    }
    render(
      <WeekProvider>
        <OverviewPageInner />
        <Probe />
      </WeekProvider>,
    );
    await waitFor(() => expect(text("in-view-ids")).toBe('["inv-us","inv-ca"]'));
  });

  it("the toggle asks the API for that unit and currency, and never converts a side's money", async () => {
    renderBoth(both());
    await waitFor(() => expect(screen.getByTestId("combined-panel")).toBeTruthy());
    expect(getOverview).toHaveBeenLastCalledWith("2026-09-09", {});

    getOverview.mockResolvedValue(both({ currency: "CAD", qtyUnit: "L" }));
    fireEvent.click(screen.getByRole("button", { name: "CAD/L" }));
    await waitFor(() => expect(getOverview).toHaveBeenLastCalledWith("2026-09-09", { units: "metric", convertTo: "CAD" }));
    await waitFor(() => expect(text("combined-currency")).toBe("CAD · per L"));

    fireEvent.click(screen.getByRole("button", { name: "USD/gal" }));
    await waitFor(() => expect(getOverview).toHaveBeenLastCalledWith("2026-09-09", { units: "imperial", convertTo: "USD" }));
  });

  it("a CA side read per gallon is labelled CAD/gal, with the same money", async () => {
    const litres = caSide();
    renderBoth(
      both({}, { ...litres, qtyUnit: "gal", kpis: { ...litres.kpis, avgBilledPerUnit: 8.147, avgBilledPreTaxPerUnit: 7.2097 } }),
    );
    await waitFor(() => expect(screen.getByTestId("ca-panel")).toBeTruthy());
    expect(screen.getByTestId("ca-panel").textContent).toContain("CAD/gal");
    expect(text("ca-rate-with")).toBe("CA$8.1470");
    expect(text("ca-spend-with")).toBe("CA$46837.33");
  });
});
