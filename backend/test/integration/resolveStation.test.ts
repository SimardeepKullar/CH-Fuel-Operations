import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { resolveStation } from "../../src/resolve/resolveStation.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

async function insertStation(
  pool: Pool,
  opts: { siteRef: string; nameRaw: string; city?: string; state?: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO stations (supplier, site_ref, name_raw, city_raw, city_normalized, state_usps)
     VALUES ('BVD', $1, $2, $3, $3, $4)`,
    [opts.siteRef, opts.nameRaw, opts.city ?? "Dallas", opts.state ?? "TX"],
  );
}

describe.skipIf(!hasDatabase)("resolveStation (integration, T-29)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_resolvestation_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  async function siteRefOf(stationId: string | null): Promise<string | undefined> {
    const { rows } = await scopedPool.query<{ site_ref: string }>(
      "SELECT site_ref FROM stations WHERE id = $1",
      [stationId],
    );
    return rows[0]?.site_ref;
  }

  it("resolves on the invoice's own Site # against stations.site_ref — the same identifier on both sides", async () => {
    // Real pairing from data/bvd-prices/pcn-usd-9206810-981.csv: SITE 43673, NAME "LOVES #294".
    await insertStation(scopedPool, { siteRef: "43673", nameRaw: "LOVES #294" });
    await insertStation(scopedPool, { siteRef: "99999", nameRaw: "LOVES #999" });

    expect(await siteRefOf(await resolveStation(scopedPool, "43673", "LOVES #294"))).toBe("43673");
  });

  it("still resolves by store number when the site identifier is unknown", async () => {
    await insertStation(scopedPool, { siteRef: "43673", nameRaw: "LOVES #294" });
    await insertStation(scopedPool, { siteRef: "99999", nameRaw: "LOVES #999" });

    // No station carries site_ref 11111, so the store number parsed out of the
    // name is what resolves it — the behaviour this function had before.
    expect(await siteRefOf(await resolveStation(scopedPool, "11111", "LOVES #294"))).toBe("43673");
    expect(await siteRefOf(await resolveStation(scopedPool, "", "LOVES #294"))).toBe("43673");
  });

  it("never treats the site identifier as a store number", async () => {
    // 43673 is the site identifier of store #294; a station whose store number
    // literally is 43673 must not be matched by name for that site.
    await insertStation(scopedPool, { siteRef: "43673", nameRaw: "LOVES #294" });
    await insertStation(scopedPool, { siteRef: "55555", nameRaw: "LOVES #43673" });

    expect(await siteRefOf(await resolveStation(scopedPool, "43673", "LOVES #294"))).toBe("43673");
  });

  it("leaves station_id null when neither the site identifier nor the store number is known — no guess", async () => {
    await insertStation(scopedPool, { siteRef: "43673", nameRaw: "LOVES #294" });

    expect(await resolveStation(scopedPool, "11111", "LOVES #999999")).toBeNull();
  });

  it("imports T-08's parseStoreName rather than reimplementing store-number parsing", () => {
    const source = readFileSync(
      path.join(dirname, "../../src/resolve/resolveStation.ts"),
      "utf8",
    );
    expect(source).toContain('from "../resolution/storeNumber.js"');
    expect(source).toContain("parseStoreName");
  });
});
