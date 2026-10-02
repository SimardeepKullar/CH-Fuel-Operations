// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportInvoiceResponse, InvoiceDetail, InvoiceListItem } from "@ch/core/api/routes/invoices";
import type { ImportReport } from "@ch/core/invoice/report";

const uploadInvoice = vi.fn();
const listInvoices = vi.fn();
const getInvoice = vi.fn();

vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ...actual,
    uploadInvoice: (...args: unknown[]) => uploadInvoice(...args),
    listInvoices: (...args: unknown[]) => listInvoices(...args),
    getInvoice: (...args: unknown[]) => getInvoice(...args),
  };
});

const { ApiError } = await import("../../../lib/api");
const { default: ImportPage } = await import("./page");

function report(overrides: Partial<ImportReport> = {}): ImportReport {
  return {
    invoiceNumber: "999210",
    fileSha256: "abc123",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    currency: "USD",
    grandTotalUsd: "50929.71",
    productTotals: [
      { productCode: "TA", gallons: "9000.00", amountUsd: "47000.00", discountUsd: "500.00" },
      { productCode: "DF", gallons: "120.00", amountUsd: "500.00", discountUsd: "10.00" },
      { productCode: "S", gallons: null, amountUsd: "1786.58", discountUsd: null },
      { productCode: "Express Codes", gallons: null, amountUsd: "1643.13", discountUsd: null },
    ],
    reconcile: {
      balanced: true,
      amountImbalances: [],
      gallonImbalances: [],
      grandTotal: { expectedCents: 5092971, parsedCents: 5092971, deltaCents: 0 },
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
    grandTotalUsd: 100,
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
