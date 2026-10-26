"use client";

import type { PeriodWeek } from "@ch/core/api/routes/periods";
import type { Scope } from "../lib/overviewScope";
import type { SideChoice } from "../lib/transactionsScope";
import { actualRange, formatCompactRange, formatDatesDifferNote } from "../lib/weeks";
import { CodeBadge, SubStrip } from "./SubStrip";

interface TransactionsStripProps {
  scope: Scope;
  /** Every week (any order), with its invoices. */
  weeks: readonly PeriodWeek[];
  /** The weeks the scope covers. */
  inScope: readonly PeriodWeek[];
  side: SideChoice;
  onSide: (side: SideChoice) => void;
}

function chipButton(key: string, pressed: boolean, onClick: () => void, children: React.ReactNode, title?: string) {
  return (
    <button key={key} type="button" className="ss-chip" aria-pressed={pressed} onClick={onClick} title={title} data-side={key}>
      {children}
    </button>
  );
}

/**
 * The sub-strip under Transactions' banner: which side's invoices the table shows. For one
 * week the chips name the week's invoices (and a missing side as a dashed chip); for a range
 * or all time they count each side's invoices in scope.
 */
export default function TransactionsStrip({ scope, inScope, side, onSide }: TransactionsStripProps) {
  const single = scope.mode === "week";
  const invoices = inScope.flatMap((w) => w.invoices);
  const count = (c: "USD" | "CAD") => invoices.filter((i) => i.currency === c).length;

  return (
    <SubStrip label="Invoices in view" testId="invoices-in-view">
      {(["USD", "CAD"] as const).map((c) => {
        const code = c === "USD" ? "US" : "CA";
        if (single) {
          const invoice = inScope[0]?.invoices.find((i) => i.currency === c);
          if (invoice === undefined) {
            return (
              <span key={c} className="ss-chip ss-chip-absent" data-side={c} data-state="not-imported">
                <CodeBadge code={code} absent />
                {c === "USD" ? "No US invoice this week" : "No Canadian invoice this week"}
              </span>
            );
          }
          const range = actualRange(invoice);
          return chipButton(
            c,
            side === c,
            () => onSide(c),
            <>
              <CodeBadge code={code} />
              {invoice.invoiceNumber} · {formatCompactRange(range.start, range.end)}
              {invoice.datesDiffer && <span className="ss-warn">⚠</span>}
            </>,
            invoice.datesDiffer ? formatDatesDifferNote(invoice) : undefined,
          );
        }
        return chipButton(
          c,
          side === c,
          () => onSide(c),
          <>
            <CodeBadge code={code} />
            {count(c)} {c === "USD" ? "US" : "CA"} {count(c) === 1 ? "invoice" : "invoices"}
          </>,
        );
      })}
      {(!single || invoices.length > 1) && chipButton("all", side === "all", () => onSide("all"), <>All invoices · {invoices.length}</>)}
    </SubStrip>
  );
}
