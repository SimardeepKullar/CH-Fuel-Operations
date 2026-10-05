/**
 * One typed client over `/api/v1` (T-21 step 21.1). Every hook in
 * `frontend/src/hooks/` calls through here rather than `fetch` directly, so
 * there is exactly one place that knows the API's base path and how it
 * reports an error.
 *
 * Typed against `backend/src/domain/` (and the sibling response shapes each
 * route module exports) — the same compile-time guarantee across the
 * frontend/backend boundary that §7 gives as the reason for one repository.
 */
import type { ProblemDetails } from "@ch/core/api/problem";
import type { TruckRosterResult } from "@ch/core/actuals/trucks";
import type { CreatePlanRequest, PlanResponse } from "@ch/core/domain/planResponse";
import type { PriceSheetSummary } from "@ch/core/catalog/priceSheets";
import type { BoundingBox, StationMapResolution, StationsPage } from "@ch/core/catalog/stations";
import type { PlanListResult } from "@ch/core/planning/planPersistence";
import type { HealthStatus } from "@ch/core/catalog/health";
import type { ImportInvoiceResponse, InvoiceDetail, InvoiceListItem, InvoiceListResult } from "@ch/core/api/routes/invoices";
import type { PeriodWeek } from "@ch/core/api/routes/periods";
import type { ReceiptQueueResult } from "@ch/core/actuals/receipts";
import type { DriversResult } from "@ch/core/actuals/drivers";
import type { ListTransactionsResult, TransactionSortField } from "@ch/core/actuals/transactions";
import type { OverviewResult } from "@ch/core/actuals/overview";

const BASE_URL = "/api/v1";

/**
 * Every error path — an RFC 9457 `problem+json` body, a non-JSON body, a
 * network failure — surfaces as this one type so a caller can branch on
 * `status` (e.g. a 401 vs. a 500) without knowing which case it was.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail?: string;

  constructor(problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
    this.status = problem.status;
    this.title = problem.title;
    this.detail = problem.detail;
  }
}

async function throwIfNotOk(response: Response): Promise<void> {
  if (response.ok) return;
  let problem: ProblemDetails;
  try {
    problem = (await response.json()) as ProblemDetails;
  } catch {
    problem = { title: response.statusText || "Request failed", status: response.status };
  }
  throw new ApiError(problem);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  await throwIfNotOk(response);
  return (await response.json()) as T;
}

/**
 * `POST /invoices/import` (T-42) — the one multipart caller in this file.
 * Deliberately bypasses `request()`: that helper sets `content-type:
 * application/json` unconditionally, which would ship a boundary-less
 * multipart body the server can't parse. The browser sets the correct
 * `multipart/form-data; boundary=...` header itself as long as nothing here
 * sets `Content-Type` at all.
 */
export function uploadInvoice(file: File): Promise<ImportInvoiceResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return fetch(`${BASE_URL}/invoices/import`, { method: "POST", body: formData }).then(async (response) => {
    await throwIfNotOk(response);
    return (await response.json()) as ImportInvoiceResponse;
  });
}

/** `GET /invoices/{id}` — reopens a history entry (T-42), including a
 * quarantined one's rejections, without re-uploading the file. */
export function getInvoice(id: string): Promise<InvoiceDetail> {
  return request<InvoiceDetail>(`/invoices/${encodeURIComponent(id)}`);
}

export function createPlan(body: CreatePlanRequest): Promise<PlanResponse> {
  return request<PlanResponse>("/plans", { method: "POST", body: JSON.stringify(body) });
}

export function getPlan(planId: string): Promise<PlanResponse> {
  return request<PlanResponse>(`/plans/${planId}`);
}

export function listPlans(params: { page?: number; pageSize?: number } = {}): Promise<PlanListResult> {
  const search = new URLSearchParams();
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
  const qs = search.toString();
  return request<PlanListResult>(`/plans${qs ? `?${qs}` : ""}`);
}

export function patchPlan(planId: string, body: { sentToDriver: boolean }): Promise<{
  planId: string;
  sentToDriver: boolean;
  sentToDriverAt: string | null;
}> {
  return request(`/plans/${planId}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function listPriceSheets(): Promise<PriceSheetSummary[]> {
  return request<PriceSheetSummary[]>("/price-sheets");
}

/**
 * `GET /stations?bbox=` (T-18 step 18.2) — the map's "all sheet stations"
 * layer (UI contract §3.8). `bbox` is required by the route, unlike every
 * other param here.
 */
export function listStations(
  options: BoundingBox & { resolution?: StationMapResolution; page?: number; pageSize?: number },
): Promise<StationsPage> {
  const { west, south, east, north, resolution, page, pageSize } = options;
  const search = new URLSearchParams({ bbox: `${west},${south},${east},${north}` });
  if (resolution !== undefined) search.set("resolution", resolution);
  if (page !== undefined) search.set("page", String(page));
  if (pageSize !== undefined) search.set("pageSize", String(pageSize));
  return request<StationsPage>(`/stations?${search.toString()}`);
}

/** `GET /trucks` with no `period` (D23) — the unscoped roster picker. */
export function listTrucks(): Promise<TruckRosterResult> {
  return request<TruckRosterResult>("/trucks");
}

/** `GET /health` — T-39's source for the shell's default invoice period
 * (`latestInvoicePeriod`, immune to backfill import order, A16) and the
 * standing "Flags" count (`openAnomalyCount`). */
export function getHealth(): Promise<HealthStatus> {
  return request<HealthStatus>("/health");
}

/** `GET /periods` (T-63, D26) — billing weeks, newest first, each with the
 * imported invoices behind it. The shell's week picker reads this; `GET
 * /invoices` stays the Import screen's history list. */
export function listPeriods(): Promise<{ weeks: PeriodWeek[] }> {
  return request<{ weeks: PeriodWeek[] }>("/periods");
}

/** `GET /invoices` — A8.2's history list (newest-first by `importedAt`). */
export function listInvoices(params: { page?: number; pageSize?: number } = {}): Promise<InvoiceListResult> {
  const search = new URLSearchParams();
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
  const qs = search.toString();
  return request<InvoiceListResult>(`/invoices${qs ? `?${qs}` : ""}`);
}

/** `PATCH /invoices/{id}` (T-63, D26) — moves an invoice to another billing week, the Import
 * screen's override. Moving onto a week another imported invoice of the same currency holds is
 * a 409 whose `detail` names that invoice; `ApiError` carries it. */
export function patchInvoiceWeek(id: string, billingWeekEnd: string): Promise<InvoiceListItem> {
  return request<InvoiceListItem>(`/invoices/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ billingWeekEnd }),
  });
}

/** `GET /receipt-queue` — T-39's source for the sidebar's pending badge and
 * the top bar's standing "Receipts" count (both global, D17). */
export function getReceiptQueue(): Promise<ReceiptQueueResult> {
  return request<ReceiptQueueResult>("/receipt-queue");
}

export interface ListTransactionsParams {
  /** A billing week's end, `YYYY-MM-DD` (D26). */
  week?: string;
  /** One side of the week; the server serves both when omitted, so a screen reading one side says which. */
  currency?: "USD" | "CAD";
  /** Converts quantities and per-unit prices (never money, D25); absent means as BVD printed them. */
  units?: "imperial" | "metric";
  page?: number;
  pageSize?: number;
  sortField?: TransactionSortField;
  sortDirection?: "asc" | "desc";
  includeLines?: boolean;
  anomalyOnly?: boolean;
  driverId?: string;
  truckId?: string;
  cardId?: string;
  state?: string;
  product?: string;
  receiptStatus?: "pending" | "confirmed" | "missing";
}

/** `GET /transactions` — A8.3's list (T-40). `?week=` is how the shell's
 * week selector (A7) scopes this screen — resolved to
 * `fuel_stops.invoice_id` on the server, the same join every sibling
 * actuals query already scopes by, rather than a client-reconstructed
 * `dateFrom`/`dateTo` pair. */
export function listTransactions(params: ListTransactionsParams = {}): Promise<ListTransactionsResult> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return request<ListTransactionsResult>(`/transactions${qs ? `?${qs}` : ""}`);
}

/** `GET /drivers?week=` — A8.7's list, reused here (T-40) as the driver
 * filter dropdown's option source: every driver on the roster, not just
 * those with stops this period, per its own doc comment. No dedicated
 * unscoped driver-roster endpoint exists (the truck equivalent is
 * `listTrucks`), so this is the reuse the endpoint was already built for
 * rather than a second one. */
export function listDrivers(week: string, currency: "USD" | "CAD"): Promise<DriversResult> {
  return request<DriversResult>(`/drivers?week=${encodeURIComponent(week)}&currency=${currency}`);
}

/** `GET /overview?week=` — A8.1's whole landing screen in one call (T-41). */
export function getOverview(week: string): Promise<OverviewResult> {
  return request<OverviewResult>(`/overview?week=${encodeURIComponent(week)}`);
}
