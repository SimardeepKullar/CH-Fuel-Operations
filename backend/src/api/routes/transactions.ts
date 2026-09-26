import type { Pool } from "pg";
import { z } from "zod";
import {
  getTransactionById,
  listTransactions,
  resolveInvoiceIdForPeriod,
  type ListTransactionsOptions,
  type TransactionSort,
  type TransactionSortField,
} from "../../actuals/transactions.js";
import type { TransactionFilters } from "../../actuals/transactionQuery.js";
import { problemResponse } from "../problem.js";

const SORT_FIELDS = ["occurred_at", "total_usd"] as const satisfies readonly TransactionSortField[];
const RECEIPT_STATUSES = ["pending", "confirmed", "missing"] as const;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortField: z.enum(SORT_FIELDS).default("occurred_at"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  includeLines: z.boolean().default(false),
  anomalyOnly: z.boolean().default(false),
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "period must be a YYYY-MM-DD date").optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  driverId: z.string().optional(),
  truckId: z.string().optional(),
  cardId: z.string().optional(),
  state: z.string().optional(),
  product: z.string().optional(),
  receiptStatus: z.enum(RECEIPT_STATUSES).optional(),
});

/**
 * `URLSearchParams` gives every value back as a string, so `true`/`false`
 * flags need an explicit comparison rather than zod's `z.coerce.boolean()`
 * — that coerces via `Boolean(value)`, which is `true` for the string
 * `"false"` too.
 */
function parseQueryParams(searchParams: URLSearchParams): z.infer<typeof querySchema> {
  const raw: Record<string, unknown> = {};
  for (const key of [
    "page",
    "pageSize",
    "sortField",
    "sortDirection",
    "period",
    "dateFrom",
    "dateTo",
    "driverId",
    "truckId",
    "cardId",
    "state",
    "product",
    "receiptStatus",
  ]) {
    const value = searchParams.get(key);
    if (value !== null) {
      raw[key] = value;
    }
  }
  const includeLines = searchParams.get("includeLines");
  if (includeLines !== null) {
    raw.includeLines = includeLines === "true";
  }
  const anomalyOnly = searchParams.get("anomalyOnly");
  if (anomalyOnly !== null) {
    raw.anomalyOnly = anomalyOnly === "true";
  }
  return querySchema.parse(raw);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** `GET /transactions` — A8.3, filterable/sortable/paginated (A13). */
export async function handleListTransactions(pool: Pool, url: URL): Promise<Response> {
  let query: z.infer<typeof querySchema>;
  try {
    query = parseQueryParams(url.searchParams);
  } catch (err) {
    return problemResponse({
      title: "Bad Request",
      status: 400,
      detail: err instanceof z.ZodError ? err.message : "invalid query parameters",
      instance: url.pathname,
    });
  }

  const filters: TransactionFilters = {
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    invoiceId: query.period === undefined ? undefined : await resolveInvoiceIdForPeriod(pool, query.period),
    driverId: query.driverId,
    truckId: query.truckId,
    cardId: query.cardId,
    state: query.state,
    product: query.product,
    receiptStatus: query.receiptStatus,
    anomalyOnly: query.anomalyOnly,
  };
  const sort: TransactionSort = { field: query.sortField, direction: query.sortDirection };
  const options: ListTransactionsOptions = { includeLines: query.includeLines };

  const result = await listTransactions(
    pool,
    filters,
    sort,
    { page: query.page, pageSize: query.pageSize },
    options,
  );
  return jsonResponse(result);
}

/** `GET /transactions/{id}` — A8.4's full record. */
export async function handleGetTransaction(pool: Pool, id: string, url: URL): Promise<Response> {
  const detail = await getTransactionById(pool, id);
  if (!detail) {
    return problemResponse({
      title: "Not Found",
      status: 404,
      detail: `No transaction with id ${id}`,
      instance: url.pathname,
    });
  }
  return jsonResponse(detail);
}
