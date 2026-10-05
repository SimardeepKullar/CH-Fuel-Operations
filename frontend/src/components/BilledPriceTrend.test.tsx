// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { OverviewTrendPoint } from "@ch/core/actuals/overview";
import { installResizeObserverMock } from "./testing/mockResizeObserver";
import BilledPriceTrend, { toTrendChartData } from "./BilledPriceTrend";

afterEach(cleanup);

function point(overrides: Partial<OverviewTrendPoint> = {}): OverviewTrendPoint {
  return { week: "2026-08-01", invoiceId: "inv-1", avgBilledPerUnit: 5.1, ...overrides };
}

describe("toTrendChartData (T-41 DoD: a period with no data is a gap, not a zero)", () => {
  it("passes a null avgBilledPerUnit through as null, never coerced to 0", () => {
    const data = toTrendChartData([
      point({ week: "2026-08-01", avgBilledPerUnit: 5.1 }),
      point({ week: "2026-08-08", avgBilledPerUnit: null }),
      point({ week: "2026-08-15", avgBilledPerUnit: 5.3 }),
    ]);
    expect(data.map((d) => d.value)).toEqual([5.1, null, 5.3]);
    expect(data[1]!.value).not.toBe(0);
  });

  it("formats each period as a short month/day label", () => {
    const data = toTrendChartData([point({ week: "2026-08-01" })]);
    expect(data[0]!.label).toBe("Aug 1");
  });
});

describe("BilledPriceTrend", () => {
  it("renders an empty state when no periods have ever imported, instead of an empty chart", () => {
    const { getByText } = render(<BilledPriceTrend points={[]} />);
    expect(getByText("No trend yet")).toBeTruthy();
  });

  it("mounts a Recharts line chart for real data without throwing", async () => {
    installResizeObserverMock();
    const { container } = render(
      <BilledPriceTrend
        points={[
          point({ week: "2026-08-01", avgBilledPerUnit: 5.1 }),
          point({ week: "2026-08-08", avgBilledPerUnit: null }),
          point({ week: "2026-08-15", avgBilledPerUnit: 5.3 }),
        ]}
      />,
    );
    await waitFor(() => expect(container.querySelector(".recharts-line")).toBeTruthy());
  });
});
