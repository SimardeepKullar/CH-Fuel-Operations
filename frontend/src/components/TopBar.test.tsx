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

function TopBar(props: React.ComponentProps<typeof TopBarInner>) {
  return (
    <WeekProvider>
      <TopBarInner {...props} />
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

describe("TopBar (T-39 step 39.2, A7)", () => {
  it("hides the billing-week selector on Plan screens", () => {
    setup();
    pathname = "/";
    render(<TopBar receipts={{ done: 48, total: 60 }} flags={3} />);
    expect(screen.queryByLabelText("Billing week")).toBeNull();

    cleanup();
    pathname = "/plans";
    render(<TopBar receipts={{ done: 48, total: 60 }} flags={3} />);
    expect(screen.queryByLabelText("Billing week")).toBeNull();
  });

  it("shows the billing-week selector on Actuals/Analysis screens", () => {
    setup();
    pathname = "/transactions";
    render(<TopBar receipts={{ done: 48, total: 60 }} flags={3} />);
    expect(screen.getByLabelText("Billing week")).toBeTruthy();
  });

  it("renders the standing receipts and flags counts from props, not constants", () => {
    setup();
    pathname = "/transactions";
    render(<TopBar receipts={{ done: 48, total: 60 }} flags={3} />);
    expect(screen.getByText("48/60")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("hides the standing receipts/flags counts everywhere except Transactions", () => {
    setup();
    for (const route of ["/", "/plans", "/overview", "/receipt-queue", "/other-charges", "/plan-actual"]) {
      pathname = route;
      const { unmount } = render(<TopBar receipts={{ done: 48, total: 60 }} flags={3} />);
      expect(screen.queryByText("48/60")).toBeNull();
      expect(screen.queryByText("Receipts")).toBeNull();
      unmount();
    }
  });

  it("renders an em dash rather than 0 when the counts are still unknown", () => {
    setup();
    pathname = "/transactions";
    render(<TopBar receipts={null} flags={null} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("shows a screen-specific title per route", () => {
    setup();
    pathname = "/transactions";
    render(<TopBar receipts={null} flags={null} />);
    expect(screen.getByText("Actuals · Transactions")).toBeTruthy();
  });
});
