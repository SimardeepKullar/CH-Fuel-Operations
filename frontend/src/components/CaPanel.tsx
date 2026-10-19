import type { OverviewSide } from "@ch/core/actuals/overview";
import { formatMoney, formatPricePerUnit, formatQty2dp } from "../lib/formatMoney";
import { taxLabel } from "../lib/overviewTax";
import { SIDE_FLAGS, SIDE_LABELS } from "../lib/weeks";
import Corners from "./Corners";

interface CaPanelProps {
  side: OverviewSide;
  invoiceNumber: string | null;
}

/**
 * The CA side of the week (T-65, D28): spend, diesel and DEF shown **before tax,
 * tax, and with tax**, then the billed price per unit before and with tax. BVD's
 * billed price includes the 13% HST, so with tax is the headline and the pre-tax
 * rate sits beside it. Everything is in CAD and in the unit the toggle chose
 * (litres as printed, gallons on request); the toggle never changes money.
 */
export default function CaPanel({ side, invoiceNumber }: CaPanelProps) {
  const { kpis, currency, qtyUnit } = side;
  const label = taxLabel(kpis.tax);
  const money = (n: number) => formatMoney(n, currency);

  const row = (key: string, name: string, before: number, tax: number, withTax: number, sub?: string) => (
    <tr key={key}>
      <th scope="row">
        {name}
        {sub !== undefined && <span className="tax-sub"> {sub}</span>}
      </th>
      <td data-testid={`ca-${key}-before`}>{money(before)}</td>
      <td data-testid={`ca-${key}-tax`}>{money(tax)}</td>
      <td data-testid={`ca-${key}-with`}>{money(withTax)}</td>
    </tr>
  );

  return (
    <div className="panel-card blueprint tax-panel" data-testid="ca-panel">
      <Corners />
      <div className="panel-card-header">
        <span className="panel-card-title">
          <span role="img" aria-label={SIDE_LABELS.CAD}>
            {SIDE_FLAGS.CAD}
          </span>{" "}
          CA{invoiceNumber === null ? "" : ` · ${invoiceNumber}`}
        </span>
        <span className="panel-card-sub">{currency}</span>
      </div>
      <table className="tax-table">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Before tax</th>
            <th scope="col" data-testid="ca-tax-label">
              {label}
            </th>
            <th scope="col">With tax</th>
          </tr>
        </thead>
        <tbody>
          {row("spend", "Spend", kpis.tax.beforeTax, kpis.tax.tax, kpis.tax.withTax)}
          {row("diesel", "Diesel", kpis.diesel.preTax, kpis.diesel.tax, kpis.diesel.amount, `${formatQty2dp(kpis.diesel.qty)} ${qtyUnit}`)}
          {row("def", "DEF", kpis.def.preTax, kpis.def.tax, kpis.def.amount, `${formatQty2dp(kpis.def.qty)} ${qtyUnit}`)}
          <tr>
            <th scope="row">Discount captured</th>
            <td />
            <td />
            <td data-testid="ca-discount">{money(kpis.discount.total)}</td>
          </tr>
          <tr className="tax-rate-row">
            <th scope="row">
              Billed per {qtyUnit === "L" ? "litre" : "gallon"}{" "}
              <span className="tax-sub">
                {currency}/{qtyUnit}
              </span>
            </th>
            <td data-testid="ca-rate-before">
              {kpis.avgBilledPreTaxPerUnit === null ? "—" : formatPricePerUnit(kpis.avgBilledPreTaxPerUnit, currency)}
            </td>
            <td />
            <td data-testid="ca-rate-with">
              {kpis.avgBilledPerUnit === null ? "—" : formatPricePerUnit(kpis.avgBilledPerUnit, currency)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
