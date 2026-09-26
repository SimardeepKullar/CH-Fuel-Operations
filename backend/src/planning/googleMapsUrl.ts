import type { LatLng } from "../domain/planResponse.js";

/** §9.4: Google's own cap on intermediate waypoints for this link format. */
export const MAX_WAYPOINTS = 9;

/** Thrown rather than silently truncating the link to 9 stops and hiding the rest from the driver. */
export class TooManyWaypointsError extends Error {
  constructor(public readonly count: number) {
    super(`googleMapsUrl supports at most ${MAX_WAYPOINTS} waypoints, got ${count}`);
    this.name = "TooManyWaypointsError";
  }
}

function formatLatLng(point: LatLng): string {
  return `${point.lat},${point.lng}`;
}

/**
 * The dispatcher's deliverable to the driver (§9.4): a Google Maps driving
 * link with each fuel stop as an ordered waypoint. This is a *car* route —
 * stops correct, roads unchecked for truck restrictions — which is exactly
 * what `GOOGLE_LINK_NOT_TRUCK_LEGAL` (disclaimers.ts) exists to flag.
 *
 * `waypoints` must already be in the order the driver visits them (a plan's
 * `stops[]`, by `seq`); this function does not sort.
 *
 * Pure: no I/O, no clock.
 */
export function buildGoogleMapsUrl(origin: LatLng, destination: LatLng, waypoints: readonly LatLng[]): string {
  if (waypoints.length > MAX_WAYPOINTS) {
    throw new TooManyWaypointsError(waypoints.length);
  }

  const params = new URLSearchParams();
  params.set("api", "1");
  params.set("origin", formatLatLng(origin));
  params.set("destination", formatLatLng(destination));
  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.map(formatLatLng).join("|"));
  }
  params.set("travelmode", "driving");

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
