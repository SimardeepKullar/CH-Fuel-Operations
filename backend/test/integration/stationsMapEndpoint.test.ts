import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import type { StationLocationSummary } from "../../src/domain/planResponse.js";
import type { StationPriceHistory } from "../../src/catalog/stations.js";
import { scopedSchema, teardown } from "./support/actualsFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const UNKNOWN_UUID = "3f2b7c1e-8a44-4f5b-9c1d-2e6a7b8c9d0e";

interface StationSpec {
  siteRef: string;
  nameRaw: string;
  storeNumber: number;
  lat: number;
  lng: number;
  resolution: "exact" | "city" | "unresolved";
}

async function insertStation(pool: Pool, spec: StationSpec): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO stations
       (supplier, site_ref, name_raw, store_number, city_raw, city_normalized, state_usps,
        geom, resolution, uncertainty_miles, truck_accessible)
     VALUES ('BVD', $1, $2, $3, 'Testville', 'TESTVILLE', 'TX',
             CASE WHEN $6 = 'unresolved' THEN NULL ELSE ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography END,
             $6, 0, 'operator_verified')
     RETURNING id`,
    [spec.siteRef, spec.nameRaw, spec.storeNumber, spec.lng, spec.lat, spec.resolution],
  );
  return rows[0]!.id;
}

describe.skipIf(!hasDatabase)("GET /stations, /stations/{id}/prices (integration, T-18 step 18.2)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let app: App;

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_stations_map"));
    app = createApp({ pool });
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  async function listStations(query: string): Promise<{ stations: StationLocationSummary[]; page: number; pageSize: number; total: number }> {
    const response = await app.handle(new Request(`http://localhost/api/v1/stations${query}`));
    expect(response.status).toBe(200);
    return (await response.json()) as { stations: StationLocationSummary[]; page: number; pageSize: number; total: number };
  }

  describe("GET /stations?bbox=&resolution=", () => {
    it("filters by bbox: a station outside the envelope is excluded", async () => {
      await insertStation(pool, { siteRef: "IN", nameRaw: "LOVES #1", storeNumber: 1, lat: 35, lng: -97, resolution: "exact" });
      await insertStation(pool, { siteRef: "OUT", nameRaw: "LOVES #2", storeNumber: 2, lat: 35, lng: 40, resolution: "exact" });

      const { stations, total } = await listStations("?bbox=-100,30,-90,40");

      expect(total).toBe(1);
      expect(stations.map((s) => s.name)).toEqual(["LOVES #1"]);
    });

    it("a continental-US-sized bbox still finds a station well inside it (T-23 follow-up: geography-cast ST_Intersects silently drops matches once the envelope gets large)", async () => {
      await insertStation(pool, { siteRef: "TX", nameRaw: "LOVES #767", storeNumber: 767, lat: 25.95, lng: -97.42, resolution: "exact" });

      const { stations, total } = await listStations("?bbox=-125,24,-66,50");

      expect(total).toBe(1);
      expect(stations.map((s) => s.name)).toEqual(["LOVES #767"]);
    });

    it("resolution=exact excludes city-tier stations", async () => {
      await insertStation(pool, { siteRef: "EX", nameRaw: "LOVES Exact", storeNumber: 1, lat: 35, lng: -97, resolution: "exact" });
      await insertStation(pool, { siteRef: "CI", nameRaw: "LOVES City", storeNumber: 2, lat: 35.1, lng: -97.1, resolution: "city" });

      const all = await listStations("?bbox=-100,30,-90,40");
      expect(all.stations.map((s) => s.name).sort()).toEqual(["LOVES City", "LOVES Exact"]);

      const exactOnly = await listStations("?bbox=-100,30,-90,40&resolution=exact");
      expect(exactOnly.stations.map((s) => s.name)).toEqual(["LOVES Exact"]);
    });

    it("an unresolved station never appears, filtered or not — it has no geom to plot", async () => {
      await insertStation(pool, { siteRef: "UN", nameRaw: "LOVES Unresolved", storeNumber: 3, lat: 35, lng: -97, resolution: "unresolved" });
      await insertStation(pool, { siteRef: "EX", nameRaw: "LOVES Exact", storeNumber: 1, lat: 35, lng: -97, resolution: "exact" });

      const { stations } = await listStations("?bbox=-100,30,-90,40");

      expect(stations.map((s) => s.name)).toEqual(["LOVES Exact"]);
    });

    it("paging is stable across pages: every id appears exactly once, and the total is the full match count", async () => {
      for (let i = 0; i < 5; i++) {
        await insertStation(pool, {
          siteRef: `P${i}`,
          nameRaw: `LOVES #${i}`,
          storeNumber: i,
          lat: 35,
          lng: -99 + i,
          resolution: "exact",
        });
      }

      const seenIds = new Set<string>();
      for (const page of [1, 2, 3]) {
        const result = await listStations(`?bbox=-100,30,-90,40&page=${page}&pageSize=2`);
        expect(result.total).toBe(5);
        expect(result.page).toBe(page);
        expect(result.pageSize).toBe(2);
        for (const station of result.stations) {
          expect(seenIds.has(station.id)).toBe(false);
          seenIds.add(station.id);
        }
      }
      expect(seenIds.size).toBe(5);

      const page4 = await listStations("?bbox=-100,30,-90,40&page=4&pageSize=2");
      expect(page4.stations).toEqual([]);
      expect(page4.total).toBe(5);
    });

    it("400s a malformed bbox", async () => {
      const response = await app.handle(new Request("http://localhost/api/v1/stations?bbox=not,a,bbox"));
      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
    });

    it("400s a missing bbox", async () => {
      const response = await app.handle(new Request("http://localhost/api/v1/stations"));
      expect(response.status).toBe(400);
    });
  });

  describe("GET /stations/{id}/prices", () => {
    async function insertPriceImport(effectiveDate: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO price_imports (supplier, source_filename, file_sha256, effective_date, status)
         VALUES ('BVD', $1, md5(random()::text || $1), $2::date, 'completed') RETURNING id`,
        [`${effectiveDate}.csv`, effectiveDate],
      );
      return rows[0]!.id;
    }

    async function insertStationPrice(
      stationId: string,
      importId: string,
      validOn: string,
      figures: { cost: number; totalCost: number; retail: number; yourPrice: number },
    ): Promise<void> {
      await pool.query(
        `INSERT INTO station_prices
           (station_id, import_id, raw_product, product_type, cost, federal_tax, state_tax, sales_tax, freight, other,
            total_cost, retail_price, your_price, savings, valid_on)
         VALUES ($1, $2, 'ULSD', 'highway_diesel', $4, 0, 0, 0, 0, 0, $5, $6, $7, 0, $3::date)`,
        [stationId, importId, validOn, figures.cost, figures.totalCost, figures.retail, figures.yourPrice],
      );
    }

    it("returns the price series oldest first, with pump/iftaNet/totalCost figures", async () => {
      const stationId = await insertStation(pool, { siteRef: "PR", nameRaw: "LOVES #313", storeNumber: 313, lat: 35, lng: -97, resolution: "exact" });
      const importAug = await insertPriceImport("2026-08-22");
      const importSep = await insertPriceImport("2026-09-01");
      await insertStationPrice(stationId, importAug, "2026-08-22", { cost: 4, totalCost: 4.5, retail: 4.8, yourPrice: 4.5 });
      await insertStationPrice(stationId, importSep, "2026-09-01", { cost: 4.1, totalCost: 4.6, retail: 4.7, yourPrice: 4.6 });

      const response = await app.handle(new Request(`http://localhost/api/v1/stations/${stationId}/prices`));
      expect(response.status).toBe(200);
      const result = (await response.json()) as StationPriceHistory;

      expect(result.station).toMatchObject({ id: stationId, name: "LOVES #313", storeNumber: 313 });
      expect(result.prices.map((p) => p.validOn)).toEqual(["2026-08-22", "2026-09-01"]);
      // price_pump is generated as your_price; total_cost is read as given.
      expect(result.prices[0]).toMatchObject({ pumpUsdPerGal: 4.5, totalCostUsdPerGal: 4.5 });
      expect(result.prices[1]).toMatchObject({ pumpUsdPerGal: 4.6, totalCostUsdPerGal: 4.6 });
      expect(result.prices[0]!.iftaNetUsdPerGal).toBeCloseTo(4, 10);
    });

    it("a station with no sheet prices is an empty series, not a 404", async () => {
      const stationId = await insertStation(pool, { siteRef: "QT", nameRaw: "LOVES Quiet", storeNumber: 2, lat: 35, lng: -97, resolution: "exact" });

      const response = await app.handle(new Request(`http://localhost/api/v1/stations/${stationId}/prices`));
      expect(response.status).toBe(200);
      const result = (await response.json()) as StationPriceHistory;

      expect(result.prices).toEqual([]);
    });

    it("404s an id that names no station, and a malformed one, as problem+json", async () => {
      for (const id of [UNKNOWN_UUID, "not-a-uuid"]) {
        const response = await app.handle(new Request(`http://localhost/api/v1/stations/${id}/prices`));
        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
      }
    });
  });
});
