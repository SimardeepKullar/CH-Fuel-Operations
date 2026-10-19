import type { ReactNode } from "react";
import type { OverviewCombined } from "@ch/core/actuals/overview";
import { RATE_PENDING, formatMoneyOrPending, formatPriceOrPending, formatQty2dp } from "../lib/formatMoney";
import { SIDE_LABELS } from "../lib/weeks";
import Corners from "./Corners";

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
 * currency and one unit. Labelled "before HST" and "HST", never "pre-tax". With
 * no rate every converted figure reads "rate pending": the API sends `null`
 * and nothing is computed.
 */
export default function CombinedPanel({ combined, rateField, dateNotes }: CombinedPanelProps) {
  const { currency, qtyUnit } = combined;
  const money = (n: number | null) => formatMoneyOrPending(n, currency);
  const rate = (n: number | null) => formatPriceOrPending(n, currency);

  const row = (
    key: string,
    name: string,
    split: { beforeTax: number | null; tax: number | null; withTax: number | null },
    sub?: string,
  ) => (
    <tr key={key}>
      <th scope="row">
        {name}
        {sub !== undefined && <span className="tax-sub"> {sub}</span>}
      </th>
      <td data-testid={`combined-${key}-before`}>{money(split.beforeTax)}</td>
      <td data-testid={`combined-${key}-tax`}>{money(split.tax)}</td>
      <td data-testid={`combined-${key}-with`}>{money(split.withTax)}</td>
    </tr>
  );

  return (
    <div className="panel-card blueprint tax-panel" data-testid="combined-panel">
      <Corners />
      <div className="panel-card-header">
        <span className="panel-card-title">Combined</span>
        <span className="panel-card-sub" data-testid="combined-currency">
          {currency} · per {qtyUnit}
        </span>
      </div>
      {combined.partial && (
        <p className="tax-partial" data-testid="combined-partial">
          Partial — {SIDE_LABELS[combined.missingSide!]} invoice not imported
        </p>
      )}
      {rateField}
      {combined.ratePending && (
        <p className="tax-pending" data-testid="combined-pending">
          {RATE_PENDING} — enter the exchange rate to convert the figures below
        </p>
      )}
      <table className="tax-table">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Before HST</th>
            <th scope="col">HST</th>
            <th scope="col">With HST</th>
          </tr>
        </thead>
        <tbody>
          {row("spend", "Spend", combined.spend)}
          {row("diesel", "Diesel", combined.diesel, `${formatQty2dp(combined.diesel.qty)} ${qtyUnit}`)}
          {row("def", "DEF", combined.def, `${formatQty2dp(combined.def.qty)} ${qtyUnit}`)}
          <tr>
            <th scope="row">Discount captured</th>
            <td />
            <td />
            <td data-testid="combined-discount">{money(combined.discount)}</td>
          </tr>
          <tr className="tax-rate-row">
            <th scope="row">
              Billed per {qtyUnit === "L" ? "litre" : "gallon"}{" "}
              <span className="tax-sub">
                {currency}/{qtyUnit}
              </span>
            </th>
            <td data-testid="combined-rate-before">{rate(combined.avgBilledPreTaxPerUnit)}</td>
            <td />
            <td data-testid="combined-rate-with">{rate(combined.avgBilledPerUnit)}</td>
          </tr>
        </tbody>
      </table>
      {dateNotes.map((note) => (
        <p key={note} className="tax-footnote" data-testid="combined-footnote">
          {note}
        </p>
      ))}
    </div>
  );
}
