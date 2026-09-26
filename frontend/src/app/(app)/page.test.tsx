// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompletedPlanResponse, CreatePlanRequest } from "@ch/core/domain/planResponse";
import type { TruckRosterResult } from "@ch/core/actuals/trucks";
import type { PriceSheetSummary } from "@ch/core/catalog/priceSheets";

const push = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/",
  useSearchParams: () => searchParams,
}));

const useSession = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => useSession(),
  signOut: vi.fn(),
}));

const createPlan = vi.fn();
const getPlan = vi.fn();
const listTrucks = vi.fn();
const listPriceSheets = vi.fn();
const listStations = vi.fn().mockResolvedValue({ stations: [], page: 1, pageSize: 500, total: 0 });

vi.mock("../../lib/api", () => ({
  createPlan: (...args: unknown[]) => createPlan(...args),
  getPlan: (...args: unknown[]) => getPlan(...args),
  listTrucks: (...args: unknown[]) => listTrucks(...args),
  listPriceSheets: (...args: unknown[]) => listPriceSheets(...args),
  listStations: (...args: unknown[]) => listStations(...args),
  patchPlan: vi.fn(),
}));

// MapLibre needs WebGL, which jsdom lacks (see RouteMap.test.tsx).
vi.mock("maplibre-gl", async () => (await import("../../map/testing/fakeMaplibre")).fakeMaplibreModule);

const { default: NewPlanPage } = await import("./page");

const TRUCK: TruckRosterResult["rows"][number] = {
  id: "11111111-1111-1111-1111-111111111111",
  unitNumber: "031",
  tankGallons: 200,
  avgMpg: 7.5,
  reserveFraction: 0.15,
};
const SHEET: PriceSheetSummary = {
  id: "sheet-1",
  effectiveOn: "2026-09-22",
  importedAt: "2026-09-22T05:58:00Z",
  rowCount: 605,
  stationCount: 412,
};

const COMPLETED_PLAN: CompletedPlanResponse = {
  planId: "plan-1",
  createdAt: "2026-09-22T12:00:00.000Z",
  units: "imperial",
  origin: { label: "Bakersfield, CA", location: { lat: 35.3733, lng: -119.0187 } },
  destination: { label: "Reno, NV", location: { lat: 39.5296, lng: -119.8138 } },
  truckId: TRUCK.id,
  candidateStations: [],
  status: "completed",
  priceAsOf: "2026-09-22",
  optimizerStrategy: "dp_v1",
  solveMs: 4200,
  stationsScanned: 1,
  truck: { unitNumber: TRUCK.unitNumber, maxLegMiles: 500 },
  baseline: {
    polyline: null,
    distanceMiles: 480,
    driveSeconds: 27000,
    estimatedFuelCostUsd: 300,
    bounds: { north: 0, south: 0, east: 0, west: 0 },
  },
  optimized: {
    polyline: null,
    distanceMiles: 486.5,
    driveSeconds: 27600,
    dwellSeconds: 1200,
    totalSeconds: 28800,
    totalFuelCostUsd: 286.62,
    totalGallons: 68,
    savingsVsBaselineUsd: 41,
    addedDistanceMiles: 6.5,
    addedDurationSeconds: 600,
    detourCostUsd: 2.82,
    costPerMile: 0.6,
    bounds: { north: 0, south: 0, east: 0, west: 0 },
  },
  stops: [],
  googleMapsUrl: "https://maps.google.com/",
  disclaimers: [],
  attribution: { routing: "ORS", placeData: "OSM" },
  sentToDriver: false,
  sentToDriverAt: null,
};

function setup() {
  useSession.mockReturnValue({ data: { user: { name: "M. Hodson", role: "dispatcher" } } });
  listTrucks.mockResolvedValue({ rows: [TRUCK] });
  listPriceSheets.mockResolvedValue([SHEET]);
  createPlan.mockResolvedValue(COMPLETED_PLAN);
  listStations.mockResolvedValue({ stations: [], page: 1, pageSize: 500, total: 0 });
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  searchParams = new URLSearchParams();
});

describe("New Plan page — live plan flow (T-21 step 21.2, re-hosted by T-39)", () => {
  it("'Plan route' issues one POST /plans carrying the selected truckId — the only truck field (T-56)", async () => {
    setup();
    render(<NewPlanPage />);

    // PlanTab's own truck selector (T-39: moved off the old Header/TopBar —
    // UI-DATA-CONTRACT §2 — since it's New Plan's field, not shell chrome).
    // There is no second truck field in Dev Tools any more (T-56) — picking
    // a truck here is now both necessary and sufficient.
    await waitFor(() => expect((screen.getByLabelText("Truck") as HTMLSelectElement).options).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Truck"), { target: { value: TRUCK.id } });

    fireEvent.click(screen.getByRole("button", { name: "Dev Tools" }));
    // A filled-in constraint should reach the request as a real number...
    fireEvent.change(screen.getByLabelText("Max detour per stop (mi)"), { target: { value: "12" } });
    // ...while an untouched one stays blank -> null, not 0.

    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "Bakersfield, CA" } });
    fireEvent.change(screen.getByLabelText("Destination"), { target: { value: "Reno, NV" } });

    fireEvent.click(screen.getByRole("button", { name: /Plan route/ }));

    await waitFor(() => expect(createPlan).toHaveBeenCalledTimes(1));
    const body = createPlan.mock.calls[0]![0] as CreatePlanRequest;
    expect(body.truckId).toBe(TRUCK.id);
    expect(body.origin).toEqual({ address: "Bakersfield, CA" });
    expect(body.destination).toEqual({ address: "Reno, NV" });
    expect(body.maxDetourMiles).toBe(12);
    expect(body.maxStops).toBeNull();
    expect(body.corridorMiles).toBeNull();

    // The real result renders — no local fixture stood in for it.
    await waitFor(() => expect(screen.getByText("$286.62")).toBeTruthy());
    expect(screen.getByText("plan-1")).toBeTruthy();
  });

  it("a ?planId= from the Plans list loads that plan and clears the query param", async () => {
    setup();
    searchParams = new URLSearchParams({ planId: "plan-1" });
    getPlan.mockResolvedValue(COMPLETED_PLAN);

    render(<NewPlanPage />);

    await waitFor(() => expect(getPlan).toHaveBeenCalledWith("plan-1"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});

describe("New Plan page — solve-in-flight spinner (T-23 step 23.3, §8)", () => {
  it("covers the map for the full request and clears once it resolves", async () => {
    setup();
    let resolveCreate!: (plan: CompletedPlanResponse) => void;
    createPlan.mockReturnValue(new Promise<CompletedPlanResponse>((resolve) => (resolveCreate = resolve)));
    render(<NewPlanPage />);

    await waitFor(() => expect((screen.getByLabelText("Truck") as HTMLSelectElement).options).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Truck"), { target: { value: TRUCK.id } });
    fireEvent.click(screen.getByRole("button", { name: "Dev Tools" }));
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "Bakersfield, CA" } });
    fireEvent.change(screen.getByLabelText("Destination"), { target: { value: "Reno, NV" } });

    fireEvent.click(screen.getByRole("button", { name: /Plan route/ }));
    expect(screen.getByRole("button", { name: "Planning…" })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("map-loading")).toBeTruthy());

    resolveCreate(COMPLETED_PLAN);
    await waitFor(() => expect(screen.queryByTestId("map-loading")).toBeNull());
    expect(screen.getByRole("button", { name: /Plan route/ })).toBeTruthy();
  });
});
