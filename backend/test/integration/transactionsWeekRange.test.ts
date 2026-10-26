import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import { scopedSchema, teardown } from "./support/actualsFixtures.js";
import { WEEK_END, importCa, importUs, redatedCsv, seedUsFixtureRoster, usInWeek } from "./support/billingWeekFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const NEXT_WEEK_END = "2026-09-16";

/** sample-redacted.csv a week later: a second billing week of US stops. */
const usNextWeek = (): Buffer =>
  redatedCsv("sample-redacted.csv", { "2026-01-05": "2026-09-14", "2026-01-06": "2026-09-15", "2026-01-07": "2026-09-16" });

/** T-74: `GET /transactions?weekFrom=&weekTo=` serves the Overview's range and all-time scopes. */
describe.skipIf(!hasDatabase)("GET /transactions over a range of billing weeks (integration, T-74)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let app: App;

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_tx_week_range"));
    await seedUsFixtureRoster(pool);
    app = createApp({ pool, authRequired: false });
    expect((await importUs(pool, usInWeek(), "invoice_100001.csv")).status).toBe("imported");
    expect((await importUs(pool, usNextWeek(), "invoice_100002.csv")).status).toBe("imported");
    expect((await importCa(pool)).status).toBe("imported");
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  const get = (query: string) => app.handle(new Request(`http://localhost/api/v1/transactions?pageSize=200${query}`));
  const rows = async (query: string): Promise<{ baseAuthCode: string }[]> => ((await (await get(query)).json()) as { rows: { baseAuthCode: string }[] }).rows;

  it("a range covers every week in it, and one week alone matches ?week=", async () => {
    const both = await rows(`&weekFrom=${WEEK_END}&weekTo=${NEXT_WEEK_END}&currency=USD`);
    const first = await rows(`&week=${WEEK_END}&currency=USD`);
    const second = await rows(`&week=${NEXT_WEEK_END}&currency=USD`);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(both).toHaveLength(first.length + second.length);
    expect(await rows(`&weekFrom=${NEXT_WEEK_END}&weekTo=${NEXT_WEEK_END}&currency=USD`)).toHaveLength(second.length);
  });

  it("currency picks one side across the range, and an open-ended bound reaches everything", async () => {
    const us = await rows(`&weekFrom=${WEEK_END}&currency=USD`);
    const ca = await rows(`&weekFrom=${WEEK_END}&currency=CAD`);
    const all = await rows("");
    expect(ca.length).toBeGreaterThan(0);
    expect(us.length + ca.length).toBe(all.length);
  });

  it("a range with no invoice matches nothing, never everything", async () => {
    expect(await rows("&weekFrom=2099-01-01&weekTo=2099-02-01")).toEqual([]);
  });

  it("week together with a range is a 400, and so is from after to", async () => {
    expect((await get(`&week=${WEEK_END}&weekFrom=${WEEK_END}`)).status).toBe(400);
    expect((await get(`&weekFrom=${NEXT_WEEK_END}&weekTo=${WEEK_END}`)).status).toBe(400);
  });
});
