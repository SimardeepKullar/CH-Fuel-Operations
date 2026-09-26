import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import {
  SCHEMA,
  diffSchema,
  type ColumnDescriptor,
  type TableDescriptor,
} from "../../src/db/schema.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

/** PostGIS installs this itself; it is not ours to mirror. */
const NOT_OURS = new Set(["spatial_ref_sys"]);

interface ColumnRow {
  table_name: string;
  column_name: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
}

interface CheckRow {
  table_name: string;
  definition: string;
}

/**
 * Reads the live shape of `schema` back out of the catalogue in the same
 * vocabulary the descriptor uses, so the two can be compared directly.
 */
async function readActualSchema(
  pool: Pool,
  schema: string,
): Promise<TableDescriptor[]> {
  const { rows: columnRows } = await pool.query<ColumnRow>(
    `SELECT c.table_name, c.column_name, c.udt_name, c.is_nullable, c.column_default
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema
        AND t.table_name = c.table_name
        AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = $1
      ORDER BY c.table_name, c.ordinal_position`,
    [schema],
  );

  const { rows: checkRows } = await pool.query<CheckRow>(
    `SELECT rel.relname AS table_name,
            pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE n.nspname = $1 AND con.contype = 'c'`,
    [schema],
  );

  const tables = new Map<string, TableDescriptor>();

  for (const row of columnRows) {
    if (NOT_OURS.has(row.table_name)) continue;
    let table = tables.get(row.table_name);
    if (!table) {
      table = { name: row.table_name, columns: [] };
      tables.set(row.table_name, table);
    }
    const column: ColumnDescriptor = {
      name: row.column_name,
      type: row.udt_name,
      nullable: row.is_nullable === "YES",
    };
    if (row.column_default !== null) {
      // Sequence defaults are schema-qualified outside `public`, and this test
      // runs in a throwaway schema. Strip it so the descriptor stays portable.
      column.default = row.column_default.replaceAll(`${schema}.`, "");
    }
    tables.set(row.table_name, { ...table, columns: [...table.columns, column] });
  }

  for (const row of checkRows) {
    if (NOT_OURS.has(row.table_name)) continue;
    const table = tables.get(row.table_name);
    if (!table) continue;
    tables.set(row.table_name, {
      ...table,
      checks: [...(table.checks ?? []), row.definition],
    });
  }

  return [...tables.values()];
}

describe.skipIf(!hasDatabase)("schema drift (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let actual: TableDescriptor[];

  beforeAll(async () => {
    schema = `test_drift_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);
    actual = await readActualSchema(scopedPool, schema);
  });

  afterAll(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("reads a schema worth comparing against", () => {
    // Guards every negative assertion below: an empty or truncated read would
    // make diffSchema trivially agree with anything.
    expect(actual.length).toBe(SCHEMA.length);
    expect(actual.some((t) => t.name === "routes")).toBe(true);
    const routes = actual.find((t) => t.name === "routes");
    expect(routes?.columns.length).toBeGreaterThan(10);
  });

  it("descriptor matches information_schema exactly", () => {
    expect(diffSchema(SCHEMA, actual)).toEqual([]);
  });

  it("detects a wrong nullability in the descriptor", () => {
    const tampered = SCHEMA.map((table) =>
      table.name === "stations"
        ? {
            ...table,
            columns: table.columns.map((c) =>
              c.name === "city_raw" ? { ...c, nullable: true } : c,
            ),
          }
        : table,
    );
    expect(diffSchema(tampered, actual)).toEqual([
      "stations.city_raw: descriptor text NULL, database text NOT NULL",
    ]);
  });

  it("detects a column present in the database but absent from the descriptor", () => {
    const tampered = SCHEMA.map((table) =>
      table.name === "plans"
        ? {
            ...table,
            columns: table.columns.filter((c) => c.name !== "dispatched_at"),
          }
        : table,
    );
    expect(diffSchema(tampered, actual)).toEqual([
      "plans.dispatched_at: in database, missing from descriptor",
    ]);
  });

  it("detects a changed default", () => {
    // T-56: trucks' own planning-spec columns (reserve_fraction included) have
    // no schema-level default any more — every truck's spec comes from
    // 0005_fleet_roster_seed.sql's flagged application-level seed, not a
    // column DEFAULT — so this now tampers a column that still has one.
    const tampered = SCHEMA.map((table) =>
      table.name === "plans"
        ? {
            ...table,
            columns: table.columns.map((c) =>
              c.name === "fixed_stop_minutes" ? { ...c, default: "15" } : c,
            ),
          }
        : table,
    );
    expect(diffSchema(tampered, actual)).toEqual([
      "plans.fixed_stop_minutes: descriptor int4 NOT NULL DEFAULT 15, database int4 NOT NULL DEFAULT 20",
    ]);
  });

  it("detects a dropped CHECK constraint", () => {
    // The §12.2 case: plans.status quietly regaining an in-progress state.
    const tampered = SCHEMA.map((table) =>
      table.name === "plans"
        ? { ...table, checks: (table.checks ?? []).filter((c) => !c.includes("status")) }
        : table,
    );
    expect(diffSchema(tampered, actual)).toEqual([
      "plans: check in database, missing from descriptor — CHECK ((status = ANY (ARRAY['completed'::text, 'infeasible'::text])))",
    ]);
  });

  it("detects a table missing from the descriptor", () => {
    const tampered = SCHEMA.filter((table) => table.name !== "provider_quota");
    expect(diffSchema(tampered, actual)).toEqual([
      "table provider_quota: in database, missing from descriptor",
    ]);
  });

  // T-25: A11's actuals tables. express_charges.driver_id is the nullable
  // case called out by name in the ticket — the blank-name row in A19 is
  // real data, not a defect, and a wrong NOT NULL here would reject it.
  it("detects a wrong nullability on express_charges.driver_id", () => {
    const tampered = SCHEMA.map((table) =>
      table.name === "express_charges"
        ? {
            ...table,
            columns: table.columns.map((c) =>
              c.name === "driver_id" ? { ...c, nullable: false } : c,
            ),
          }
        : table,
    );
    expect(diffSchema(tampered, actual)).toEqual([
      "express_charges.driver_id: descriptor uuid NOT NULL, database uuid NULL",
    ]);
  });
});
