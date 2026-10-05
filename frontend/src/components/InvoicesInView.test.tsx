// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";
import type { CurrencySide } from "../lib/weeks";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push }),
  usePathname: () => "/transactions",
  useSearchParams: () => new URLSearchParams(),
}));

const getHealth = vi.fn();
const listPeriods = vi.fn();
vi.mock("../lib/api", () => ({
  getHealth: (...args: unknown[]) => getHealth(...args),
  listPeriods: (...args: unknown[]) => listPeriods(...args),
}));

const { WeekProvider, usePublishViewSide } = await import("../hooks/useWeek");
const { default: InvoicesInView, chipState, invoiceHistoryHref } = await import("./InvoicesInView");

function invoice(overrides: Partial<PeriodInvoice>): PeriodInvoice {
  return {
    id: "inv-us",
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

const CA_DIFFERS = invoice({
  id: "inv-ca",
  invoiceNumber: "999217",
  currency: "CAD",
  printedStart: "2026-08-01",
  printedEnd: "2026-09-09",
  actualStart: "2026-09-03",
  actualEnd: "2026-09-10",
  datesDiffer: true,
});
const PAIRED: PeriodWeek = { weekEnd: "2026-09-09", invoices: [invoice({}), CA_DIFFERS] };
const US_ONLY: PeriodWeek = { weekEnd: "2026-09-09", invoices: [invoice({})] };

afterEach(() => {
  cleanup();
  push.mockClear();
  getHealth.mockReset();
  listPeriods.mockReset();
});

/** A stand-in screen: reads `side` and publishes it, the way `useCurrencySide` does. */
function Screen({ side }: { side: CurrencySide | null }) {
  usePublishViewSide(side);
  return null;
}

function renderStrip(week: PeriodWeek, side: CurrencySide | null) {
  getHealth.mockResolvedValue({ latestInvoicePeriod: week.weekEnd, openAnomalyCount: 0 });
  listPeriods.mockResolvedValue({ weeks: [week] });
  return render(
    <WeekProvider>
      <InvoicesInView />
      <Screen side={side} />
    </WeekProvider>,
  );
}

const chip = (side: string) => document.querySelector(`.invoice-chip[data-side="${side}"]`) as HTMLElement;

describe("InvoicesInView (T-64 step 64.2)", () => {
  it("renders one chip per side — flag, number, actual range — highlighting the side in view and dimming the other", async () => {
    renderStrip(PAIRED, "USD");
    await waitFor(() => expect(chip("USD")).not.toBeNull());

    expect(chip("USD").textContent).toBe("🇺🇸 999210 · Sep 3–9");
    expect(chip("USD").dataset.state).toBe("in-view");
    // The CA chip shows the range the transactions actually ran (Sep 3–10), not the printed one.
    expect(chip("CAD").textContent).toContain("🇨🇦 999217 · Sep 3–10");
    expect(chip("CAD").dataset.state).toBe("not-in-view");
  });

  it("flips which chip is in view with the screen's side", async () => {
    renderStrip(PAIRED, "CAD");
    await waitFor(() => expect(chip("CAD")).not.toBeNull());
    expect(chip("CAD").dataset.state).toBe("in-view");
    expect(chip("USD").dataset.state).toBe("not-in-view");
  });

  it("a missing side is a greyed 'Not imported' chip, not a link", async () => {
    renderStrip(US_ONLY, "USD");
    await waitFor(() => expect(chip("CAD")).not.toBeNull());

    expect(chip("CAD").textContent).toBe("🇨🇦 Not imported");
    expect(chip("CAD").dataset.state).toBe("not-imported");
    expect(chip("CAD").tagName).toBe("SPAN");
    expect(chip("USD").tagName).toBe("A");
  });

  it("⚠ carries printed vs actual range in its tooltip when the dates differ, and only then", async () => {
    renderStrip(PAIRED, "CAD");
    await waitFor(() => expect(chip("CAD")).not.toBeNull());

    const warn = chip("CAD").querySelector(".invoice-chip-warn")!;
    expect(warn.getAttribute("title")).toBe("Printed Aug 1 – Sep 9; transactions Sep 3 – Sep 10");
    expect(chip("USD").querySelector(".invoice-chip-warn")).toBeNull();
  });

  it("a screen that reads no invoice figures dims nothing", async () => {
    renderStrip(PAIRED, null);
    await waitFor(() => expect(chip("USD")).not.toBeNull());
    expect(chip("USD").dataset.state).toBe("available");
    expect(chip("CAD").dataset.state).toBe("available");
  });

  it("a chip opens that invoice in Import history", async () => {
    renderStrip(PAIRED, "USD");
    await waitFor(() => expect(chip("CAD")).not.toBeNull());

    expect(chip("CAD").getAttribute("href")).toBe("/import?invoice=inv-ca");
    fireEvent.click(chip("CAD"));
    expect(push).toHaveBeenCalledWith("/import?invoice=inv-ca");
  });

  it("renders nothing until the selected week is known", () => {
    getHealth.mockReturnValue(new Promise(() => {}));
    listPeriods.mockReturnValue(new Promise(() => {}));
    render(
      <WeekProvider>
        <InvoicesInView />
      </WeekProvider>,
    );
    expect(screen.queryByTestId("invoices-in-view")).toBeNull();
  });

  it("chipState and invoiceHistoryHref", () => {
    expect(chipState(false, "CAD", "USD")).toBe("not-imported");
    expect(chipState(true, "USD", "USD")).toBe("in-view");
    expect(chipState(true, "CAD", "USD")).toBe("not-in-view");
    expect(chipState(true, "CAD", null)).toBe("available");
    expect(invoiceHistoryHref("a b")).toBe("/import?invoice=a%20b");
  });
});
