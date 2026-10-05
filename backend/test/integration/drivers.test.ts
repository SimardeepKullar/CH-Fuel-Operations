import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import type { DriverDetail, DriversResult } from "../../src/actuals/drivers.js";
import type { OverviewResult } from "../../src/actuals/overview.js";
import type { TrucksResult } from "../../src/actuals/trucks.js";
import { runImportInvoiceCli } from "../../src/cli/importInvoice.js";
import {
  insertAnomaly,
  insertCard,
  insertDriver,
  insertInvoice,
  insertStation,
  insertStop,
  scopedSchema,
  teardown,
} from "./support/actualsFixtures.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const realMigrationsDir = path.join(dirname, "../../../migrations/real");
const realCsvPath = path.join(dirname, "../../../data/bvd-invoices/invoice_999210.csv");
const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRealFixture = existsSync(realCsvPath);
const UNKNOWN_UUID = "3f2b7c1e-8a44-4f5b-9c1d-2e6a7b8c9d0e";

/**
 * Hand-built rows, not an import: this is about how the endpoints *shape* what
 * is stored, so each stop is exactly the state under test.
 *
 * March invoice (period 2026-03-01):
 *   Ann  — 3 stops: a1 100 gal TA @5.00 + 3 gal DF @4.00 (confirmed), a2 100 @6.00
 *          (pending), a3 50 @4.00 (confirmed). TA 250 gal, weighted 5.20 (the
 *          plain mean of her prices would be 5.00).
 *   Bob  — 1 stop: 200 gal @5.50, no DEF at all.
 *   Dee  — 1 stop: DEF only, 10 gal — no diesel gallons to divide by.
 *   Cy   — on the roster, no stops.
 *   —    — 1 stop on a card with no driver: 100 gal @7.00.
 * Fleet TA: 550 gal, weighted 3100/550 — not the 5.35 mean of Ann's and Bob's averages.
 */
describe.skipIf(!hasDatabase)("GET /drivers, /drivers/{id} (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let app: App;
  let ids: {
    invoice: string;
    ann: string;
    bob: string;
    dee: string;
    cy: string;
    alpha: string;
    bravo: string;
  };

  async function get<T>(pathAndQuery: string, status = 200): Promise<T> {
    const response = await app.handle(new Request(`http://localhost/api/v1${pathAndQuery}`));
    expect(response.status).toBe(status);
    return (await response.json()) as T;
  }

  beforeEach(async () => {
    ({ adminPool, scopedPool, schema } = await scopedSchema("test_drivers"));
    app = createApp({ pool: scopedPool });

    const invoice = await insertInvoice(scopedPool, { number: "T37-MAR", periodStart: "2026-03-01", periodEnd: "2026-03-07" });
    const [ann, bob, dee, cy] = await Promise.all(["T37 ANN", "T37 BOB", "T37 DEE", "T37 CY"].map((n) => insertDriver(scopedPool, n)));
    const [cardAnn, cardBob, cardDee, cardOrphan] = await Promise.all([
      insertCard(scopedPool, { cardNumber: "T37-A", driverId: ann }),
      insertCard(scopedPool, { cardNumber: "T37-B", driverId: bob }),
      insertCard(scopedPool, { cardNumber: "T37-D", driverId: dee }),
      insertCard(scopedPool, { cardNumber: "T37-U", driverId: null }),
    ]);
    const alpha = await insertStation(scopedPool, { siteRef: "T37-1", nameRaw: "LOVES #1", cityRaw: "Alpha City" });
    const bravo = await insertStation(scopedPool, { siteRef: "T37-2", nameRaw: "LOVES #2", cityRaw: "Bravo City" });
    ids = { invoice, ann: ann!, bob: bob!, dee: dee!, cy: cy!, alpha, bravo };

    await insertStop(scopedPool, {
      invoiceId: invoice,
      cardId: cardAnn,
      driverId: ann,
      stationId: alpha,
      occurredAt: "2026-03-02T15:00:00Z",
      receiptStatus: "confirmed",
      lines: [
        { code: "TA", gallons: 100, billed: 5 },
        { code: "DF", gallons: 3, billed: 4 },
      ],
    });
    const a2 = await insertStop(scopedPool, {
      invoiceId: invoice,
      cardId: cardAnn,
      driverId: ann,
      stationId: alpha,
      occurredAt: "2026-03-03T15:00:00Z",
      lines: [{ code: "TA", gallons: 100, billed: 6 }],
    });
    const a3 = await insertStop(scopedPool, {
      invoiceId: invoice,
      cardId: cardAnn,
      driverId: ann,
      stationId: bravo,
      occurredAt: "2026-03-04T15:00:00Z",
      receiptStatus: "confirmed",
      lines: [{ code: "TA", gallons: 50, billed: 4 }],
    });
    const b1 = await insertStop(scopedPool, {
      invoiceId: invoice,
      cardId: cardBob,
      driverId: bob,
      stationId: bravo,
      occurredAt: "2026-03-02T16:00:00Z",
      lines: [{ code: "TA", gallons: 200, billed: 5.5 }],
    });
    await insertStop(scopedPool, {
      invoiceId: invoice,
      cardId: cardDee,
      driverId: dee,
      stationId: alpha,
      occurredAt: "2026-03-02T17:00:00Z",
      lines: [{ code: "DF", gallons: 10, billed: 4 }],
    });
    await insertStop(scopedPool, {
      invoiceId: invoice,
      cardId: cardOrphan,
      driverId: null,
      stationId: alpha,
      occurredAt: "2026-03-05T15:00:00Z",
      lines: [{ code: "TA", gallons: 100, billed: 7 }],
    });

    // Ann: one open anomaly on a2, one dismissed on a3 (not counted). Bob: two open on b1.
    await insertAnomaly(scopedPool, { fuelStopId: a2, rule: "def_ratio", severity: "amber" });
    await insertAnomaly(scopedPool, { fuelStopId: a3, rule: "sub_gallon", severity: "red", dismissed: true });
    await insertAnomaly(scopedPool, { fuelStopId: b1, rule: "def_ratio", severity: "amber" });
    await insertAnomaly(scopedPool, { fuelStopId: b1, rule: "too_close", severity: "red" });
  });

  afterEach(async () => {
    await teardown(adminPool, scopedPool, schema);
  });

  describe("list", () => {
    it("returns spend, diesel gallons, weighted average billed, compliance % and open anomaly count per driver", async () => {
      const result = await get<DriversResult>("/drivers?week=2026-03-07");
      const ann = result.rows.find((r) => r.driver.id === ids.ann)!;

      expect(result.invoiceId).toBe(ids.invoice);
      expect(ann.driver.displayName).toBe("T37 ANN");
      // a1 carries a TA and a DF line: its 512.00 is counted once, not once per line.
      expect(ann.stopCount).toBe(3);
      expect(ann.total).toBe(1312);
      expect(ann.qty).toBe(250);
      expect(ann.defQty).toBe(3);
      expect(ann.avgBilledPerUnit).toBeCloseTo(5.2, 10);
      expect(ann.receiptCompliance.confirmed).toBe(2);
      expect(ann.receiptCompliance.total).toBe(3);
      expect(ann.receiptCompliance.pct).toBeCloseTo(66.6667, 3);
      expect(ann.anomalyCount).toBe(1);
    });

    it("the average is gallons-weighted (5.20), not the mean of her prices (5.00)", async () => {
      const ann = (await get<DriversResult>("/drivers?week=2026-03-07")).rows.find((r) => r.driver.id === ids.ann)!;

      expect(ann.avgBilledPerUnit).not.toBeCloseTo((5 + 6 + 4) / 3, 2);
    });

    it("counts every open anomaly on a driver's stops, and skips dismissed ones", async () => {
      const rows = (await get<DriversResult>("/drivers?week=2026-03-07")).rows;

      expect(rows.find((r) => r.driver.id === ids.bob)!.anomalyCount).toBe(2);
      expect(rows.find((r) => r.driver.id === ids.ann)!.anomalyCount).toBe(1);
    });

    it("a driver with no stops in the period is a row of zeros with a null average — not an error, not omitted", async () => {
      const cy = (await get<DriversResult>("/drivers?week=2026-03-07")).rows.find((r) => r.driver.id === ids.cy)!;

      expect(cy).toEqual({
        driver: { id: ids.cy, displayName: "T37 CY" },
        stopCount: 0,
        total: 0,
        qty: 0,
        defQty: 0,
        avgBilledPerUnit: null,
        defRatio: null,
        receiptCompliance: { confirmed: 0, total: 0, pct: null },
        anomalyCount: 0,
      });
    });

    it("lists rows spend-descending", async () => {
      const spend = (await get<DriversResult>("/drivers?week=2026-03-07")).rows.map((r) => r.total);

      expect(spend).toEqual([...spend].sort((a, b) => b - a));
    });

    it("stops on a card with no driver are not a row, but stay in `unresolved` and the fleet", async () => {
      const result = await get<DriversResult>("/drivers?week=2026-03-07");

      expect(result.rows.some((r) => r.driver.id === null)).toBe(false);
      expect(result.unresolved).toMatchObject({ stopCount: 1, total: 700, qty: 100 });
      expect(result.unresolved.avgBilledPerUnit).toBeCloseTo(7, 10);

      // Nothing vanishes: driver rows + the unresolved bucket are the whole invoice.
      const rowsTotal = result.rows.reduce((sum, r) => sum + r.total, 0);
      const rowsStops = result.rows.reduce((sum, r) => sum + r.stopCount, 0);
      expect(rowsTotal + result.unresolved.total).toBeCloseTo(result.fleet.total, 2);
      expect(rowsStops + result.unresolved.stopCount).toBe(result.fleet.stopCount);
      expect(result.fleet.stopCount).toBe(6);
      expect(result.fleet.total).toBe(3152);
    });

    it("the fleet average is the same figure as the Overview's headline — one formula, not two", async () => {
      const list = await get<DriversResult>("/drivers?week=2026-03-07");
      const overview = await get<OverviewResult>("/overview?week=2026-03-07");

      expect(list.fleet.avgBilledPerUnit).toBeCloseTo(3100 / 550, 10);
      expect(list.fleet.avgBilledPerUnit).toBeCloseTo(overview.kpis.avgBilledPerUnit!, 10);
    });

    it("a period with no invoice is empty with zero totals, not an error", async () => {
      const result = await get<DriversResult>("/drivers?week=2026-04-07");

      expect(result.invoiceId).toBeNull();
      expect(result.rows).toEqual([]);
      expect(result.fleet).toMatchObject({ stopCount: 0, total: 0, qty: 0, avgBilledPerUnit: null });
    });

    it("400s a malformed period through the app", async () => {
      await get("/drivers?week=nope", 400);
    });
  });

  describe("detail", () => {
    it("returns their average against the fleet's, both gallons-weighted", async () => {
      const detail = await get<DriverDetail>(`/drivers/${ids.ann}?week=2026-03-07`);

      expect(detail.driver).toEqual({ id: ids.ann, displayName: "T37 ANN", status: "active" });
      expect(detail.summary.avgBilledPerUnit).toBeCloseTo(5.2, 10);
      expect(detail.fleet.avgBilledPerUnit).toBeCloseTo(3100 / 550, 10);
      expect(detail.avgVsFleetPerUnit).toBeCloseTo(5.2 - 3100 / 550, 10);
      expect(detail.fleet).toMatchObject({ qty: 550, stopCount: 6 });
    });

    it("the fleet average includes the driverless stops rather than dropping them", async () => {
      const detail = await get<DriverDetail>(`/drivers/${ids.bob}?week=2026-03-07`);

      // Without the $7.00 driverless fill the fleet would be (1300 + 1100) / 450 = 5.33.
      expect(detail.fleet.avgBilledPerUnit).toBeCloseTo(3100 / 550, 10);
      expect(detail.fleet.avgBilledPerUnit).not.toBeCloseTo(2400 / 450, 2);
    });

    it("DEF:diesel is DF gallons over TA gallons", async () => {
      const detail = await get<DriverDetail>(`/drivers/${ids.ann}?week=2026-03-07`);

      expect(detail.summary.defRatio).toBeCloseTo(3 / 250, 10);
    });

    it("DEF:diesel is 0 for a driver who bought diesel and no DEF", async () => {
      const detail = await get<DriverDetail>(`/drivers/${ids.bob}?week=2026-03-07`);

      expect(detail.summary.defRatio).toBe(0);
    });

    it("DEF:diesel is null — not Infinity, not 0 — for a driver with DEF and no diesel gallons", async () => {
      const detail = await get<DriverDetail>(`/drivers/${ids.dee}?week=2026-03-07`);

      expect(detail.summary).toMatchObject({ stopCount: 1, defQty: 10, qty: 0 });
      expect(detail.summary.defRatio).toBeNull();
      expect(detail.summary.avgBilledPerUnit).toBeNull();
      expect(detail.avgVsFleetPerUnit).toBeNull();
    });

    it("favoured stations rank by stop count: Alpha (2 stops) ahead of Bravo (1)", async () => {
      const { favouredStations } = await get<DriverDetail>(`/drivers/${ids.ann}?week=2026-03-07`);

      expect(favouredStations.stations.map((s) => [s.station.nameRaw, s.stopCount])).toEqual([
        ["LOVES #1", 2],
        ["LOVES #2", 1],
      ]);
      expect(favouredStations.stations[0]).toMatchObject({
        station: { id: ids.alpha, cityRaw: "Alpha City", stateUsps: "MO" },
        qty: 200,
        total: 1112,
      });
      expect(favouredStations.stations[0]!.avgBilledPerUnit).toBeCloseTo(5.5, 10);
      expect(favouredStations.unresolvedStationStops).toBe(0);
    });

    it("a driver with no stops in the period returns zeros — not a 404", async () => {
      const detail = await get<DriverDetail>(`/drivers/${ids.cy}?week=2026-03-07`);

      expect(detail.invoiceId).toBe(ids.invoice);
      expect(detail.summary).toMatchObject({ stopCount: 0, total: 0, qty: 0, anomalyCount: 0 });
      expect(detail.summary.avgBilledPerUnit).toBeNull();
      expect(detail.summary.defRatio).toBeNull();
      expect(detail.summary.receiptCompliance).toEqual({ confirmed: 0, total: 0, pct: null });
      expect(detail.avgVsFleetPerUnit).toBeNull();
      expect(detail.favouredStations).toEqual({ stations: [], unresolvedStationStops: 0 });
      // The fleet is still the whole invoice, for the comparison a UI would draw.
      expect(detail.fleet.avgBilledPerUnit).toBeCloseTo(3100 / 550, 10);
    });

    it("a period with no invoice returns zeros for a real driver — not a 404", async () => {
      const detail = await get<DriverDetail>(`/drivers/${ids.ann}?week=2026-04-07`);

      expect(detail.invoiceId).toBeNull();
      expect(detail.summary.stopCount).toBe(0);
      expect(detail.fleet).toEqual({ avgBilledPerUnit: null, qty: 0, stopCount: 0 });
    });

    it("404s a well-formed id that names no driver, and a malformed one, as problem+json", async () => {
      for (const id of [UNKNOWN_UUID, "not-a-uuid"]) {
        const response = await app.handle(new Request(`http://localhost/api/v1/drivers/${id}?week=2026-03-07`));
        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
      }
    });

    it("400s a missing period", async () => {
      await get(`/drivers/${ids.ann}`, 400);
    });

    it("history is the trailing per-invoice series, oldest first, with the fleet on the same axis", async () => {
      // A February invoice: Ann one confirmed 100 gal @4.00; Bob 100 gal @6.00.
      const feb = await insertInvoice(scopedPool, { number: "T37-FEB", periodStart: "2026-02-01", periodEnd: "2026-02-07" });
      const cardAnn = (await scopedPool.query<{ id: string }>("SELECT id FROM fuel_cards WHERE card_number = 'T37-A'")).rows[0]!.id;
      const cardBob = (await scopedPool.query<{ id: string }>("SELECT id FROM fuel_cards WHERE card_number = 'T37-B'")).rows[0]!.id;
      await insertStop(scopedPool, {
        invoiceId: feb,
        cardId: cardAnn,
        driverId: ids.ann,
        occurredAt: "2026-02-02T15:00:00Z",
        receiptStatus: "confirmed",
        lines: [{ code: "TA", gallons: 100, billed: 4 }],
      });
      await insertStop(scopedPool, {
        invoiceId: feb,
        cardId: cardBob,
        driverId: ids.bob,
        occurredAt: "2026-02-02T15:00:00Z",
        lines: [{ code: "TA", gallons: 100, billed: 6 }],
      });

      const { history } = await get<DriverDetail>(`/drivers/${ids.ann}?week=2026-03-07`);

      expect(history.map((h) => h.week)).toEqual(["2026-02-07", "2026-03-07"]);
      expect(history[0]).toMatchObject({
        stopCount: 1,
        receiptCompliance: { confirmed: 1, total: 1, pct: 100 },
      });
      expect(history[0]!.avgBilledPerUnit).toBeCloseTo(4, 10);
      expect(history[0]!.fleetAvgBilledPerUnit).toBeCloseTo(5, 10);
      expect(history[1]!.avgBilledPerUnit).toBeCloseTo(5.2, 10);
      expect(history[1]!.fleetAvgBilledPerUnit).toBeCloseTo(3100 / 550, 10);
    });
  });
});

/**
 * Favoured-station ties and an unresolved station, on their own invoice so the
 * March figures above stay simple. Eve fills 50 gal at Bravo, then 50 gal at
 * Alpha — the same stop count and gallons, inserted in the "wrong" order.
 */
describe.skipIf(!hasDatabase)("favoured stations: deterministic ties (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let app: App;

  beforeEach(async () => {
    ({ adminPool, scopedPool, schema } = await scopedSchema("test_favoured"));
    app = createApp({ pool: scopedPool });
  });

  afterEach(async () => {
    await teardown(adminPool, scopedPool, schema);
  });

  it("breaks a tie on stops and gallons by station name, whatever order the rows were written in", async () => {
    const invoice = await insertInvoice(scopedPool, { number: "T37-TIE", periodStart: "2026-05-01", periodEnd: "2026-05-07" });
    const eve = await insertDriver(scopedPool, "T37 EVE");
    const card = await insertCard(scopedPool, { cardNumber: "T37-E", driverId: eve });
    const bravo = await insertStation(scopedPool, { siteRef: "T37-B", nameRaw: "LOVES #20" });
    const alpha = await insertStation(scopedPool, { siteRef: "T37-A", nameRaw: "LOVES #10" });

    for (const stationId of [bravo, alpha]) {
      await insertStop(scopedPool, {
        invoiceId: invoice,
        cardId: card,
        driverId: eve,
        stationId,
        occurredAt: "2026-05-02T15:00:00Z",
        lines: [{ code: "TA", gallons: 50, billed: 5 }],
      });
    }
    await insertStop(scopedPool, {
      invoiceId: invoice,
      cardId: card,
      driverId: eve,
      stationId: null,
      occurredAt: "2026-05-03T15:00:00Z",
      lines: [{ code: "TA", gallons: 10, billed: 5 }],
    });

    const response = await app.handle(new Request(`http://localhost/api/v1/drivers/${eve}?week=2026-05-07`));
    const { favouredStations } = (await response.json()) as DriverDetail;

    expect(favouredStations.stations.map((s) => s.station.nameRaw)).toEqual(["LOVES #10", "LOVES #20"]);
    // The station-less stop is counted, not ranked and not dropped.
    expect(favouredStations.unresolvedStationStops).toBe(1);
  });

  it("with equal stop counts, the station with more diesel gallons ranks first", async () => {
    const invoice = await insertInvoice(scopedPool, { number: "T37-GAL", periodStart: "2026-06-01", periodEnd: "2026-06-07" });
    const fay = await insertDriver(scopedPool, "T37 FAY");
    const card = await insertCard(scopedPool, { cardNumber: "T37-F", driverId: fay });
    const small = await insertStation(scopedPool, { siteRef: "T37-S", nameRaw: "LOVES #1" });
    const big = await insertStation(scopedPool, { siteRef: "T37-G", nameRaw: "LOVES #2" });
    await insertStop(scopedPool, { invoiceId: invoice, cardId: card, driverId: fay, stationId: small, occurredAt: "2026-06-02T15:00:00Z", lines: [{ code: "TA", gallons: 20, billed: 5 }] });
    await insertStop(scopedPool, { invoiceId: invoice, cardId: card, driverId: fay, stationId: big, occurredAt: "2026-06-02T18:00:00Z", lines: [{ code: "TA", gallons: 90, billed: 5 }] });

    const response = await app.handle(new Request(`http://localhost/api/v1/drivers/${fay}?week=2026-06-07`));
    const { favouredStations } = (await response.json()) as DriverDetail;

    expect(favouredStations.stations.map((s) => s.station.nameRaw)).toEqual(["LOVES #2", "LOVES #1"]);
  });
});

/**
 * The real invoice. Figures are the ones invoice999210.test.ts already pins from
 * the printed totals — 66 stops, 8,733.11 TA gallons, 174.43 DF, a weighted
 * average that rounds to 5.55 — so the rollups are held to BVD's numbers, not
 * to what the code happens to return.
 */
describe.skipIf(!hasDatabase || !hasRealFixture)("driver and truck rollups on 999210 (integration, local fixture only)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let app: App;
  let week: string;

  beforeEach(async () => {
    ({ adminPool, scopedPool, schema } = await scopedSchema("test_rollups_999210", realMigrationsDir));
    app = createApp({ pool: scopedPool });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitCode = await runImportInvoiceCli([realCsvPath], scopedPool);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    expect(exitCode).toBe(0);
    week = (await scopedPool.query<{ p: string }>("SELECT to_char(billing_week_end, 'YYYY-MM-DD') AS p FROM invoices")).rows[0]!.p;
  });

  afterEach(async () => {
    await teardown(adminPool, scopedPool, schema);
  });

  async function get<T>(pathAndQuery: string): Promise<T> {
    const response = await app.handle(new Request(`http://localhost/api/v1${pathAndQuery}`));
    expect(response.status).toBe(200);
    return (await response.json()) as T;
  }

  it("the driver fleet is the whole invoice: 66 stops, 8,733.11 diesel gallons, 174.43 DEF, weighted average 5.55", async () => {
    const { fleet } = await get<DriversResult>(`/drivers?week=${week}`);

    expect(fleet.stopCount).toBe(66);
    expect(fleet.qty).toBe(8733.11);
    expect(fleet.defQty).toBe(174.43);
    expect(fleet.avgBilledPerUnit!.toFixed(2)).toBe("5.55");
  });

  it("driver rows plus the unresolved bucket reconcile to the fleet — no stop, dollar or gallon is lost", async () => {
    const { rows, unresolved, fleet } = await get<DriversResult>(`/drivers?week=${week}`);

    expect(rows.reduce((s, r) => s + r.stopCount, 0) + unresolved.stopCount).toBe(fleet.stopCount);
    expect(rows.reduce((s, r) => s + r.total, 0) + unresolved.total).toBeCloseTo(fleet.total, 2);
    expect(rows.reduce((s, r) => s + r.qty, 0) + unresolved.qty).toBeCloseTo(fleet.qty, 2);
  });

  it("truck rows plus the unresolved bucket reconcile to the same fleet", async () => {
    const drivers = await get<DriversResult>(`/drivers?week=${week}`);
    const { rows, unresolved, fleet } = await get<TrucksResult>(`/trucks?week=${week}`);

    expect(rows.reduce((s, r) => s + r.stopCount, 0) + unresolved.stopCount).toBe(66);
    // The same figures grouped two ways: identical up to float summation order.
    const { avgBilledPerUnit, defRatio, ...exact } = fleet;
    const { avgBilledPerUnit: driverAvg, defRatio: driverDefRatio, ...driverExact } = drivers.fleet;
    expect(exact).toEqual(driverExact);
    expect(avgBilledPerUnit).toBeCloseTo(driverAvg!, 10);
    expect(defRatio).toBeCloseTo(driverDefRatio!, 10);
  });

  it("the biggest spender is the same driver, at the same dollars, as the Overview's top-spend list", async () => {
    const list = await get<DriversResult>(`/drivers?week=${week}`);
    const overview = await get<OverviewResult>(`/overview?week=${week}`);
    const top = overview.topSpendByDriver.find((d) => d.driverId !== null)!;
    const row = list.rows.find((r) => r.driver.id === top.driverId)!;

    expect(row.total).toBe(top.total);
    expect(row.qty).toBe(top.qty);
    expect(row.avgBilledPerUnit).toBeCloseTo(top.avgBilledPerUnit!, 10);
  });

  it("a driver's detail matches their list row", async () => {
    const list = await get<DriversResult>(`/drivers?week=${week}`);
    const busiest = list.rows.find((r) => r.stopCount > 0)!;

    const detail = await get<DriverDetail>(`/drivers/${busiest.driver.id}?week=${week}`);

    const { driver: _driver, ...rollup } = busiest;
    expect(detail.summary).toEqual(rollup);
  });
});
