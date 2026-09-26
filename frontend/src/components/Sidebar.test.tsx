// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/";
const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}));

const useSession = vi.fn();
const signOut = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => useSession(),
  signOut: (...args: unknown[]) => signOut(...args),
}));

const { default: Sidebar, NAV_GROUPS } = await import("./Sidebar");

afterEach(() => {
  cleanup();
  pathname = "/";
  useSession.mockReset();
  signOut.mockClear();
});

describe("Sidebar (T-39 step 39.1, A7)", () => {
  it("renders A7's eleven destinations across three groups, plus Settings", () => {
    useSession.mockReturnValue({ data: { user: { name: "M. Hodson", role: "Dispatch" } } });
    render(<Sidebar pendingReceipts={null} />);

    const labels = [
      "New Plan",
      "Plans",
      "Overview",
      "Transactions",
      "Receipt Queue",
      "Other Charges",
      "Import",
      "Drivers",
      "Trucks",
      "Stations",
      "Plan vs Actual",
      "Settings",
    ];
    for (const label of labels) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("marks the active item from the current route, not a hard-coded default", () => {
    useSession.mockReturnValue({ data: { user: { name: "M. Hodson", role: "Dispatch" } } });
    pathname = "/transactions";
    render(<Sidebar pendingReceipts={null} />);

    expect(screen.getByText("Transactions").closest("a")!.className).toContain("active");
    expect(screen.getByText("New Plan").closest("a")!.className).not.toContain("active");
  });

  it("the Receipt Queue badge comes from the pendingReceipts prop, not a constant", () => {
    useSession.mockReturnValue({ data: { user: { name: "M. Hodson", role: "Dispatch" } } });
    const { rerender } = render(<Sidebar pendingReceipts={12} />);
    expect(screen.getByText("12")).toBeTruthy();

    rerender(<Sidebar pendingReceipts={0} />);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("shows the signed-in dispatcher and signs out via next-auth", () => {
    useSession.mockReturnValue({ data: { user: { name: "M. Hodson", role: "Dispatch" } } });
    render(<Sidebar pendingReceipts={null} />);
    expect(screen.getByText("M. Hodson")).toBeTruthy();
    expect(screen.getByText("Dispatch")).toBeTruthy();

    screen.getByRole("button", { name: /sign out/i }).click();
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/" });
  });

  it("tolerates a fourth nav group with no layout change (A18 Q4)", () => {
    useSession.mockReturnValue({ data: { user: { name: "M. Hodson", role: "Dispatch" } } });
    const withFourthGroup = [
      ...NAV_GROUPS,
      { group: "Ops", items: [{ label: "Dispatch Board", href: "/dispatch-board", built: false }] },
    ];
    render(<Sidebar pendingReceipts={null} groups={withFourthGroup} />);

    expect(screen.getByText("Ops")).toBeTruthy();
    expect(screen.getByText("Dispatch Board")).toBeTruthy();
  });
});
