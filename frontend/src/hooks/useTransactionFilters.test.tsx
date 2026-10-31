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
      <span data-testid="sort">{filters.sort || "none"}</span>
      <button onClick={() => setFilter("sort", "asc")}>sort asc</button>
      <button onClick={() => setFilter("sort", "")}>sort default</button>
      <span data-testid="from">{filters.from || "none"}</span>
      <span data-testid="to">{filters.to || "none"}</span>
      <button onClick={() => setFilter("from", "2026-09-08")}>set from</button>
      <button onClick={() => setFilter("to", "")}>clear to</button>
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

  it("sort defaults to newest first and reads sort=asc from the URL (T-40J)", () => {
    render(<Probe />);
    expect(screen.getByTestId("sort").textContent).toBe("none");
    cleanup();
    searchParams = new URLSearchParams({ sort: "asc" });
    render(<Probe />);
    expect(screen.getByTestId("sort").textContent).toBe("asc");
  });

  it("an unknown sort value reads as the default", () => {
    searchParams = new URLSearchParams({ sort: "sideways" });
    render(<Probe />);
    expect(screen.getByTestId("sort").textContent).toBe("none");
  });

  it("sort=asc is written when oldest first and removed again for the default", () => {
    render(<Probe />);
    act(() => screen.getByText("sort asc").click());
    expect(new URL(replace.mock.calls[0]![0] as string, "http://localhost").searchParams.get("sort")).toBe("asc");

    cleanup();
    searchParams = new URLSearchParams({ sort: "asc", driverId: "driver-1" });
    render(<Probe />);
    act(() => screen.getByText("sort default").click());
    const url = new URL(replace.mock.calls[1]![0] as string, "http://localhost");
    expect(url.searchParams.has("sort")).toBe(false);
    expect(url.searchParams.get("driverId")).toBe("driver-1");
  });

  it("clearFilters resets sort along with the filters", () => {
    searchParams = new URLSearchParams({ sort: "asc", state: "TX", period: "2026-09-03" });
    render(<Probe />);
    act(() => screen.getByText("clear all").click());
    const url = new URL(replace.mock.calls[0]![0] as string, "http://localhost");
    expect(url.searchParams.has("sort")).toBe(false);
    expect(url.searchParams.get("period")).toBe("2026-09-03");
  });

  it("from and to read back from the URL, each defaulting to empty (T-83)", () => {
    render(<Probe />);
    expect(screen.getByTestId("from").textContent).toBe("none");
    expect(screen.getByTestId("to").textContent).toBe("none");
    cleanup();
    searchParams = new URLSearchParams({ from: "2026-09-08" });
    render(<Probe />);
    expect(screen.getByTestId("from").textContent).toBe("2026-09-08");
    expect(screen.getByTestId("to").textContent).toBe("none");
  });

  it("from is written to the URL and to is removed when emptied, keeping the other params (T-83)", () => {
    searchParams = new URLSearchParams({ to: "2026-09-09", week: "2026-09-10" });
    render(<Probe />);
    act(() => screen.getByText("set from").click());
    const written = new URL(replace.mock.calls[0]![0] as string, "http://localhost");
    expect(written.searchParams.get("from")).toBe("2026-09-08");
    expect(written.searchParams.get("to")).toBe("2026-09-09");
    act(() => screen.getByText("clear to").click());
    const cleared = new URL(replace.mock.calls[1]![0] as string, "http://localhost");
    expect(cleared.searchParams.has("to")).toBe(false);
    expect(cleared.searchParams.get("week")).toBe("2026-09-10");
  });

  it("clearFilters resets from and to but keeps the scope (T-83)", () => {
    searchParams = new URLSearchParams({ from: "2026-09-08", to: "2026-09-09", week: "2026-09-10" });
    render(<Probe />);
    act(() => screen.getByText("clear all").click());
    const url = new URL(replace.mock.calls[0]![0] as string, "http://localhost");
    expect(url.searchParams.has("from")).toBe(false);
    expect(url.searchParams.has("to")).toBe(false);
    expect(url.searchParams.get("week")).toBe("2026-09-10");
  });
});
