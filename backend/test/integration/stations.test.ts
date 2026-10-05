import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import type { StationBilledPrices } from "../../src/actuals/stations.js";
import { runImportInvoiceCli } from "../../src/cli/importInvoice.js";
import {
  insertCard,
  insertInvoice,
  insertPublishedPrice,
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
 * Hand-built rows. Site "T37-25334" buys diesel on three days:
 *   09-07  five cards, one stop each, all at 5.5208   (the shape A6.5 describes)
 *   09-08  two cards at two different prices, 5.50 and 5.60
 *   09-09  five cards, one stop each, all at 5.5208
 * No published-price row exists unless a test inserts one.
 */
describe.skipIf(!hasDatabase)("GET /stations/{id}/billed-prices (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let app: App;
  let stationId: string;

  async function getPrices(id = stationId, status = 200): Promise<StationBilledPrices> {
    const response = await app.handle(new Request(`http://localhost/api/v1/stations/${id}/billed-prices`));
    expect(response.status).toBe(status);
    return (await response.json()) as StationBilledPrices;
  }

  const day = async (date: string) => (await getPrices()).days.find((d) => d.date === date)!;

  beforeEach(async () => {
    ({ adminPool, scopedPool, schema } = await scopedSchema("test_stations"));
    app = createApp({ pool: scopedPool });

    const invoice = await insertInvoice(scopedPool, { number: "T37-STN", periodStart: "2026-09-03", periodEnd: "2026-09-10" });
    stationId = await insertStation(scopedPool, {
      siteRef: "T37-25334",
      nameRaw: "LOVES #313",
      cityRaw: "Matthews",
      stateUsps: "MO",
    });
    const cards = await Promise.all([1, 2, 3, 4, 5].map((n) => insertCard(scopedPool, { cardNumber: `T37-C${n}` })));

    for (const [i, cardId] of cards.entries()) {
      for (const date of ["2026-09-07", "2026-09-09"]) {
        await insertStop(scopedPool, {
          invoiceId: invoice,
          cardId,
          stationId,
          occurredAt: `${date}T1${i}:00:00Z`,
          lines: [
            { code: "TA", gallons: 100, billed: 5.5208 },
            { code: "DF", gallons: 3, billed: 4 },
          ],
        });
      }
    }
    await insertStop(scopedPool, { invoiceId: invoice, cardId: cards[0]!, stationId, occurredAt: "2026-09-08T10:00:00Z", lines: [{ code: "TA", gallons: 100, billed: 5.5 }] });
    await insertStop(scopedPool, { invoiceId: invoice, cardId: cards[1]!, stationId, occurredAt: "2026-09-08T14:00:00Z", lines: [{ code: "TA", gallons: 300, billed: 5.6 }] });
  });

  afterEach(async () => {
    await teardown(adminPool, scopedPool, schema);
  });

  describe("price per site per day (A6.5)", () => {
    it("five cards on 09-07 and on 09-09 were all billed 5.5208 — one distinct price a day, not just an average that rounds to it", async () => {
      for (const date of ["2026-09-07", "2026-09-09"]) {
        const d = await day(date);

        expect(d.cardCount).toBe(5);
        expect(d.stopCount).toBe(5);
        expect(d.distinctBilledPrices).toEqual([5.5208]);
        expect(d.avgBilledPerUnit).toBeCloseTo(5.5208, 10);
        expect(d.qty).toBe(500);
      }
    });

    it("a day billed at two prices shows both, with the gallons-weighted average between them", async () => {
      const d = await day("2026-09-08");

      expect(d.distinctBilledPrices).toEqual([5.5, 5.6]);
      // (100 × 5.50 + 300 × 5.60) / 400 = 5.575 — not the 5.55 mean of the two prices.
      expect(d.avgBilledPerUnit).toBeCloseTo(5.575, 10);
    });

    it("returns days oldest first, one row per day, and the station's own identity", async () => {
      const result = await getPrices();

      expect(result.days.map((d) => d.date)).toEqual(["2026-09-07", "2026-09-08", "2026-09-09"]);
      expect(result.station).toEqual({
        id: stationId,
        siteRef: "T37-25334",
        nameRaw: "LOVES #313",
        cityRaw: "Matthews",
        stateUsps: "MO",
      });
    });

    it("counts only diesel: a DEF line at 4.00 is not a billed price", async () => {
      expect((await day("2026-09-07")).distinctBilledPrices).not.toContain(4);
    });

    it("a station with no fuel stops is an empty series, not a 404", async () => {
      const quiet = await insertStation(scopedPool, { siteRef: "T37-QUIET", nameRaw: "LOVES #2" });

      const result = await getPrices(quiet);

      expect(result.days).toEqual([]);
      expect(result.station.id).toBe(quiet);
    });

    it("the id is stations.id: the site_ref and an unknown uuid are both a 404 problem+json", async () => {
      for (const id of ["T37-25334", UNKNOWN_UUID]) {
        const response = await app.handle(new Request(`http://localhost/api/v1/stations/${id}/billed-prices`));
        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
      }
    });
  });

  describe("discrepancy against the published file (A18 Q5)", () => {
    it("is null — not 0 — on every day when no published price file exists, with the published price null beside it", async () => {
      for (const d of (await getPrices()).days) {
        expect(d.discrepancy).toBeNull();
        expect(d.publishedPerUnit).toBeNull();
        expect(d.severity).toBeNull();
      }
    });

    it("is null on a day with no published row even when a neighbouring day has one (the January 11 shape)", async () => {
      await insertPublishedPrice(scopedPool, { stationId, validOn: "2026-09-07", yourPrice: 5.5208 });

      expect((await day("2026-09-07")).discrepancy).toBe(0);
      expect((await day("2026-09-08")).discrepancy).toBeNull();
      expect((await day("2026-09-09")).discrepancy).toBeNull();
    });

    it("a published price that matches the billed price is a real zero, distinct from null", async () => {
      await insertPublishedPrice(scopedPool, { stationId, validOn: "2026-09-07", yourPrice: 5.5208 });

      const d = await day("2026-09-07");

      expect(d.discrepancy).toBe(0);
      expect(d.publishedPerUnit).toBe(5.5208);
      expect(d.severity).toBeNull();
    });

    it("a published price 2 cents below the billed price is a +0.02 discrepancy, kept beside the published price", async () => {
      await insertPublishedPrice(scopedPool, { stationId, validOn: "2026-09-07", yourPrice: 5.5008 });

      const d = await day("2026-09-07");

      expect(d.discrepancy).toBe(0.02);
      expect(d.publishedPerUnit).toBe(5.5008);
    });

    it("2 cents does NOT cross the seeded 10-cent threshold, so it carries no severity", async () => {
      await insertPublishedPrice(scopedPool, { stationId, validOn: "2026-09-07", yourPrice: 5.5008 });

      const { rows } = await scopedPool.query<{ config: { maxOverageUsdPerGal: string } }>(
        "SELECT config FROM anomaly_thresholds WHERE rule = 'price_above_published'",
      );
      expect(rows[0]!.config.maxOverageUsdPerGal).toBe("0.10");
      expect((await day("2026-09-07")).severity).toBeNull();
    });

    it("2 cents is a billing error (red) once the threshold row says 1 cent — the threshold is data, read from anomaly_thresholds", async () => {
      await insertPublishedPrice(scopedPool, { stationId, validOn: "2026-09-07", yourPrice: 5.5008 });
      await scopedPool.query(
        `UPDATE anomaly_thresholds SET config = config || '{"maxOverageUsdPerGal": "0.01"}'::jsonb
         WHERE rule = 'price_above_published'`,
      );

      const d = await day("2026-09-07");

      expect(d.discrepancy).toBe(0.02);
      expect(d.severity).toBe("red");
    });

    it("a gap over the seeded threshold is red without touching the threshold row", async () => {
      await insertPublishedPrice(scopedPool, { stationId, validOn: "2026-09-07", yourPrice: 5.4008 });

      const d = await day("2026-09-07");

      expect(d.discrepancy).toBe(0.12);
      expect(d.severity).toBe("red");
    });

    it("a billed price below the published one is a negative discrepancy and no severity", async () => {
      await insertPublishedPrice(scopedPool, { stationId, validOn: "2026-09-07", yourPrice: 5.6208 });

      const d = await day("2026-09-07");

      expect(d.discrepancy).toBe(-0.1);
      expect(d.severity).toBeNull();
    });

    it("on a day billed at two prices the discrepancy is against the highest, and severity flags if any price crosses", async () => {
      // Billed 5.50 and 5.60 on 09-08. Published 5.45: the 5.60 price is 15 cents over, the 5.50 only 5.
      await insertPublishedPrice(scopedPool, { stationId, validOn: "2026-09-08", yourPrice: 5.45 });

      const d = await day("2026-09-08");

      expect(d.discrepancy).toBe(0.15);
      expect(d.severity).toBe("red");
    });

    it("a published price for another station never leaks in", async () => {
      const other = await insertStation(scopedPool, { siteRef: "T37-OTHER", nameRaw: "LOVES #7" });
      await insertPublishedPrice(scopedPool, { stationId: other, validOn: "2026-09-07", yourPrice: 1 });

      expect((await day("2026-09-07")).discrepancy).toBeNull();
    });

    it("a published row with a null your_price is no figure to audit against — same as no row", async () => {
      await insertPublishedPrice(scopedPool, { stationId, validOn: "2026-09-07", yourPrice: 5.5 });
      await scopedPool.query("UPDATE station_prices SET your_price = NULL WHERE station_id = $1", [stationId]);

      expect((await day("2026-09-07")).discrepancy).toBeNull();
    });
  });
});

/**
 * The real invoice, with the station roster this bare schema lacks.
 *
 * `importInvoice` resolves a stop's station on the invoice's `Site #` against
 * `stations.site_ref` (resolveStation), and a bare test schema loads no
 * stations table — so without this seed every imported stop has
 * `station_id = NULL` and there is nothing to assert. Seeding site_ref 25334
 * *before* the import is what makes LOVES #313's stops resolve; it is never
 * treated as a store number.
 */
describe.skipIf(!hasDatabase || !hasRealFixture)("GET /stations/{id}/billed-prices on 999210 (integration, local fixture only)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let app: App;
  let stationId: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    ({ adminPool, scopedPool, schema } = await scopedSchema("test_stations_999210", realMigrationsDir));
    app = createApp({ pool: scopedPool });
    stationId = await insertStation(scopedPool, {
      siteRef: "25334",
      nameRaw: "LOVES #313",
      cityRaw: "Matthews",
      stateUsps: "MO",
    });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runImportInvoiceCli([realCsvPath], scopedPool)).toBe(0);
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await teardown(adminPool, scopedPool, schema);
  });

  async function getPrices(): Promise<StationBilledPrices> {
    const response = await app.handle(new Request(`http://localhost/api/v1/stations/${stationId}/billed-prices`));
    expect(response.status).toBe(200);
    return (await response.json()) as StationBilledPrices;
  }

  it("the seeded station resolved on the import: its stops carry station_id, matched on site_ref", async () => {
    const { rows } = await scopedPool.query<{ n: string }>("SELECT count(*) AS n FROM fuel_stops WHERE station_id = $1", [stationId]);

    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });

  /**
   * Measured, not copied from A6.5. The scope says "five drivers at LOVES #313 on
   * 9/7 and 9/9 were all billed 5.5208"; the invoice has FIVE diesel rows at
   * this site in total, split 1 / 3 / 1 across 9/3, 9/7 and 9/9:
   *   09-03  DHNESH KUMAR                                  5.6593
   *   09-07  DHNESH KUMAR, RAJVEER RANA, JATINDER          5.5208  (3 cards)
   *   09-09  DHNESH KUMAR                                  5.5208  (1 card)
   * The finding itself holds — one billed price per site per day, the same
   * price for every card on 9/7 — but on 4 stops and 3 cards, not 5.
   * The same holds fleet-wide: of 54 site-days in the invoice, none carries
   * two billed prices (only 5 have two or more stops, so the evidence is thin).
   */
  it("site 25334 (LOVES #313): every card on 09-07 and 09-09 was billed 5.5208 — one price per site per day (A6.5)", async () => {
    const { days } = await getPrices();

    const sept7 = days.find((d) => d.date === "2026-09-07");
    const sept9 = days.find((d) => d.date === "2026-09-09");
    expect(sept7).toMatchObject({ stopCount: 3, cardCount: 3, distinctBilledPrices: [5.5208] });
    expect(sept9).toMatchObject({ stopCount: 1, cardCount: 1, distinctBilledPrices: [5.5208] });
    expect(sept7!.avgBilledPerUnit).toBeCloseTo(5.5208, 10);
  });

  it("the price moves between days, not within one: 09-03 was 5.6593, and the station has exactly five diesel stops in all", async () => {
    const { days } = await getPrices();

    expect(days.map((d) => [d.date, d.distinctBilledPrices])).toEqual([
      ["2026-09-03", [5.6593]],
      ["2026-09-07", [5.5208]],
      ["2026-09-09", [5.5208]],
    ]);
    expect(days.reduce((sum, d) => sum + d.stopCount, 0)).toBe(5);
    for (const d of days) {
      expect(d.distinctBilledPrices).toHaveLength(1);
    }
  });

  it("discrepancy is null on every day: nothing seeds published prices for September 2026, and it is not faked", async () => {
    const { days } = await getPrices();

    expect(days.length).toBeGreaterThan(0);
    for (const d of days) {
      expect(d.discrepancy).toBeNull();
      expect(d.publishedPerUnit).toBeNull();
      expect(d.severity).toBeNull();
    }
  });

  it("the day rows reconcile with the stored lines: Σ stopCount and Σ gallons match SQL over this station's diesel", async () => {
    const { days } = await getPrices();
    const { rows } = await scopedPool.query<{ stops: string; gallons: string }>(
      `SELECT count(DISTINCT fs.id) AS stops, SUM(fsl.qty) AS gallons
       FROM fuel_stops fs JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id AND fsl.product_code = 'TA'
       WHERE fs.station_id = $1`,
      [stationId],
    );

    expect(days.reduce((s, d) => s + d.stopCount, 0)).toBe(Number(rows[0]!.stops));
    expect(days.reduce((s, d) => s + d.qty, 0)).toBeCloseTo(Number(rows[0]!.gallons), 2);
  });
});
