// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/transactions",
  useSearchParams: () => searchParams,
}));

const getHealth = vi.fn();
const listInvoices = vi.fn();
vi.mock("../lib/api", () => ({
  getHealth: (...args: unknown[]) => getHealth(...args),
  listInvoices: (...args: unknown[]) => listInvoices(...args),
}));

const { useInvoicePeriod } = await import("./useInvoicePeriod");

function Probe() {
  const { period, setPeriod, periods, loading, invoiceNumber } = useInvoicePeriod();
  return (
    <div>
      <span data-testid="period">{period ?? "none"}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="invoice-number">{invoiceNumber ?? "none"}</span>
      <ul>
        {periods.map((p) => (
          <li key={p.value}>{p.label}</li>
        ))}
      </ul>
      <button onClick={() => setPeriod("2026-08-27")}>pick older</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  replace.mockClear();
  getHealth.mockReset();
  listInvoices.mockReset();
  searchParams = new URLSearchParams();
});

describe("useInvoicePeriod (T-39 step 39.2)", () => {
  it("defaults to the newest invoice from GET /health, not import order", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listInvoices.mockResolvedValue({
      rows: [
        { id: "1", invoiceNumber: "999210", periodStart: "2026-09-03", periodEnd: "2026-09-09", currency: "USD", grandTotalUsd: 1, status: "imported", importedAt: "x" },
        { id: "2", invoiceNumber: "999104", periodStart: "2026-08-27", periodEnd: "2026-09-02", currency: "USD", grandTotalUsd: 1, status: "imported", importedAt: "y" },
      ],
      page: 1,
      pageSize: 200,
      total: 2,
    });

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("period").textContent).toBe("2026-09-03"));
    expect(screen.getByText("999210 · Sep 3 – 9, 2026")).toBeTruthy();
    expect(screen.getByText("999104 · Aug 27 – Sep 2, 2026")).toBeTruthy();
    expect(screen.getByTestId("invoice-number").textContent).toBe("999210");
  });

  it("excludes quarantined invoices from the picker list", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listInvoices.mockResolvedValue({
      rows: [
        { id: "1", invoiceNumber: "999210", periodStart: "2026-09-03", periodEnd: "2026-09-09", currency: "USD", grandTotalUsd: 1, status: "imported", importedAt: "x" },
        { id: "2", invoiceNumber: "999104", periodStart: "2026-08-27", periodEnd: "2026-09-02", currency: "USD", grandTotalUsd: 1, status: "quarantined", importedAt: "y" },
      ],
      page: 1,
      pageSize: 200,
      total: 2,
    });

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.queryByText(/999104/)).toBeNull();
  });

  it("excludes a CAD invoice from the picker list until T-63 pairs it into a billing week (T-61)", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listInvoices.mockResolvedValue({
      rows: [
        { id: "1", invoiceNumber: "999210", periodStart: "2026-09-03", periodEnd: "2026-09-09", currency: "USD", grandTotalUsd: 1, status: "imported", importedAt: "x" },
        { id: "2", invoiceNumber: "700001", periodStart: "2026-08-01", periodEnd: "2026-09-09", currency: "CAD", grandTotalUsd: 1, status: "imported", importedAt: "y" },
      ],
      page: 1,
      pageSize: 200,
      total: 2,
    });

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByText("999210 · Sep 3 – 9, 2026")).toBeTruthy();
    expect(screen.queryByText(/700001/)).toBeNull();
  });

  it("an explicit ?period= in the URL overrides the default", async () => {
    searchParams = new URLSearchParams({ period: "2026-08-27" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listInvoices.mockResolvedValue({ rows: [], page: 1, pageSize: 200, total: 0 });

    render(<Probe />);
    expect(screen.getByTestId("period").textContent).toBe("2026-08-27");
  });

  it("setPeriod writes the choice into the URL via router.replace", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listInvoices.mockResolvedValue({ rows: [], page: 1, pageSize: 200, total: 0 });

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    act(() => screen.getByText("pick older").click());

    expect(replace).toHaveBeenCalledWith("/transactions?period=2026-08-27");
  });
});
