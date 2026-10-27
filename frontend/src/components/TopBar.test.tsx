// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const getHealth = vi.fn();
const listPeriods = vi.fn();
vi.mock("../lib/api", () => ({
  getHealth: (...args: unknown[]) => getHealth(...args),
  listPeriods: (...args: unknown[]) => listPeriods(...args),
}));

const { default: TopBarInner } = await import("./TopBar");
const { WeekProvider } = await import("../hooks/useWeek");

function TopBar() {
  return (
    <WeekProvider>
      <TopBarInner />
    </WeekProvider>
  );
}

afterEach(() => {
  cleanup();
  pathname = "/";
  getHealth.mockReset();
  listPeriods.mockReset();
});

function setup() {
  getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-03", openAnomalyCount: 3 });
  listPeriods.mockResolvedValue({ weeks: [] });
}

describe("TopBar — the default page banner (T-75)", () => {
  it("draws nothing over screens that render their own banner", () => {
    setup();
    for (const route of ["/", "/plans", "/overview", "/transactions", "/import", "/plan-actual"]) {
      pathname = route;
      const { container, unmount } = render(<TopBar />);
      expect(container.innerHTML).toBe("");
      unmount();
    }
  });

  it("draws a PageBanner with the screen's title elsewhere", () => {
    setup();
    pathname = "/receipt-queue";
    render(<TopBar />);
    expect(screen.getByTestId("page-banner")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Receipt Queue" })).toBeTruthy();
  });

  it("shows the billing-week selector on the week-governed screens and not on Settings", () => {
    setup();
    pathname = "/drivers";
    render(<TopBar />);
    expect(screen.getByLabelText("Billing week")).toBeTruthy();

    cleanup();
    pathname = "/settings";
    render(<TopBar />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByLabelText("Billing week")).toBeNull();
  });
});
