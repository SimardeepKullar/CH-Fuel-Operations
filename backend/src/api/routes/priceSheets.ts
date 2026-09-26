import type { Pool } from "pg";
import { listPriceSheets } from "../../catalog/priceSheets.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** `GET /price-sheets` — the sheet picker's data source (T-18 step 18.1). */
export async function handleListPriceSheets(pool: Pool): Promise<Response> {
  return jsonResponse(await listPriceSheets(pool));
}
