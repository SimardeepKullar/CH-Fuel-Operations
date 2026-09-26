import type { RawResolvedString } from "@ch/core/actuals/transactions";

export type RawResolvedState = "resolved" | "disagreeing" | "unmatched";

function stateOf(value: RawResolvedString): RawResolvedState {
  if (value.resolved === null) return "unmatched";
  if (value.agrees === false) return "disagreeing";
  return "resolved";
}

interface RawResolvedProps {
  value: RawResolvedString;
  /**
   * Also show the raw value as a muted subline under the resolved one when
   * they agree. Off by default: once resolved and raw already say the same
   * thing, repeating the raw text is noise rather than a check — A9.2's
   * "raw" treatment exists to flag a value worth double-checking, not to
   * echo an already-confirmed one. The unit/truck column (where a pump
   * mistype is common and operationally significant even when it happens
   * to match) passes `true`.
   */
  showRawWhenAgreeing?: boolean;
  /**
   * Force the plain "raw" treatment regardless of resolution, ignoring
   * `value.resolved` entirely. For contexts that show the raw value on its
   * own line already labelled "Raw ..." (a stop's expanded detail panel),
   * not paired with a resolved value the way a table cell is — this keeps
   * `RawResolved` the one place raw invoice text is ever styled (T-40 DoD)
   * instead of a second hand-rolled monospace/dotted span appearing there.
   */
  rawOnly?: boolean;
}

/**
 * A9.2's three raw/resolved states, in one component — "the only component
 * that renders raw invoice text anywhere in the app" (T-40 DoD).
 *
 * The backend also produces a case A9.2's table doesn't name:
 * `resolved === null` — nothing to compare against, so `agrees` is `null`
 * too (A13's "nulls are meaningful"; e.g. a card whose driver never
 * resolved). Per A8.6 ("show unmatched as unmatched, never a guess") this
 * reuses the RAW treatment as the sole, primary value — explicitly, as its
 * own `"unmatched"` state below, rather than silently falling into either
 * of the other two.
 */
export default function RawResolved({ value, showRawWhenAgreeing = false, rawOnly = false }: RawResolvedProps) {
  const state = rawOnly ? "unmatched" : stateOf(value);

  if (state === "unmatched") {
    return (
      <span className="rr rr-unmatched" data-state="unmatched">
        {value.raw}
      </span>
    );
  }

  if (state === "disagreeing") {
    return (
      <span className="rr rr-disagree" data-state="disagreeing">
        <span className="rr-disagree-value">{value.resolved}</span>
        <span className="rr-disagree-raw">&ne;{value.raw}</span>
      </span>
    );
  }

  return (
    <span className="rr rr-resolved" data-state="resolved">
      <span className="rr-value">{value.resolved}</span>
      {showRawWhenAgreeing && <span className="rr-raw">{value.raw}</span>}
    </span>
  );
}
