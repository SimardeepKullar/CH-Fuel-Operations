"use client";

import { useCallback, useEffect, useState } from "react";
import type { ImportInvoiceResponse, InvoiceListItem } from "@ch/core/api/routes/invoices";
import { ApiError, getInvoice, listInvoices, patchInvoiceWeek, uploadInvoice } from "../../../lib/api";
import { useWeek } from "../../../hooks/useWeek";
import Dropzone from "../../../components/Dropzone";
import ParsingState from "../../../components/ParsingState";
import ReconciliationPreview from "../../../components/ReconciliationPreview";
import QuarantineScreen, { type QuarantineRejection } from "../../../components/QuarantineScreen";
import ImportHistory from "../../../components/ImportHistory";
import EmptyState from "../../../components/EmptyState";

type ImportView =
  | { phase: "idle" }
  | { phase: "parsing"; fileName: string; rowCount: number | null }
  | { phase: "loading" }
  | { phase: "imported"; response: ImportInvoiceResponse }
  | { phase: "quarantined"; invoiceNumber: string; rejections: QuarantineRejection[] }
  | { phase: "duplicate"; invoiceNumber: string }
  | { phase: "error"; message: string };

/** How much of the file has been read so far — an honest progress figure,
 * not the promoted fuel-stop row count the server computes after grouping
 * and reconciling. */
function countCsvRows(text: string): number {
  return text.split(/\r\n|\r|\n/).filter((line) => line.length > 0).length;
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.detail ?? err.title;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** `FileReader`, not `File.text()`/`Blob.text()` — the latter isn't
 * implemented in this project's jsdom test environment, and `FileReader`
 * works identically in both a real browser and the test suite. */
function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error(`could not read "${file.name}"`));
    reader.readAsText(file);
  });
}

/**
 * A8.2's Import screen (T-42): drag-and-drop intake, the parsing/preview/
 * quarantine states, and the history list, all on one route — the same one
 * the sidebar already links to, so a quarantined invoice from a past upload
 * is reachable here with no re-upload.
 *
 * `POST /invoices/import` parses, reconciles and writes in a single call
 * (T-28) — there is no separate preview-then-commit step against the
 * backend. "Parsing" is therefore a client-side state shown while that one
 * request is in flight, and "Confirm" on the preview acknowledges an
 * already-written invoice rather than firing a second write.
 */
export default function ImportPage() {
  const [view, setView] = useState<ImportView>({ phase: "idle" });
  const [historyRows, setHistoryRows] = useState<InvoiceListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const { reloadPeriods } = useWeek();

  const refreshHistory = useCallback(() => {
    setHistoryLoading(true);
    listInvoices({ pageSize: 50 })
      .then((result) => setHistoryRows(result.rows))
      .catch(() => setHistoryRows([]))
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const handleFile = useCallback(
    (file: File) => {
      setView({ phase: "parsing", fileName: file.name, rowCount: null });

      if (file.name.toLowerCase().endsWith(".csv")) {
        readAsText(file)
          .then((text) => {
            const rowCount = countCsvRows(text);
            setView((current) => (current.phase === "parsing" ? { ...current, rowCount } : current));
          })
          .catch(() => {
            // Row count is a nice-to-have progress figure — a read failure
            // here shouldn't block or fail the upload itself.
          });
      }

      uploadInvoice(file)
        .then((response) => {
          if (response.status === "duplicate") {
            setView({ phase: "duplicate", invoiceNumber: response.report.invoiceNumber });
          } else if (response.status === "quarantined") {
            setView({
              phase: "quarantined",
              invoiceNumber: response.report.invoiceNumber,
              rejections: response.report.rejections,
            });
          } else {
            setView({ phase: "imported", response });
          }
          refreshHistory();
        })
        .catch((err: unknown) => {
          setView({ phase: "error", message: messageOf(err) });
        });
    },
    [refreshHistory],
  );

  const reopenQuarantined = useCallback((id: string) => {
    setView({ phase: "loading" });
    getInvoice(id)
      .then((detail) => {
        setView({ phase: "quarantined", invoiceNumber: detail.invoiceNumber, rejections: detail.rejections });
      })
      .catch((err: unknown) => {
        setView({ phase: "error", message: messageOf(err) });
      });
  }, []);

  const reset = useCallback(() => setView({ phase: "idle" }), []);

  // Moves an invoice to another billing week, then re-reads both lists so the
  // history row and the top bar's selector show it without a page reload. A
  // refusal (a 409 naming the invoice already in that week) rejects up to the
  // row, which shows its reason.
  const moveWeek = useCallback(
    async (id: string, weekEnd: string) => {
      await patchInvoiceWeek(id, weekEnd);
      await Promise.all([reloadPeriods(), listInvoices({ pageSize: 50 }).then((result) => setHistoryRows(result.rows))]);
    },
    [reloadPeriods],
  );

  return (
    <div className="import-page">
      <div className="import-main">
        {view.phase === "idle" && <Dropzone onFile={handleFile} />}
        {view.phase === "parsing" && <ParsingState fileName={view.fileName} rowCount={view.rowCount} />}
        {view.phase === "loading" && <EmptyState title="Loading…" />}
        {view.phase === "imported" && <ReconciliationPreview report={view.response.report} onConfirm={reset} />}
        {view.phase === "quarantined" && (
          <QuarantineScreen invoiceNumber={view.invoiceNumber} rejections={view.rejections} onDismiss={reset} />
        )}
        {view.phase === "duplicate" && (
          <div className="import-duplicate" data-testid="duplicate-notice">
            <EmptyState
              title="Already imported"
              detail={`Invoice ${view.invoiceNumber} was already imported from this exact file — nothing changed.`}
            />
            <button className="btn btn-ghost" onClick={reset}>
              Upload another
            </button>
          </div>
        )}
        {view.phase === "error" && (
          <div className="import-error" data-testid="import-error">
            <EmptyState title="Import failed" detail={view.message} />
            <button className="btn btn-ghost" onClick={reset}>
              Try again
            </button>
          </div>
        )}
      </div>

      <ImportHistory
        rows={historyRows}
        loading={historyLoading}
        onReopenQuarantined={reopenQuarantined}
        onMoveWeek={moveWeek}
      />
    </div>
  );
}
