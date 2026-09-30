// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ParsingState from "./ParsingState";

afterEach(cleanup);

describe("ParsingState (T-42 step 42.1)", () => {
  it("shows the file name and row count once known", () => {
    render(<ParsingState fileName="invoice_100001.csv" rowCount={605} />);
    const text = screen.getByTestId("parsing-state").textContent!;
    expect(text).toContain("invoice_100001.csv");
    expect(text).toContain("605 rows");
  });

  it("shows progress without a row count before it's known (e.g. a PDF)", () => {
    render(<ParsingState fileName="BVD_invoice_999210.pdf" rowCount={null} />);
    const text = screen.getByTestId("parsing-state").textContent!;
    expect(text).toContain("BVD_invoice_999210.pdf");
    expect(text).not.toContain("rows");
  });
});
