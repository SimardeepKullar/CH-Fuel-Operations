// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/transactions",
  useSearchParams: () => searchParams,
}));

const { useTransactionFilters } = await import("./useTransactionFilters");

function Probe() {
  const { filters, setFilter, clearFilters } = useTransactionFilters();
  return (
    <div>
      <span data-testid="driverId">{filters.driverId || "none"}</span>
      <span data-testid="anomalyOnly">{String(filters.anomalyOnly)}</span>
      <span data-testid="q">{filters.q || "none"}</span>
      <button onClick={() => setFilter("driverId", "driver-1")}>set driver</button>
      <button onClick={() => setFilter("driverId", "")}>clear driver</button>
      <button onClick={() => setFilter("anomalyOnly", true)}>flag only</button>
      <button onClick={() => clearFilters()}>clear all</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  replace.mockClear();
  searchParams = new URLSearchParams();
});

describe("useTransactionFilters (T-40)", () => {
  it("reads every filter from the URL, defaulting to empty/false", () => {
    render(<Probe />);
    expect(screen.getByTestId("driverId").textContent).toBe("none");
    expect(screen.getByTestId("anomalyOnly").textContent).toBe("false");
  });

  it("an explicit query string is read back as the filter state", () => {
    searchParams = new URLSearchParams({ driverId: "driver-1", anomalyOnly: "true", q: "jordan" });
    render(<Probe />);
    expect(screen.getByTestId("driverId").textContent).toBe("driver-1");
    expect(screen.getByTestId("anomalyOnly").textContent).toBe("true");
    expect(screen.getByTestId("q").textContent).toBe("jordan");
  });

  it("setFilter writes the value into the URL via router.replace, preserving other params", () => {
    searchParams = new URLSearchParams({ period: "2026-09-03" });
    render(<Probe />);
    act(() => screen.getByText("set driver").click());

    const url = new URL(replace.mock.calls[0]![0] as string, "http://localhost");
    expect(url.searchParams.get("driverId")).toBe("driver-1");
    expect(url.searchParams.get("period")).toBe("2026-09-03");
  });

  it("setFilter with an empty/false value removes the param rather than writing an empty one", () => {
    searchParams = new URLSearchParams({ driverId: "driver-1" });
    render(<Probe />);
    act(() => screen.getByText("clear driver").click());

    const url = new URL(replace.mock.calls[0]![0] as string, "http://localhost");
    expect(url.searchParams.has("driverId")).toBe(false);
  });

  it("clearFilters removes every filter key but keeps period", () => {
    searchParams = new URLSearchParams({
      period: "2026-09-03",
      driverId: "driver-1",
      anomalyOnly: "true",
      state: "TX",
    });
    render(<Probe />);
    act(() => screen.getByText("clear all").click());

    const url = new URL(replace.mock.calls[0]![0] as string, "http://localhost");
    expect(url.searchParams.has("driverId")).toBe(false);
    expect(url.searchParams.has("anomalyOnly")).toBe(false);
    expect(url.searchParams.has("state")).toBe(false);
    expect(url.searchParams.get("period")).toBe("2026-09-03");
  });
});
