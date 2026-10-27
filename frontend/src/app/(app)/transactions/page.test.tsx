// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionListItem } from "@ch/core/actuals/transactions";
import type { PeriodWeek } from "@ch/core/api/routes/periods";

const replace = vi.fn();
const push = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => "/transactions",
  useSearchParams: () => searchParams,
}));

const getHealth = vi.fn();
const listPeriods = vi.fn();
const listTransactions = vi.fn();
const listDrivers = vi.fn();
const listTrucks = vi.fn();

vi.mock("../../../lib/api", () => ({
  getHealth: (...args: unknown[]) => getHealth(...args),
  listPeriods: (...args: unknown[]) => listPeriods(...args),
  listTransactions: (...args: unknown[]) => listTransactions(...args),
  listDrivers: (...args: unknown[]) => listDrivers(...args),
  listTrucks: (...args: unknown[]) => listTrucks(...args),
}));

const { default: TransactionsPageInner } = await import("./page");
const { WeekProvider } = await import("../../../hooks/useWeek");

function TransactionsPage() {
  return (
    <WeekProvider>
      <TransactionsPageInner />
    </WeekProvider>
  );
}

function stop(overrides: Partial<TransactionListItem> = {}): TransactionListItem {
  return {
    id: "stop-1",
    baseAuthCode: "A900000001",
    occurredAt: "2026-09-05T14:30:00.000Z",
    card: { id: "card-1", number: "9000005" },
    driver: { resolved: "JORDAN", raw: "JORDAN", agrees: true },
    truck: { resolved: "072", raw: "072", agrees: true },
    station: { id: "st-1", loveNumber: 294, city: "Dallas", state: "TX" },
    qty: 40.0,
    qtyUnit: "gal",
    retailPerUnit: 5.799,
    billedPerUnit: 5.499,
    total: 238.26,
    currency: "USD",
    // What BVD billed; the same as `currency` unless a conversion says otherwise.
    invoiceCurrency: overrides.invoiceCurrency ?? overrides.currency ?? "USD",
    receiptStatus: "confirmed",
    flags: [],
    lines: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  replace.mockClear();
  push.mockClear();
  getHealth.mockReset();
  listPeriods.mockReset();
  listTransactions.mockReset();
  listDrivers.mockReset();
  listTrucks.mockReset();
  searchParams = new URLSearchParams();
});

describe("TransactionsPage (T-40)", () => {
  it("scopes GET /transactions to the shell's selected period, not a reconstructed date range", async () => {
    searchParams = new URLSearchParams({ week: "2026-09-03" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    listDrivers.mockResolvedValue({ week: "2026-09-03", invoiceId: "inv-1", rows: [], unresolved: {}, fleet: {} });
    listTrucks.mockResolvedValue({ rows: [] });
    listTransactions.mockResolvedValue({ rows: [stop()], page: 1, pageSize: 200, total: 1 });

    render(<TransactionsPage />);

    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());
    const tableCall = listTransactions.mock.calls.find((c) => (c[0] as { pageSize?: number }).pageSize === 200 && (c[0] as { includeLines?: boolean }).includeLines);
    expect(tableCall![0]).toMatchObject({ week: "2026-09-03", includeLines: true });
  });

  it("a driver filter in the URL is forwarded to GET /transactions as driverId", async () => {
    searchParams = new URLSearchParams({ week: "2026-09-03", driverId: "driver-1" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    listDrivers.mockResolvedValue({ week: "2026-09-03", invoiceId: "inv-1", rows: [], unresolved: {}, fleet: {} });
    listTrucks.mockResolvedValue({ rows: [] });
    listTransactions.mockResolvedValue({ rows: [], page: 1, pageSize: 200, total: 0 });

    render(<TransactionsPage />);

    await waitFor(() => expect(listTransactions.mock.calls.some((c) => (c[0] as { includeLines?: boolean }).includeLines)).toBe(true));
    const tableCall = listTransactions.mock.calls.find((c) => (c[0] as { includeLines?: boolean }).includeLines);
    expect(tableCall![0]).toMatchObject({ driverId: "driver-1" });
  });

  it("a search term in the URL narrows the rendered rows client-side, without re-fetching", async () => {
    searchParams = new URLSearchParams({ week: "2026-09-03", q: "jordan" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    listDrivers.mockResolvedValue({ week: "2026-09-03", invoiceId: "inv-1", rows: [], unresolved: {}, fleet: {} });
    listTrucks.mockResolvedValue({ rows: [] });
    listTransactions.mockResolvedValue({
      rows: [stop(), stop({ id: "stop-2", baseAuthCode: "B999", driver: { resolved: "OTHER", raw: "OTHER", agrees: true } })],
      page: 1,
      pageSize: 200,
      total: 2,
    });

    render(<TransactionsPage />);

    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());
    expect(screen.queryByText("OTHER")).toBeNull();
  });

  it("a failed fetch surfaces the error rather than an indefinite loading state", async () => {
    searchParams = new URLSearchParams({ week: "2026-09-03" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    listDrivers.mockResolvedValue({ week: "2026-09-03", invoiceId: "inv-1", rows: [], unresolved: {}, fleet: {} });
    listTrucks.mockResolvedValue({ rows: [] });
    listTransactions.mockRejectedValue(new Error("network down"));

    render(<TransactionsPage />);

    await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());
  });
});

// A week with both sides imported — the ticket's own shape: 999210 (US) + 999217 (CA, printed range wider than it ran).
const PAIRED_WEEK: PeriodWeek = {
  weekEnd: "2026-09-09",
  invoices: [
    { id: "inv-us", invoiceNumber: "999210", currency: "USD", printedStart: "2026-09-03", printedEnd: "2026-09-09", actualStart: "2026-09-03", actualEnd: "2026-09-09", datesDiffer: false, fx: null },
    { id: "inv-ca", invoiceNumber: "999217", currency: "CAD", printedStart: "2026-08-01", printedEnd: "2026-09-09", actualStart: "2026-09-03", actualEnd: "2026-09-10", datesDiffer: true, fx: null },
  ],
};
const US_ONLY_WEEK: PeriodWeek = { weekEnd: "2026-09-02", invoices: [PAIRED_WEEK.invoices[0]!] };
const CA_ONLY_WEEK: PeriodWeek = { weekEnd: "2026-09-16", invoices: [PAIRED_WEEK.invoices[1]!] };

function caRow(overrides: Partial<TransactionListItem> = {}): TransactionListItem {
  return stop({
    id: "stop-ca",
    driver: { resolved: "SAM", raw: "SAM", agrees: true },
    qty: 100,
    qtyUnit: "L",
    retailPerUnit: 2.0,
    billedPerUnit: 1.9046,
    total: 215.22,
    currency: "CAD",
    ...overrides,
  });
}

const FX = { rate: 1.3712, enteredAt: "2026-10-06T16:00:00.000Z" };

function setupWeeks(weeks: PeriodWeek[], latest = weeks[0]!.weekEnd, rateEntered = true) {
  getHealth.mockResolvedValue({ latestInvoicePeriod: latest, openAnomalyCount: 0 });
  listPeriods.mockResolvedValue({ weeks });
  listDrivers.mockResolvedValue({ week: latest, invoiceId: "x", rows: [], unresolved: {}, fleet: {} });
  listTrucks.mockResolvedValue({ rows: [] });
  // Serves what the request asks for: one side or both, as printed or in the requested unit and
  // currency — converted at 1.3712 when `rateEntered`, otherwise rate pending (T-66).
  listTransactions.mockImplementation(async (params: { currency?: string; units?: string; convertTo?: string }) => {
    let us = params.units === "metric" ? stop({ qty: 151.42, qtyUnit: "L", billedPerUnit: 1.4527, retailPerUnit: 1.5319 }) : stop();
    let ca = params.units === "imperial" ? caRow({ qty: 26.42, qtyUnit: "gal", billedPerUnit: 7.2093, retailPerUnit: 7.5708 }) : caRow();
    if (params.convertTo === "USD") {
      ca = rateEntered
        ? { ...ca, currency: "USD", invoiceCurrency: "CAD", fx: FX, billedPerUnit: 5.2577, retailPerUnit: 5.5213, total: 156.96 }
        : { ...ca, currency: "USD", invoiceCurrency: "CAD", ratePending: true, billedPerUnit: null, retailPerUnit: null, total: null };
    }
    if (params.convertTo === "CAD") {
      us = rateEntered
        ? { ...us, currency: "CAD", invoiceCurrency: "USD", fx: FX, billedPerUnit: 1.992, retailPerUnit: 2.1006, total: 326.7 }
        : { ...us, currency: "CAD", invoiceCurrency: "USD", ratePending: true, billedPerUnit: null, retailPerUnit: null, total: null };
    }
    const rows = params.currency === "USD" ? [us] : params.currency === "CAD" ? [ca] : [us, ca];
    return { rows, page: 1, pageSize: 200, total: rows.length };
  });
}

type TableRequest = { week?: string; currency?: string; units?: string; convertTo?: string };

/** The last table-shaped request (`includeLines`) — what the page's figures came from. */
function lastTableRequest(): TableRequest {
  const calls = listTransactions.mock.calls.filter((c) => (c[0] as { includeLines?: boolean }).includeLines);
  return calls[calls.length - 1]![0] as TableRequest;
}

function chipStates(): Record<string, string> {
  return Object.fromEntries(
    [...document.querySelectorAll(".ss-chip[data-side]")].map((chip) => {
      const el = chip as HTMLElement;
      const state = el.dataset.state === "not-imported" ? "not-imported" : el.getAttribute("aria-pressed") === "true" ? "in-view" : "not-in-view";
      return [el.dataset.side!, state];
    }),
  );
}

/** Which conversion button is pressed — what the screen says it is showing. */
function pressed(): string | null {
  const button = document.querySelector('[aria-label="Show amounts in"] button[aria-pressed="true"]');
  return button?.textContent ?? null;
}

describe("TransactionsPage — invoice picker and the USD/gal | CAD/L conversion (T-64)", () => {
  it("opens on the week's first invoice: requests currency=USD as printed and highlights only that chip", async () => {
    setupWeeks([PAIRED_WEEK]);
    render(<TransactionsPage />);

    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());
    expect(lastTableRequest()).toMatchObject({ week: "2026-09-09", currency: "USD" });
    expect(lastTableRequest().units).toBeUndefined();
    expect(chipStates()).toEqual({ USD: "in-view", CAD: "not-in-view", all: "not-in-view" });
    expect(pressed()).toBe("USD/gal");
    expect(screen.queryByTestId("tx-invoice-tag")).toBeNull();
  });

  it("?invoice= picks that invoice: currency=CAD, its rows in litres and CAD, the CA chip highlighted", async () => {
    searchParams = new URLSearchParams({ invoice: "inv-ca" });
    setupWeeks([PAIRED_WEEK]);
    render(<TransactionsPage />);

    await waitFor(() => expect(screen.getByText("SAM")).toBeTruthy());
    expect(lastTableRequest()).toMatchObject({ week: "2026-09-09", currency: "CAD" });
    expect(lastTableRequest().units).toBeUndefined();
    expect(chipStates()).toEqual({ USD: "not-in-view", CAD: "in-view", all: "not-in-view" });
    expect(pressed()).toBe("CAD/L");
    const head = document.querySelector(".tx-head-row")!.textContent!;
    expect(head).toContain("Litres");
    expect(head).toContain("Total CAD");
    expect(document.querySelector(".tx-total")!.textContent).toBe("CA$215.22");
    expect(listDrivers).toHaveBeenLastCalledWith("2026-09-09", "CAD");
  });

  it("clicking a chip navigates to that invoice on Transactions", async () => {
    setupWeeks([PAIRED_WEEK]);
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());

    fireEvent.click(document.querySelector('.ss-chip[data-side="CAD"]')!);
    expect(replace).toHaveBeenCalledWith("/transactions?currency=CAD");
  });

  it("All invoices requests both sides (no currency) and highlights the All chip", async () => {
    searchParams = new URLSearchParams({ invoice: "all" });
    setupWeeks([PAIRED_WEEK]);
    render(<TransactionsPage />);

    await waitFor(() => expect(screen.getByText("SAM")).toBeTruthy());
    expect(screen.getByText("JORDAN")).toBeTruthy();
    expect(lastTableRequest().currency).toBeUndefined();
    expect(lastTableRequest().units).toBeUndefined();
    expect(chipStates()).toEqual({ USD: "not-in-view", CAD: "not-in-view", all: "in-view" });
    // Two invoices as printed: neither button describes everything on screen.
    expect(pressed()).toBeNull();
    // Each row says which invoice, and which country, it came from.
    expect(screen.getAllByTestId("tx-invoice-tag").map((t) => t.textContent)).toEqual(["🇺🇸 999210", "🇨🇦 999217"]);
  });

  it("USD/gal on the CA invoice asks for gallons and USD, and shows USD money with the rate and when it was entered (T-66)", async () => {
    searchParams = new URLSearchParams({ invoice: "inv-ca" });
    setupWeeks([PAIRED_WEEK]);
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("SAM")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "USD/gal" }));

    await waitFor(() => expect(lastTableRequest()).toMatchObject({ currency: "CAD", units: "imperial", convertTo: "USD" }));
    await waitFor(() => expect(document.querySelector(".tx-total")!.textContent).toBe("US$156.96"));
    expect(document.querySelector(".tx-head-row")!.textContent).toContain("Billed USD/gal");
    expect(screen.getByTestId("fx-rate-line").textContent).toContain("Converted at 1.3712 CAD per USD, entered Oct 6, 2026");
    expect(screen.queryByTestId("conversion-pending")).toBeNull();
    expect(pressed()).toBe("USD/gal");
  });

  it("USD/gal on the CA invoice with no rate entered shows 'rate pending' and a link to that week's Overview", async () => {
    searchParams = new URLSearchParams({ invoice: "inv-ca" });
    setupWeeks([PAIRED_WEEK], "2026-09-09", false);
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("SAM")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "USD/gal" }));

    await waitFor(() => expect(document.querySelector(".tx-total")!.textContent).toBe("rate pending"));
    expect(screen.getByTestId("conversion-pending").textContent).toContain("rate pending");
    expect(screen.getByTestId("enter-rate-link").getAttribute("href")).toBe("/overview?scope=week&w=2026-09-09");
  });

  it("CAD/L on the US invoice asks for litres; choosing the invoice's own format again sends nothing", async () => {
    setupWeeks([PAIRED_WEEK]);
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "CAD/L" }));
    await waitFor(() => expect(lastTableRequest()).toMatchObject({ currency: "USD", units: "metric", convertTo: "CAD" }));

    fireEvent.click(screen.getByRole("button", { name: "USD/gal" }));
    await waitFor(() => expect(lastTableRequest().units).toBeUndefined());
    expect(lastTableRequest().convertTo).toBeUndefined();
  });

  it("the conversion applies to every row under All invoices", async () => {
    searchParams = new URLSearchParams({ invoice: "all" });
    setupWeeks([PAIRED_WEEK]);
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("SAM")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "USD/gal" }));
    await waitFor(() => expect(lastTableRequest()).toMatchObject({ units: "imperial", convertTo: "USD" }));
    expect(lastTableRequest().currency).toBeUndefined();
    expect(pressed()).toBe("USD/gal");
  });

  it("a conversion does not carry over: picking another invoice shows it as it came in", async () => {
    searchParams = new URLSearchParams({ invoice: "inv-ca" });
    setupWeeks([PAIRED_WEEK]);
    const view = render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("SAM")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "USD/gal" }));
    await waitFor(() => expect(lastTableRequest().units).toBe("imperial"));

    // The strip's chip navigates; the URL now names the US invoice.
    searchParams = new URLSearchParams({ invoice: "inv-us" });
    view.rerender(<TransactionsPage />);
    await waitFor(() => expect(lastTableRequest().currency).toBe("USD"));
    expect(lastTableRequest().units).toBeUndefined();

    // And back to the CA invoice: CAD/L again, not the earlier USD/gal.
    searchParams = new URLSearchParams({ invoice: "inv-ca" });
    view.rerender(<TransactionsPage />);
    await waitFor(() => expect(lastTableRequest().currency).toBe("CAD"));
    expect(lastTableRequest().units).toBeUndefined();
    expect(pressed()).toBe("CAD/L");
  });

  it("a one-invoice week shows the missing side as Not imported and no All chip", async () => {
    setupWeeks([US_ONLY_WEEK]);
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());
    expect(chipStates()).toEqual({ USD: "in-view", CAD: "not-imported" });
  });

  it("a CA-only week opens on its CA invoice", async () => {
    setupWeeks([CA_ONLY_WEEK]);
    render(<TransactionsPage />);

    await waitFor(() => expect(screen.getByText("SAM")).toBeTruthy());
    expect(lastTableRequest()).toMatchObject({ week: "2026-09-16", currency: "CAD" });
    expect(chipStates()).toEqual({ USD: "not-imported", CAD: "in-view" });
  });

  it("makes exactly one table request once the week list has arrived — none while it loads", async () => {
    setupWeeks([PAIRED_WEEK]);
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());
    const tableCalls = listTransactions.mock.calls.filter((c) => (c[0] as { includeLines?: boolean }).includeLines);
    expect(tableCalls).toHaveLength(1);
  });
});

describe("TransactionsPage — the Overview's scope in the URL (T-74)", () => {
  const twoWeeks = () => setupWeeks([CA_ONLY_WEEK, PAIRED_WEEK], "2026-09-16");

  it("a range asks for its weeks as weekFrom/weekTo, one side, flagged stops only", async () => {
    searchParams = new URLSearchParams("scope=range&from=2026-09-09&to=2026-09-16&currency=USD&anomalyOnly=true");
    twoWeeks();
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());
    expect(lastTableRequest()).toMatchObject({ weekFrom: "2026-09-09", weekTo: "2026-09-16", currency: "USD", anomalyOnly: true });
    expect(lastTableRequest().week).toBeUndefined();
    expect(screen.getByText(/^Range · 2 weeks · /)).toBeTruthy();
  });

  it("all time sends no week filter at all, and both sides with no currency", async () => {
    searchParams = new URLSearchParams("scope=all");
    twoWeeks();
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());
    const request = lastTableRequest();
    expect(request.week).toBeUndefined();
    expect((request as { weekFrom?: string }).weekFrom).toBeUndefined();
    expect(request.currency).toBeUndefined();
    expect(screen.getByText(/^All time · 2 weeks · /)).toBeTruthy();
  });

  it("all time tags each row with its country, since rows from both invoices are mixed", async () => {
    searchParams = new URLSearchParams("scope=all");
    twoWeeks();
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());
    const tags = screen.getAllByTestId("tx-invoice-tag");
    expect(tags.map((t) => (t as HTMLElement).dataset.currency).sort()).toEqual(["CAD", "USD"]);
  });

  it("the strip counts each side's invoices in a range and picks a side through the URL", async () => {
    searchParams = new URLSearchParams("scope=all");
    twoWeeks();
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());
    expect(document.querySelector('.ss-chip[data-side="USD"]')!.textContent).toContain("1 US invoice");
    expect(document.querySelector('.ss-chip[data-side="CAD"]')!.textContent).toContain("2 CA invoices");
    fireEvent.click(document.querySelector('.ss-chip[data-side="CAD"]')!);
    expect(replace).toHaveBeenCalledWith("/transactions?scope=all&currency=CAD");
  });

  it("choosing All time in the banner writes the scope into the URL", async () => {
    twoWeeks();
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("SAM")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "All time" }));
    expect(replace).toHaveBeenCalledWith("/transactions?scope=all");
  });
});

describe("TransactionsPage — date sort (T-40J)", () => {
  it("opens newest first: no sort in the request", async () => {
    setupWeeks([PAIRED_WEEK]);
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());
    expect(lastTableRequest()).not.toHaveProperty("sortField");
    expect(lastTableRequest()).not.toHaveProperty("sortDirection");
  });

  it("sort=asc in the URL requests occurred_at ascending; clicking the header removes the key", async () => {
    searchParams = new URLSearchParams({ sort: "asc" });
    setupWeeks([PAIRED_WEEK]);
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());
    expect(lastTableRequest()).toMatchObject({ sortField: "occurred_at", sortDirection: "asc" });

    fireEvent.click(screen.getByRole("button", { name: /Date · time/ }));
    expect(new URL(replace.mock.calls.at(-1)![0] as string, "http://localhost").searchParams.has("sort")).toBe(false);
  });

  it("clicking the header on the default order writes sort=asc", async () => {
    setupWeeks([PAIRED_WEEK]);
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Date · time/ }));
    expect(new URL(replace.mock.calls.at(-1)![0] as string, "http://localhost").searchParams.get("sort")).toBe("asc");
  });

  it("under All invoices the request carries the sort and no currency", async () => {
    searchParams = new URLSearchParams({ invoice: "all", sort: "asc" });
    setupWeeks([PAIRED_WEEK]);
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("SAM")).toBeTruthy());
    const req = lastTableRequest();
    expect(req.currency).toBeUndefined();
    expect(req).toMatchObject({ sortField: "occurred_at", sortDirection: "asc" });
  });

  it("the filter-option seed fetch stays unsorted", async () => {
    searchParams = new URLSearchParams({ sort: "asc" });
    setupWeeks([PAIRED_WEEK]);
    render(<TransactionsPage />);
    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());
    const seeds = listTransactions.mock.calls.filter((c) => !(c[0] as { includeLines?: boolean }).includeLines);
    for (const c of seeds) expect(c[0]).not.toHaveProperty("sortDirection");
  });
});
