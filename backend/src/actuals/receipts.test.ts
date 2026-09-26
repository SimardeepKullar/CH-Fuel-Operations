import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUEUE_ORDER,
  EXCEPTIONS_FIRST_QUEUE_ORDER,
  buildQueueOrderClause,
} from "./receipts.js";

/**
 * D17: the queue's ordering is data, not a code path, so an exceptions-first
 * queue (Q3/A18) is a different `QueueOrderSpec` passed to the same builder
 * and the same query — never a migration or a query rewrite. Pure — no
 * database, no HTTP, no clock.
 */
describe("buildQueueOrderClause", () => {
  it("renders the default (oldest-first) spec", () => {
    expect(buildQueueOrderClause(DEFAULT_QUEUE_ORDER)).toBe("ORDER BY fs.occurred_at ASC, fs.id ASC");
  });

  it("renders the exceptions-first spec from the exact same builder — no migration, no rewrite", () => {
    expect(buildQueueOrderClause(EXCEPTIONS_FIRST_QUEUE_ORDER)).toBe(
      "ORDER BY has_exception DESC, fs.occurred_at ASC, fs.id ASC",
    );
  });

  it("always ties off on fs.id ASC, so two calls on the same spec are deterministic even when every field ties", () => {
    const spec = [{ field: "occurred_at" as const, direction: "desc" as const }];
    expect(buildQueueOrderClause(spec)).toBe(buildQueueOrderClause(spec));
    expect(buildQueueOrderClause(spec).endsWith("fs.id ASC")).toBe(true);
  });

  it("only ever emits whitelisted column SQL — never caller-supplied text (D1)", () => {
    const spec = [{ field: "has_exception" as const, direction: "asc" as const }];
    expect(buildQueueOrderClause(spec)).toBe("ORDER BY has_exception ASC, fs.id ASC");
  });
});
