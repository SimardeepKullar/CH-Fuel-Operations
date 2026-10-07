import { describe, expect, it } from "vitest";
import { MIN_STALE_AGE_MS, staleTestSchemas } from "./sweepStaleSchemas.js";

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const at = (msAgo: number) => String(NOW - msAgo);

describe("staleTestSchemas (T-50)", () => {
  it("selects every throwaway schema shape the tests create, old enough to be orphaned", () => {
    const names = [
      `test_drivers_${at(MIN_STALE_AGE_MS)}_k3j9x2`,
      `plan_actual_${at(60 * 60_000)}_a1b2c3`,
      `test_express_charges_999210_${at(24 * 60 * 60_000)}_zz9`,
    ];
    expect(staleTestSchemas(names, NOW)).toEqual(names);
  });

  it("leaves a schema younger than the cut-off — it may belong to a run in another terminal", () => {
    expect(staleTestSchemas([`test_drivers_${at(MIN_STALE_AGE_MS - 1)}_k3j9x2`], NOW)).toEqual([]);
  });

  it("never selects a schema without the <prefix>_<13-digit ms>_<base36> shape", () => {
    const names = [
      "public",
      "information_schema",
      "pg_catalog",
      "tiger",
      "topology",
      `Test_drivers_${at(MIN_STALE_AGE_MS)}_k3j9x2`,
      `test_drivers_${at(MIN_STALE_AGE_MS).slice(1)}_k3j9x2`,
      `test_drivers_${at(MIN_STALE_AGE_MS)}`,
      `test_drivers_${at(MIN_STALE_AGE_MS)}_K3J9`,
    ];
    expect(staleTestSchemas(names, NOW)).toEqual([]);
  });
});
