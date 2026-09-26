import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Every distance column, with the numeric width the schema gives it. */
const DISTANCE_COLUMNS: ReadonlyArray<{
  table: string;
  column: string;
  precision: number;
  scale: number;
}> = [
  { table: "place_centroids", column: "uncertainty_miles", precision: 8, scale: 3 },
  { table: "stations", column: "uncertainty_miles", precision: 8, scale: 3 },
  { table: "station_geocode_candidates", column: "uncertainty_miles", precision: 8, scale: 3 },
  { table: "routes", column: "distance_miles", precision: 9, scale: 3 },
  { table: "plans", column: "total_distance_miles", precision: 9, scale: 3 },
  { table: "plan_stops", column: "offset_along_route_miles", precision: 9, scale: 3 },
  { table: "plan_stops", column: "leg_distance_miles", precision: 9, scale: 3 },
  { table: "plan_stops", column: "detour_distance_miles", precision: 7, scale: 3 },
  { table: "plan_stops", column: "cum_distance_miles", precision: 9, scale: 3 },
];

describe.skipIf(!hasDatabase)("distance units in the live schema (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_units_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  it("has no column ending in _m — storage is miles", async () => {
    const { rows: all } = await scopedPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.columns WHERE table_schema = $1`,
      [schema],
    );
    // Guards the negative assertion: a wrong schema filter would return zero rows.
    expect(Number(all[0]?.n)).toBeGreaterThan(50);

    const { rows } = await scopedPool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = $1 AND column_name ~ '_m$'`,
      [schema],
    );
    expect(rows).toEqual([]);
  });

  it("names every distance column _miles, at the intended width", async () => {
    const { rows } = await scopedPool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      numeric_precision: number;
      numeric_scale: number;
    }>(
      `SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = $1 AND column_name ~ '_miles$'
          AND column_name !~ '^(max|min)_(leg|detour)_miles$'
          AND column_name !~ '^corridor_miles$'`,
      [schema],
    );

    const actual = rows
      .map((r) => `${r.table_name}.${r.column_name}:${r.data_type}(${r.numeric_precision},${r.numeric_scale})`)
      .sort();
    const expected = DISTANCE_COLUMNS.map(
      (c) => `${c.table}.${c.column}:numeric(${c.precision},${c.scale})`,
    ).sort();
    expect(actual).toEqual(expected);
  });
});
