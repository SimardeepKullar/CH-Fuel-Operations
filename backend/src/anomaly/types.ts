import type { AnomalySeverity } from "../db/types.js";

export type { AnomalySeverity };

/**
 * One rule's verdict for a single flagged subject. `severity` is typed
 * `AnomalySeverity` — the same two-valued union the `anomalies.severity`
 * CHECK constraint enforces (migrations/0003_actuals_schema.sql) — so a third
 * severity is unrepresentable here, not merely unused.
 */
export interface AnomalyFinding {
  subjectType: string;
  subjectId: string;
  severity: AnomalySeverity;
  detail: Record<string, unknown>;
}
