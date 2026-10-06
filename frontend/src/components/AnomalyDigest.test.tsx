// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OverviewAnomalyDigestItem } from "@ch/core/actuals/overview";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const { default: AnomalyDigest, anomalyDigestHref } = await import("./AnomalyDigest");

afterEach(() => {
  cleanup();
  push.mockClear();
});

function item(overrides: Partial<OverviewAnomalyDigestItem> = {}): OverviewAnomalyDigestItem {
  return {
    id: "anom-1",
    fuelStopId: "stop-1",
    rule: "sub_gallon",
    severity: "red",
    detail: {},
    detectedAt: "2026-09-05T14:30:00.000Z",
    ...overrides,
  };
}

describe("anomalyDigestHref", () => {
  it("pre-applies anomalyOnly and carries the current week", () => {
    expect(anomalyDigestHref("2026-09-03")).toBe("/transactions?anomalyOnly=true&week=2026-09-03");
  });

  it("omits week when it isn't known yet, rather than writing 'null'", () => {
    expect(anomalyDigestHref(null)).toBe("/transactions?anomalyOnly=true");
  });
});

describe("AnomalyDigest (T-41 DoD: deep-links into Transactions with anomalyOnly applied)", () => {
  it("renders an empty state when nothing is flagged", () => {
    render(<AnomalyDigest items={[]} week="2026-09-03" />);
    expect(screen.getByText("No anomalies flagged")).toBeTruthy();
  });

  it("clicking an item navigates to Transactions with anomalyOnly and the week pre-applied", () => {
    render(<AnomalyDigest items={[item()]} week="2026-09-03" />);
    screen.getByText("Sub-gal").closest("a")!.click();
    expect(push).toHaveBeenCalledWith("/transactions?anomalyOnly=true&week=2026-09-03");
  });

  it("the header's view-all link goes to the same destination", () => {
    render(<AnomalyDigest items={[item()]} week="2026-09-03" />);
    screen.getByText("View flagged in Transactions →").click();
    expect(push).toHaveBeenCalledWith("/transactions?anomalyOnly=true&week=2026-09-03");
  });
});
