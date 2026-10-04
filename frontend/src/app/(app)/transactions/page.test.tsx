// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionListItem } from "@ch/core/actuals/transactions";

const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
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

const { default: TransactionsPage } = await import("./page");

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
    receiptStatus: "confirmed",
    flags: [],
    lines: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  replace.mockClear();
  getHealth.mockReset();
  listPeriods.mockReset();
  listTransactions.mockReset();
  listDrivers.mockReset();
  listTrucks.mockReset();
  searchParams = new URLSearchParams();
});

describe("TransactionsPage (T-40)", () => {
  it("scopes GET /transactions to the shell's selected period, not a reconstructed date range", async () => {
    searchParams = new URLSearchParams({ period: "2026-09-03" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    listDrivers.mockResolvedValue({ week: "2026-09-03", invoiceId: "inv-1", rows: [], unresolved: {}, fleet: {} });
    listTrucks.mockResolvedValue({ rows: [] });
    listTransactions.mockResolvedValue({ rows: [stop()], page: 1, pageSize: 200, total: 1 });

    render(<TransactionsPage />);

    await waitFor(() => expect(screen.getByText("JORDAN")).toBeTruthy());
    const tableCall = listTransactions.mock.calls.find((c) => (c[0] as { pageSize?: number }).pageSize === 200 && (c[0] as { includeLines?: boolean }).includeLines);
    expect(tableCall![0]).toMatchObject({ week: "2026-09-03", currency: "USD", includeLines: true });
  });

  it("a driver filter in the URL is forwarded to GET /transactions as driverId", async () => {
    searchParams = new URLSearchParams({ period: "2026-09-03", driverId: "driver-1" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    listDrivers.mockResolvedValue({ week: "2026-09-03", invoiceId: "inv-1", rows: [], unresolved: {}, fleet: {} });
    listTrucks.mockResolvedValue({ rows: [] });
    listTransactions.mockResolvedValue({ rows: [], page: 1, pageSize: 200, total: 0 });

    render(<TransactionsPage />);

    await waitFor(() => expect(listTransactions).toHaveBeenCalled());
    const tableCall = listTransactions.mock.calls.find((c) => (c[0] as { includeLines?: boolean }).includeLines);
    expect(tableCall![0]).toMatchObject({ driverId: "driver-1" });
  });

  it("a search term in the URL narrows the rendered rows client-side, without re-fetching", async () => {
    searchParams = new URLSearchParams({ period: "2026-09-03", q: "jordan" });
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
    searchParams = new URLSearchParams({ period: "2026-09-03" });
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [] });
    listDrivers.mockResolvedValue({ week: "2026-09-03", invoiceId: "inv-1", rows: [], unresolved: {}, fleet: {} });
    listTrucks.mockResolvedValue({ rows: [] });
    listTransactions.mockRejectedValue(new Error("network down"));

    render(<TransactionsPage />);

    await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());
  });
});
