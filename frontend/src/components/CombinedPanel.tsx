import type { ReactNode } from "react";
import type { OverviewCombined } from "@ch/core/actuals/overview";
import { RATE_PENDING, formatMoneyGroupedOrPending, formatPriceGroupedOrPending, formatQtyGrouped } from "../lib/formatMoney";
import { SIDE_LABELS } from "../lib/weeks";
import KpiCard from "./KpiCard";

interface CombinedPanelProps {
  combined: OverviewCombined;
  /** The exchange-rate field (T-66), when the week has a CA invoice — beside the figures it converts. */
  rateField: ReactNode;
  /** One note per invoice whose printed range is not the one its transactions ran (`datesDiffer`). */
  dateNotes: readonly string[];
}

/**
 * The week's two invoices added together (T-65, D27, D28): the CA side converted
 * at the dispatcher's entered rate, then summed with the US side, in one
 * currency and one unit. Five tiles, each with its HST amount bottom right —
 * labelled "HST", never "pre-tax". With no rate every converted figure reads
 * "rate pending": the API sends `null` and nothing is computed.
 */
export default function CombinedPanel({ combined, rateField, dateNotes }: CombinedPanelProps) {
  const { currency, qtyUnit } = combined;
  const money = (n: number | null) => formatMoneyGroupedOrPending(n, currency);
  const rate = (n: number | null) => formatPriceGroupedOrPending(n, currency);
  // The tile's own value already says "rate pending"; a second note would only repeat it.
  const hst = (tax: number | null) => (tax === null ? undefined : `${formatQtyGrouped(tax)} HST`);
  const qty = (n: number) => `${formatQtyGrouped(n)} ${qtyUnit}`;

  return (
    <section className="combined-panel" data-testid="combined-panel" aria-label="Combined">
      <header className="combined-head">
        <span className="side-badge side-badge-light" aria-hidden="true">
          US + CA
        </span>
        <div className="side-panel-titles">
          <h2 className="side-panel-title">Combined</h2>
          <span className="side-panel-sub">
            Both invoices, {currency === "CAD" ? "US" : "Canada"} converted to {currency} · {qtyUnit === "L" ? "litres" : "gallons"}
          </span>
        </div>
        <div className="combined-rate">{rateField}</div>
      </header>

      {combined.partial && (
        <p className="tax-partial" data-testid="combined-partial">
          Partial — {SIDE_LABELS[combined.missingSide!]} invoice not imported
        </p>
      )}
      {combined.ratePending && (
        <p className="tax-pending" data-testid="combined-pending">
          {RATE_PENDING} — enter the exchange rate to convert the figures below
        </p>
      )}

      <div className="combined-tiles">
        <KpiCard
          flat
          label="Total spend, with HST"
          value={money(combined.spend.withTax)}
          sub="Diesel + DEF + other charges"
          cornerBottom={hst(combined.spend.tax)}
          testId="combined-total"
        />
        <KpiCard
          flat
          label="Diesel"
          value={money(combined.diesel.withTax)}
          sub={qty(combined.diesel.qty)}
          cornerBottom={hst(combined.diesel.tax)}
          testId="combined-diesel"
        />
        <KpiCard
          flat
          label="DEF"
          value={money(combined.def.withTax)}
          sub={qty(combined.def.qty)}
          cornerBottom={hst(combined.def.tax)}
          testId="combined-def"
        />
        <KpiCard flat label="Discount captured" value={money(combined.discount)} sub="Both invoices" testId="combined-disc" />
        <KpiCard
          flat
          label="Billed price, with HST"
          value={rate(combined.avgBilledPerUnit)}
          unit={combined.avgBilledPerUnit === null ? undefined : `/ ${qtyUnit}`}
          sub={combined.avgBilledPreTaxPerUnit === null ? undefined : `${rate(combined.avgBilledPreTaxPerUnit)} / ${qtyUnit} before HST`}
          testId="combined-billed"
        />
      </div>

      {(dateNotes.length > 0 || !combined.partial) && (
        <div className="combined-foot">
          {dateNotes.map((note) => (
            <p key={note} className="tax-footnote" data-testid="combined-footnote">
              {note}
            </p>
          ))}
          {!combined.partial && (
            <p className="tax-footnote" data-testid="combined-us-note">
              US invoice carries no HST.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
