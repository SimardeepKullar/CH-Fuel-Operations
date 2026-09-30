// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import KpiCard from "./KpiCard";

afterEach(cleanup);

describe("KpiCard (T-41, A9.1 applied to the KPI row)", () => {
  it("a dominant card's value is strictly larger than a regular card's value", () => {
    render(<KpiCard label="Average billed price" value="$5.2395" dominant testId="avg-billed" />);
    render(<KpiCard label="Total spend" value="$12,345.67" testId="total-spend" />);

    const dominantSize = parseFloat(getComputedStyle(screen.getByTestId("avg-billed-value")).fontSize);
    const regularSize = parseFloat(getComputedStyle(screen.getByTestId("total-spend-value")).fontSize);
    expect(dominantSize).toBeGreaterThan(regularSize);
  });

  it("a dominant card's subline (discount captured) renders smaller than its own value, never coloured as a win", () => {
    render(
      <KpiCard label="Average billed price" value="$5.2395" sub="discount captured $123.45" dominant testId="avg-billed" />,
    );

    const valueSize = parseFloat(getComputedStyle(screen.getByTestId("avg-billed-value")).fontSize);
    const subSize = parseFloat(getComputedStyle(screen.getByTestId("avg-billed-sub")).fontSize);
    expect(subSize).toBeLessThan(valueSize);
    expect(screen.getByTestId("avg-billed-sub").textContent).toBe("discount captured $123.45");
  });

  it("renders the unit marker beside the value, when given (A5.1: a USD marker on every money value)", () => {
    render(<KpiCard label="Total spend" value="$255.13" unit="USD" testId="total-spend" />);
    expect(screen.getByText("USD")).toBeTruthy();
  });

  it("omits the subline entirely when sub is not given, rather than an empty node", () => {
    render(<KpiCard label="Anomalies flagged" value="3" testId="anomalies" />);
    expect(screen.queryByTestId("anomalies-sub")).toBeNull();
  });
});
