// @vitest-environment jsdom
import { useState } from "react";
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

const { WeekProvider, useWeek } = await import("./useWeek");

function Probe() {
  const { week, setWeek, weeks, loading, invoices, reloadPeriods } = useWeek();
  return (
    <div>
      <span data-testid="week">{week ?? "none"}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="weeks">{weeks.map((w) => w.weekEnd).join(",")}</span>
      <span data-testid="invoices">{invoices.map((i) => i.invoiceNumber).join(",")}</span>
      <button onClick={() => setWeek("2026-09-02")}>pick older</button>
      <button onClick={() => void reloadPeriods()}>reload</button>
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

const PAIRED_WEEK: PeriodWeek = {
  weekEnd: "2026-09-09",
  invoices: [invoice({}), invoice({ id: "3", invoiceNumber: "999217", currency: "CAD", printedStart: "2026-08-01", datesDiffer: true })],
};
const OLDER_WEEK: PeriodWeek = {
  weekEnd: "2026-09-02",
  invoices: [invoice({ id: "2", invoiceNumber: "999104", printedStart: "2026-08-27", printedEnd: "2026-09-02", actualStart: "2026-08-27", actualEnd: "2026-09-02" })],
};

afterEach(() => {
  cleanup();
  replace.mockClear();
  getHealth.mockReset();
  listPeriods.mockReset();
  searchParams = new URLSearchParams();
});

function renderProbe() {
  return render(
    <WeekProvider>
      <Probe />
    </WeekProvider>,
  );
}

describe("WeekProvider / useWeek (T-64 step 64.1, over billing weeks)", () => {
  it("defaults to the newest week from GET /health, not import order, and exposes its invoices", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [OLDER_WEEK, PAIRED_WEEK] });

    renderProbe();
    await waitFor(() => expect(screen.getByTestId("week").textContent).toBe("2026-09-09"));
    expect(screen.getByTestId("invoices").textContent).toBe("999210,999217");
  });

  it("lists a week with only a CA invoice — the selector is no longer US-only", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-16", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({
      weeks: [{ weekEnd: "2026-09-16", invoices: [invoice({ id: "4", invoiceNumber: "999224", currency: "CAD" })] }, PAIRED_WEEK],
    });

    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("weeks").textContent).toBe("2026-09-16,2026-09-09");
    expect(screen.getByTestId("week").textContent).toBe("2026-09-16");
  });

  it("an explicit ?week= in the URL overrides the default", () => {
    searchParams = new URLSearchParams({ week: "2026-09-02" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });

    renderProbe();
    expect(screen.getByTestId("week").textContent).toBe("2026-09-02");
  });

  it("the old ?period= key is ignored", async () => {
    searchParams = new URLSearchParams({ period: "2026-09-02" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [PAIRED_WEEK] });

    renderProbe();
    await waitFor(() => expect(screen.getByTestId("week").textContent).toBe("2026-09-09"));
  });

  it("setWeek writes the choice into the URL as ?week= via router.replace", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [PAIRED_WEEK, OLDER_WEEK] });

    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    act(() => screen.getByText("pick older").click());

    expect(replace).toHaveBeenCalledWith("/transactions?week=2026-09-02");
  });

  it("is empty, not an error, when nothing is imported", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: null, openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });

    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("week").textContent).toBe("none");
  });

  it("navigation does not refetch /periods or /health: a screen mounting and unmounting under the provider reads the context", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [PAIRED_WEEK] });

    function Shell() {
      const [route, setRoute] = useState<"a" | "b">("a");
      return (
        <WeekProvider>
          <button onClick={() => setRoute(route === "a" ? "b" : "a")}>navigate</button>
          {route === "a" ? <Probe key="a" /> : <Probe key="b" />}
        </WeekProvider>
      );
    }
    render(<Shell />);
    await waitFor(() => expect(screen.getByTestId("week").textContent).toBe("2026-09-09"));
    act(() => screen.getByText("navigate").click());
    act(() => screen.getByText("navigate").click());

    expect(screen.getByTestId("week").textContent).toBe("2026-09-09");
    expect(listPeriods).toHaveBeenCalledTimes(1);
    expect(getHealth).toHaveBeenCalledTimes(1);
  });

  it("reloadPeriods re-reads /periods only, so a moved invoice shows up without a page reload", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValueOnce({ weeks: [PAIRED_WEEK] }).mockResolvedValueOnce({ weeks: [OLDER_WEEK, PAIRED_WEEK] });

    renderProbe();
    await waitFor(() => expect(screen.getByTestId("weeks").textContent).toBe("2026-09-09"));
    act(() => screen.getByText("reload").click());
    await waitFor(() => expect(screen.getByTestId("weeks").textContent).toBe("2026-09-02,2026-09-09"));
    expect(listPeriods).toHaveBeenCalledTimes(2);
    expect(getHealth).toHaveBeenCalledTimes(1);
  });

  it("useWeek outside a provider fails loudly", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/WeekProvider/);
    spy.mockRestore();
  });
});
