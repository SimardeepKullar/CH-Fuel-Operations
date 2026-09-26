import type { Pool } from "pg";
import { z } from "zod";
import { getStationBilledPrices } from "../../actuals/stations.js";
import { getStationPriceHistory, listStations, type StationMapResolution } from "../../catalog/stations.js";
import { problemResponse } from "../problem.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** `GET /stations/{id}/billed-prices` — A8.9's price history and A6.5's audit
 * hook. `id` is `stations.id`; an id that names no station (or isn't a uuid) is a 404. */
export async function handleGetStationBilledPrices(pool: Pool, id: string, url: URL): Promise<Response> {
  const result = await getStationBilledPrices(pool, id);
  if (!result) {
    return problemResponse({
      title: "Not Found",
      status: 404,
      detail: `No station with id ${id}`,
      instance: url.pathname,
    });
  }
  return jsonResponse(result);
}

const RESOLUTION_VALUES = ["exact", "city"] as const satisfies readonly StationMapResolution[];

const bboxSchema = z
  .string()
  .transform((raw, ctx) => {
    const parts = raw.split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      ctx.addIssue({ code: "custom", message: "bbox must be \"west,south,east,north\", four finite numbers" });
      return z.NEVER;
    }
    const [west, south, east, north] = parts as [number, number, number, number];
    return { west, south, east, north };
  });

const listStationsQuerySchema = z.object({
  bbox: bboxSchema,
  resolution: z.enum(RESOLUTION_VALUES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

/** `GET /stations?bbox=&resolution=` — the map's sheet layer (T-18 step 18.2). */
export async function handleListStations(pool: Pool, url: URL): Promise<Response> {
  const raw: Record<string, unknown> = {};
  for (const key of ["bbox", "resolution", "page", "pageSize"]) {
    const value = url.searchParams.get(key);
    if (value !== null) {
      raw[key] = value;
    }
  }
  const parsed = listStationsQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return problemResponse({ title: "Bad Request", status: 400, detail: parsed.error.message, instance: url.pathname });
  }

  const { bbox, resolution, page, pageSize } = parsed.data;
  const result = await listStations(pool, { bbox, resolution, page, pageSize });
  return jsonResponse(result);
}

/** `GET /stations/{id}/prices` — BVD's published sheet-price history for one
 * station (T-18 step 18.2), distinct from `/billed-prices` above. */
export async function handleGetStationPrices(pool: Pool, id: string, url: URL): Promise<Response> {
  if (!z.string().uuid().safeParse(id).success) {
    return problemResponse({ title: "Not Found", status: 404, detail: `No station with id ${id}`, instance: url.pathname });
  }

  const result = await getStationPriceHistory(pool, id);
  if (!result) {
    return problemResponse({
      title: "Not Found",
      status: 404,
      detail: `No station with id ${id}`,
      instance: url.pathname,
    });
  }
  return jsonResponse(result);
}
