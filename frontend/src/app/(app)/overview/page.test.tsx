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

function overviewResult(overrides: Partial<OverviewResult> = {}): OverviewResult {
  return {
    currency: "USD",
    qtyUnit: "gal",
    kpis: {
      week: "2026-09-03",
      invoiceId: "inv-1",
      total: { amount: 50929.71, currency: "USD" },
      diesel: { qty: 9000, amount: 47000, currency: "USD" },
      def: { qty: 120, amount: 500, currency: "USD" },
      avgBilledPerUnit: 5.2395,
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
    expect(getOverview).toHaveBeenCalledWith("2026-09-03");
  });

  it("average billed price is the headline figure and discount rides as its subline (A9.1)", async () => {
    searchParams = new URLSearchParams({ week: "2026-09-03" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    getOverview.mockResolvedValue(overviewResult());

    render(<OverviewPage />);

    await waitFor(() => expect(screen.getByTestId("kpi-avg-billed-value")).toBeTruthy());
    expect(screen.getByTestId("kpi-avg-billed-value").textContent).toBe("$5.2395");
    expect(screen.getByTestId("kpi-avg-billed-sub").textContent).toBe("discount captured $1200.50");
    const dominantSize = parseFloat(getComputedStyle(screen.getByTestId("kpi-avg-billed-value")).fontSize);
    const totalSize = parseFloat(getComputedStyle(screen.getByTestId("kpi-total-value")).fontSize);
    expect(dominantSize).toBeGreaterThan(totalSize);
  });

  it("shows the designed empty state for a period with no invoice, not an indefinite spinner", async () => {
    searchParams = new URLSearchParams({ week: "2026-09-10" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    getOverview.mockResolvedValue(
      overviewResult({
        kpis: {
          week: "2026-09-10",
          invoiceId: null,
          total: { amount: 0, currency: "USD" },
          diesel: { qty: 0, amount: 0, currency: "USD" },
          def: { qty: 0, amount: 0, currency: "USD" },
          avgBilledPerUnit: null,
          discount: { total: 0, avgPerUnit: null, currency: "USD" },
          otherCharges: { total: 0, scale: 0, express: 0, expressFee: 0, currency: "USD" },
          receiptCompliance: { confirmed: 0, total: 0 },
          anomaliesFlagged: 0,
        },
        trend: [],
        topSpendByDriver: [],
        anomalyDigest: [],
      }),
    );

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
    // The shell re-read its weeks, so every screen sees the rate; the Overview's own figures were not refetched.
    await waitFor(() => expect(listPeriods).toHaveBeenCalledTimes(2));
    expect(getOverview).toHaveBeenCalledTimes(1);
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

  it("a CA-only week still offers the field, beside a note that the US figures are absent", async () => {
    searchParams = new URLSearchParams({ week: "2026-09-09" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [week([caInvoice()])] });
    getOverview.mockResolvedValue(overviewResult({ kpis: { ...overviewResult().kpis, invoiceId: null } }));

    render(<OverviewPage />);

    await waitFor(() => expect(screen.getByText("No US invoice in this week")).toBeTruthy());
    expect(screen.getByTestId("fx-rate-status").textContent).toContain("rate pending");
  });
});
