// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeriodInvoice, PeriodWeek } from "@ch/core/api/routes/periods";
import { overviewFixture, type OverviewScenario } from "../../../lib/overviewFixtures";

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
const getOverviewWeeks = vi.fn();
const patchInvoiceFx = vi.fn();

vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ApiError: actual.ApiError,
    getHealth: (...args: unknown[]) => getHealth(...args),
    listPeriods: (...args: unknown[]) => listPeriods(...args),
    getOverviewWeeks: (...args: unknown[]) => getOverviewWeeks(...args),
    patchInvoiceFx: (...args: unknown[]) => patchInvoiceFx(...args),
  };
});

const { default: OverviewPageInner } = await import("./page");
const { WeekProvider } = await import("../../../hooks/useWeek");

function OverviewPage() {
  return (
    <WeekProvider>
      <OverviewPageInner />
    </WeekProvider>
  );
}

function invoice(id: string, currency: "USD" | "CAD", number: string, fx: PeriodInvoice["fx"] = null): PeriodInvoice {
  return { id, invoiceNumber: number, currency, printedStart: "2026-09-03", printedEnd: "2026-09-09", actualStart: "2026-09-03", actualEnd: "2026-09-09", datesDiffer: false, fx };
}

function periodsFor(scenario: OverviewScenario): PeriodWeek[] {
  return overviewFixture(scenario)
    .map((w): PeriodWeek => ({
      weekEnd: w.weekEnd,
      invoices: [...(w.us ? [invoice(`us-${w.weekEnd}`, "USD", w.us.invoice)] : []), ...(w.ca ? [invoice(`ca-${w.weekEnd}`, "CAD", w.ca.invoice, w.fx === null ? null : { rate: w.fx, enteredAt: "2026-09-10T12:00:00.000Z" })] : [])],
    }))
    .reverse();
}

function mount(scenario: OverviewScenario, query = "") {
  searchParams = new URLSearchParams(query);
  const weeks = overviewFixture(scenario);
  getOverviewWeeks.mockResolvedValue({ weeks });
  listPeriods.mockResolvedValue({ weeks: periodsFor(scenario) });
  getHealth.mockResolvedValue({ latestInvoicePeriod: weeks[weeks.length - 1]!.weekEnd });
  return render(<OverviewPage />);
}

const tile = (panel: string, label: string) => within(screen.getByTestId(panel)).getAllByTestId("ov-tile").find((t) => t.dataset.label === label)!;

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  getOverviewWeeks.mockReset();
  patchInvoiceFx.mockReset();
});
afterEach(cleanup);

describe("OverviewPage (T-71)", () => {
  it("makes one data call and opens on all time", async () => {
    mount("all");
    expect(await screen.findByText("All time · 14 weeks · Aug 4 – Nov 9")).toBeTruthy();
    expect(getOverviewWeeks).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "All time" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Exchange rates entered for 14 of 14 weeks")).toBeTruthy();
  });

  it("shows the invoices strip as one summary chip, and Show all lists them", async () => {
    mount("all");
    await screen.findByTestId("invoices-summary");
    expect(screen.getByTestId("invoices-summary").textContent).toContain("All invoices · 28");
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(within(screen.getByTestId("invoices-list")).getAllByText(/·/)).toHaveLength(28);
    expect(screen.getByRole("button", { name: "Hide list" })).toBeTruthy();
  });

  it("choosing Billing week writes the latest week into the URL; Range the last four", async () => {
    mount("all");
    await screen.findByTestId("invoices-summary");
    fireEvent.click(screen.getByRole("button", { name: /Billing week/ }));
    const last = overviewFixture("all").at(-1)!.weekEnd;
    expect(replace).toHaveBeenLastCalledWith(`/overview?scope=week&w=${last}`);
    fireEvent.click(screen.getByRole("button", { name: /Range/ }));
    const from = overviewFixture("all")[10]!.weekEnd;
    expect(replace).toHaveBeenLastCalledWith(`/overview?scope=range&from=${from}&to=${last}`);
  });

  it("a week in the URL shows that week: two chips and the single-week readout", async () => {
    const week = overviewFixture("all")[13]!;
    mount("all", `scope=week&w=${week.weekEnd}`);
    expect(await screen.findByText(/^Billing week · Nov 3 – 9$/)).toBeTruthy();
    expect(within(screen.getByTestId("invoices-strip")).getByText(new RegExp(week.us!.invoice))).toBeTruthy();
    expect(screen.getByText("Exchange rate 1.42 CAD per USD")).toBeTruthy();
  });

  it("the Anomalies link opens Transactions with the same scope in the URL", async () => {
    const ends = overviewFixture("all").map((w) => w.weekEnd);
    const [from, to] = [ends[11]!, ends[13]!];
    mount("all", `scope=range&from=${from}&to=${to}`);
    await screen.findByTestId("invoices-summary");
    const links = screen.getAllByTestId("anomalies-link");
    expect(links[0]!.getAttribute("href")).toBe(`/transactions?scope=range&from=${from}&to=${to}&currency=all&anomalyOnly=true`);
    expect(links[1]!.getAttribute("href")).toBe(`/transactions?scope=range&from=${from}&to=${to}&currency=USD&anomalyOnly=true`);
    expect(links[2]!.getAttribute("href")).toContain("currency=CAD");
    expect(links[1]!.textContent).toBe("Open in Transactions, this range →");
  });

  it("the US card's units toggle swaps to CAD and litres", async () => {
    mount("all");
    await screen.findByTestId("invoices-summary");
    const panel = within(screen.getByTestId("us-panel"));
    expect(panel.getAllByTestId("ov-tile")[1]!.textContent).toContain("/ gal");
    fireEvent.click(panel.getByRole("button", { name: "CA units" }));
    expect(panel.getAllByTestId("ov-tile")[1]!.textContent).toContain("/ L");
    expect(panel.getAllByTestId("ov-tile")[1]!.textContent).toContain("CA");
    fireEvent.click(panel.getByRole("button", { name: "US units" }));
    expect(panel.getAllByTestId("ov-tile")[1]!.textContent).toContain("/ gal");
  });

  it("all time: both trend charts are drawn", async () => {
    mount("all");
    await screen.findByTestId("invoices-summary");
    expect(within(screen.getByTestId("trend-us")).getByTestId("trend-chart")).toBeTruthy();
    expect(within(screen.getByTestId("trend-ca")).getByTestId("trend-chart-phone")).toBeTruthy();
    expect(screen.getByText("−2.8% since Aug 4")).toBeTruthy();
  });

  it("today's one week: no trend card at all, and no NaN anywhere", async () => {
    const { container } = mount("today");
    await screen.findByTestId("us-panel");
    expect(screen.queryByTestId("trend-us")).toBeNull();
    expect(screen.queryByTestId("trend-chart")).toBeNull();
    expect(tile("us-panel", "Average billed price").textContent).toContain("$5.5479");
    expect(container.textContent).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("rate missing for some weeks: the notice names them and combined still shows", async () => {
    mount("fxpartial");
    expect(await screen.findByText("3 of 14 weeks have no exchange rate. Converted figures cover 11 weeks.")).toBeTruthy();
    expect(screen.getByText(/^Missing: week of Sep 8/)).toBeTruthy();
    expect(screen.getAllByTestId("ov-combined-tile")).toHaveLength(3);
  });

  it("no rate anywhere: combined asks for a rate and the drivers split into one currency per view", async () => {
    mount("fxnone");
    expect(await screen.findByTestId("combined-none")).toBeTruthy();
    expect(screen.queryAllByTestId("ov-combined-tile")).toHaveLength(0);
    expect(screen.getByTestId("driver-split-note").textContent).toContain("can’t be stacked in one currency");
    const columns = () => screen.getAllByTestId("driver-column").length;
    const usColumns = columns();
    fireEvent.click(screen.getByRole("button", { name: "Canada · CAD" }));
    expect(columns()).toBeLessThan(usColumns + 1);
    expect(screen.getAllByText("Canada · CAD").length).toBeGreaterThan(1);
  });

  it("a week with only a US invoice keeps the Canada card as an empty state", async () => {
    const week = overviewFixture("usonly")[10]!;
    mount("usonly", `scope=week&w=${week.weekEnd}`);
    expect(await screen.findByTestId("ca-not-imported")).toBeTruthy();
    expect(screen.getByText("No Canadian invoice for Oct 13 – 19")).toBeTruthy();
    expect(screen.getByText("No Canadian invoice this week")).toBeTruthy();
    expect(screen.getByText(/US only this week/)).toBeTruthy();
  });

  it("the two country cards fold under one Breakdown by country header", async () => {
    mount("all");
    await screen.findByTestId("country-breakdown");
    const toggle = screen.getByTestId("breakdown-toggle");
    const body = () => screen.getByTestId("us-panel").closest("[hidden]");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body()).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(body()).not.toBeNull();
    fireEvent.click(toggle);
    expect(body()).toBeNull();
  });

  it("spend by driver shows the top five, then all eleven bars, and collapses", async () => {
    mount("all");
    await screen.findByTestId("driver-spend");
    const bars = () => screen.queryAllByTestId("driver-column").length;
    expect(bars()).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: "Show all 11" }));
    expect(bars()).toBe(11);
    expect(screen.getByText("All other drivers")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show top 5" }));
    expect(bars()).toBe(5);
    fireEvent.click(screen.getByTestId("driver-toggle"));
    expect(bars()).toBe(0);
    fireEvent.click(screen.getByTestId("driver-toggle"));
    expect(bars()).toBe(5);
  });

  it("a driver segment's hover title carries both currencies", async () => {
    mount("all");
    await screen.findByTestId("driver-spend");
    const title = screen.getAllByTestId("driver-seg-us")[2]!.getAttribute("title")!;
    expect(title).toContain("Driver 3 · United States");
    expect(title).toMatch(/US\$[\d,]+\.\d{2} · CA\$[\d,]+\.\d{2}/);
  });
});

describe("OverviewPage — entering the exchange rate", () => {
  it("Edit rates opens a field per week and a saved rate re-reads the page", async () => {
    mount("today");
    await screen.findByTestId("us-panel");
    patchInvoiceFx.mockResolvedValue({ fx: { rate: 1.3712, enteredAt: "2026-10-26T12:00:00.000Z" } });
    fireEvent.click(screen.getByRole("link", { name: "Edit rates" }));
    const input = (await screen.findByPlaceholderText("e.g. 1.3712")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1.3712" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(patchInvoiceFx).toHaveBeenCalledWith(expect.stringMatching(/^ca-/), 1.3712));
    await waitFor(() => expect(getOverviewWeeks).toHaveBeenCalledTimes(2));
  });

  it("the missing-rate notice's link opens the same panel", async () => {
    mount("fxnone");
    fireEvent.click(await screen.findByRole("link", { name: "Enter exchange rates →", hidden: false }).catch(() => screen.getAllByRole("link", { name: "Enter exchange rates →" })[0]!));
    expect(await screen.findByTestId("rates-panel")).toBeTruthy();
  });
});

describe("OverviewPage — empty and failing", () => {
  it("shows the empty state when nothing is imported", async () => {
    getOverviewWeeks.mockResolvedValue({ weeks: [] });
    listPeriods.mockResolvedValue({ weeks: [] });
    getHealth.mockResolvedValue({ latestInvoicePeriod: null });
    render(<OverviewPage />);
    expect(await screen.findByText("No invoice imported yet")).toBeTruthy();
  });

  it("surfaces a failed fetch instead of loading forever", async () => {
    getOverviewWeeks.mockRejectedValue(new Error("boom"));
    listPeriods.mockResolvedValue({ weeks: [] });
    getHealth.mockResolvedValue({ latestInvoicePeriod: null });
    render(<OverviewPage />);
    expect(await screen.findByText("Couldn't load the overview")).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy();
  });
});
