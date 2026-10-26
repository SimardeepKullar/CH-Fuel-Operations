/**
 * Deep links into Transactions that carry the Overview's scope (T-74). The scope
 * keys are the Overview's own (`scope`, `w`, `from`, `to`), so the link and the
 * screen it opens describe the same weeks, and `currency` picks one side.
 */
import { writeScope, type Scope } from "./overviewScope";

export type SideCurrency = "USD" | "CAD";

/** Every flagged stop of one side, over the weeks `scope` covers. */
export function anomaliesLink(scope: Scope, currency: SideCurrency): string {
  const params = new URLSearchParams();
  writeScope(params, scope);
  params.set("currency", currency);
  params.set("anomalyOnly", "true");
  return `/transactions?${params.toString()}`;
}
