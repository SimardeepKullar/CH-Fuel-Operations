// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { OverviewTopSpendDriver } from "@ch/core/actuals/overview";
import { installResizeObserverMock } from "./testing/mockResizeObserver";
import TopSpendByDriver, { toTopSpendChartData } from "./TopSpendByDriver";

afterEach(cleanup);

function driver(overrides: Partial<OverviewTopSpendDriver> = {}): OverviewTopSpendDriver {
  return { driverId: "driver-1", driverName: "JORDAN", totalUsd: 500, gallons: 90, avgBilledUsdPerGal: 5.5, ...overrides };
}

describe("toTopSpendChartData", () => {
  it("shows an unresolved driver as unresolved, rather than guessing or dropping the row (A8.6/A9.2)", () => {
    const data = toTopSpendChartData([driver({ driverId: null, driverName: null })]);
    expect(data[0]!.label).toBe("Unresolved");
    expect(data[0]!.key).toBe("unresolved-0");
  });

  it("carries spend, gallons and avg billed price through unchanged", () => {
    const data = toTopSpendChartData([driver({ totalUsd: 1234.56, gallons: 200.5, avgBilledUsdPerGal: 5.2395 })]);
    expect(data[0]).toMatchObject({ totalUsd: 1234.56, gallons: 200.5, avgBilledUsdPerGal: 5.2395 });
  });
});

describe("TopSpendByDriver", () => {
  it("renders an empty state when no driver has spend this period, instead of an empty chart", () => {
    const { getByText } = render(<TopSpendByDriver drivers={[]} />);
    expect(getByText("No spend yet")).toBeTruthy();
  });

  it("mounts a Recharts bar chart for real data without throwing", async () => {
    installResizeObserverMock();
    const { container } = render(<TopSpendByDriver drivers={[driver(), driver({ driverId: "driver-2", driverName: "ROBIN" })]} />);
    await waitFor(() => expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(2));
  });
});
