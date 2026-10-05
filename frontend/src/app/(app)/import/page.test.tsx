// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportInvoiceResponse, InvoiceDetail, InvoiceListItem } from "@ch/core/api/routes/invoices";
import type { PeriodWeek } from "@ch/core/api/routes/periods";
import type { ImportReport } from "@ch/core/invoice/report";

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/import",
  useSearchParams: () => searchParams,
}));

const uploadInvoice = vi.fn();
const listInvoices = vi.fn();
const getInvoice = vi.fn();
const patchInvoiceWeek = vi.fn();
const getHealth = vi.fn();
const listPeriods = vi.fn();

vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ...actual,
    uploadInvoice: (...args: unknown[]) => uploadInvoice(...args),
    listInvoices: (...args: unknown[]) => listInvoices(...args),
    getInvoice: (...args: unknown[]) => getInvoice(...args),
    patchInvoiceWeek: (...args: unknown[]) => patchInvoiceWeek(...args),
    getHealth: (...args: unknown[]) => getHealth(...args),
    listPeriods: (...args: unknown[]) => listPeriods(...args),
  };
});

const { ApiError } = await import("../../../lib/api");
const { default: ImportPageInner } = await import("./page");
const { WeekProvider } = await import("../../../hooks/useWeek");
const { default: WeekSelector } = await import("../../../components/WeekSelector");

function ImportPage() {
  return (
    <WeekProvider>
      <WeekSelector />
      <ImportPageInner />
    </WeekProvider>
  );
}

function report(overrides: Partial<ImportReport> = {}): ImportReport {
  return {
    invoiceNumber: "999210",
    fileSha256: "abc123",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    billingWeekEnd: "2026-08-31",
    actualStart: null,
    actualEnd: null,
    currency: "USD",
    qtyUnit: "gal",
    grandTotal: "50929.71",
    productTotals: [
      { productCode: "TA", qty: "9000.00", amount: "47000.00", discount: "500.00" },
      { productCode: "DF", qty: "120.00", amount: "500.00", discount: "10.00" },
      { productCode: "S", qty: null, amount: "1786.58", discount: null },
      { productCode: "Express Codes", qty: null, amount: "1643.13", discount: null },
    ],
    reconcile: {
      balanced: true,
      amountImbalances: [],
      gallonImbalances: [],
      grandTotal: { expectedCents: 5092971, parsedCents: 5092971, deltaCents: 0 },
      lineImbalances: [],
      totalsImbalances: [],
    },
    parserRejectionCount: 0,
    unknownCardNumbers: [],
    unknownTruckUnits: [],
    rejections: [],
    stationMisses: [],
    truckAssignmentMisses: [],
    expressBlankUnits: [],
    ...overrides,
  };
}

function historyRow(overrides: Partial<InvoiceListItem> = {}): InvoiceListItem {
  return {
    id: "inv-1",
    invoiceNumber: "100003",
    periodStart: "2026-01-05",
    periodEnd: "2026-01-07",
    currency: "USD",
    grandTotal: 100,
    billingWeekEnd: "2026-01-07",
    actualStart: null,
    actualEnd: null,
    datesDiffer: false,
    status: "quarantined",
    importedAt: "2026-01-08T00:00:00.000Z",
    ...overrides,
  };
}

function historyResult(rows: InvoiceListItem[] = []) {
  return { rows, page: 1, pageSize: 50, total: rows.length };
}

function makeFile(name: string, content = "a,b\n1,2\n3,4\n"): File {
  return new File([content], name);
}

afterEach(() => {
  cleanup();
  uploadInvoice.mockReset();
  listInvoices.mockReset();
  getInvoice.mockReset();
  patchInvoiceWeek.mockReset();
  getHealth.mockReset();
  listPeriods.mockReset();
  searchParams = new URLSearchParams();
});

beforeEach(() => {
  getHealth.mockResolvedValue({ latestInvoicePeriod: null, openAnomalyCount: 0 });
  listPeriods.mockResolvedValue({ weeks: [] });
});

describe("ImportPage (T-42)", () => {
  it("parsing shows the file name and a row count read client-side while the upload is in flight", async () => {
    listInvoices.mockResolvedValue(historyResult());
    let resolveUpload!: (value: ImportInvoiceResponse) => void;
    uploadInvoice.mockReturnValue(new Promise<ImportInvoiceResponse>((resolve) => (resolveUpload = resolve)));

    render(<ImportPage />);
    await waitFor(() => expect(screen.getByTestId("dropzone")).toBeTruthy());

    fireEvent.drop(screen.getByTestId("dropzone"), {
      dataTransfer: { files: [makeFile("invoice_100001.csv", "a,b\n1,2\n3,4\n")] },
    });

    await waitFor(() => expect(screen.getByTestId("parsing-state")).toBeTruthy());
    expect(screen.getByTestId("parsing-state").textContent).toContain("invoice_100001.csv");
    await waitFor(() => expect(screen.getByTestId("parsing-state").textContent).toContain("3 rows"));

    resolveUpload({ status: "imported", invoiceId: "inv-1", report: report() });
    await waitFor(() => expect(screen.getByTestId("reconciliation-preview")).toBeTruthy());
  });

  it("a non-CSV/PDF drop never calls uploadInvoice", async () => {
    listInvoices.mockResolvedValue(historyResult());
    render(<ImportPage />);
    await waitFor(() => expect(screen.getByTestId("dropzone")).toBeTruthy());

    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [makeFile("notes.txt")] } });

    expect(uploadInvoice).not.toHaveBeenCalled();
    expect(screen.getByTestId("dropzone-rejection")).toBeTruthy();
  });

  it("an imported upload shows the reconciliation-passed preview, and confirm returns to the dropzone", async () => {
    listInvoices.mockResolvedValue(historyResult());
    uploadInvoice.mockResolvedValue({ status: "imported", invoiceId: "inv-1", report: report() });

    render(<ImportPage />);
    await waitFor(() => expect(screen.getByTestId("dropzone")).toBeTruthy());
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [makeFile("invoice_999210.csv")] } });

    await waitFor(() => expect(screen.getByTestId("reconciliation-preview")).toBeTruthy());
    expect(screen.getByTestId("import-balance-total").textContent).toContain("50929.71");

    fireEvent.click(screen.getByTestId("confirm-button"));
    await waitFor(() => expect(screen.getByTestId("dropzone")).toBeTruthy());
  });

  it("a quarantined upload renders the full-screen QuarantineScreen, not a toast", async () => {
    listInvoices.mockResolvedValue(historyResult());
    uploadInvoice.mockResolvedValue({
      status: "quarantined",
      invoiceId: "inv-2",
      report: report({
        rejections: [
          {
            lineNumber: 5,
            authCode: null,
            code: "AMOUNT_IMBALANCE",
            message: "DF: expected 2250 cents, parsed 2350 cents (delta 100)",
          },
        ],
      }),
    });

    render(<ImportPage />);
    await waitFor(() => expect(screen.getByTestId("dropzone")).toBeTruthy());
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [makeFile("invoice_100002.csv")] } });

    await waitFor(() => expect(screen.getByTestId("quarantine-screen")).toBeTruthy());
    expect(screen.getByTestId("quarantine-nothing-written")).toBeTruthy();
    expect(screen.queryByTestId("reconciliation-preview")).toBeNull();
  });

  it("a duplicate upload renders a distinct rejection message, not the quarantine screen", async () => {
    listInvoices.mockResolvedValue(historyResult());
    uploadInvoice.mockResolvedValue({ status: "duplicate", invoiceId: "inv-1", report: report() });

    render(<ImportPage />);
    await waitFor(() => expect(screen.getByTestId("dropzone")).toBeTruthy());
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [makeFile("invoice_999210.csv")] } });

    await waitFor(() => expect(screen.getByTestId("duplicate-notice")).toBeTruthy());
    expect(screen.queryByTestId("quarantine-screen")).toBeNull();
  });

  it("a 409 conflict surfaces as a plain error state", async () => {
    listInvoices.mockResolvedValue(historyResult());
    uploadInvoice.mockRejectedValue(
      new ApiError({ title: "Conflict", status: 409, detail: "already imported from a different file" }),
    );

    render(<ImportPage />);
    await waitFor(() => expect(screen.getByTestId("dropzone")).toBeTruthy());
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [makeFile("invoice_100001.csv")] } });

    await waitFor(() => expect(screen.getByTestId("import-error")).toBeTruthy());
    expect(screen.getByTestId("import-error").textContent).toContain("already imported from a different file");
  });

  it("a quarantined history row reopens QuarantineScreen via GET /invoices/{id}, without re-uploading", async () => {
    listInvoices.mockResolvedValue(historyResult([historyRow()]));
    getInvoice.mockResolvedValue({
      ...historyRow(),
      rejections: [
        {
          lineNumber: 3,
          authCode: null,
          code: "GRAND_TOTAL_IMBALANCE",
          message: "grand total: expected 10000 cents, parsed 10100 cents (delta 100)",
        },
      ],
    } satisfies InvoiceDetail);

    render(<ImportPage />);
    await waitFor(() => expect(screen.getByTestId("import-history-row-inv-1")).toBeTruthy());
    fireEvent.click(screen.getByTestId("import-history-row-inv-1"));

    await waitFor(() => expect(screen.getByTestId("quarantine-screen")).toBeTruthy());
    expect(uploadInvoice).not.toHaveBeenCalled();
    expect(screen.getByTestId("quarantine-screen").textContent).toContain("100003");
  });
});

// 999217 prints Aug 1 – Sep 9 but its transactions ran Sep 3 – Sep 10 (T-63's amber note).
function caInvoice(overrides: Partial<InvoiceListItem> = {}): InvoiceListItem {
  return historyRow({
    id: "inv-ca",
    invoiceNumber: "999217",
    periodStart: "2026-08-01",
    periodEnd: "2026-09-09",
    billingWeekEnd: "2026-09-09",
    actualStart: "2026-09-03",
    actualEnd: "2026-09-10",
    datesDiffer: true,
    currency: "CAD",
    grandTotal: 46837.33,
    status: "imported",
    ...overrides,
  });
}

const usInvoice = historyRow({
  id: "inv-us",
  invoiceNumber: "999210",
  periodStart: "2026-09-03",
  periodEnd: "2026-09-09",
  billingWeekEnd: "2026-09-09",
  actualStart: "2026-09-03",
  actualEnd: "2026-09-09",
  currency: "USD",
  status: "imported",
});

function periodWeek(weekEnd: string, invoices: PeriodWeek["invoices"]): PeriodWeek {
  return { weekEnd, invoices };
}

const US_PERIOD = { id: "inv-us", invoiceNumber: "999210", currency: "USD" as const, printedStart: "2026-09-03", printedEnd: "2026-09-09", actualStart: "2026-09-03", actualEnd: "2026-09-09", datesDiffer: false };
const CA_PERIOD = { id: "inv-ca", invoiceNumber: "999217", currency: "CAD" as const, printedStart: "2026-08-01", printedEnd: "2026-09-09", actualStart: "2026-09-03", actualEnd: "2026-09-10", datesDiffer: true };

describe("ImportPage — billing weeks (T-64 step 64.4)", () => {
  it("an invoice whose printed range is not the range it ran shows the amber note, in the ticket's words", async () => {
    listInvoices.mockResolvedValue(historyResult([usInvoice, caInvoice()]));
    render(<ImportPage />);

    await waitFor(() => expect(screen.getByTestId("dates-differ-note-inv-ca")).toBeTruthy());
    expect(screen.getByTestId("dates-differ-note-inv-ca").textContent).toContain("Printed Aug 1 – Sep 9; transactions Sep 3 – Sep 10");
    expect(screen.queryByTestId("dates-differ-note-inv-us")).toBeNull();
  });

  it("highlights the invoice a strip chip pointed at via ?invoice=", async () => {
    searchParams = new URLSearchParams({ invoice: "inv-ca" });
    listInvoices.mockResolvedValue(historyResult([usInvoice, caInvoice()]));
    render(<ImportPage />);

    await waitFor(() => expect(screen.getByTestId("import-history-row-inv-ca")).toBeTruthy());
    expect(screen.getByTestId("import-history-row-inv-ca").closest(".import-history-entry")!.getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("import-history-row-inv-us").closest(".import-history-entry")!.getAttribute("aria-current")).toBeNull();
  });

  it("'Belongs to week ending' calls PATCH, and the top bar's selector shows the new week without a reload", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    // Before: 999217 sits in the week ending Sep 9 beside 999210. After: it has moved to the week ending Sep 16.
    listPeriods
      .mockResolvedValueOnce({ weeks: [periodWeek("2026-09-09", [US_PERIOD, CA_PERIOD])] })
      .mockResolvedValue({ weeks: [periodWeek("2026-09-16", [CA_PERIOD]), periodWeek("2026-09-09", [US_PERIOD])] });
    listInvoices
      .mockResolvedValueOnce(historyResult([usInvoice, caInvoice()]))
      .mockResolvedValue(historyResult([usInvoice, caInvoice({ billingWeekEnd: "2026-09-16" })]));
    patchInvoiceWeek.mockResolvedValue(caInvoice({ billingWeekEnd: "2026-09-16" }));

    render(<ImportPage />);
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    expect(screen.getAllByRole("option")[0]!.textContent).toBe("Week ending Sep 9, 2026 · 🇺🇸 999210 · 🇨🇦 999217 ⚠");

    const entry = screen.getByTestId("import-history-row-inv-ca").closest(".import-history-entry")! as HTMLElement;
    const input = entry.querySelector("input[type=date]") as HTMLInputElement;
    expect(input.value).toBe("2026-09-09");
    fireEvent.change(input, { target: { value: "2026-09-16" } });
    fireEvent.click(entry.querySelector("button")!);

    await waitFor(() => expect(patchInvoiceWeek).toHaveBeenCalledWith("inv-ca", "2026-09-16"));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "Week ending Sep 16, 2026 · 🇺🇸 — · 🇨🇦 999217 ⚠",
      "Week ending Sep 9, 2026 · 🇺🇸 999210 · 🇨🇦 —",
    ]);
    // Only the week list and the history were re-read — no page reload, no /health refetch.
    expect(listPeriods).toHaveBeenCalledTimes(2);
    expect(getHealth).toHaveBeenCalledTimes(1);
  });

  it("a 409 shows its reason on the row and leaves the selector as it was", async () => {
    getHealth.mockResolvedValue({ latestInvoicePeriod: "2026-09-09", openAnomalyCount: 0 });
    listPeriods.mockResolvedValue({ weeks: [periodWeek("2026-09-09", [US_PERIOD, CA_PERIOD])] });
    listInvoices.mockResolvedValue(historyResult([usInvoice, caInvoice()]));
    const reason = "invoice 999224 already holds that billing week for this currency (existing invoice id: x)";
    patchInvoiceWeek.mockRejectedValue(new ApiError({ title: "Conflict", status: 409, detail: reason }));

    render(<ImportPage />);
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));

    const entry = screen.getByTestId("import-history-row-inv-ca").closest(".import-history-entry")! as HTMLElement;
    fireEvent.change(entry.querySelector("input[type=date]")!, { target: { value: "2026-09-16" } });
    fireEvent.click(entry.querySelector("button")!);

    await waitFor(() => expect(screen.getByTestId("week-error-inv-ca").textContent).toBe(reason));
    expect(listPeriods).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("Move stays disabled until the week actually changes", async () => {
    listInvoices.mockResolvedValue(historyResult([caInvoice()]));
    render(<ImportPage />);
    await waitFor(() => expect(screen.getByTestId("import-history-row-inv-ca")).toBeTruthy());

    const entry = screen.getByTestId("import-history-row-inv-ca").closest(".import-history-entry")! as HTMLElement;
    const button = entry.querySelector("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(entry.querySelector("input[type=date]")!, { target: { value: "2026-09-16" } });
    expect(button.disabled).toBe(false);
  });
});
