import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { LatLng } from "../domain/planResponse.js";
import type { RouteResult, TruckSpec } from "../routing/provider.js";

export interface RouteRequestIdentity {
  provider: string;
  origin: LatLng;
  destination: LatLng;
  /** In route order. Empty for the baseline (direct) route. */
  via: readonly LatLng[];
  truckSpec: TruckSpec;
}

/**
 * `routes.request_hash`: the full identity of one routing request — provider,
 * both endpoints, every via point in order, and the truck spec that shapes
 * the route. This is the `UNIQUE (provider, request_hash)` cache/upsert key
 * (§17), and is deliberately our own hash, not `OrsRoutingProvider`'s
 * internal one (§8.3's metering key, over the provider's wire body) — that
 * one exists to meter a specific HTTP call; this one exists to recognise
 * "the same routing request" regardless of provider wire format.
 */
export function computeRouteRequestHash(identity: RouteRequestIdentity): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: identity.provider,
        origin: identity.origin,
        destination: identity.destination,
        via: identity.via,
        truckSpec: identity.truckSpec,
      }),
    )
    .digest("hex");
}

/** `routes.via_hash`: just the via sequence, so a route can be found by stop sequence alone. `null` for a via-less (baseline) route. */
export function computeViaHash(via: readonly LatLng[]): string | null {
  if (via.length === 0) {
    return null;
  }
  return createHash("sha256").update(JSON.stringify(via)).digest("hex");
}

export interface UpsertRouteInput extends RouteRequestIdentity {
  truckId: string;
  route: RouteResult;
}

/**
 * §17: "A route is refreshed through its `UNIQUE (provider, request_hash)`
 * upsert, which updates `computed_at` rather than inserting a duplicate."
 * The upsert refreshes the cached geometry too — a re-fetch reflects today's
 * road network, and it is the *plan's* stored totals, not this cache row,
 * that stay authoritative (§17: "a refreshed line still writes to `routes`
 * only — never to `plans` or `plan_stops`", which this function's caller,
 * not this function, is responsible for honouring).
 *
 * `routes.line`/`polyline` are decoded from the provider's own
 * precision-5 encoded polyline (ORS's `driving-hgv` default); nothing here
 * touches meters — the ORS adapter already converted the provider's metres
 * to miles on the way in (CLAUDE.md's three-edges rule).
 */
export async function upsertRoute(pool: Pool, input: UpsertRouteInput): Promise<string> {
  const requestHash = computeRouteRequestHash(input);
  const viaHash = computeViaHash(input.via);

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO routes (provider, request_hash, origin_geom, destination_geom, truck_id, via_hash,
                          line, polyline, legs, distance_miles, duration_s)
     VALUES (
       $1, $2,
       ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
       ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
       $7, $8,
       ST_LineFromEncodedPolyline($9, 5)::geography, $9, $10::jsonb, $11, $12
     )
     ON CONFLICT (provider, request_hash) DO UPDATE SET
       line = EXCLUDED.line,
       polyline = EXCLUDED.polyline,
       legs = EXCLUDED.legs,
       distance_miles = EXCLUDED.distance_miles,
       duration_s = EXCLUDED.duration_s,
       computed_at = now()
     RETURNING id`,
    [
      input.provider,
      requestHash,
      input.origin.lng,
      input.origin.lat,
      input.destination.lng,
      input.destination.lat,
      input.truckId,
      viaHash,
      input.route.polyline,
      JSON.stringify(input.route.legs),
      input.route.distanceMiles,
      Math.round(input.route.durationSeconds),
    ],
  );
  return rows[0]!.id;
}
