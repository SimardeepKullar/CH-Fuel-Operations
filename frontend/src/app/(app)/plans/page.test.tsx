// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanListItem } from "@ch/core/planning/planPersistence";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const listPlans = vi.fn();
vi.mock("../../../lib/api", () => ({ listPlans: (...args: unknown[]) => listPlans(...args) }));

const { default: PlansPage } = await import("./page");

const plan = (planId: string, sentToDriver: boolean): PlanListItem => ({
  planId,
  createdAt: "2026-09-10T15:00:00.000Z",
  origin: { label: "Toronto" },
  destination: { label: "Chicago" },
  status: "completed",
  truck: { id: "t1", unitNumber: "101" },
  distanceMiles: 520,
  savingsVsBaselineUsd: 40,
  sentToDriver,
  sentToDriverAt: sentToDriver ? "2026-09-10T16:00:00.000Z" : null,
});

afterEach(() => {
  cleanup();
  listPlans.mockReset();
});

describe("PlansPage — the page banner (T-75)", () => {
  it("filters the list by whether the plan has gone to the driver", async () => {
    listPlans.mockResolvedValue({ plans: [plan("PLAN-A", false), plan("PLAN-B", true)], page: 1, pageSize: 25, total: 2 });
    render(<PlansPage />);
    await waitFor(() => expect(screen.getByText("PLAN-A")).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Plans" })).toBeTruthy();
    expect(screen.getByText("PLAN-B")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Draft" }));
    expect(screen.getByText("PLAN-A")).toBeTruthy();
    expect(screen.queryByText("PLAN-B")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sent" }));
    expect(screen.queryByText("PLAN-A")).toBeNull();
    expect(screen.getByText("PLAN-B")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("PLAN-A")).toBeTruthy();
  });
});
