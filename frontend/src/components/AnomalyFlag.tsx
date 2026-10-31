import type { AnomalyFlag as AnomalyFlagData } from "@ch/core/actuals/transactions";

/** The six rules `runAnomalies.ts` currently writes (A10's table). A rule
 * added later without a label here still renders — humanized from its
 * slug — rather than disappearing or throwing. */
const RULE_LABELS: Record<string, string> = {
  sub_gallon: "Sub-gal",
  unit_mismatch: "Unit mismatch",
  too_close: "Too close",
  charges_no_fuel: "Scale",
  price_above_published: "Price high",
  not_on_roster: "Not on roster",
};

/** The rules a dispatcher can filter by: every one the screen renders (`charges_no_fuel` never shows, T-40H). */
export const FILTERABLE_FLAGS: { value: string; label: string }[] = Object.entries(RULE_LABELS)
  .filter(([rule]) => rule !== "charges_no_fuel")
  .map(([value, label]) => ({ value, label }));

/** One line per rule for a hover — what the rule found, in the dispatcher's terms. */
const RULE_DESCRIPTIONS: Record<string, string> = {
  sub_gallon: "Fuel line is under the minimum quantity",
  unit_mismatch: "Unit typed at the pump does not match the truck assigned to the card",
  too_close: "Another fill on the same card at the same station came shortly before",
  price_above_published: "Billed price is above BVD's published price",
  not_on_roster: "This card has no driver on the fleet roster",
};

/** `Unit mismatch: Unit typed at the pump…` — the text a flag's hover shows. */
export function describeFlag(rule: string): string {
  const what = RULE_DESCRIPTIONS[rule];
  return what === undefined ? flagLabel(rule) : `${flagLabel(rule)}: ${what}`;
}

/** The one-line meaning of a rule, or `null` for a rule added without one. */
export function flagDescription(rule: string): string | null {
  return RULE_DESCRIPTIONS[rule] ?? null;
}

export function flagLabel(rule: string): string {
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
      {flagLabel(flag.rule)}
    </span>
  );
}
