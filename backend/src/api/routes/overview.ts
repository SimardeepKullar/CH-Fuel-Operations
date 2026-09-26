import type { Pool } from "pg";
import { z } from "zod";
import { getOverview } from "../../actuals/overview.js";
import { problemResponse } from "../problem.js";

const querySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "period must be a YYYY-MM-DD date"),
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** `GET /overview?period=` — A8.1's whole landing screen in one call. */
export async function handleGetOverview(pool: Pool, url: URL): Promise<Response> {
  const parsed = querySchema.safeParse({ period: url.searchParams.get("period") });
  if (!parsed.success) {
    return problemResponse({
      title: "Bad Request",
      status: 400,
      detail: parsed.error.message,
      instance: url.pathname,
    });
  }

  const result = await getOverview(pool, parsed.data.period);
  return jsonResponse(result);
}
