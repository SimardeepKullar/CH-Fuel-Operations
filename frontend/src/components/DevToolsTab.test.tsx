// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PLAN_FORM } from "../lib/planRequestForm";

const useTrucks = vi.fn();
vi.mock("../hooks/useTrucks", () => ({
  useTrucks: () => useTrucks(),
}));

const { default: DevToolsTab } = await import("./DevToolsTab");

afterEach(() => {
  cleanup();
  useTrucks.mockReset();
});

describe("DevToolsTab truck spec preview (T-56 — no separate truck-profile picker)", () => {
  it("a failed truck load says so and offers a retry", () => {
    const refetch = vi.fn();
    useTrucks.mockReturnValue({ trucks: [], loading: false, error: new Error("boom"), refetch });
    render(
      <DevToolsTab form={EMPTY_PLAN_FORM} onChange={() => {}} plan={null} loading={false} onApply={() => {}} applyDisabled />,
    );

    fireEvent.click(screen.getByRole("button", { name: /couldn.t load trucks/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("previews the spec of whichever truck PlanTab's own selector has picked, not a second picker of its own", () => {
    useTrucks.mockReturnValue({
      trucks: [{ id: "truck-1", unitNumber: "072", tankGallons: 200, avgMpg: 7.5, reserveFraction: 0.15 }],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <DevToolsTab
        form={{ ...EMPTY_PLAN_FORM, truckId: "truck-1" }}
        onChange={() => {}}
        plan={null}
        loading={false}
        onApply={() => {}}
        applyDisabled
      />,
    );

    expect(screen.getByText("Unit 072")).toBeTruthy();
    expect(screen.queryByLabelText("Truck profile")).toBeNull();
  });

  it("shows the spec fields blank, with a named gap, when the selected truck has none set", () => {
    useTrucks.mockReturnValue({
      trucks: [{ id: "truck-2", unitNumber: "057", tankGallons: null, avgMpg: null, reserveFraction: null }],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <DevToolsTab
        form={{ ...EMPTY_PLAN_FORM, truckId: "truck-2" }}
        onChange={() => {}}
        plan={null}
        loading={false}
        onApply={() => {}}
        applyDisabled
      />,
    );

    expect(screen.getByText(/Unit 057 has no mpg\/tank spec set/)).toBeTruthy();
  });
});
