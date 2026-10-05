// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
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
const { useCurrencySide } = await import("../hooks/useCurrencySide");
const { default: CurrencySideSwitch } = await import("./CurrencySideSwitch");

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

const PAIRED: PeriodWeek = { weekEnd: "2026-09-09", invoices: [invoice({}), invoice({ id: "2", invoiceNumber: "999217", currency: "CAD" })] };
const US_ONLY: PeriodWeek = { weekEnd: "2026-09-09", invoices: [invoice({})] };

afterEach(() => {
  cleanup();
  getHealth.mockReset();
  listPeriods.mockReset();
});

/** A screen mounting the switch the way Transactions does. */
function Screen() {
  const { side, setSide } = useCurrencySide();
  return (
    <div>
      <span data-testid="side">{side}</span>
      <CurrencySideSwitch side={side} onChange={setSide} />
    </div>
  );
}

function setup(week: PeriodWeek) {
  getHealth.mockResolvedValue({ latestInvoicePeriod: week.weekEnd, openAnomalyCount: 0 });
  listPeriods.mockResolvedValue({ weeks: [week] });
}

describe("CurrencySideSwitch (T-64 step 64.2)", () => {
  it("defaults to US and switches to CA on a click", async () => {
    setup(PAIRED);
    render(
      <WeekProvider>
        <Screen />
      </WeekProvider>,
    );
    await waitFor(() => expect((screen.getByRole("button", { name: /CA/ }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("side").textContent).toBe("USD");
    expect(screen.getByRole("button", { name: /US/ }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /CA/ }));
    expect(screen.getByTestId("side").textContent).toBe("CAD");
    expect(screen.getByRole("button", { name: /CA/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("defaults to US on every mount, including after a CA visit — nothing is remembered", async () => {
    setup(PAIRED);
    const first = render(
      <WeekProvider>
        <Screen />
      </WeekProvider>,
    );
    await waitFor(() => expect((screen.getByRole("button", { name: /CA/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: /CA/ }));
    expect(screen.getByTestId("side").textContent).toBe("CAD");
    first.unmount();
    window.localStorage.clear();

    render(
      <WeekProvider>
        <Screen />
      </WeekProvider>,
    );
    expect(screen.getByTestId("side").textContent).toBe("USD");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("a persistent shell survives a screen's remount: the side resets, the week list is not refetched", async () => {
    setup(PAIRED);
    function Shell({ showScreen }: { showScreen: boolean }) {
      return <WeekProvider>{showScreen ? <Screen /> : null}</WeekProvider>;
    }
    const { rerender } = render(<Shell showScreen />);
    await waitFor(() => expect((screen.getByRole("button", { name: /CA/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: /CA/ }));
    rerender(<Shell showScreen={false} />);
    rerender(<Shell showScreen />);

    expect(screen.getByTestId("side").textContent).toBe("USD");
    expect(listPeriods).toHaveBeenCalledTimes(1);
  });

  it("disables the CA side with 'Not imported' when the week has none", async () => {
    setup(US_ONLY);
    render(
      <WeekProvider>
        <Screen />
      </WeekProvider>,
    );
    await waitFor(() => expect((screen.getByRole("button", { name: /CA/ }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByRole("button", { name: /CA/ }).textContent).toContain("Not imported");

    fireEvent.click(screen.getByRole("button", { name: /CA/ }));
    expect(screen.getByTestId("side").textContent).toBe("USD");
  });
});
