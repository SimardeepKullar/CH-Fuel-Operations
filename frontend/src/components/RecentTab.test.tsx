// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanListItem, PlanListResult } from "@ch/core/planning/planPersistence";

const listPlansMock = vi.fn();
vi.mock("../lib/api", () => ({
  listPlans: (...args: unknown[]) => listPlansMock(...args),
}));

const { default: RecentTab } = await import("./RecentTab");

function trip(overrides: Partial<PlanListItem> & Pick<PlanListItem, "planId" | "status">): PlanListItem {
  return {
    createdAt: "2026-09-22T12:00:00.000Z",
    origin: { label: "Bakersfield, CA" },
    destination: { label: "Reno, NV" },
    truck: { id: "truck-1", unitNumber: "760" },
    distanceMiles: 486.5,
    savingsVsBaselineUsd: 41,
    sentToDriver: false,
    sentToDriverAt: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  listPlansMock.mockReset();
});

describe("RecentTab", () => {
  it("styles an infeasible row distinctly from a completed one", async () => {
    const result: PlanListResult = {
      plans: [
        trip({ planId: "T-1", status: "completed" }),
        trip({ planId: "T-2", status: "infeasible", distanceMiles: null, savingsVsBaselineUsd: null }),
      ],
      page: 1,
      pageSize: 25,
      total: 2,
    };
    listPlansMock.mockResolvedValue(result);
    render(<RecentTab currentPlanId={null} onOpenPlan={() => {}} />);

    const completedRow = await screen.findByText("T-1");
    const infeasibleRow = screen.getByText("T-2");
    expect(completedRow.closest(".trip-row")!.className).not.toContain("infeasible");
    expect(infeasibleRow.closest(".trip-row")!.className).toContain("infeasible");
  });

  it("no trips: a named empty state, not a blank table", async () => {
    listPlansMock.mockResolvedValue({ plans: [], page: 1, pageSize: 25, total: 0 });
    render(<RecentTab currentPlanId={null} onOpenPlan={() => {}} />);

    expect(await screen.findByText("No trips planned yet.")).toBeTruthy();
  });

  it("a failed list load says so rather than rendering nothing", async () => {
    listPlansMock.mockRejectedValue(new Error("network down"));
    render(<RecentTab currentPlanId={null} onOpenPlan={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/network down/);
  });
});
