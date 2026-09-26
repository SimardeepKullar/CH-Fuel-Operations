import type { Pool } from "pg";
import { z } from "zod";
import { listExpressCharges } from "../../actuals/otherCharges.js";
import { problemResponse } from "../problem.js";

const querySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "period must be a YYYY-MM-DD date"),
});

/** `GET /express-charges?period=` — A8.6's Other Charges list. */
export async function handleListExpressCharges(pool: Pool, url: URL): Promise<Response> {
  const parsed = querySchema.safeParse({ period: url.searchParams.get("period") });
  if (!parsed.success) {
    return problemResponse({
      title: "Bad Request",
      status: 400,
      detail: parsed.error.message,
      instance: url.pathname,
    });
  }

  const result = await listExpressCharges(pool, parsed.data.period);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
