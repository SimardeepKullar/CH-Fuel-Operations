"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReceiptQueueItem } from "@ch/core/actuals/receipts";
import type { ReceiptOutcome } from "@ch/core/db/types";
import { ApiError, confirmDriverReceipts, getReceiptQueue, postReceiptCheck } from "../../../lib/api";
import { useApiResource } from "../../../hooks/useApiResource";
import { useStandingCountsValue } from "../../../hooks/standingCountsContext";
import PageBanner from "../../../components/PageBanner";
import QueueCard from "../../../components/QueueCard";
import BatchConfirm, { type BatchGroup } from "../../../components/BatchConfirm";
import EmptyState from "../../../components/EmptyState";

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.detail ?? err.title;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** A shortcut must not fire while the dispatcher is typing into a control that owns the key. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

function describeStop(item: ReceiptQueueItem): string {
  const station = item.station === null ? "an unresolved station" : `${item.station.city}, ${item.station.state}`;
  return `${item.driver.resolved ?? item.driver.raw} at ${station}`;
}

/**
 * A8.5's Receipt Queue (T-43): one unconfirmed stop at a time, decided with Y / N / S.
 *
 * A decision is optimistic. The item leaves the card at once and the write follows; if the write
 * fails the item comes back to the front and the failure is shown, so the dispatcher never believes
 * a receipt is checked that is not. State is derived from the fetched queue plus the session's own
 * decisions and skips, so nothing is copied into state by an effect. Skip writes nothing: it only
 * moves the item behind the rest.
 *
 * The queue is unscoped on purpose — a standing worklist across every week (D17) — because batch
 * confirm acts on a driver's whole queue and its stated count must match what the server writes.
 */
export default function ReceiptQueuePage() {
  const { data, loading, error, refetch } = useApiResource(getReceiptQueue);
  const { refresh: refreshCounts } = useStandingCountsValue();

  // Item id -> what the dispatcher decided this session (written, or in flight).
  const [decided, setDecided] = useState<ReadonlyMap<string, ReceiptOutcome>>(new Map());
  // Item ids in the order they were skipped; they come back after everything not skipped.
  const [skipped, setSkipped] = useState<readonly string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);

  const serverItems = useMemo(() => data?.items ?? [], [data]);

  const items = useMemo(() => {
    const open = serverItems.filter((i) => !decided.has(i.id));
    const skippedSet = new Set(skipped);
    const fresh = open.filter((i) => !skippedSet.has(i.id));
    const byId = new Map(open.map((i) => [i.id, i]));
    const back = skipped.flatMap((id) => byId.get(id) ?? []);
    return [...fresh, ...back];
  }, [serverItems, decided, skipped]);

  const current = items[0] ?? null;

  // Progress is the server's, plus this session's confirmations the fetched `done` does not yet count.
  const progress = useMemo(() => {
    if (data === null) return null;
    const ids = new Set(serverItems.map((i) => i.id));
    let extra = 0;
    for (const [id, outcome] of decided) if (outcome === "confirmed" && ids.has(id)) extra += 1;
    return { done: data.progress.done + extra, total: data.progress.total };
  }, [data, serverItems, decided]);

  const groups = useMemo<BatchGroup[]>(() => {
    const byDriver = new Map<string, BatchGroup>();
    for (const item of serverItems) {
      if (item.driverId === null || decided.get(item.id) === "confirmed") continue;
      const group = byDriver.get(item.driverId) ?? {
        driverId: item.driverId,
        name: item.driver.resolved ?? item.driver.raw,
        count: 0,
        missing: 0,
      };
      group.count += 1;
      if (item.receiptStatus === "missing" || decided.get(item.id) === "missing") group.missing += 1;
      byDriver.set(item.driverId, group);
    }
    return [...byDriver.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [serverItems, decided]);

  const decide = useCallback(
    (item: ReceiptQueueItem, outcome: ReceiptOutcome) => {
      setFailure(null);
      setDecided((m) => new Map(m).set(item.id, outcome));
      postReceiptCheck(item.id, outcome)
        .then(() => refreshCounts?.())
        .catch((err: unknown) => {
          setDecided((m) => {
            const next = new Map(m);
            next.delete(item.id);
            return next;
          });
          setSkipped((s) => s.filter((id) => id !== item.id));
          setFailure(`Could not save ${outcome === "confirmed" ? "Y" : "N"} for ${describeStop(item)} — it is back in the queue. ${messageOf(err)}`);
        });
    },
    [refreshCounts],
  );

  const skip = useCallback((item: ReceiptQueueItem) => {
    setFailure(null);
    setSkipped((s) => [...s.filter((id) => id !== item.id), item.id]);
  }, []);

  const confirmBatch = useCallback(
    (group: BatchGroup) => {
      setFailure(null);
      setBatchBusy(true);
      confirmDriverReceipts(group.driverId)
        .then(() => {
          setDecided(new Map());
          setSkipped([]);
          refetch();
          refreshCounts?.();
        })
        .catch((err: unknown) => setFailure(`Could not confirm ${group.name}'s receipts — nothing was written. ${messageOf(err)}`))
        .finally(() => setBatchBusy(false));
    },
    [refetch, refreshCounts],
  );

  // The key handler reads the latest card through a ref so the listener is attached once.
  const live = useRef({ current, batchBusy, decide, skip });
  useEffect(() => {
    live.current = { current, batchBusy, decide, skip };
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
      const { current: item, batchBusy: busy, decide: doDecide, skip: doSkip } = live.current;
      if (item === null || busy) return;
      const key = e.key.toLowerCase();
      if (key === "y") doDecide(item, "confirmed");
      else if (key === "n") doDecide(item, "missing");
      else if (key === "s") doSkip(item);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const remaining = items.length;

  return (
    <>
      <PageBanner
        title="Receipt Queue"
        readout={progress === null ? undefined : <span data-testid="queue-remaining">{remaining} to review</span>}
      />
      <div className="rq-page">
        {failure !== null && (
          <div className="rq-failure" role="alert" data-testid="queue-failure">
            {failure}
          </div>
        )}

        {loading && data === null && <EmptyState title="Loading the queue…" />}
        {error !== null && data === null && (
          <div className="rq-load-error" data-testid="queue-load-error">
            <EmptyState title="Could not load the queue" detail={error.message} />
            <button className="btn btn-ghost" type="button" onClick={refetch}>
              Try again
            </button>
          </div>
        )}

        {progress !== null && (
          <>
            <div className="rq-progress" data-testid="queue-progress-block">
              <span className="rq-progress-count" data-testid="queue-progress">
                {progress.done} of {progress.total}
              </span>
              <span className="rq-progress-label">confirmed</span>
              <span className="rq-progress-bar" aria-hidden="true">
                <span
                  className="rq-progress-fill"
                  style={{ width: progress.total === 0 ? "0%" : `${(progress.done / progress.total) * 100}%` }}
                />
              </span>
            </div>

            {current !== null ? (
              <QueueCard item={current} busy={batchBusy} onDecide={(outcome) => decide(current, outcome)} onSkip={() => skip(current)} />
            ) : (
              <div className="rq-clear" data-testid="queue-clear">
                <EmptyState title="Nothing left to check" detail="Every stop in the queue has a decision." />
              </div>
            )}

            <BatchConfirm groups={groups} busy={batchBusy} onConfirm={confirmBatch} />
          </>
        )}
      </div>
    </>
  );
}
