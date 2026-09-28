import type { AnomalyFlag as AnomalyFlagData } from "@ch/core/actuals/transactions";

/** The five rules `runAnomalies.ts` currently writes (A10's table). A rule
 * added later without a label here still renders — humanized from its
 * slug — rather than disappearing or throwing. */
const RULE_LABELS: Record<string, string> = {
  sub_gallon: "Sub-gal",
  unit_mismatch: "Unit mismatch",
  too_close: "Too close",
  charges_no_fuel: "Scale",
  price_above_published: "Price high",
};

function labelFor(rule: string): string {
  return RULE_LABELS[rule] ?? rule.replace(/_/g, " ");
}

interface AnomalyFlagProps {
  flag: AnomalyFlagData;
}

/** A10: two severities only — amber ("worth a look") and red ("probably a
 * billing error"). `AnomalySeverity` is a two-valued union at the type
 * level (`db/types.ts`), so a third level is unrepresentable, not merely
 * unused. */
export default function AnomalyFlag({ flag }: AnomalyFlagProps) {
  return (
    <span className={`anomaly-flag anomaly-flag-${flag.severity}`} data-severity={flag.severity}>
      {labelFor(flag.rule)}
    </span>
  );
}
