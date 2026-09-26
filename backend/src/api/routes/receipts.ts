import type { Pool } from "pg";
import { z } from "zod";
import {
  DEFAULT_QUEUE_ORDER,
  confirmReceiptsForDriver,
  listReceiptQueue,
  recordReceiptCheck,
} from "../../actuals/receipts.js";
import { problemResponse } from "../problem.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** `GET /receipt-queue` — A8.5's work queue, ordered `DEFAULT_QUEUE_ORDER`
 * (D17: the caller never sees a strategy name, only the resulting order —
 * swapping to `EXCEPTIONS_FIRST_QUEUE_ORDER` is a code change here, not a
 * migration). */
export async function handleGetReceiptQueue(pool: Pool, _url: URL): Promise<Response> {
  const result = await listReceiptQueue(pool, DEFAULT_QUEUE_ORDER);
  return jsonResponse(result);
}

const singleCheckSchema = z.object({
  fuelStopId: z.string().uuid(),
  outcome: z.enum(["confirmed", "missing"]),
});

const batchConfirmSchema = z.object({
  driverId: z.string().uuid(),
  outcome: z.literal("confirmed"),
});

/**
 * `POST /receipt-checks` — A8.5's single decision and batch-confirm-for-a-
 * driver, told apart by which key the body carries (`fuelStopId` vs
 * `driverId`). Skip is not a third shape here: the schema only accepts
 * `outcome: "confirmed" | "missing"`, so anything else (including "skip")
 * 400s before touching the database — skip never writes a row because it
 * never reaches this function at all; the frontend queue just advances past
 * the item without calling this endpoint.
 */
export async function handlePostReceiptChecks(pool: Pool, request: Request, url: URL, checkedBy: string): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problemResponse({
      title: "Bad Request",
      status: 400,
      detail: "expected a JSON body",
      instance: url.pathname,
    });
  }

  if (typeof body !== "object" || body === null) {
    return problemResponse({
      title: "Bad Request",
      status: 400,
      detail: 'expected an object with "fuelStopId" or "driverId"',
      instance: url.pathname,
    });
  }

  if ("fuelStopId" in body) {
    const parsed = singleCheckSchema.safeParse(body);
    if (!parsed.success) {
      return problemResponse({
        title: "Bad Request",
        status: 400,
        detail: parsed.error.message,
        instance: url.pathname,
      });
    }
    const result = await recordReceiptCheck(pool, { ...parsed.data, checkedBy });
    if (result === null) {
      return problemResponse({
        title: "Not Found",
        status: 404,
        detail: `No fuel stop with id ${parsed.data.fuelStopId}`,
        instance: url.pathname,
      });
    }
    return jsonResponse({ status: "recorded", ...result }, 201);
  }

  if ("driverId" in body) {
    const parsed = batchConfirmSchema.safeParse(body);
    if (!parsed.success) {
      return problemResponse({
        title: "Bad Request",
        status: 400,
        detail: parsed.error.message,
        instance: url.pathname,
      });
    }
    const result = await confirmReceiptsForDriver(pool, { driverId: parsed.data.driverId, checkedBy });
    return jsonResponse({ status: "confirmed", ...result });
  }

  return problemResponse({
    title: "Bad Request",
    status: 400,
    detail: 'expected an object with "fuelStopId" or "driverId"',
    instance: url.pathname,
  });
}
