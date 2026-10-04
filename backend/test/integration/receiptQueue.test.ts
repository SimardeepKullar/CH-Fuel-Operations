import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import { EXCEPTIONS_FIRST_QUEUE_ORDER, listReceiptQueue } from "../../src/actuals/receipts.js";
import { runImportInvoiceCli } from "../../src/cli/importInvoice.js";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const realMigrationsDir = path.join(dirname, "../../../migrations/real");
const realFixturePath = path.join(dirname, "../../../data/bvd-invoices/invoice_999210.csv");
const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRealFixture = existsSync(realFixturePath);

interface SeedIds {
  driverA: string;
  driverB: string;
  stopA1: string;
  stopA2: string;
  stopA3: string;
  stopB1: string;
  stopBConfirmed: string;
  checker: string;
}

/**
 * A small hand-built fixture rather than a CSV import — T-35 is about the
 * queue and its writes, not ingest, so this seeds exactly the shape it needs
 * directly: two drivers, one already-confirmed stop (proving the WHERE
 * clause excludes it, not a client-side filter), and one anomaly (D17's
 * exceptions-first ordering).
 */
async function seed(pool: Pool): Promise<SeedIds> {
  await pool.query(
    `INSERT INTO invoices (invoice_number, period_start, period_end, billing_week_end, invoice_date, due_date, currency, qty_unit, grand_total, status, file_sha256)
     VALUES ('T35-TEST', '2026-02-01', '2026-02-07', '2026-02-07', '2026-02-08', '2026-02-09', 'USD', 'gal', 0, 'imported', repeat('0', 64))`,
  );
  const invoiceId = (
    await pool.query<{ id: string }>("SELECT id FROM invoices WHERE invoice_number = 'T35-TEST'")
  ).rows[0]!.id;

  await pool.query("INSERT INTO fuel_cards (card_number) VALUES ('3000001')");
  const cardId = (await pool.query<{ id: string }>("SELECT id FROM fuel_cards WHERE card_number = '3000001'"))
    .rows[0]!.id;

  await pool.query("INSERT INTO trucks (unit_number) VALUES ('201'), ('202')");
  const truckA = (await pool.query<{ id: string }>("SELECT id FROM trucks WHERE unit_number = '201'")).rows[0]!.id;
  const truckB = (await pool.query<{ id: string }>("SELECT id FROM trucks WHERE unit_number = '202'")).rows[0]!.id;

  await pool.query("INSERT INTO drivers (display_name) VALUES ('DRIVER A'), ('DRIVER B')");
  const driverA = (await pool.query<{ id: string }>("SELECT id FROM drivers WHERE display_name = 'DRIVER A'"))
    .rows[0]!.id;
  const driverB = (await pool.query<{ id: string }>("SELECT id FROM drivers WHERE display_name = 'DRIVER B'"))
    .rows[0]!.id;

  const insertStop = async (
    authCode: string,
    occurredAt: string,
    driverId: string,
    truckId: string,
    receiptStatus: "pending" | "confirmed",
  ): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO fuel_stops
         (invoice_id, base_auth_code, occurred_at, card_id, truck_id, driver_id, unit_raw, driver_name_raw, total, receipt_status)
       VALUES ($1, $2, $3::timestamptz, $4, $5, $6, 'unit', 'raw name', 100.00, $7)
       RETURNING id`,
      [invoiceId, authCode, occurredAt, cardId, truckId, driverId, receiptStatus],
    );
    return rows[0]!.id;
  };

  const stopA1 = await insertStop("T35-A1", "2026-02-03T10:00:00Z", driverA, truckA, "pending");
  const stopA2 = await insertStop("T35-A2", "2026-02-02T10:00:00Z", driverA, truckA, "pending");
  const stopA3 = await insertStop("T35-A3", "2026-02-01T10:00:00Z", driverA, truckA, "pending");
  const stopB1 = await insertStop("T35-B1", "2026-02-04T10:00:00Z", driverB, truckB, "pending");
  const stopBConfirmed = await insertStop("T35-B2", "2026-02-05T10:00:00Z", driverB, truckB, "confirmed");

  // The newest of driver A's stops (stopA1) carries an undismissed anomaly —
  // deliberately not the one the default (oldest-first) order would already
  // put first, so the exceptions-first test proves the spec actually moves
  // it, not just that it happens to agree with the default.
  await pool.query(
    `INSERT INTO anomalies (subject_type, subject_id, rule, severity) VALUES ('fuel_stop', $1, 'test_rule', 'amber')`,
    [stopA1],
  );

  await pool.query(
    `INSERT INTO users (email, password_hash, display_name) VALUES ('checker@example.com', 'x', 'Checker')`,
  );
  const checker = (await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'checker@example.com'"))
    .rows[0]!.id;

  return { driverA, driverB, stopA1, stopA2, stopA3, stopB1, stopBConfirmed, checker };
}

function postReceiptCheck(body: unknown): Request {
  return new Request("http://localhost/api/v1/receipt-checks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!hasDatabase)("receipt queue and receipt checks (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let app: App;
  let ids: SeedIds;

  beforeEach(async () => {
    schema = `test_receipt_queue_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);
    ids = await seed(scopedPool);
    app = createApp({ pool: scopedPool });
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("GET /receipt-queue returns only unconfirmed stops, with A8.5's context fields", async () => {
    const response = await app.handle(new Request("http://localhost/api/v1/receipt-queue"), {
      userId: ids.checker,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{
        id: string;
        occurredAt: string;
        driver: { resolved: string | null; raw: string; agrees: boolean | null };
        truck: { resolved: string | null; raw: string; agrees: boolean | null };
        station: unknown;
        total: number;
        receiptStatus: string;
      }>;
      progress: { done: number; total: number };
    };

    const returnedIds = body.items.map((i) => i.id);
    expect(returnedIds).toContain(ids.stopA1);
    expect(returnedIds).toContain(ids.stopB1);
    expect(returnedIds).not.toContain(ids.stopBConfirmed); // already confirmed — excluded, not filtered client-side

    const item = body.items.find((i) => i.id === ids.stopA1)!;
    expect(item.driver.resolved).toBe("DRIVER A");
    expect(item.truck.resolved).toBe("201");
    expect(item.total).toBe(100);
    expect(item.receiptStatus).toBe("pending");

    expect(body.progress).toEqual({ done: 1, total: 5 }); // stopBConfirmed is the one "done" stop
  });

  it("ordering is deterministic across calls", async () => {
    const first = await listReceiptQueue(scopedPool);
    const second = await listReceiptQueue(scopedPool);
    expect(first.items.map((i) => i.id)).toEqual(second.items.map((i) => i.id));
  });

  it("switching to exceptions-first ordering requires no migration — only swapping the order spec", async () => {
    const defaultOrder = await listReceiptQueue(scopedPool);
    // Oldest-first by default: stopA3 (2026-02-01) leads, not the anomalous
    // stopA1 (2026-02-03).
    expect(defaultOrder.items[0]!.id).toBe(ids.stopA3);

    const exceptionsFirst = await listReceiptQueue(scopedPool, EXCEPTIONS_FIRST_QUEUE_ORDER);
    // Same query, same table, same code — only the spec passed in changed,
    // and the anomalous (but newest) stop now leads.
    expect(exceptionsFirst.items[0]!.id).toBe(ids.stopA1);
    expect(exceptionsFirst.items[0]!.hasException).toBe(true);
    expect(exceptionsFirst.items[0]!.id).not.toBe(defaultOrder.items[0]!.id);

    // Every non-exception item still sorted oldest-first behind it.
    const rest = exceptionsFirst.items.slice(1);
    const restTimes = rest.map((i) => new Date(i.occurredAt).getTime());
    expect(restTimes).toEqual([...restTimes].sort((a, b) => a - b));
  });

  it("a single decision writes one append-only receipt_checks row with checker and timestamp; the stop's status follows", async () => {
    const response = await app.handle(
      postReceiptCheck({ fuelStopId: ids.stopA1, outcome: "confirmed" }),
      { userId: ids.checker },
    );
    expect(response.status).toBe(201);

    const { rows } = await scopedPool.query<{ outcome: string; checked_by: string }>(
      "SELECT outcome, checked_by FROM receipt_checks WHERE fuel_stop_id = $1",
      [ids.stopA1],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ outcome: "confirmed", checked_by: ids.checker });

    const { rows: stopRows } = await scopedPool.query<{ receipt_status: string }>(
      "SELECT receipt_status FROM fuel_stops WHERE id = $1",
      [ids.stopA1],
    );
    expect(stopRows[0]!.receipt_status).toBe("confirmed");
  });

  it("404s a decision against an unknown fuel stop id, without writing a row", async () => {
    const response = await app.handle(
      postReceiptCheck({ fuelStopId: "00000000-0000-0000-0000-000000000000", outcome: "missing" }),
      { userId: ids.checker },
    );
    expect(response.status).toBe(404);
    expect((await scopedPool.query("SELECT count(*) FROM receipt_checks")).rows[0]!.count).toBe("0");
  });

  it("skip writes nothing and leaves the item in the queue", async () => {
    const response = await app.handle(postReceiptCheck({ fuelStopId: ids.stopA1, outcome: "skip" }), {
      userId: ids.checker,
    });
    expect(response.status).toBe(400);
    expect((await scopedPool.query("SELECT count(*) FROM receipt_checks")).rows[0]!.count).toBe("0");

    const queue = await listReceiptQueue(scopedPool);
    expect(queue.items.map((i) => i.id)).toContain(ids.stopA1);
  });

  it("batch confirm for a driver writes one row per stop in one transaction, and is idempotent", async () => {
    const first = await app.handle(postReceiptCheck({ driverId: ids.driverA, outcome: "confirmed" }), {
      userId: ids.checker,
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { confirmedCount: number };
    expect(firstBody.confirmedCount).toBe(3); // stopA1, stopA2, stopA3

    const { rows: statuses } = await scopedPool.query<{ receipt_status: string }>(
      "SELECT receipt_status FROM fuel_stops WHERE driver_id = $1",
      [ids.driverA],
    );
    expect(statuses.every((s) => s.receipt_status === "confirmed")).toBe(true);

    const { rows: checkCounts } = await scopedPool.query<{ count: string }>(
      "SELECT count(*) FROM receipt_checks WHERE fuel_stop_id = ANY($1)",
      [[ids.stopA1, ids.stopA2, ids.stopA3]],
    );
    expect(checkCounts[0]!.count).toBe("3");

    // Idempotent: nothing left unconfirmed for this driver, so a second call
    // writes nothing new.
    const second = await app.handle(postReceiptCheck({ driverId: ids.driverA, outcome: "confirmed" }), {
      userId: ids.checker,
    });
    const secondBody = (await second.json()) as { confirmedCount: number };
    expect(secondBody.confirmedCount).toBe(0);
    const { rows: checkCountsAfter } = await scopedPool.query<{ count: string }>(
      "SELECT count(*) FROM receipt_checks WHERE fuel_stop_id = ANY($1)",
      [[ids.stopA1, ids.stopA2, ids.stopA3]],
    );
    expect(checkCountsAfter[0]!.count).toBe("3"); // unchanged
  });

  it("a confirmed stop never reappears in the queue", async () => {
    await app.handle(postReceiptCheck({ fuelStopId: ids.stopB1, outcome: "confirmed" }), {
      userId: ids.checker,
    });

    const queue = await listReceiptQueue(scopedPool);
    expect(queue.items.map((i) => i.id)).not.toContain(ids.stopB1);
  });
});

/**
 * The one figure this ticket asks to be measured against the real invoice
 * rather than a synthetic fixture (BUILD-PLAN-v2.md Step 35.1). The real
 * 999210 CSV holds 66 fuel stops, not A5's stale 60 (see
 * invoice999210.test.ts's own note on that number) — 48 of the 66 are
 * confirmed here, so the figure this test asserts is `{done: 48, total: 66}`,
 * not the stale `{done: 48, total: 60}`.
 */
describe.skipIf(!hasDatabase || !hasRealFixture)("receipt queue progress on 999210 (integration, local fixture only)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_receipt_queue_999210_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, realMigrationsDir);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitCode = await runImportInvoiceCli([realFixturePath], scopedPool);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    if (exitCode !== 0) {
      throw new Error("fixture import failed");
    }
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("progress reads {done: 48, total: 66} after confirming 48 of the real invoice's stops", async () => {
    await scopedPool.query(
      `INSERT INTO users (email, password_hash, display_name) VALUES ('checker@example.com', 'x', 'Checker')`,
    );
    const checkerId = (
      await scopedPool.query<{ id: string }>("SELECT id FROM users WHERE email = 'checker@example.com'")
    ).rows[0]!.id;

    const { rows: allStops } = await scopedPool.query<{ id: string }>(
      "SELECT id FROM fuel_stops ORDER BY id LIMIT 48",
    );
    expect(allStops).toHaveLength(48);

    await scopedPool.query(
      `INSERT INTO receipt_checks (fuel_stop_id, checked_by, outcome)
       SELECT id, $2, 'confirmed' FROM fuel_stops WHERE id = ANY($1)`,
      [allStops.map((s) => s.id), checkerId],
    );
    await scopedPool.query("UPDATE fuel_stops SET receipt_status = 'confirmed' WHERE id = ANY($1)", [
      allStops.map((s) => s.id),
    ]);

    const queue = await listReceiptQueue(scopedPool);
    expect(queue.progress).toEqual({ done: 48, total: 66 });
  });
});
