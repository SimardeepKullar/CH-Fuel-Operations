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
const listInvoices = vi.fn();
const getOverview = vi.fn();

vi.mock("../../../lib/api", () => ({
  getHealth: (...args: unknown[]) => getHealth(...args),
  listInvoices: (...args: unknown[]) => listInvoices(...args),
  getOverview: (...args: unknown[]) => getOverview(...args),
}));

const { default: OverviewPage } = await import("./page");

function overviewResult(overrides: Partial<OverviewResult> = {}): OverviewResult {
  return {
    kpis: {
      period: "2026-09-03",
      invoiceId: "inv-1",
      total: { amountUsd: 50929.71, currency: "USD" },
      diesel: { gallons: 9000, amountUsd: 47000, currency: "USD" },
      def: { gallons: 120, amountUsd: 500, currency: "USD" },
      avgBilledUsdPerGal: 5.2395,
      discount: { totalUsd: 1200.5, avgUsdPerGal: 0.1334, currency: "USD" },
      otherCharges: { totalUsd: 1543.13, scaleUsd: 1000, expressUsd: 500, expressFeeUsd: 43.13, currency: "USD" },
      receiptCompliance: { confirmed: 55, total: 60 },
      anomaliesFlagged: 3,
    },
    trend: [{ period: "2026-09-03", invoiceId: "inv-1", avgBilledUsdPerGal: 5.2395 }],
    topSpendByDriver: [{ driverId: "driver-1", driverName: "JORDAN", totalUsd: 500, gallons: 90, avgBilledUsdPerGal: 5.5 }],
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
  listInvoices.mockReset();
  getOverview.mockReset();
  searchParams = new URLSearchParams();
});

describe("OverviewPage (T-41)", () => {
  it("makes exactly one API call — GET /overview, scoped to the shell's selected period", async () => {
    searchParams = new URLSearchParams({ period: "2026-09-03" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listInvoices.mockResolvedValue({ rows: [], page: 1, pageSize: 200, total: 0 });
    getOverview.mockResolvedValue(overviewResult());

    render(<OverviewPage />);

    await waitFor(() => expect(screen.getByTestId("kpi-avg-billed-value")).toBeTruthy());
    expect(getOverview).toHaveBeenCalledTimes(1);
    expect(getOverview).toHaveBeenCalledWith("2026-09-03");
  });

  it("average billed price is the headline figure and discount rides as its subline (A9.1)", async () => {
    searchParams = new URLSearchParams({ period: "2026-09-03" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listInvoices.mockResolvedValue({ rows: [], page: 1, pageSize: 200, total: 0 });
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
    listInvoices.mockResolvedValue({ rows: [], page: 1, pageSize: 200, total: 0 });
    getOverview.mockResolvedValue(
      overviewResult({
        kpis: {
          period: "2026-09-10",
          invoiceId: null,
          total: { amountUsd: 0, currency: "USD" },
          diesel: { gallons: 0, amountUsd: 0, currency: "USD" },
          def: { gallons: 0, amountUsd: 0, currency: "USD" },
          avgBilledUsdPerGal: null,
          discount: { totalUsd: 0, avgUsdPerGal: null, currency: "USD" },
          otherCharges: { totalUsd: 0, scaleUsd: 0, expressUsd: 0, expressFeeUsd: 0, currency: "USD" },
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
    listInvoices.mockResolvedValue({ rows: [], page: 1, pageSize: 200, total: 0 });

    render(<OverviewPage />);

    await waitFor(() => expect(screen.getByText("No invoice imported yet")).toBeTruthy());
    expect(getOverview).not.toHaveBeenCalled();
  });

  it("a failed fetch surfaces the error rather than an indefinite loading state", async () => {
    searchParams = new URLSearchParams({ period: "2026-09-03" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listInvoices.mockResolvedValue({ rows: [], page: 1, pageSize: 200, total: 0 });
    getOverview.mockRejectedValue(new Error("network down"));

    render(<OverviewPage />);

    await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());
  });
});
