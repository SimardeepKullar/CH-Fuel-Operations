// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OverviewResult } from "@ch/core/actuals/overview";

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

vi.mock("../../../lib/api", () => ({
  getHealth: (...args: unknown[]) => getHealth(...args),
  listPeriods: (...args: unknown[]) => listPeriods(...args),
  getOverview: (...args: unknown[]) => getOverview(...args),
}));

const { default: OverviewPage } = await import("./page");

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
  searchParams = new URLSearchParams();
});

describe("OverviewPage (T-41)", () => {
  it("makes exactly one API call — GET /overview, scoped to the shell's selected period", async () => {
    searchParams = new URLSearchParams({ period: "2026-09-03" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    getOverview.mockResolvedValue(overviewResult());

    render(<OverviewPage />);

    await waitFor(() => expect(screen.getByTestId("kpi-avg-billed-value")).toBeTruthy());
    expect(getOverview).toHaveBeenCalledTimes(1);
    expect(getOverview).toHaveBeenCalledWith("2026-09-03");
  });

  it("average billed price is the headline figure and discount rides as its subline (A9.1)", async () => {
    searchParams = new URLSearchParams({ period: "2026-09-03" });
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
    searchParams = new URLSearchParams({ period: "2026-09-10" });
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
    searchParams = new URLSearchParams({ period: "2026-09-03" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    getOverview.mockRejectedValue(new Error("network down"));

    render(<OverviewPage />);

    await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());
  });
});
