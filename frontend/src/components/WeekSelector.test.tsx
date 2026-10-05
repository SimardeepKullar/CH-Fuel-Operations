// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/transactions",
  useSearchParams: () => new URLSearchParams(),
}));

const getHealth = vi.fn();
const listPeriods = vi.fn();
vi.mock("../lib/api", () => ({
  getHealth: (...args: unknown[]) => getHealth(...args),
  listPeriods: (...args: unknown[]) => listPeriods(...args),
}));

const { WeekProvider } = await import("../hooks/useWeek");
const { default: WeekSelector } = await import("./WeekSelector");

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

const PAIRED: PeriodWeek = {
  weekEnd: "2026-09-09",
  invoices: [
    invoice({}),
    invoice({ id: "3", invoiceNumber: "999217", currency: "CAD", printedStart: "2026-08-01", actualStart: "2026-09-03", actualEnd: "2026-09-10", datesDiffer: true }),
  ],
};
const US_ONLY: PeriodWeek = { weekEnd: "2026-09-02", invoices: [invoice({ id: "2", invoiceNumber: "999104" })] };

afterEach(() => {
  cleanup();
  replace.mockClear();
  getHealth.mockReset();
  listPeriods.mockReset();
});

function renderSelector(weeks: PeriodWeek[]) {
  getHealth.mockResolvedValue({ latestInvoicePeriod: weeks[0]?.weekEnd ?? null, openAnomalyCount: 0 });
  listPeriods.mockResolvedValue({ weeks });
  return render(
    <WeekProvider>
      <WeekSelector />
    </WeekProvider>,
  );
}

describe("WeekSelector (T-64 step 64.1)", () => {
  it("lists weeks, not invoices — one option per week with both flags and numbers, ⚠ when dates differ", async () => {
    renderSelector([PAIRED, US_ONLY]);
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options[0]).toBe("Week ending Sep 9, 2026 · 🇺🇸 999210 · 🇨🇦 999217 ⚠");
    expect(options[1]).toBe("Week ending Sep 2, 2026 · 🇺🇸 999104 · 🇨🇦 —");
  });

  it("shows — for a missing US side too, and no ⚠ when the dates agree", async () => {
    renderSelector([{ weekEnd: "2026-09-16", invoices: [invoice({ id: "4", invoiceNumber: "999224", currency: "CAD" })] }]);
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    expect(screen.getByRole("option").textContent).toBe("Week ending Sep 16, 2026 · 🇺🇸 — · 🇨🇦 999224");
  });

  it("selects the newest week and writes a pick into ?week=", async () => {
    renderSelector([PAIRED, US_ONLY]);
    const select = (await screen.findByLabelText("Billing week")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("2026-09-09"));
    fireEvent.change(select, { target: { value: "2026-09-02" } });
    expect(replace).toHaveBeenCalledWith("/transactions?week=2026-09-02");
  });

  it("is disabled with a message when nothing is imported", async () => {
    renderSelector([]);
    await waitFor(() => expect(screen.getByText("No invoices imported")).toBeTruthy());
    expect((screen.getByLabelText("Billing week") as HTMLSelectElement).disabled).toBe(true);
  });
});
