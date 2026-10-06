// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";

const push = vi.fn();
let pathname = "/transactions";
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push }),
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}));

const getHealth = vi.fn();
const listPeriods = vi.fn();
vi.mock("../lib/api", () => ({
  getHealth: (...args: unknown[]) => getHealth(...args),
  listPeriods: (...args: unknown[]) => listPeriods(...args),
}));

const { WeekProvider, usePublishInView } = await import("../hooks/useWeek");
const { default: InvoicesInView, chipState } = await import("./InvoicesInView");

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
  pathname = "/transactions";
  searchParams = new URLSearchParams();
});

/** A stand-in screen publishing the invoices its figures come from, as `useInvoiceInView` does. */
function Screen({ ids }: { ids: string[] | null }) {
  usePublishInView(ids);
  return null;
}

function renderStrip(week: PeriodWeek, ids: string[] | null) {
  getHealth.mockResolvedValue({ latestInvoicePeriod: week.weekEnd, openAnomalyCount: 0 });
  listPeriods.mockResolvedValue({ weeks: [week] });
  return render(
    <WeekProvider>
      <InvoicesInView />
      <Screen ids={ids} />
    </WeekProvider>,
  );
}

const chip = (side: string) => document.querySelector(`.invoice-chip[data-side="${side}"]`) as HTMLElement;
const allChip = () => document.querySelector('.invoice-chip[data-all="true"]') as HTMLElement | null;

describe("InvoicesInView (T-64 step 64.2)", () => {
  it("lists every invoice in the week — flag, number, actual range — highlighting the one in view", async () => {
    renderStrip(PAIRED, ["inv-us"]);
    await waitFor(() => expect(chip("USD")).not.toBeNull());

    expect(chip("USD").textContent).toBe("🇺🇸 999210 · Sep 3–9");
    expect(chip("USD").dataset.state).toBe("in-view");
    // The CA chip shows the range the transactions actually ran (Sep 3–10), not the printed one.
    expect(chip("CAD").textContent).toContain("🇨🇦 999217 · Sep 3–10");
    expect(chip("CAD").dataset.state).toBe("not-in-view");
    expect(allChip()!.dataset.state).toBe("not-in-view");
  });

  it("with All invoices in view, every invoice chip and the All chip are highlighted", async () => {
    renderStrip(PAIRED, ["inv-us", "inv-ca"]);
    await waitFor(() => expect(chip("CAD")).not.toBeNull());
    expect(chip("USD").dataset.state).toBe("in-view");
    expect(chip("CAD").dataset.state).toBe("in-view");
    expect(allChip()!.dataset.state).toBe("in-view");
  });

  it("a chip opens that invoice on Transactions; All invoices opens them together", async () => {
    renderStrip(PAIRED, ["inv-us"]);
    await waitFor(() => expect(chip("CAD")).not.toBeNull());

    expect(chip("CAD").getAttribute("href")).toBe("/transactions?week=2026-09-09&invoice=inv-ca");
    fireEvent.click(chip("CAD"));
    expect(push).toHaveBeenCalledWith("/transactions?week=2026-09-09&invoice=inv-ca");

    fireEvent.click(allChip()!);
    expect(push).toHaveBeenLastCalledWith("/transactions?week=2026-09-09&invoice=all");
  });

  it("on Transactions a chip keeps the page's filters; from another screen it starts clean", async () => {
    searchParams = new URLSearchParams({ driverId: "d1", invoice: "inv-us" });
    renderStrip(PAIRED, ["inv-us"]);
    await waitFor(() => expect(chip("CAD")).not.toBeNull());
    expect(chip("CAD").getAttribute("href")).toBe("/transactions?driverId=d1&invoice=inv-ca&week=2026-09-09");

    cleanup();
    pathname = "/overview";
    renderStrip(PAIRED, ["inv-us"]);
    await waitFor(() => expect(chip("CAD")).not.toBeNull());
    expect(chip("CAD").getAttribute("href")).toBe("/transactions?week=2026-09-09&invoice=inv-ca");
  });

  it("a missing side is a greyed 'Not imported' chip, not a link, and a one-invoice week has no All chip", async () => {
    renderStrip(US_ONLY, ["inv-us"]);
    await waitFor(() => expect(chip("CAD")).not.toBeNull());

    expect(chip("CAD").textContent).toBe("🇨🇦 Not imported");
    expect(chip("CAD").dataset.state).toBe("not-imported");
    expect(chip("CAD").tagName).toBe("SPAN");
    expect(chip("USD").tagName).toBe("A");
    expect(allChip()).toBeNull();
  });

  it("⚠ carries printed vs actual range in its tooltip when the dates differ, and only then", async () => {
    renderStrip(PAIRED, ["inv-ca"]);
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
    expect(allChip()!.dataset.state).toBe("available");
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

  it("chipState", () => {
    expect(chipState(null, ["a"])).toBe("not-imported");
    expect(chipState("a", ["a"])).toBe("in-view");
    expect(chipState("b", ["a"])).toBe("not-in-view");
    expect(chipState("b", null)).toBe("available");
  });
});
