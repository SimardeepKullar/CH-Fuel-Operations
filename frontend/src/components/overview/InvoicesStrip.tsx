"use client";

import { useState } from "react";
import type { InvoicesView, StripChip as ChipModel } from "../../lib/overviewView";
import { CodeBadge, GhostButton, StripChip, SubStrip } from "../SubStrip";

function Chip({ chip, small }: { chip: ChipModel; small?: boolean }) {
  return (
    <StripChip absent={chip.absent}>
      <CodeBadge code={chip.code} absent={chip.absent} small={small} />
      {chip.text}
    </StripChip>
  );
}

/** "Invoices in view": two chips for a week, one summary chip with an expandable list for a range or all time. */
export default function InvoicesStrip({ view }: { view: InvoicesView }) {
  const [open, setOpen] = useState(false);
  return (
    <SubStrip label="Invoices in view" testId="invoices-strip">
      {view.single ? (
        view.weekChips.map((c) => <Chip key={c.code} chip={c} />)
      ) : (
        <>
          <StripChip testId="invoices-summary">
            {view.summaryLabel} · {view.count}
            <span className="ss-chip-dim">{view.split}</span>
          </StripChip>
          <GhostButton onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide list" : "Show all"}
          </GhostButton>
          {open && (
            <div className="ss-list" data-testid="invoices-list">
              {view.allChips.map((c) => (
                <Chip key={`${c.code}-${c.text}`} chip={c} small />
              ))}
            </div>
          )}
        </>
      )}
    </SubStrip>
  );
}
