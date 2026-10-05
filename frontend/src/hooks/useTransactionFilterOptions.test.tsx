// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const listDrivers = vi.fn();
const listTrucks = vi.fn();
const listTransactions = vi.fn();
vi.mock("../lib/api", () => ({
  listDrivers: (...args: unknown[]) => listDrivers(...args),
  listTrucks: (...args: unknown[]) => listTrucks(...args),
  listTransactions: (...args: unknown[]) => listTransactions(...args),
}));

const { useTransactionFilterOptions } = await import("./useTransactionFilterOptions");

function Probe({ period, currency = "USD" }: { period: string | null; currency?: "USD" | "CAD" }) {
  const { drivers, trucks, cards, states, loading } = useTransactionFilterOptions(period, currency);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <ul data-testid="drivers">{drivers.map((d) => <li key={d.value}>{d.label}</li>)}</ul>
      <ul data-testid="trucks">{trucks.map((t) => <li key={t.value}>{t.label}</li>)}</ul>
      <ul data-testid="cards">{cards.map((c) => <li key={c.value}>{c.label}</li>)}</ul>
      <ul data-testid="states">{states.map((s) => <li key={s.value}>{s.label}</li>)}</ul>
    </div>
  );
}

afterEach(() => {
  cleanup();
  listDrivers.mockReset();
  listTrucks.mockReset();
  listTransactions.mockReset();
});

describe("useTransactionFilterOptions (T-40)", () => {
  it("drivers and trucks come from their roster endpoints; cards and states are derived from one unfiltered fetch", async () => {
    listDrivers.mockResolvedValue({
      week: "2026-09-03",
      invoiceId: "inv-1",
      rows: [
        { driver: { id: "d1", displayName: "JORDAN" }, totalUsd: 0, gallons: 0, avgBilledUsdPerGal: null },
        { driver: { id: "d2", displayName: "CASEY" }, totalUsd: 0, gallons: 0, avgBilledUsdPerGal: null },
      ],
      unresolved: {},
      fleet: {},
    });
    listTrucks.mockResolvedValue({ rows: [{ id: "t1", unitNumber: "072" }] });
    listTransactions.mockResolvedValue({
      rows: [
        { id: "s1", card: { id: "c1", number: "9000005" }, station: { id: "st1", loveNumber: 294, city: "Dallas", state: "TX" } },
        { id: "s2", card: { id: "c2", number: "1111111" }, station: { id: "st2", loveNumber: 100, city: "Reno", state: "NV" } },
      ],
      page: 1,
      pageSize: 200,
      total: 2,
    });

    render(<Probe period="2026-09-03" />);

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("drivers").textContent).toBe("CASEYJORDAN");
    expect(screen.getByTestId("trucks").textContent).toBe("072");
    expect(screen.getByTestId("cards").textContent).toBe("11111119000005");
    expect(screen.getByTestId("states").textContent).toBe("NVTX");

    expect(listDrivers).toHaveBeenCalledWith("2026-09-03", "USD");
    expect(listTransactions).toHaveBeenCalledWith(expect.objectContaining({ week: "2026-09-03", currency: "USD", pageSize: 200 }));
  });

  it("no period yet: skips the period-scoped fetches rather than erroring", () => {
    listTrucks.mockResolvedValue({ rows: [] });
    render(<Probe period={null} />);
    expect(listDrivers).not.toHaveBeenCalled();
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it("passes the side through: a CAD screen reads CAD drivers and CAD transactions", async () => {
    listDrivers.mockResolvedValue({ week: "2026-09-09", invoiceId: "inv-3", rows: [], unresolved: {}, fleet: {} });
    listTrucks.mockResolvedValue({ rows: [] });
    listTransactions.mockResolvedValue({ rows: [], page: 1, pageSize: 200, total: 0 });

    render(<Probe period="2026-09-09" currency="CAD" />);

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(listDrivers).toHaveBeenCalledWith("2026-09-09", "CAD");
    expect(listTransactions).toHaveBeenCalledWith(expect.objectContaining({ week: "2026-09-09", currency: "CAD" }));
  });
});
