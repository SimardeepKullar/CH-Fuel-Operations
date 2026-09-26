import { z } from "zod";
import type { RawBvdRow } from "./parseBvdCsv.js";
import type { ProductType } from "../db/types.js";

/** The 50 states plus DC — this app is US-only (§4.4). */
export const USPS_STATE_CODES: ReadonlySet<string> = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
]);

/** Half a cent — comfortably tighter than the sheet's finest denomination. */
const PRICE_TOLERANCE = 0.0005;

export type RejectionCode =
  | "SCHEMA_ERROR"
  | "NUMERIC_PARSE_ERROR"
  | "INVALID_STATE"
  | "UNMAPPED_PRODUCT"
  | "PRICE_INVARIANT_VIOLATION";

const FIELD_TO_CODE: Record<string, RejectionCode> = {
  site: "SCHEMA_ERROR",
  name: "SCHEMA_ERROR",
  city: "SCHEMA_ERROR",
  state: "INVALID_STATE",
  prod: "UNMAPPED_PRODUCT",
  cost: "NUMERIC_PARSE_ERROR",
  federalTax: "NUMERIC_PARSE_ERROR",
  stateTax: "NUMERIC_PARSE_ERROR",
  salesTax: "NUMERIC_PARSE_ERROR",
  freight: "NUMERIC_PARSE_ERROR",
  other: "NUMERIC_PARSE_ERROR",
  totalCost: "NUMERIC_PARSE_ERROR",
  retailPrice: "NUMERIC_PARSE_ERROR",
  yourPrice: "PRICE_INVARIANT_VIOLATION",
  savings: "NUMERIC_PARSE_ERROR",
};

export interface ValidationRejection {
  lineNumber: number;
  siteRef: string | null;
  code: RejectionCode;
  message: string;
  /** The row's raw PROD value, regardless of rejection code — lets a report
   * list unmapped codes without re-parsing the message string. */
  rawProduct: string;
}

/**
 * A row that passed validation. Numeric fields are kept as the original raw
 * strings — BVD's exact decimal text — so the database never re-renders a
 * value it did not receive; only `validateRow` itself parses them to numbers,
 * and only to check the invariants below.
 */
export interface ValidatedRow {
  lineNumber: number;
  siteRef: string;
  nameRaw: string;
  cityRaw: string;
  stateUsps: string;
  rawProduct: string;
  productType: ProductType;
  cost: string;
  federalTax: string;
  stateTax: string;
  salesTax: string;
  freight: string;
  other: string;
  totalCost: string;
  retailPrice: string;
  yourPrice: string;
  savings: string;
}

export type ValidationResult =
  | { ok: true; row: ValidatedRow }
  | { ok: false; rejection: ValidationRejection };

const numericField = z.string().transform((value, ctx) => {
  const trimmed = value.trim();
  const n = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(n)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `does not parse as a number: "${value}"`,
    });
    return z.NEVER;
  }
  return n;
});

/**
 * Builds the row schema against a specific supplier's product code map, since
 * "PROD mapped" is a lookup against product_codes, not a static shape.
 *
 * An unmapped PROD fails the row — never default-mapped (§22.4). YOUR PRICE
 * is read from the sheet and only checked here against
 * min(TOTAL COST, RETAIL PRICE); the BVD-supplied value is never recomputed.
 */
function createBvdRowSchema(productCodes: ReadonlyMap<string, ProductType>) {
  return z
    .object({
      site: z.string().trim().min(1, "SITE is required"),
      name: z.string().trim().min(1, "NAME is required"),
      city: z.string().trim().min(1, "CITY is required"),
      state: z.string().trim().toUpperCase(),
      prod: z.string().trim().toUpperCase(),
      cost: numericField,
      federalTax: numericField,
      stateTax: numericField,
      salesTax: numericField,
      freight: numericField,
      other: numericField,
      totalCost: numericField,
      retailPrice: numericField,
      yourPrice: numericField,
      savings: numericField,
    })
    .superRefine((data, ctx) => {
      if (!USPS_STATE_CODES.has(data.state)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["state"],
          message: `unrecognised USPS state code: "${data.state}"`,
        });
      }
      if (!productCodes.has(data.prod)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["prod"],
          message: `unmapped PROD code: "${data.prod}"`,
        });
      }
      const expected = Math.min(data.totalCost, data.retailPrice);
      if (Math.abs(data.yourPrice - expected) > PRICE_TOLERANCE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["yourPrice"],
          message:
            `YOUR PRICE ${data.yourPrice} != min(TOTAL COST ${data.totalCost}, ` +
            `RETAIL PRICE ${data.retailPrice})`,
        });
      }
    });
}

/**
 * Validates one raw row: columns present, numerics parse, PROD mapped in
 * product_codes, STATE a valid USPS code, and YOUR PRICE = min(TOTAL COST,
 * RETAIL PRICE). Returns a typed rejection with line number and site ref
 * rather than throwing — a row is accepted or rejected, never guessed at.
 */
export function validateRow(
  row: RawBvdRow,
  productCodes: ReadonlyMap<string, ProductType>,
): ValidationResult {
  const schema = createBvdRowSchema(productCodes);
  const result = schema.safeParse(row);

  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue ? String(issue.path[0] ?? "") : "";
    const code = FIELD_TO_CODE[field] ?? "SCHEMA_ERROR";
    return {
      ok: false,
      rejection: {
        lineNumber: row.lineNumber,
        siteRef: row.site.trim() || null,
        code,
        message: issue?.message ?? "row failed validation",
        rawProduct: row.prod.trim().toUpperCase(),
      },
    };
  }

  const data = result.data;
  return {
    ok: true,
    row: {
      lineNumber: row.lineNumber,
      siteRef: data.site,
      nameRaw: row.name.trim(),
      cityRaw: row.city.trim(),
      stateUsps: data.state,
      rawProduct: data.prod,
      productType: productCodes.get(data.prod)!,
      cost: row.cost.trim(),
      federalTax: row.federalTax.trim(),
      stateTax: row.stateTax.trim(),
      salesTax: row.salesTax.trim(),
      freight: row.freight.trim(),
      other: row.other.trim(),
      totalCost: row.totalCost.trim(),
      retailPrice: row.retailPrice.trim(),
      yourPrice: row.yourPrice.trim(),
      savings: row.savings.trim(),
    },
  };
}
