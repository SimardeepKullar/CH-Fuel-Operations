import { describe, expect, it } from "vitest";
import { buildTransactionFilterClause } from "./transactionQuery.js";

describe("buildTransactionFilterClause", () => {
  it("an empty filter object returns no WHERE clause and no params", () => {
    const clause = buildTransactionFilterClause({});
    expect(clause.whereSql).toBe("");
    expect(clause.params).toEqual([]);
  });

  it("dateFrom alone", () => {
    const dateFrom = new Date("2026-09-03T00:00:00Z");
    const clause = buildTransactionFilterClause({ dateFrom });
    expect(clause.whereSql).toBe("WHERE fs.occurred_at >= $1");
    expect(clause.params).toEqual([dateFrom]);
  });

  it("dateTo alone", () => {
    const dateTo = new Date("2026-09-09T23:59:59Z");
    const clause = buildTransactionFilterClause({ dateTo });
    expect(clause.whereSql).toBe("WHERE fs.occurred_at <= $1");
    expect(clause.params).toEqual([dateTo]);
  });

  it("invoiceId alone", () => {
    const clause = buildTransactionFilterClause({ invoiceId: "invoice-1" });
    expect(clause.whereSql).toBe("WHERE fs.invoice_id = $1");
    expect(clause.params).toEqual(["invoice-1"]);
  });

  it("invoiceId: null (a period that matched no invoice) still adds the condition, not a no-op", () => {
    const clause = buildTransactionFilterClause({ invoiceId: null });
    expect(clause.whereSql).toBe("WHERE fs.invoice_id = $1");
    expect(clause.params).toEqual([null]);
  });

  it("driverId alone", () => {
    const clause = buildTransactionFilterClause({ driverId: "driver-1" });
    expect(clause.whereSql).toBe("WHERE fs.driver_id = $1");
    expect(clause.params).toEqual(["driver-1"]);
  });

  it("truckId alone", () => {
    const clause = buildTransactionFilterClause({ truckId: "truck-1" });
    expect(clause.whereSql).toBe("WHERE fs.truck_id = $1");
    expect(clause.params).toEqual(["truck-1"]);
  });

  it("cardId alone", () => {
    const clause = buildTransactionFilterClause({ cardId: "card-1" });
    expect(clause.whereSql).toBe("WHERE fs.card_id = $1");
    expect(clause.params).toEqual(["card-1"]);
  });

  it("state alone is an EXISTS against stations, not a join", () => {
    const clause = buildTransactionFilterClause({ state: "TX" });
    expect(clause.whereSql).toBe(
      "WHERE EXISTS (SELECT 1 FROM stations s WHERE s.id = fs.station_id AND s.state_usps = $1)",
    );
    expect(clause.params).toEqual(["TX"]);
  });

  it("product alone is an EXISTS against fuel_stop_lines, not a join", () => {
    const clause = buildTransactionFilterClause({ product: "DF" });
    expect(clause.whereSql).toBe(
      "WHERE EXISTS (SELECT 1 FROM fuel_stop_lines fsl WHERE fsl.fuel_stop_id = fs.id AND fsl.product_code = $1)",
    );
    expect(clause.params).toEqual(["DF"]);
  });

  it("receiptStatus alone", () => {
    const clause = buildTransactionFilterClause({ receiptStatus: "confirmed" });
    expect(clause.whereSql).toBe("WHERE fs.receipt_status = $1");
    expect(clause.params).toEqual(["confirmed"]);
  });

  it("anomalyOnly alone is an EXISTS against undismissed anomalies, never a post-filter", () => {
    const clause = buildTransactionFilterClause({ anomalyOnly: true });
    expect(clause.whereSql).toBe(
      "WHERE EXISTS (SELECT 1 FROM anomalies a WHERE a.subject_type = 'fuel_stop' AND a.subject_id = fs.id AND a.dismissed_at IS NULL)",
    );
    expect(clause.params).toEqual([]);
  });

  it("anomalyOnly: false produces no condition at all", () => {
    const clause = buildTransactionFilterClause({ anomalyOnly: false });
    expect(clause.whereSql).toBe("");
    expect(clause.params).toEqual([]);
  });

  it("three filters in combination AND together with sequential placeholders", () => {
    const dateFrom = new Date("2026-09-03T00:00:00Z");
    const clause = buildTransactionFilterClause({
      dateFrom,
      driverId: "driver-1",
      anomalyOnly: true,
    });
    expect(clause.whereSql).toBe(
      "WHERE fs.occurred_at >= $1 AND fs.driver_id = $2 AND " +
        "EXISTS (SELECT 1 FROM anomalies a WHERE a.subject_type = 'fuel_stop' AND a.subject_id = fs.id AND a.dismissed_at IS NULL)",
    );
    expect(clause.params).toEqual([dateFrom, "driver-1"]);
  });

  it("every filter combined still produces one placeholder per positional param, in order", () => {
    const dateFrom = new Date("2026-09-03T00:00:00Z");
    const dateTo = new Date("2026-09-09T00:00:00Z");
    const clause = buildTransactionFilterClause({
      dateFrom,
      dateTo,
      invoiceId: "invoice-1",
      driverId: "driver-1",
      truckId: "truck-1",
      cardId: "card-1",
      state: "TX",
      product: "TA",
      receiptStatus: "missing",
      anomalyOnly: true,
    });
    expect(clause.params).toEqual([
      dateFrom,
      dateTo,
      "invoice-1",
      "driver-1",
      "truck-1",
      "card-1",
      "TX",
      "TA",
      "missing",
    ]);
    // Every placeholder number matches the params array position exactly.
    for (let i = 1; i <= clause.params.length; i++) {
      expect(clause.whereSql).toContain(`$${i}`);
    }
  });

  it("no filter value is ever interpolated into the SQL text itself", () => {
    const clause = buildTransactionFilterClause({
      driverId: "'; DROP TABLE fuel_stops; --",
      state: "TX",
    });
    expect(clause.whereSql).not.toContain("DROP TABLE");
    expect(clause.whereSql).not.toContain("TX");
    expect(clause.params).toContain("'; DROP TABLE fuel_stops; --");
  });
});
