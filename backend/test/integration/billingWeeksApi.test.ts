import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import type { DriverDetail, DriversResult } from "../../src/actuals/drivers.js";
import type { ExpressChargesResult } from "../../src/actuals/otherCharges.js";
import type { OverviewResult } from "../../src/actuals/overview.js";
import type { ReceiptQueueResult } from "../../src/actuals/receipts.js";
import type { StationBilledPrices } from "../../src/actuals/stations.js";
import type { ListTransactionsResult, TransactionDetail } from "../../src/actuals/transactions.js";
import type { TruckDetail, TrucksResult } from "../../src/actuals/trucks.js";
import { insertCard, insertInvoice, insertStation, insertStop, scopedSchema, teardown } from "./support/actualsFixtures.js";
import { WEEK_END, importCa, importUs, seedUsFixtureRoster, usInWeek } from "./support/billingWeekFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const LITRES_PER_GALLON = 3.785411784;

/** T-63 step 63.3 — every period-scoped route serves one week, one side or both. */
describe.skipIf(!hasDatabase)("period-scoped routes over a US + CA week (integration, T-63)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let app: App;

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_week_api"));
    await seedUsFixtureRoster(pool);
    app = createApp({ pool, authRequired: false });
    await importUs(pool, usInWeek(), "invoice_100001.csv");
    await importCa(pool);
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  async function get<T>(pathAndQuery: string, status = 200): Promise<T> {
    // A signed-in context: /receipt-queue needs a user id even with auth off.
    const response = await app.handle(new Request(`http://localhost/api/v1${pathAndQuery}`), { userId: "test-user" });
    expect(response.status, pathAndQuery).toBe(status);
    return (await response.json()) as T;
  }

  const w = `week=${WEEK_END}`;

  describe("GET /transactions", () => {
    it("?currency=CAD returns only the CA invoice's stops, in litres and CAD, as printed", async () => {
      const body = await get<ListTransactionsResult>(`/transactions?${w}&currency=CAD&pageSize=200&includeLines=true`);
      expect(body.total).toBe(8);
      expect(body.rows.every((r) => r.currency === "CAD" && r.qtyUnit === "L")).toBe(true);

      const stop = body.rows.find((r) => r.baseAuthCode === "A700000101")!;
      expect(stop.lines).toEqual([
        {
          productCode: "TA",
          qty: 300,
          qtyUnit: "L",
          retailPerUnit: 2.499,
          billedPerUnit: 2.2427,
          amount: 672.8,
          preTaxAmount: 595.4,
          hst: 77.4,
          gst: 0,
          pst: 0,
          qst: 0,
          currency: "CAD",
        },
      ]);
    });

    it("?currency=USD returns only the US invoice's stops, in gallons", async () => {
      const body = await get<ListTransactionsResult>(`/transactions?${w}&currency=USD&pageSize=200`);
      expect(body.total).toBe(3);
      expect(body.rows.every((r) => r.currency === "USD" && r.qtyUnit === "gal")).toBe(true);
    });

    it("with no currency, both sides of the week, each row carrying its own currency and unit", async () => {
      const body = await get<ListTransactionsResult>(`/transactions?${w}&pageSize=200`);
      expect(body.total).toBe(11);
      expect(new Set(body.rows.map((r) => `${r.currency}/${r.qtyUnit}`))).toEqual(new Set(["USD/gal", "CAD/L"]));
    });

    it("?units=imperial on a CAD week returns gallons and a per-gallon price, with identical money", async () => {
      const printed = await get<ListTransactionsResult>(`/transactions?${w}&currency=CAD&pageSize=200&includeLines=true`);
      const gallons = await get<ListTransactionsResult>(`/transactions?${w}&currency=CAD&pageSize=200&includeLines=true&units=imperial`);
      expect(gallons.total).toBe(printed.total);

      for (const row of printed.rows) {
        const converted = gallons.rows.find((r) => r.id === row.id)!;
        expect(converted.qtyUnit).toBe("gal");
        expect(converted.currency).toBe("CAD");
        // Money never changes: compared exactly, never with a tolerance.
        expect(converted.total).toBe(row.total);
        if (row.qty !== null) {
          expect(converted.qty).toBeCloseTo(row.qty / LITRES_PER_GALLON, 4);
          expect(converted.billedPerUnit).toBeCloseTo(row.billedPerUnit! * LITRES_PER_GALLON, 5);
        } else {
          expect(converted.qty).toBeNull();
        }
        for (const [i, line] of row.lines!.entries()) {
          const convertedLine = converted.lines![i]!;
          expect(convertedLine.amount).toBe(line.amount);
          expect(convertedLine.hst).toBe(line.hst);
          expect(convertedLine.preTaxAmount).toBe(line.preTaxAmount);
          expect(convertedLine.qty).toBeCloseTo(line.qty / LITRES_PER_GALLON, 4);
        }
      }
    });

    it("?units=metric on a USD week returns litres, and the transaction by id follows ?units too", async () => {
      const printed = await get<ListTransactionsResult>(`/transactions?${w}&currency=USD&pageSize=200`);
      const litres = await get<ListTransactionsResult>(`/transactions?${w}&currency=USD&pageSize=200&units=metric`);
      for (const row of printed.rows) {
        const converted = litres.rows.find((r) => r.id === row.id)!;
        expect(converted.qtyUnit).toBe("L");
        expect(converted.total).toBe(row.total);
        if (row.qty !== null) expect(converted.qty).toBeCloseTo(row.qty * LITRES_PER_GALLON, 4);
      }
      const id = printed.rows.find((r) => r.qty !== null)!.id;
      const detail = await get<TransactionDetail>(`/transactions/${id}?units=metric`);
      expect(detail.qtyUnit).toBe("L");
      expect(detail.lines.every((l) => l.qtyUnit === "L")).toBe(true);
    });

    it("sorts on `total`, the renamed sort value", async () => {
      const body = await get<ListTransactionsResult>(`/transactions?${w}&currency=CAD&pageSize=200&sortField=total&sortDirection=desc`);
      const totals = body.rows.map((r) => r.total);
      expect(totals).toEqual([...totals].sort((a, b) => b - a));
      await get("/transactions?sortField=total_usd", 400);
    });

    it("a week with no invoice on that side is empty, not an error", async () => {
      const body = await get<ListTransactionsResult>(`/transactions?week=2030-01-07&currency=CAD`);
      expect(body).toMatchObject({ total: 0, rows: [] });
    });
  });

  describe("GET /drivers, /trucks, /express-charges", () => {
    it("serve USD when no currency is asked for, and say so", async () => {
      const drivers = await get<DriversResult>(`/drivers?${w}`);
      expect(drivers).toMatchObject({ week: WEEK_END, currency: "USD", qtyUnit: "gal" });
      expect(drivers.fleet.stopCount).toBe(3);
    });

    it("?currency=CAD is the CA invoice alone, in litres; ?units=imperial converts quantity and price, not money", async () => {
      const printed = await get<DriversResult>(`/drivers?${w}&currency=CAD`);
      expect(printed).toMatchObject({ currency: "CAD", qtyUnit: "L" });
      expect(printed.fleet.stopCount).toBe(8);

      const gallons = await get<DriversResult>(`/drivers?${w}&currency=CAD&units=imperial`);
      expect(gallons.qtyUnit).toBe("gal");
      expect(gallons.fleet.total).toBe(printed.fleet.total);
      expect(gallons.fleet.qty).toBeCloseTo(printed.fleet.qty / LITRES_PER_GALLON, 1);
      expect(gallons.fleet.avgBilledPerUnit).toBeCloseTo(printed.fleet.avgBilledPerUnit! * LITRES_PER_GALLON, 4);
      expect(gallons.fleet.defRatio).toBe(printed.fleet.defRatio);
    });

    it("a driver's and a truck's detail are one side of the week too, with a same-currency history", async () => {
      const list = await get<DriversResult>(`/drivers?${w}&currency=CAD`);
      const busiest = list.rows[0]!;
      const detail = await get<DriverDetail>(`/drivers/${busiest.driver.id}?${w}&currency=CAD`);
      expect(detail).toMatchObject({ week: WEEK_END, currency: "CAD", qtyUnit: "L" });
      expect(detail.summary.total).toBe(busiest.total);
      expect(detail.history.map((h) => h.week)).toEqual([WEEK_END]);

      const trucks = await get<TrucksResult>(`/trucks?${w}&currency=CAD`);
      expect(trucks).toMatchObject({ currency: "CAD", qtyUnit: "L" });
      const truck = await get<TruckDetail>(`/trucks/${trucks.rows[0]!.truck.id}?${w}&currency=CAD`);
      expect(truck).toMatchObject({ week: WEEK_END, currency: "CAD", qtyUnit: "L" });
    });

    it("/express-charges is one side of the week, in its currency", async () => {
      const ca = await get<ExpressChargesResult>(`/express-charges?${w}&currency=CAD`);
      expect(ca).toMatchObject({ week: WEEK_END, currency: "CAD" });
      expect(ca.totals.currency).toBe("CAD");
      expect(ca.rows.every((r) => r.currency === "CAD")).toBe(true);
      const us = await get<ExpressChargesResult>(`/express-charges?${w}`);
      expect(us.currency).toBe("USD");
      expect(us.invoiceId).not.toBe(ca.invoiceId);
    });

    it("GET /trucks with no week at all is still the plain roster (D23)", async () => {
      const roster = await get<{ rows: Array<{ id: string; unitNumber: string }> }>("/trucks");
      expect(roster.rows.length).toBeGreaterThan(0);
      expect(roster.rows[0]).not.toHaveProperty("currency");
    });
  });

  describe("GET /overview and GET /receipt-queue", () => {
    it("/overview takes the week alone and serves the US side", async () => {
      const overview = await get<OverviewResult>(`/overview?${w}`);
      expect(overview).toMatchObject({ currency: "USD", qtyUnit: "gal" });
      expect(overview.kpis.week).toBe(WEEK_END);
      expect(overview.trend.map((p) => p.week)).toEqual([WEEK_END]);
      const litres = await get<OverviewResult>(`/overview?${w}&units=metric`);
      expect(litres.qtyUnit).toBe("L");
      expect(litres.kpis.total).toEqual(overview.kpis.total);
      expect(litres.kpis.diesel.qty).toBeCloseTo(overview.kpis.diesel.qty * LITRES_PER_GALLON, 2);
    });

    it("/receipt-queue is both sides until narrowed by currency or week", async () => {
      const all = await get<ReceiptQueueResult>("/receipt-queue");
      expect(all.progress.total).toBe(11);
      expect(new Set(all.items.map((i) => i.currency))).toEqual(new Set(["USD", "CAD"]));

      const ca = await get<ReceiptQueueResult>("/receipt-queue?currency=CAD");
      expect(ca.progress).toEqual({ done: 0, total: 8 });
      expect(ca.items.every((i) => i.currency === "CAD")).toBe(true);

      const noWeek = await get<ReceiptQueueResult>("/receipt-queue?week=2030-01-07");
      expect(noWeek).toEqual({ items: [], progress: { done: 0, total: 0 } });
    });
  });

  describe("GET /stations/{id}/billed-prices", () => {
    it("a CA station's series is CAD per litre, with no published price to compare against", async () => {
      const stationId = await insertStation(pool, { siteRef: "58156", nameRaw: "BVD COMBER", cityRaw: "Comber", stateUsps: "ON" });
      await pool.query("UPDATE stations SET country = 'CA' WHERE id = $1", [stationId]);
      const invoice = await insertInvoice(pool, { number: "CA-STN", periodStart: "2026-09-16", periodEnd: "2026-09-16", currency: "CAD" });
      const card = await insertCard(pool, { cardNumber: "9100001" });
      await insertStop(pool, {
        invoiceId: invoice,
        cardId: card,
        stationId,
        occurredAt: "2026-09-12T10:00:00Z",
        lines: [{ code: "TA", gallons: 200, billed: 2.1 }],
      });

      const series = await get<StationBilledPrices>(`/stations/${stationId}/billed-prices`);
      expect(series).toMatchObject({ currency: "CAD", qtyUnit: "L" });
      expect(series.days).toHaveLength(1);
      expect(series.days[0]).toMatchObject({ qty: 200, distinctBilledPrices: [2.1], avgBilledPerUnit: 2.1, publishedPerUnit: null, discrepancy: null, severity: null });

      const gallons = await get<StationBilledPrices>(`/stations/${stationId}/billed-prices?units=imperial`);
      expect(gallons.qtyUnit).toBe("gal");
      expect(gallons.days[0]!.avgBilledPerUnit).toBeCloseTo(2.1 * LITRES_PER_GALLON, 4);
    });
  });
});
