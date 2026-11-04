// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/overview",
  useSearchParams: () => searchParams,
}));

const { parseTrendGrain, useTrendGrain } = await import("./useTrendGrain");

function Probe() {
  const { grain, setGrain } = useTrendGrain();
  return (
    <div>
      <span data-testid="grain">{grain}</span>
      <button onClick={() => setGrain("month")}>month</button>
      <button onClick={() => setGrain("week")}>week</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  replace.mockClear();
  searchParams = new URLSearchParams();
});

describe("useTrendGrain", () => {
  it("reads ?trend=month on load, and anything else as Week", () => {
    expect(parseTrendGrain(new URLSearchParams("trend=month"))).toBe("month");
    expect(parseTrendGrain(new URLSearchParams("trend=nonsense"))).toBe("week");
    expect(parseTrendGrain(new URLSearchParams(""))).toBe("week");
    searchParams = new URLSearchParams("trend=month");
    render(<Probe />);
    expect(screen.getByTestId("grain").textContent).toBe("month");
  });

  it("choosing Month writes ?trend=month and keeps the scope keys", () => {
    searchParams = new URLSearchParams("scope=range&from=2026-09-09&to=2026-10-28");
    render(<Probe />);
    fireEvent.click(screen.getByText("month"));
    expect(replace).toHaveBeenCalledWith("/overview?scope=range&from=2026-09-09&to=2026-10-28&trend=month");
  });

  it("choosing Week removes the key, leaving a clean URL", () => {
    searchParams = new URLSearchParams("trend=month");
    render(<Probe />);
    fireEvent.click(screen.getByText("week"));
    expect(replace).toHaveBeenCalledWith("/overview");
  });
});
