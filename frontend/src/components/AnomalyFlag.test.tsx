// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AnomalyFlag, { describeFlag, FILTERABLE_FLAGS, flagDescription } from "./AnomalyFlag";

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

  it("renders no_truck_on_file as 'No truck', amber, with its description and the entered unit", () => {
    render(<AnomalyFlag flag={{ rule: "no_truck_on_file", severity: "amber" }} enteredUnit="2" />);
    const el = screen.getByText("No truck");
    expect(el.getAttribute("data-severity")).toBe("amber");
    expect(el.className).toContain("anomaly-flag-amber");
    expect(el.getAttribute("title")).toBe("No truck on file for this driver on this date — entered 2");
  });

  it("omits the entered unit from the hover when there is none", () => {
    render(<AnomalyFlag flag={{ rule: "no_truck_on_file", severity: "amber" }} />);
    expect(screen.getByText("No truck").getAttribute("title")).toBe("No truck on file for this driver on this date");
  });

  it("describes the flag for the Flagged hover", () => {
    expect(describeFlag("no_truck_on_file")).toBe("No truck: No truck on file for this driver on this date");
    expect(flagDescription("no_truck_on_file")).toBe("No truck on file for this driver on this date");
  });

  it("offers No truck as a filterable flag", () => {
    expect(FILTERABLE_FLAGS).toContainEqual({ value: "no_truck_on_file", label: "No truck" });
    expect(FILTERABLE_FLAGS).toContainEqual({ value: "unit_not_entered", label: "Unit not entered" });
  });

  it("humanizes an unmapped rule slug rather than rendering nothing", () => {
    render(<AnomalyFlag flag={{ rule: "some_new_rule", severity: "amber" }} />);
    expect(screen.getByText("some new rule")).toBeTruthy();
  });
});
