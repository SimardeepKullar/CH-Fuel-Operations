import type { Pool } from "pg";
import { z } from "zod";
import {
  getTransactionById,
  listTransactions,
  type ListTransactionsOptions,
  type TransactionSort,
  type TransactionSortField,
} from "../../actuals/transactions.js";
import type { TransactionFilters } from "../../actuals/transactionQuery.js";
import { problemResponse } from "../problem.js";
import { currencySchema, isoDateSchema, parseUnits, unitsSchema } from "../query.js";

const SORT_FIELDS = ["occurred_at", "total"] as const satisfies readonly TransactionSortField[];
const RECEIPT_STATUSES = ["pending", "confirmed", "missing"] as const;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortField: z.enum(SORT_FIELDS).default("occurred_at"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  includeLines: z.boolean().default(false),
  anomalyOnly: z.boolean().default(false),
  /** Optional here, unlike every other period-scoped route: a driver's or a
   * truck's transaction history (A13) spans weeks. Malformed is still a 400. */
  week: isoDateSchema.optional(),
  currency: currencySchema.optional(),
  units: unitsSchema.optional(),
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
    "week",
    "currency",
    "units",
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
    week: query.week,
    currency: query.currency,
    driverId: query.driverId,
    truckId: query.truckId,
    cardId: query.cardId,
    state: query.state,
    product: query.product,
    receiptStatus: query.receiptStatus,
    anomalyOnly: query.anomalyOnly,
  };
  const sort: TransactionSort = { field: query.sortField, direction: query.sortDirection };
  const options: ListTransactionsOptions = { includeLines: query.includeLines, units: query.units ?? null };

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
  const units = parseUnits(url);
  if (units instanceof Response) {
    return units;
  }
  const detail = await getTransactionById(pool, id, units);
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
