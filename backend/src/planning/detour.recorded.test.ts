import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { LatLng } from "../domain/planResponse.js";
import { ORS_MATRIX_MAX_ROUTES, OrsRoutingProvider } from "../routing/ors.js";
import { RoutingProviderError, type TruckSpec } from "../routing/provider.js";
import { MAX_MATRIX_SIDE, detourEstimateError, measureDetours, type DetourSubject } from "./detour.js";
import { DEFAULT_K } from "./stratifiedTopK.js";

/**
 * T-14 step 14.3, offline. The figures §15.4.1 records were measured against the live ORS free tier
 * on 2026-09-21 (I-40, LOVES #200 Amarillo TX -> LOVES #429 Nashville TN, 930.84 mi, 38 priced
 * stations); the responses are committed in `test/fixtures/ors/detour-*.json` with ODbL attribution.
 * These tests replay them through the real adapter and the real arithmetic, so every number in the
 * scope can be reproduced here with no network and no database.
 */
const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/ors");

interface Recorded {
  request: { coordinates?: number[][]; locations?: number[][]; sources?: number[]; destinations?: number[] };
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
}

interface StationsFixture {
  routeDistanceMiles: number;
  routeDurationSeconds: number;
  stations: Array<{
    name: string;
    lat: number;
    lng: number;
    offsetAlongRouteMiles: number;
    perpOffsetMiles: number;
    arcMiles: number;
  }>;
}

const load = <T>(name: string): T => JSON.parse(readFileSync(path.join(fixturesDir, `${name}.json`), "utf8")) as T;

/** The truck the recordings were made with (the seeded `volvo-vnl-860`). */
const truckSpec: TruckSpec = { grossWeightKg: 36287, heightCm: 411, widthCm: 259, lengthCm: 2250, axleCount: 5, hazmatClass: null };

/**
 * A `fetch` that answers from recordings, keyed by what was asked (the coordinates, not the truck's
 * restrictions). A request nobody recorded throws, so a test that drifts from what was measured fails
 * loudly instead of passing on nothing.
 */
function replay(recordings: Recorded[]) {
  const answers = new Map<string, Recorded>();
  for (const r of recordings) {
    const { request } = r;
    const key = request.locations
      ? `matrix ${JSON.stringify([request.locations, request.sources, request.destinations])}`
      : `route ${JSON.stringify(request.coordinates)}`;
    answers.set(key, r);
  }
  const calls: Array<{ kind: "matrix" | "route"; size: number }> = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Recorded["request"];
    const isMatrix = Boolean(body.locations);
    const key = isMatrix
      ? `matrix ${JSON.stringify([body.locations, body.sources, body.destinations])}`
      : `route ${JSON.stringify(body.coordinates)}`;
    const found = answers.get(key);
    if (!found) throw new Error(`no recording for ${key.slice(0, 120)}`);
    calls.push({ kind: isMatrix ? "matrix" : "route", size: isMatrix ? (body.sources?.length ?? 0) * (body.destinations?.length ?? 0) : 0 });
    return new Response(JSON.stringify(found.responseBody), { status: found.responseStatus, headers: found.responseHeaders });
  }) as typeof fetch;
  const provider = new OrsRoutingProvider({ apiKey: "recorded", fetchImpl, logger: { info: () => {}, error: () => {} } });
  return { provider, calls };
}

const latLng = ([lng, lat]: number[]): LatLng => ({ lat: lat!, lng: lng! });

/** The lane's 38 stations, each with the bracket points the recorded matrix requests were made with. */
function subjects(stations: StationsFixture, inbound: Recorded, outbound: Recorded): DetourSubject[] {
  const n = stations.stations.length;
  return stations.stations.map((s, k) => {
    const location = { lat: s.lat, lng: s.lng };
    // Both recordings carry the station in the slot the request put it in: that pins the fixtures to each other.
    expect(latLng(inbound.request.locations![n + k]!)).toEqual(location);
    expect(latLng(outbound.request.locations![k]!)).toEqual(location);
    return {
      id: s.name,
      location,
      before: latLng(inbound.request.locations![k]!),
      after: latLng(outbound.request.locations![n + k]!),
      arcMiles: s.arcMiles,
      perpOffsetMiles: s.perpOffsetMiles,
    };
  });
}

async function measureRecorded() {
  const stations = load<StationsFixture>("detour-lane-stations");
  const inbound = load<Recorded>("detour-lane-matrix-inbound");
  const outbound = load<Recorded>("detour-lane-matrix-outbound");
  const { provider, calls } = replay([inbound, outbound]);
  const result = await measureDetours({
    provider,
    truckSpec,
    subjects: subjects(stations, inbound, outbound),
    routeDistanceMiles: stations.routeDistanceMiles,
    routeDurationSeconds: stations.routeDurationSeconds,
  });
  return { stations, result, calls };
}

/** The true detour of each sampled station: the direct route re-run through it, minus the direct route. */
async function trueDetours(): Promise<Map<string, number>> {
  const route = load<Recorded>("detour-lane-route");
  const via = load<{ routes: Array<Recorded & { station: string }> }>("detour-lane-via-routes").routes;
  const { provider } = replay([route, ...via]);
  const direct = await provider.route({
    origin: latLng(route.request.coordinates![0]!),
    destination: latLng(route.request.coordinates![1]!),
    truckSpec,
  });
  const truth = new Map<string, number>();
  for (const v of via) {
    const [origin, station, destination] = v.request.coordinates!.map(latLng) as [LatLng, LatLng, LatLng];
    const routed = await provider.route({ origin, destination, via: [station], truckSpec });
    truth.set(v.station, routed.distanceMiles - direct.distanceMiles);
  }
  return truth;
}

/** The naive model on the same stations: nearest route point -> station, doubled. */
async function naiveDetours(stations: StationsFixture): Promise<Map<string, number>> {
  const naive = load<Recorded>("detour-lane-matrix-naive");
  const { provider } = replay([naive]);
  const n = stations.stations.length;
  const matrix = await provider.matrix({
    origins: naive.request.locations!.slice(0, n).map(latLng),
    destinations: naive.request.locations!.slice(n).map(latLng),
    truckSpec,
  });
  return new Map(stations.stations.map((s, k) => [s.name, 2 * matrix.distanceMiles[k]![k]!]));
}

describe("the recorded I-40 lane, replayed offline (§15.4.1, measured 2026-09-21)", () => {
  it("measures the 38 stations with exactly two N x N matrix calls, none unmeasurable", async () => {
    const { stations, result, calls } = await measureRecorded();

    expect(stations.stations).toHaveLength(38);
    expect(result.matrixCalls).toBe(2);
    expect(calls).toEqual([
      { kind: "matrix", size: 38 * 38 },
      { kind: "matrix", size: 38 * 38 },
    ]);
    expect(result.measurements).toHaveLength(38);
    expect(result.exclusions).toEqual([]);
  });

  it("puts LOVES #759 in Hazen at 0.25 mi bracketed, against 38.31 mi naive and 0.43 mi driven", async () => {
    const { stations, result } = await measureRecorded();
    const naive = await naiveDetours(stations);
    const truth = await trueDetours();
    const hazen = result.measurements.find((m) => m.id === "LOVES #759")!;

    expect(stations.stations.find((s) => s.name === "LOVES #759")!.perpOffsetMiles).toBeCloseTo(0.249, 3);
    expect(hazen.rawDetourMiles).toBeCloseTo(0.251, 3);
    expect(hazen.estimatedDetourMiles).toBeCloseTo(0.672, 3);
    expect(naive.get("LOVES #759")!).toBeCloseTo(38.307, 3);
    expect(truth.get("LOVES #759")!).toBeCloseTo(0.434, 3);
  });

  it("scores the three models against the routed-through truth on 20 stations", async () => {
    const { result } = await measureRecorded();
    const naive = await naiveDetours(load<StationsFixture>("detour-lane-stations"));
    const truth = await trueDetours();
    expect(truth.size).toBe(20);

    const sampled = result.measurements.filter((m) => truth.has(m.id));
    const error = (model: (m: (typeof sampled)[number]) => number) => {
      const gaps = sampled.map((m) => model(m) - truth.get(m.id)!);
      return {
        mae: gaps.reduce((s, g) => s + Math.abs(g), 0) / gaps.length,
        signed: gaps.reduce((s, g) => s + g, 0) / gaps.length,
        under: Math.max(0, ...gaps.map((g) => -g)),
        over: Math.max(0, ...gaps),
      };
    };

    const estimate = error((m) => m.estimatedDetourMiles);
    const bracket = error((m) => m.rawDetourMiles);
    const naiveError = error((m) => naive.get(m.id)!);

    expect(naiveError.mae).toBeCloseTo(15.508, 2);
    expect(naiveError.over).toBeCloseTo(37.872, 2);
    expect(estimate.mae).toBeCloseTo(2.406, 2);
    expect(estimate.signed).toBeCloseTo(2.151, 2);
    expect(estimate.under).toBeCloseTo(0.886, 2);
    expect(estimate.over).toBeCloseTo(10.802, 2);
    expect(bracket.mae).toBeCloseTo(0.696, 2);
    expect(bracket.signed).toBeCloseTo(-0.181, 2);
    expect(bracket.under).toBeCloseTo(5.754, 2);
    expect(bracket.over).toBeCloseTo(2.559, 2);
    // The bracket model is the closest to what a truck drives, by a wide margin.
    expect(bracket.mae).toBeLessThan(estimate.mae);
    expect(estimate.mae).toBeLessThan(naiveError.mae);
  });

  it("reports the estimate's gap to the bracket measurement across all 38 stations", async () => {
    const { result } = await measureRecorded();
    const gap = detourEstimateError(result.measurements);

    expect(gap.count).toBe(38);
    expect(gap.meanAbsoluteErrorMiles).toBeCloseTo(3.098, 2);
    expect(gap.meanSignedErrorMiles).toBeCloseTo(2.394, 2);
    expect(gap.worstUnderestimateMiles).toBeCloseTo(7.888, 2);
    expect(gap.worstOverestimateMiles).toBeCloseTo(14.3, 2);
  });

  it("finds four stations whose bracket came out below zero, so the floor is doing real work", async () => {
    const { result } = await measureRecorded();
    const negative = result.measurements.filter((m) => m.rawDetourMiles < 0);

    expect(negative.map((m) => m.id).sort()).toEqual(["LOVES #200", "LOVES #219", "LOVES #253", "LOVES #274"]);
    for (const m of negative) {
      expect(m.measuredDetourMiles).toBe(0);
      expect(m.rawDetourMiles).toBeGreaterThan(-0.25);
    }
  });

  it("brackets the two endpoint stations at the route's ends without a negative arc", async () => {
    const { stations, result } = await measureRecorded();
    const first = stations.stations[0]!;
    const last = stations.stations[stations.stations.length - 1]!;

    expect(first.offsetAlongRouteMiles).toBeCloseTo(0, 0);
    expect(first.arcMiles).toBeLessThanOrEqual(10.5);
    expect(last.offsetAlongRouteMiles).toBeCloseTo(stations.routeDistanceMiles, 0);
    expect(last.arcMiles).toBeLessThanOrEqual(10.5);
    for (const m of result.measurements) expect(m.arcMiles).toBeGreaterThan(0);
  });
});

describe("the recorded ORS matrix ceiling (§15.4.1, measured 2026-09-21)", () => {
  it("accepts a 50 x 50 request, 2,500 pairs, with every cell reachable", async () => {
    const probe = load<Recorded>("detour-matrix-50x50");
    const { provider } = replay([probe]);
    const n = probe.request.sources!.length;
    const result = await provider.matrix({
      origins: probe.request.locations!.slice(0, n).map(latLng),
      destinations: probe.request.locations!.slice(n).map(latLng),
      truckSpec,
    });

    expect(probe.responseStatus).toBe(200);
    expect(result.distanceMiles).toHaveLength(50);
    expect(result.distanceMiles.every((row) => row.length === 50 && row.every((cell) => cell !== null))).toBe(true);
  });

  it("refuses a 60 x 60 request and states the limit: 3,500 routes, not the 2,500 v3.4 carried", async () => {
    const probe = load<Recorded>("detour-matrix-oversize");
    const { provider } = replay([probe]);
    const n = probe.request.sources!.length;
    const error = await provider
      .matrix({
        origins: probe.request.locations!.slice(0, n).map(latLng),
        destinations: probe.request.locations!.slice(n).map(latLng),
        truckSpec,
      })
      .catch((e: unknown) => e);

    expect(n * n).toBe(3600);
    expect(error).toBeInstanceOf(RoutingProviderError);
    expect(error).toMatchObject({ status: 400, code: 6004 });
    expect((error as Error).message).toMatch(/3500 routes/);
    expect(ORS_MATRIX_MAX_ROUTES).toBe(3500);
  });

  it("keeps K = 40 and the 50-wide side well inside it: no chunking on an ordinary lane", () => {
    expect(DEFAULT_K ** 2).toBeLessThanOrEqual(ORS_MATRIX_MAX_ROUTES);
    // The side actually measured to work is 50; the stated limit would allow 59, which was not tried.
    expect(MAX_MATRIX_SIDE).toBe(50);
    expect(MAX_MATRIX_SIDE ** 2).toBeLessThanOrEqual(ORS_MATRIX_MAX_ROUTES);
    expect(Math.floor(Math.sqrt(ORS_MATRIX_MAX_ROUTES))).toBe(59);
  });
});

describe("§15.4.1 in the scope (T-14 step 14.3)", () => {
  const scopePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/PROJECT-SCOPE.md");
  const section = (): string => {
    const text = readFileSync(scopePath, "utf8");
    const start = text.indexOf("#### 15.4.1");
    const end = text.indexOf("### 15.5", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return text.slice(start, end);
  };

  it("carries measured figures with their date, and no unverified warning", () => {
    const text = section();
    expect(text).not.toMatch(/unverified/i);
    expect(text.match(/Measured 2026-09-21/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("states the figures the recorded fixtures reproduce", () => {
    const text = section();
    for (const figure of ["38.31", "0.25 mi", "0.43", "15.51", "2.41", "0.70", "5.75", "3,500", "K = 40"]) {
      expect(text, figure).toContain(figure);
    }
  });
});
