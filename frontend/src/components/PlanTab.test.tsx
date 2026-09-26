// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PriceSheetSummary } from "@ch/core/catalog/priceSheets";
import type { InfeasiblePlanResponse } from "@ch/core/domain/planResponse";
import { lastMap, mapInstances, resetFakeMaplibre } from "../map/testing/fakeMaplibre";
import { COMPLETED_PLAN } from "../map/testing/planFixture";
import { LAYER, SOURCE } from "../map/layers";

const usePriceSheets = vi.fn();
vi.mock("../hooks/usePriceSheets", () => ({
  usePriceSheets: () => usePriceSheets(),
}));

interface UseTrucksResult {
  trucks: { id: string; unitNumber: string }[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

// Defaulted (not reset in afterEach) so the 21 existing cases below, which
// predate the truck selector's move into this component (T-39, UI-DATA-
// CONTRACT §2), don't each need their own mock — only the cases that care
// about the truck list set it explicitly.
const useTrucks = vi.fn<() => UseTrucksResult>(() => ({ trucks: [], loading: false, error: null, refetch: vi.fn() }));
vi.mock("../hooks/useTrucks", () => ({
  useTrucks: () => useTrucks(),
}));

const { patchPlanMock, listStationsMock } = vi.hoisted(() => ({
  patchPlanMock: vi.fn(),
  listStationsMock: vi.fn().mockResolvedValue({ stations: [], page: 1, pageSize: 500, total: 0 }),
}));
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, patchPlan: patchPlanMock, listStations: listStationsMock };
});

// MapLibre needs WebGL, which jsdom lacks (see RouteMap.test.tsx).
vi.mock("maplibre-gl", async () => (await import("../map/testing/fakeMaplibre")).fakeMaplibreModule);

const { default: PlanTab } = await import("./PlanTab");
const { ApiError } = await import("../lib/api");

const SHEETS: PriceSheetSummary[] = [
  { id: "s1", effectiveOn: "2026-09-22", importedAt: "2026-09-22T05:58:00Z", rowCount: 605, stationCount: 412 },
  { id: "s2", effectiveOn: "2026-09-21", importedAt: "2026-09-21T05:58:00Z", rowCount: 605, stationCount: 410 },
];

const INFEASIBLE_PLAN: InfeasiblePlanResponse = {
  planId: "plan-infeasible",
  createdAt: "2026-09-22T12:00:00.000Z",
  units: "imperial",
  origin: { label: "Hartford, CT", location: { lat: 41.7658, lng: -72.6734 } },
  destination: { label: "Newark, NJ", location: { lat: 40.7357, lng: -74.1724 } },
  truckId: "truck-infeasible",
  candidateStations: [
    {
      id: "st-near",
      name: "Love's #900",
      city: "Springfield",
      state: "MA",
      location: { lat: 42.1015, lng: -72.5898 },
      unitPriceUsd: 3.99,
      distanceAlongRouteMiles: 40.2,
      detourMiles: 5.1,
    },
  ],
  status: "infeasible",
  reason: {
    code: "LEG_GAP",
    message: "No station covers the gap between mile 120 and mile 640.",
    gapStartMile: 120,
    gapEndMile: 640,
    gapMiles: 520,
    maxLegMiles: 500,
    suggestions: [
      { action: "increaseMaxLeg", maxLegMiles: 560 },
      { action: "increaseDetour", maxDetourMiles: 25 },
    ],
  },
};

function renderPlanTab(overrides: Partial<Parameters<typeof PlanTab>[0]> = {}) {
  return render(
    <PlanTab
      plan={null}
      loading={false}
      error={null}
      originAddress=""
      destinationAddress=""
      onOriginChange={() => {}}
      onDestinationChange={() => {}}
      truckId={null}
      onTruckIdChange={() => {}}
      priceEffectiveOn={null}
      onPriceEffectiveOnChange={() => {}}
      onPlanRoute={() => {}}
      planDisabled={false}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
  usePriceSheets.mockReset();
  patchPlanMock.mockReset();
  listStationsMock.mockReset();
  listStationsMock.mockResolvedValue({ stations: [], page: 1, pageSize: 500, total: 0 });
  resetFakeMaplibre();
});

describe("PlanTab truck selector (T-39: moved off the old Header/TopBar, UI-DATA-CONTRACT §2)", () => {
  it("lists the real fleet roster by unit_number, unpadded (D18) — not truck_profiles", () => {
    usePriceSheets.mockReturnValue({ sheets: [], loading: false, error: null });
    useTrucks.mockReturnValue({
      trucks: [
        { id: "aaaaaaaa-0000-0000-0000-000000000000", unitNumber: "031" },
        { id: "bbbbbbbb-0000-0000-0000-000000000000", unitNumber: "1012" },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPlanTab();

    const select = screen.getByLabelText("Truck") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.textContent);
    expect(optionValues).toContain("031");
    expect(optionValues).toContain("1012");
    expect(optionValues).not.toContain("31");
  });

  it("a failed roster load says so and offers a retry, instead of an empty dropdown", () => {
    usePriceSheets.mockReturnValue({ sheets: [], loading: false, error: null });
    const refetch = vi.fn();
    useTrucks.mockReturnValue({ trucks: [], loading: false, error: new Error("boom"), refetch });
    renderPlanTab();

    fireEvent.click(screen.getByRole("button", { name: /couldn.t load trucks/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("selecting a truck calls onTruckIdChange with its id", () => {
    usePriceSheets.mockReturnValue({ sheets: [], loading: false, error: null });
    useTrucks.mockReturnValue({
      trucks: [{ id: "aaaaaaaa-0000-0000-0000-000000000000", unitNumber: "031" }],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const onTruckIdChange = vi.fn();
    renderPlanTab({ onTruckIdChange });

    fireEvent.change(screen.getByLabelText("Truck"), { target: { value: "aaaaaaaa-0000-0000-0000-000000000000" } });
    expect(onTruckIdChange).toHaveBeenCalledWith("aaaaaaaa-0000-0000-0000-000000000000");
  });
});

describe("PlanTab sheet picker", () => {
  it("lists real imports from GET /price-sheets, newest first", () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    renderPlanTab();

    const select = screen.getByLabelText("Fuel prices effective") as HTMLSelectElement;
    expect(select.options).toHaveLength(2);
    expect(select.options[0]!.value).toBe("2026-09-22");
    expect(select.options[1]!.value).toBe("2026-09-21");
  });

  it("a failed sheet load says so and offers a retry, not 'No price sheet imported yet'", () => {
    const refetch = vi.fn();
    usePriceSheets.mockReturnValue({ sheets: [], loading: false, error: new Error("boom"), refetch });
    renderPlanTab();

    expect(screen.queryByText(/No price sheet imported yet/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /couldn.t load price sheets/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("selecting the newest sheet shows the loaded note, not archived", () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    const { container } = renderPlanTab({ priceEffectiveOn: null });

    expect(container.querySelector(".plan-right")!.className).not.toContain("sheet-archived");
    expect(screen.getByText(/412 stations/)).toBeTruthy();
  });

  it("selecting a non-newest sheet reports its date and applies archived styling", () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    const onPriceEffectiveOnChange = vi.fn();
    const { container, rerender } = renderPlanTab({ onPriceEffectiveOnChange });

    fireEvent.change(screen.getByLabelText("Fuel prices effective"), { target: { value: "2026-09-21" } });
    expect(onPriceEffectiveOnChange).toHaveBeenCalledWith("2026-09-21");

    rerender(
      <PlanTab
        plan={null}
        loading={false}
        error={null}
        originAddress=""
        destinationAddress=""
        onOriginChange={() => {}}
        onDestinationChange={() => {}}
        truckId={null}
        onTruckIdChange={() => {}}
        priceEffectiveOn="2026-09-21"
        onPriceEffectiveOnChange={onPriceEffectiveOnChange}
        onPlanRoute={() => {}}
        planDisabled={false}
      />,
    );

    expect(container.querySelector(".plan-right")!.className).toContain("sheet-archived");
    expect(screen.getByText(/Archived sheet/)).toBeTruthy();
  });
});

describe("PlanTab map-layer toggles (T-23 step 23.2, drift item 1)", () => {
  it("fetches every resolved station eagerly, not scoped to this plan's route, so the button's count is real before it's ever toggled on", async () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    listStationsMock.mockResolvedValue({
      stations: [
        { id: "a", name: "Love's #1", storeNumber: 1, city: "X", state: "TX", location: { lat: 36, lng: -120 }, resolution: "exact", uncertaintyMiles: 0, truckAccessible: "operator_verified" },
        { id: "b", name: "Love's #2", storeNumber: 2, city: "Y", state: "TX", location: { lat: 37, lng: -120 }, resolution: "exact", uncertaintyMiles: 0, truckAccessible: "operator_verified" },
        { id: "c", name: "Love's #3", storeNumber: 3, city: "Z", state: "TX", location: { lat: 38, lng: -120 }, resolution: "exact", uncertaintyMiles: 0, truckAccessible: "operator_verified" },
      ],
      page: 1,
      pageSize: 500,
      total: 3,
    });
    renderPlanTab({ plan: COMPLETED_PLAN });

    // Loading state first — never a misleading "(0)" while the fetch is in flight.
    expect(screen.getByRole("button", { name: "Show all sheet stations on map…" })).toBeTruthy();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Show all sheet stations on map (3)" })).toBeTruthy(),
    );
    expect(listStationsMock).toHaveBeenCalledTimes(1);
    // Continental US, not this plan's own route bbox — a bbox scoped to one
    // route was itself a guess about how far off-route a station could sit
    // (T-23 follow-up); fetching everything (~600 rows) removes that guess.
    expect(listStationsMock.mock.calls[0]![0]).toMatchObject({ west: -125, south: 24, east: -66, north: 50, page: 1 });
  });

  it("fetches the same station set regardless of which plan (or no plan) is open", async () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    renderPlanTab({ plan: null });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Show all sheet stations on map (0)" })).toBeTruthy(),
    );
    expect(listStationsMock.mock.calls[0]![0]).toMatchObject({ west: -125, south: 24, east: -66, north: 50 });
  });

  it("pages through GET /stations until every station in the bbox is collected", async () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    listStationsMock
      .mockResolvedValueOnce({
        stations: Array.from({ length: 2 }, (_, i) => ({
          id: `st-${i}`,
          name: `Love's #${i}`,
          storeNumber: i,
          city: "Reno",
          state: "NV",
          location: { lat: 39.5, lng: -119.8 },
          resolution: "exact" as const,
          uncertaintyMiles: 0,
          truckAccessible: "operator_verified" as const,
        })),
        page: 1,
        pageSize: 500,
        // Above the hook's own 500-per-page size, so a second page is required.
        total: 501,
      })
      .mockResolvedValueOnce({
        stations: [
          { id: "st-2", name: "Love's #2", storeNumber: 2, city: "Reno", state: "NV", location: { lat: 39.5, lng: -119.8 }, resolution: "exact", uncertaintyMiles: 0, truckAccessible: "operator_verified" },
        ],
        page: 2,
        pageSize: 500,
        total: 501,
      });
    renderPlanTab({ plan: COMPLETED_PLAN });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Show all sheet stations on map (3)" })).toBeTruthy(),
    );
    expect(listStationsMock).toHaveBeenCalledTimes(2);
    expect(listStationsMock.mock.calls[1]![0]).toMatchObject({ page: 2 });
  });

  it("a failed sheet-stations load says so and offers a retry, instead of a silently stuck (0)", async () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    listStationsMock.mockRejectedValue(new Error("boom"));
    renderPlanTab({ plan: COMPLETED_PLAN });

    const retry = await screen.findByRole("button", { name: /couldn.t load sheet stations/i });
    // The toggle itself is disabled while nothing loaded — turning it "on"
    // would show an empty layer that reads as "no stations exist".
    expect((screen.getByRole("button", { name: "Show all sheet stations on map" }) as HTMLButtonElement).disabled).toBe(true);

    listStationsMock.mockResolvedValue({
      stations: [
        { id: "a", name: "Love's #1", storeNumber: 1, city: "X", state: "TX", location: { lat: 36, lng: -120 }, resolution: "exact", uncertaintyMiles: 0, truckAccessible: "operator_verified" },
      ],
      page: 1,
      pageSize: 500,
      total: 1,
    });
    fireEvent.click(retry);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Show all sheet stations on map (1)" })).toBeTruthy(),
    );
  });

  it("the in-corridor count is candidates minus chosen: no candidate id overlaps a chosen stop", () => {
    const chosenIds = new Set(COMPLETED_PLAN.stops.map((s) => s.station.id));
    for (const candidate of COMPLETED_PLAN.candidateStations) {
      expect(chosenIds.has(candidate.id)).toBe(false);
    }
  });

  it("each toggle flips only its own map layer, independently of the other", async () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    renderPlanTab({ plan: COMPLETED_PLAN });
    await waitFor(() => expect(mapInstances()).toHaveLength(1));
    const map = lastMap();
    act(() => map.fire("style.load"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Show all sheet stations on map (0)" })).toBeTruthy(),
    );

    expect(map.getLayoutProperty(LAYER.candidate, "visibility")).toBe("none");
    expect(map.getLayoutProperty(LAYER.sheet, "visibility")).toBe("none");

    fireEvent.click(screen.getByRole("button", { name: "Show in-corridor not selected (2)" }));
    expect(map.getLayoutProperty(LAYER.candidate, "visibility")).toBe("visible");
    expect(map.getLayoutProperty(LAYER.sheet, "visibility")).toBe("none");

    fireEvent.click(screen.getByRole("button", { name: "Show all sheet stations on map (0)" }));
    expect(map.getLayoutProperty(LAYER.sheet, "visibility")).toBe("visible");
    expect(map.getLayoutProperty(LAYER.candidate, "visibility")).toBe("visible");

    fireEvent.click(screen.getByRole("button", { name: "Hide in-corridor not selected" }));
    expect(map.getLayoutProperty(LAYER.candidate, "visibility")).toBe("none");
    expect(map.getLayoutProperty(LAYER.sheet, "visibility")).toBe("visible");
  });
});

describe("PlanTab 'Cheapest along route' row hover (T-23 follow-up)", () => {
  it("hovering a row shows that station on the map, even though its layer's toggle is off; leaving clears it", async () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    renderPlanTab({ plan: COMPLETED_PLAN });
    await waitFor(() => expect(mapInstances()).toHaveLength(1));
    const map = lastMap();
    act(() => map.fire("style.load"));

    // Love's #501 (st-madera) is an unselected candidate — its layer is off by default.
    expect(map.getLayoutProperty(LAYER.candidate, "visibility")).toBe("none");
    const row = screen.getByText("Love's #501").closest(".price-bar-row")!;

    fireEvent.mouseEnter(row);
    await waitFor(() => {
      const highlight = map.getSource(SOURCE.highlight)!.data as { features: unknown[] };
      expect(highlight.features).toHaveLength(1);
    });
    expect(map.getLayoutProperty(LAYER.candidate, "visibility")).toBe("none");
    expect(screen.getByRole("tooltip").textContent).toMatch(/Love's #501/);

    fireEvent.mouseLeave(row);
    await waitFor(() => {
      const highlight = map.getSource(SOURCE.highlight)!.data as { features: unknown[] };
      expect(highlight.features).toHaveLength(0);
    });
  });
});

describe("PlanTab 'Sent to driver' checkbox (UI-DATA-CONTRACT §3.10)", () => {
  it("ticking it calls PATCH and stays checked across a reload", async () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    patchPlanMock.mockResolvedValue({ planId: COMPLETED_PLAN.planId, sentToDriver: true, sentToDriverAt: "2026-09-22T13:00:00.000Z" });
    const { rerender } = renderPlanTab({ plan: COMPLETED_PLAN });

    const checkbox = screen.getByLabelText("Sent to driver") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    await waitFor(() => expect(patchPlanMock).toHaveBeenCalledWith(COMPLETED_PLAN.planId, { sentToDriver: true }));

    // "Reload" — the parent re-fetched the plan and now the server value agrees.
    rerender(
      <PlanTab
        plan={{ ...COMPLETED_PLAN, sentToDriver: true, sentToDriverAt: "2026-09-22T13:00:00.000Z" }}
        loading={false}
        error={null}
        originAddress=""
        destinationAddress=""
        onOriginChange={() => {}}
        onDestinationChange={() => {}}
        truckId={null}
        onTruckIdChange={() => {}}
        priceEffectiveOn={null}
        onPriceEffectiveOnChange={() => {}}
        onPlanRoute={() => {}}
        planDisabled={false}
      />,
    );
    expect((screen.getByLabelText("Sent to driver") as HTMLInputElement).checked).toBe(true);
  });

  it("a failed PATCH reverts the optimistic check", async () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    patchPlanMock.mockRejectedValue(new Error("network down"));
    renderPlanTab({ plan: COMPLETED_PLAN });

    const checkbox = screen.getByLabelText("Sent to driver") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    await waitFor(() => expect(checkbox.checked).toBe(false));
  });
});

describe("PlanTab disclaimers (§8)", () => {
  it("every disclaimer renders; the truck-legality one sits in the driver-link card, not twice", () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    const plan = {
      ...COMPLETED_PLAN,
      disclaimers: [
        { code: "GOOGLE_LINK_NOT_TRUCK_LEGAL" as const, message: "The Google Maps link does not check truck restrictions." },
        { code: "PRICE_STALENESS" as const, message: "Prices reflect the BVD sheet effective 2026-09-22." },
      ],
    };
    renderPlanTab({ plan });

    expect(screen.getByText("The Google Maps link does not check truck restrictions.").closest(".driver-link-note")).toBeTruthy();
    expect(screen.getAllByText("The Google Maps link does not check truck restrictions.")).toHaveLength(1);
    expect(screen.getByText("Prices reflect the BVD sheet effective 2026-09-22.")).toBeTruthy();
  });
});

describe("PlanTab infeasible plan (§8)", () => {
  it("renders the reason, gap miles, every suggestion, and the candidates the corridor still found", () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    renderPlanTab({ plan: INFEASIBLE_PLAN });

    expect(screen.getByText(INFEASIBLE_PLAN.reason.message)).toBeTruthy();
    expect(screen.getByText(/520\.0 mi/)).toBeTruthy();
    expect(screen.getByText(/560\.0 mi/)).toBeTruthy();
    expect(screen.getByText(/25\.0 mi/)).toBeTruthy();
    expect(screen.getByText(/Love's #900/)).toBeTruthy();
  });
});

describe("PlanTab error states (§8)", () => {
  it("a geocode failure (422) reads distinctly from a provider outage (502)", () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    const geocodeError = new ApiError({ title: "Unprocessable Location", status: 422, detail: "Could not geocode 'asdf'" });
    const { rerender } = renderPlanTab({ error: geocodeError });
    const geocodeText = screen.getByText(/Could not geocode/).textContent;

    rerender(
      <PlanTab
        plan={null}
        loading={false}
        error={new ApiError({ title: "Upstream Provider Error", status: 502, detail: "ORS timed out" })}
        originAddress=""
        destinationAddress=""
        onOriginChange={() => {}}
        onDestinationChange={() => {}}
        truckId={null}
        onTruckIdChange={() => {}}
        priceEffectiveOn={null}
        onPriceEffectiveOnChange={() => {}}
        onPlanRoute={() => {}}
        planDisabled={false}
      />,
    );
    const providerText = screen.getByText(/routing provider/i).textContent;

    expect(geocodeText).not.toBe(providerText);
  });
});

describe("PlanTab conditional captions (§3.5)", () => {
  it("names the short legs when MIN_LEG_RELAXED fired, instead of asserting the leg bounds held", () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    const message = "The 300-mile minimum leg length was relaxed because no station fit the requested spacing. Short leg(s): leg 2 into Love's #412 (210 mi).";
    const plan = { ...COMPLETED_PLAN, disclaimers: [{ code: "MIN_LEG_RELAXED" as const, message }] };
    renderPlanTab({ plan });

    // Renders twice by design: the Stops caption and the general disclaimers list both read it.
    expect(screen.getAllByText(message).length).toBeGreaterThan(0);
    expect(screen.queryByText("within the leg bounds")).toBeNull();
  });

  it("an unrelaxed plan keeps the original caption", () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    renderPlanTab({ plan: { ...COMPLETED_PLAN, disclaimers: [] } });

    expect(screen.getByText("within the leg bounds")).toBeTruthy();
  });

  it("names the actual dwell time excluded from driving time", () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    renderPlanTab({ plan: COMPLETED_PLAN });

    // COMPLETED_PLAN.optimized.dwellSeconds is 1200s = 0h 20m.
    expect(screen.getByText("excludes 0h 20m at the pump")).toBeTruthy();
  });
});

describe("PlanTab 'Saved' stat cell — the sign lives in the label, not stacked with formatCurrency's own", () => {
  it("positive savings: labelled 'Saved', figure has no leading minus", () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    renderPlanTab({ plan: { ...COMPLETED_PLAN, optimized: { ...COMPLETED_PLAN.optimized, savingsVsBaselineUsd: 613.78 } } });

    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByText("$613.78")).toBeTruthy();
    expect(screen.queryByText("−$613.78")).toBeNull();
  });

  it("negative savings: labelled 'Lost', figure shown as a plain positive amount — not a stacked '-$X' or '−-$X'", () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    renderPlanTab({ plan: { ...COMPLETED_PLAN, optimized: { ...COMPLETED_PLAN.optimized, savingsVsBaselineUsd: -75.5 } } });

    expect(screen.getByText("Lost")).toBeTruthy();
    expect(screen.getByText("$75.50")).toBeTruthy();
    expect(screen.queryByText("Saved")).toBeNull();
    expect(screen.queryByText(/-\$75\.50/)).toBeNull();
  });
});

describe("PlanTab empty states (§8)", () => {
  it("no candidates and no chosen stops: a named empty state, not a blank chart", () => {
    usePriceSheets.mockReturnValue({ sheets: SHEETS, loading: false, error: null });
    renderPlanTab({ plan: { ...COMPLETED_PLAN, stops: [], candidateStations: [] } });

    expect(screen.getByText("No priced stops yet.")).toBeTruthy();
  });
});
