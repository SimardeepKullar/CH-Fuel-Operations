// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AnomalyFlag from "./AnomalyFlag";

afterEach(cleanup);

describe("AnomalyFlag", () => {
  it("renders a red flag with the red severity treatment", () => {
    render(<AnomalyFlag flag={{ rule: "sub_gallon", severity: "red" }} />);
    const el = screen.getByText("Sub-gal");
    expect(el.getAttribute("data-severity")).toBe("red");
    expect(el.className).toContain("anomaly-flag-red");
  });

  it("renders an amber flag with the amber severity treatment", () => {
    render(<AnomalyFlag flag={{ rule: "unit_mismatch", severity: "amber" }} />);
    const el = screen.getByText("Unit mismatch");
    expect(el.getAttribute("data-severity")).toBe("amber");
    expect(el.className).toContain("anomaly-flag-amber");
  });

  it("renders charges_no_fuel as 'Scale', not 'No fuel'", () => {
    render(<AnomalyFlag flag={{ rule: "charges_no_fuel", severity: "amber" }} />);
    const el = screen.getByText("Scale");
    expect(el.getAttribute("data-severity")).toBe("amber");
    expect(el.className).toContain("anomaly-flag-amber");
  });

  it("humanizes an unmapped rule slug rather than rendering nothing", () => {
    render(<AnomalyFlag flag={{ rule: "some_new_rule", severity: "amber" }} />);
    expect(screen.getByText("some new rule")).toBeTruthy();
  });
});
