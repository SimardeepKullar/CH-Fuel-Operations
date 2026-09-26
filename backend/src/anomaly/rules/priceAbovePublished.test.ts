import { describe, expect, it } from "vitest";
import {
  priceAbovePublished,
  publishedPriceKey,
  toAnomalyFinding,
  type PriceAbovePublishedConfig,
  type PriceAbovePublishedStop,
} from "./priceAbovePublished.js";

const CONFIG: PriceAbovePublishedConfig = { maxOverageUsdPerGal: "0.10", fuelProductCode: "TA" };

describe("priceAbovePublished", () => {
  it("reports not_computable — never 'no anomaly' — when no published price file exists for the date (999210)", () => {
    const stops: PriceAbovePublishedStop[] = [
      { id: "stop-jan11", stationId: "station-1", occurredOn: "2026-01-11", billedUsdPerGal: "5.2395" },
    ];

    const results = priceAbovePublished(stops, new Map(), CONFIG);

    expect(results).toEqual([
      {
        status: "not_computable",
        subjectId: "stop-jan11",
        reason: "no published price for this station on 2026-01-11",
      },
    ]);
  });

  it("reports not_computable when the station itself never resolved", () => {
    const stops: PriceAbovePublishedStop[] = [
      { id: "stop-unresolved", stationId: null, occurredOn: "2026-09-04", billedUsdPerGal: "5.2395" },
    ];

    expect(priceAbovePublished(stops, new Map(), CONFIG)).toEqual([
      { status: "not_computable", subjectId: "stop-unresolved", reason: "station did not resolve" },
    ]);
  });

  it("flags a billed price materially above the published price", () => {
    const stops: PriceAbovePublishedStop[] = [
      { id: "stop-over", stationId: "station-1", occurredOn: "2026-09-04", billedUsdPerGal: "5.5000" },
    ];
    const published = new Map([[publishedPriceKey("station-1", "2026-09-04"), "5.2000"]]);

    const results = priceAbovePublished(stops, published, CONFIG);
    expect(results).toEqual([
      {
        status: "flagged",
        subjectId: "stop-over",
        severity: "red",
        detail: {
          billedUsdPerGal: "5.5000",
          publishedUsdPerGal: "5.2000",
          overage: expect.closeTo(0.3, 5),
          maxOverageUsdPerGal: "0.10",
        },
      },
    ]);
    const [result] = results;
    expect(toAnomalyFinding(result!)).toEqual({
      subjectType: "fuel_stop",
      subjectId: "stop-over",
      severity: "red",
      detail: (result as { detail: Record<string, unknown> }).detail,
    });
  });

  it("clears (no result) when billed matches the published price within tolerance", () => {
    const stops: PriceAbovePublishedStop[] = [
      { id: "stop-ok", stationId: "station-1", occurredOn: "2026-09-04", billedUsdPerGal: "5.2050" },
    ];
    const published = new Map([[publishedPriceKey("station-1", "2026-09-04"), "5.2000"]]);

    expect(priceAbovePublished(stops, published, CONFIG)).toEqual([]);
  });

  it("skips a stop with no diesel line rather than reporting it not_computable", () => {
    const stops: PriceAbovePublishedStop[] = [
      { id: "stop-scale-only", stationId: "station-1", occurredOn: "2026-09-04", billedUsdPerGal: null },
    ];

    expect(priceAbovePublished(stops, new Map(), CONFIG)).toEqual([]);
  });

  it("toAnomalyFinding returns null for a not_computable result", () => {
    expect(
      toAnomalyFinding({ status: "not_computable", subjectId: "x", reason: "no data" }),
    ).toBeNull();
  });
});
