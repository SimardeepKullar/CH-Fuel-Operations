import { describe, expect, it } from "vitest";
import { computeDrift, parseQuotaHeaders } from "./quotaObserver.js";

describe("parseQuotaHeaders", () => {
  it("reads the rate-limit headers as numbers", () => {
    const headers = new Headers({ "x-ratelimit-limit": "200", "x-ratelimit-remaining": "198" });
    expect(parseQuotaHeaders(headers)).toEqual({ limit: 200, remaining: 198 });
  });

  it("reports null, not 0, for a missing header", () => {
    const headers = new Headers();
    expect(parseQuotaHeaders(headers)).toEqual({ limit: null, remaining: null });
  });
});

describe("computeDrift", () => {
  it("reports drift when their remaining falls faster than our permitted calls", () => {
    // They fell by 10 (200 -> 190), we only made 5 calls: 5 calls' worth of
    // drift — something is calling the provider outside the guard.
    expect(computeDrift(190, 200, 5)).toBe(5);
  });

  it("reports zero drift when they fall in step with our permitted calls", () => {
    expect(computeDrift(195, 200, 5)).toBe(0);
  });

  it("reports zero drift, not a negative, when their counter increases (a reset)", () => {
    // 50 -> 200 is their remaining rising, i.e. a window reset.
    expect(computeDrift(200, 50, 5)).toBe(0);
  });

  it("rebaselines when our own counter resets at UTC midnight", () => {
    // Our daily call_count fell (45 -> 2 across midnight) even though
    // their remaining fell too; neither counter's fall is drift here.
    expect(computeDrift(190, 200, -43)).toBe(0);
  });

  it("reports nothing for a single observation with no prior reading", () => {
    expect(computeDrift(198, null, 1)).toBeNull();
  });
});
