import { createHash } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CorridorError } from "../../src/planning/corridor.js";
import { BRACKET_POINTS_SQL, buildDetourSubjects, pointsAlongRoute } from "../../src/planning/bracketPoints.js";
import { scopedSchema, teardown } from "./support/actualsFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

/** A due-north route down the -97° meridian, 30°N → 40°N, reported by the "provider" as 750 mi: a
 * meridian is its own geodesic, so the point at fraction f is at latitude 30 + 10 f exactly. */
const ROUTE_LNG = -97;
const ROUTE_MILES = 750;
const MILES_PER_DEGREE = ROUTE_MILES / 10;

const latAtMile = (mile: number): number => 30 + mile / MILES_PER_DEGREE;

describe.skipIf(!hasDatabase)("bracket points (integration, T-14)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let routeId: string;

  async function insertRoute(line: string | null, hashSeed: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO routes (provider, request_hash, origin_geom, destination_geom, truck_id,
                           line, distance_miles, duration_s)
       SELECT 'ors', $1,
              ST_GeogFromText('POINT(${ROUTE_LNG} 30)'), ST_GeogFromText('POINT(${ROUTE_LNG} 40)'),
              (SELECT id FROM trucks LIMIT 1),
              CASE WHEN $3::text IS NULL THEN NULL ELSE ST_GeogFromText($3::text) END, $2, 40000
       RETURNING id`,
      [createHash("sha256").update(hashSeed).digest("hex"), ROUTE_MILES, line],
    );
    return rows[0]!.id;
  }

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_bracket"));
    routeId = await insertRoute(`LINESTRING(${ROUTE_LNG} 30, ${ROUTE_LNG} 40)`, "bracket-route");
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  describe("pointsAlongRoute", () => {
    it("returns the point at each fraction of the route, in the order asked", async () => {
      const points = await pointsAlongRoute(pool, routeId, [0.5, 0, 1, 0.25]);

      expect(points).toHaveLength(4);
      expect(points.map((p) => p.lat)).toEqual([
        expect.closeTo(35, 6),
        expect.closeTo(30, 6),
        expect.closeTo(40, 6),
        expect.closeTo(32.5, 6),
      ]);
      for (const p of points) expect(p.lng).toBeCloseTo(ROUTE_LNG, 6);
    });

    it("asks for nothing without a query", async () => {
      expect(await pointsAlongRoute(pool, routeId, [])).toEqual([]);
    });

    it("converts no units: it takes fractions, so there is no metre in the statement", () => {
      expect(BRACKET_POINTS_SQL).not.toMatch(/1609/);
      expect(BRACKET_POINTS_SQL).toMatch(/ST_LineInterpolatePoint/);
    });

    it("names a missing route and a route with no geometry, rather than returning nothing", async () => {
      await expect(pointsAlongRoute(pool, "00000000-0000-0000-0000-000000000000", [0.5])).rejects.toMatchObject({
        name: "CorridorError",
        code: "ROUTE_NOT_FOUND",
      });
      const bare = await insertRoute(null, "bracket-no-line");
      await expect(pointsAlongRoute(pool, bare, [0.5])).rejects.toBeInstanceOf(CorridorError);
      await expect(pointsAlongRoute(pool, bare, [0.5])).rejects.toMatchObject({ code: "ROUTE_GEOMETRY_MISSING" });
    });

    it("rejects a fraction outside the route", async () => {
      await expect(pointsAlongRoute(pool, routeId, [1.2])).rejects.toThrow(RangeError);
      await expect(pointsAlongRoute(pool, routeId, [-0.1])).rejects.toThrow(RangeError);
      await expect(pointsAlongRoute(pool, routeId, [Number.NaN])).rejects.toThrow(RangeError);
    });
  });

  describe("buildDetourSubjects", () => {
    const candidate = (id: string, offset: number, perp = 0.25) => ({
      id,
      lat: latAtMile(offset),
      lng: ROUTE_LNG + 0.005,
      offsetAlongRouteMiles: offset,
      perpOffsetMiles: perp,
    });

    it("brackets a mid-route station ten miles either side, with the arc between", async () => {
      const [subject] = await buildDetourSubjects(pool, { routeId, routeDistanceMiles: ROUTE_MILES }, [candidate("mid", 375)]);

      expect(subject!.id).toBe("mid");
      expect(subject!.arcMiles).toBe(20);
      expect(subject!.before.lat).toBeCloseTo(latAtMile(365), 6);
      expect(subject!.after.lat).toBeCloseTo(latAtMile(385), 6);
      expect(subject!.before.lng).toBeCloseTo(ROUTE_LNG, 6);
      expect(subject!.location).toEqual({ lat: latAtMile(375), lng: ROUTE_LNG + 0.005 });
      expect(subject!.perpOffsetMiles).toBe(0.25);
    });

    it("clamps to the origin and the destination at the route's ends", async () => {
      const subjects = await buildDetourSubjects(pool, { routeId, routeDistanceMiles: ROUTE_MILES }, [
        candidate("start", 3),
        candidate("end", 748),
      ]);
      const [start, end] = subjects;

      expect(start!.before.lat).toBeCloseTo(30, 6);
      expect(start!.arcMiles).toBe(13);
      expect(end!.after.lat).toBeCloseTo(40, 6);
      expect(end!.arcMiles).toBe(12);
    });

    it("keeps candidate order across one query for all the points", async () => {
      const subjects = await buildDetourSubjects(pool, { routeId, routeDistanceMiles: ROUTE_MILES }, [
        candidate("c", 600),
        candidate("a", 100),
        candidate("b", 300),
      ]);
      expect(subjects.map((s) => s.id)).toEqual(["c", "a", "b"]);
      expect(subjects.map((s) => s.before.lat)).toEqual([
        expect.closeTo(latAtMile(590), 6),
        expect.closeTo(latAtMile(90), 6),
        expect.closeTo(latAtMile(290), 6),
      ]);
    });

    it("builds nothing for no candidates", async () => {
      expect(await buildDetourSubjects(pool, { routeId, routeDistanceMiles: ROUTE_MILES }, [])).toEqual([]);
    });
  });
});
