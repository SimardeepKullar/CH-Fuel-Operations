// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";

const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/transactions",
  useSearchParams: () => searchParams,
}));

const getHealth = vi.fn();
const listPeriods = vi.fn();
vi.mock("../lib/api", () => ({
  getHealth: (...args: unknown[]) => getHealth(...args),
  listPeriods: (...args: unknown[]) => listPeriods(...args),
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
      <button onClick={() => setPeriod("2026-09-02")}>pick older</button>
    </div>
  );
}

function invoice(overrides: Partial<PeriodInvoice>): PeriodInvoice {
  return {
    id: "1",
    invoiceNumber: "999210",
    currency: "USD",
    printedStart: "2026-09-03",
    printedEnd: "2026-09-09",
    actualStart: "2026-09-03",
    actualEnd: "2026-09-09",
    datesDiffer: false,
    ...overrides,
  };
}

const US_WEEK: PeriodWeek = { weekEnd: "2026-09-09", invoices: [invoice({})] };
const OLDER_US_WEEK: PeriodWeek = {
  weekEnd: "2026-09-02",
  invoices: [invoice({ id: "2", invoiceNumber: "999104", printedStart: "2026-08-27", printedEnd: "2026-09-02" })],
};

afterEach(() => {
  cleanup();
  replace.mockClear();
  getHealth.mockReset();
  listPeriods.mockReset();
  searchParams = new URLSearchParams();
});

describe("useInvoicePeriod (T-39 step 39.2, over billing weeks since T-63)", () => {
  it("defaults to the newest week from GET /health, not import order, and lists each week by its US invoice", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [US_WEEK, OLDER_US_WEEK] });

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("period").textContent).toBe("2026-09-09"));
    expect(screen.getByText("999210 · Sep 3 – 9, 2026")).toBeTruthy();
    expect(screen.getByText("999104 · Aug 27 – Sep 2, 2026")).toBeTruthy();
    expect(screen.getByTestId("invoice-number").textContent).toBe("999210");
  });

  it("offers the US invoice of a paired week, not the CA one, and the value is the week's end", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({
      weeks: [
        {
          weekEnd: "2026-09-09",
          invoices: [invoice({}), invoice({ id: "3", invoiceNumber: "999217", currency: "CAD", printedStart: "2026-08-01", datesDiffer: true })],
        },
      ],
    });

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByText("999210 · Sep 3 – 9, 2026")).toBeTruthy();
    expect(screen.queryByText(/999217/)).toBeNull();
    expect(screen.getByTestId("period").textContent).toBe("2026-09-09");
  });

  it("leaves a CA-only week out of the list until T-64 gives the screens a CA side", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-16", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({
      weeks: [{ weekEnd: "2026-09-16", invoices: [invoice({ id: "4", invoiceNumber: "999224", currency: "CAD" })] }, US_WEEK],
    });

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.queryByText(/999224/)).toBeNull();
    // The newest week has no US invoice, so the default falls back to the newest one that does.
    expect(screen.getByTestId("period").textContent).toBe("2026-09-09");
  });

  it("an explicit ?period= in the URL overrides the default", async () => {
    searchParams = new URLSearchParams({ period: "2026-09-02" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });

    render(<Probe />);
    expect(screen.getByTestId("period").textContent).toBe("2026-09-02");
  });

  it("setPeriod writes the choice into the URL via router.replace", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [US_WEEK, OLDER_US_WEEK] });

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    act(() => screen.getByText("pick older").click());

    expect(replace).toHaveBeenCalledWith("/transactions?period=2026-09-02");
  });

  it("is empty, not an error, when nothing is imported", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: null, openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("period").textContent).toBe("none");
  });
});
