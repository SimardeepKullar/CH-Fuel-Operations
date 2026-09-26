import { describe, expect, it } from "vitest";
import { stratifiedTopK } from "./stratifiedTopK.js";

interface Candidate {
  id: string;
  offsetAlongRouteMiles: number;
  unitPriceUsd: number;
}

const at = (id: string, miles: number, price: number): Candidate => ({
  id,
  offsetAlongRouteMiles: miles,
  unitPriceUsd: price,
});

const miles = (c: Candidate) => c.offsetAlongRouteMiles;
const bucketOf = (c: Candidate) => Math.floor(miles(c) / 50);

/** Largest gap between consecutive positions, in miles. */
function maxGap(picked: Candidate[]): number {
  const sorted = picked.map(miles).sort((a, b) => a - b);
  return Math.max(...sorted.slice(1).map((m, i) => m - sorted[i]!));
}

describe("stratifiedTopK", () => {
  describe("the trap: the cheapest stations all cluster at one end", () => {
    // 200 stations spread evenly over a 900-mile route. The first 300 miles are
    // Texas-cheap ($3.00-$3.99); everything past that costs $4.00 or more.
    const stations = Array.from({ length: 200 }, (_, i) => {
      const position = (i / 200) * 900;
      const price = position < 300 ? 3 + (i / 200) * 0.6 : 4 + (i / 200) * 0.6;
      return at(`s${i}`, position, Number(price.toFixed(4)));
    });

    it("is a real trap: a plain price sort leaves a 500-mile hole", () => {
      const cheapest40 = [...stations].sort((a, b) => a.unitPriceUsd - b.unitPriceUsd).slice(0, 40);

      expect(Math.max(...cheapest40.map(miles))).toBeLessThan(300);
      // From the last cheap pick to the end of the route: nothing to buy from.
      expect(900 - Math.max(...cheapest40.map(miles))).toBeGreaterThan(500);
    });

    it("draws from every 50-mile bucket that had any station, so no hole opens", () => {
      const picked = stratifiedTopK(stations, { k: 40 });

      const occupied = new Set(stations.map(bucketOf));
      expect(new Set(picked.map(bucketOf))).toEqual(occupied);
      expect(occupied.size).toBe(18);
      expect(maxGap(picked)).toBeLessThan(100);
      expect(Math.min(...picked.map(miles))).toBeLessThan(50);
      expect(Math.max(...picked.map(miles))).toBeGreaterThan(850);
    });

    it("still returns exactly K when there are more than K stations", () => {
      expect(stratifiedTopK(stations, { k: 40 })).toHaveLength(40);
    });
  });

  it("gives every occupied bucket at least one candidate before any gets a second", () => {
    const stations = [
      // bucket 0: many cheap
      at("a1", 5, 1.0), at("a2", 10, 1.1), at("a3", 15, 1.2), at("a4", 20, 1.3),
      // bucket 3: one expensive
      at("d1", 160, 9.0),
      // bucket 7: one mid
      at("h1", 380, 5.0),
    ];

    const picked = stratifiedTopK(stations, { k: 3 });

    expect(picked.map((c) => c.id)).toEqual(["a1", "d1", "h1"]);
  });

  it("is cheapest-first within a bucket", () => {
    // Three occupied buckets of ten; k = 6 gives each two draws.
    const stations = ["x", "y", "z"].flatMap((tag, bucket) =>
      Array.from({ length: 10 }, (_, i) => at(`${tag}${i}`, bucket * 50 + i * 4, 5 - i * 0.1)),
    );

    const picked = stratifiedTopK(stations, { k: 6 });

    // Price falls with i, so the cheapest two per bucket are i = 9 and i = 8.
    expect(picked.map((c) => c.id).sort()).toEqual(["x8", "x9", "y8", "y9", "z8", "z9"]);
  });

  it("in a partial final round, prefers the cheaper next candidate, not the earlier bucket", () => {
    const stations = [
      at("a1", 10, 1.0), at("a2", 20, 5.0), // bucket 0: next after a1 costs 5.00
      at("b1", 60, 2.0), at("b2", 70, 3.0), // bucket 1: next after b1 costs 3.00
    ];

    const picked = stratifiedTopK(stations, { k: 3 });

    expect(picked.map((c) => c.id)).toEqual(["a1", "b1", "b2"]);
  });

  it("returns all of them, in position order, when there are fewer stations than K", () => {
    const stations = [at("c", 300, 4), at("a", 10, 4), at("b", 120, 4)];

    expect(stratifiedTopK(stations, { k: 40 }).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array, not an error, for zero candidates", () => {
    expect(stratifiedTopK([], { k: 40 })).toEqual([]);
  });

  it("returns candidates ordered by position for the optimiser", () => {
    const stations = Array.from({ length: 120 }, (_, i) => at(`s${i}`, ((i * 37) % 120) * 7, 3 + (i % 9) * 0.1));

    const offsets = stratifiedTopK(stations, { k: 40 }).map((c) => c.offsetAlongRouteMiles);

    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it("widens K to the number of occupied buckets rather than reopen a hole on a long route", () => {
    // 2,500 miles = 50 buckets, more than K = 40. Capping at 40 would drop ten
    // buckets — up to 500 contiguous miles — and re-create the very gap this exists to prevent.
    const stations = Array.from({ length: 150 }, (_, i) => at(`s${i}`, (i % 50) * 50 + 10 + Math.floor(i / 50) * 12, 3 + (i % 7) * 0.1));

    const picked = stratifiedTopK(stations, { k: 40 });

    expect(new Set(picked.map(bucketOf)).size).toBe(50);
    expect(picked).toHaveLength(50);
  });

  it("puts a station exactly on a bucket boundary in the upper bucket", () => {
    const stations = [at("edge", 50, 1), at("low", 49.99, 9)];

    const picked = stratifiedTopK(stations, { k: 2 });

    expect(picked.map((c) => c.id)).toEqual(["low", "edge"]);
    expect(bucketOf(picked[0]!)).toBe(0);
    expect(bucketOf(picked[1]!)).toBe(1);
  });

  it("breaks price ties by position, then id, so the choice is repeatable", () => {
    const stations = [at("b", 30, 4), at("a", 30, 4), at("c", 10, 4)];

    const picked = stratifiedTopK(stations, { k: 1 });

    expect(picked.map((c) => c.id)).toEqual(["c"]);
    expect(stratifiedTopK([...stations].reverse(), { k: 1 })).toEqual(picked);
  });

  it("does not mutate its input", () => {
    const stations = [at("b", 200, 4), at("a", 10, 5), at("c", 90, 3)];
    const snapshot = structuredClone(stations);

    stratifiedTopK(stations, { k: 2 });

    expect(stations).toEqual(snapshot);
  });

  it("carries extra fields through untouched", () => {
    const rich = { ...at("a", 10, 4), priceId: "42", lat: 35.1 };

    expect(stratifiedTopK([rich], { k: 40 })).toEqual([rich]);
  });

  it("defaults to K = 40 and 50-mile buckets", () => {
    const stations = Array.from({ length: 300 }, (_, i) => at(`s${i}`, i * 3, 4));

    const picked = stratifiedTopK(stations);

    expect(picked).toHaveLength(40);
    expect(new Set(picked.map(bucketOf)).size).toBe(18);
  });

  it("honours a different bucket width", () => {
    const stations = [at("a", 5, 1), at("b", 15, 2), at("c", 25, 3)];

    const picked = stratifiedTopK(stations, { k: 3, bucketMiles: 10 });

    expect(picked).toHaveLength(3);
    // All three sit in different 10-mile buckets, so even k = 2 widens to 3.
    expect(stratifiedTopK(stations, { k: 2, bucketMiles: 10 })).toHaveLength(3);
    // At the default 50 miles they share one bucket, and k = 2 is honoured.
    expect(stratifiedTopK(stations, { k: 2 })).toHaveLength(2);
  });

  it("rejects a non-positive or non-integer K and a non-positive bucket width", () => {
    expect(() => stratifiedTopK([], { k: 0 })).toThrow(RangeError);
    expect(() => stratifiedTopK([], { k: 2.5 })).toThrow(RangeError);
    expect(() => stratifiedTopK([], { bucketMiles: 0 })).toThrow(RangeError);
    expect(() => stratifiedTopK([], { bucketMiles: Number.NaN })).toThrow(RangeError);
  });
});
