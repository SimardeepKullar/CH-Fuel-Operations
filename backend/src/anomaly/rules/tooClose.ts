import type { AnomalyFinding } from "../types.js";

export interface TooCloseConfig {
  maxMinutesApart: number;
}

export interface TooCloseStop {
  id: string;
  /** Same card = same driver for that card's whole life (D19's permanent
   * 1:1), so this is the natural grouping key — always present, unlike
   * `truck_id`/`driver_id`, which T-29 may leave null. */
  cardId: string;
  /** `null` (an unresolved station) is never comparable — two stops can't
   * be "the same site" if one of them has no site at all. */
  stationId: string | null;
  occurredAt: Date;
}

/**
 * Flags the later of two fills on the same card, at the same station,
 * within `maxMinutesApart` — §A10's 78-minutes-apart pair at LOVES #275. A
 * truck's tank does not need refilling again that soon, so this is either a
 * miskeyed duplicate or a billing error, not a real second purchase.
 *
 * Compares only adjacent stops within each (card, station) group once
 * sorted by time — sufficient for the "back-to-back" case this rule exists
 * for, and avoids an O(n²) scan over an invoice's full stop list.
 *
 * Pure — no database, no HTTP, no clock; "now" plays no part, only the
 * stops' own timestamps.
 */
export function tooClose(
  stops: readonly TooCloseStop[],
  config: TooCloseConfig,
): AnomalyFinding[] {
  const groups = new Map<string, TooCloseStop[]>();
  for (const stop of stops) {
    if (stop.stationId === null) {
      continue;
    }
    const key = `${stop.cardId}|${stop.stationId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(stop);
    } else {
      groups.set(key, [stop]);
    }
  }

  const findings: AnomalyFinding[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const sorted = [...group].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    for (let i = 1; i < sorted.length; i++) {
      const earlier = sorted[i - 1]!;
      const later = sorted[i]!;
      const minutesApart = (later.occurredAt.getTime() - earlier.occurredAt.getTime()) / 60_000;
      if (minutesApart <= config.maxMinutesApart) {
        findings.push({
          subjectType: "fuel_stop",
          subjectId: later.id,
          severity: "amber",
          detail: {
            pairedWithStopId: earlier.id,
            minutesApart,
            maxMinutesApart: config.maxMinutesApart,
          },
        });
      }
    }
  }

  return findings;
}
