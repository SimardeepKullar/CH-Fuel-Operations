// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import BilledPrice from "./BilledPrice";

afterEach(cleanup);

describe("BilledPrice", () => {
  it("the billed price's font size is strictly larger than the discount's (A9.1)", () => {
    render(<BilledPrice billedUsdPerGal={5.2395} retailUsdPerGal={5.499} />);
    const valueSize = parseFloat(getComputedStyle(screen.getByTestId("billed-price-value")).fontSize);
    const discountSize = parseFloat(getComputedStyle(screen.getByTestId("billed-price-discount")).fontSize);
    expect(valueSize).toBeGreaterThan(discountSize);
  });

  it("renders the billed price at 4dp — 5.24 never appears where 5.2395 is the value", () => {
    render(<BilledPrice billedUsdPerGal={5.2395} retailUsdPerGal={5.499} />);
    const text = screen.getByTestId("billed-price-value").textContent;
    expect(text).toBe("$5.2395");
    expect(text).not.toBe("$5.24");
  });

  it("computes discount as retail minus billed, at 4dp", () => {
    render(<BilledPrice billedUsdPerGal={5.2395} retailUsdPerGal={5.499} />);
    expect(screen.getByTestId("billed-price-discount").textContent).toBe("disc $0.2595");
  });

  it("renders em dashes, never 0 or $0.00, when the stop carries no TA line", () => {
    render(<BilledPrice billedUsdPerGal={null} retailUsdPerGal={null} />);
    expect(screen.getByTestId("billed-price-value").textContent).toBe("—");
    expect(screen.getByTestId("billed-price-discount").textContent).toBe("disc —");
  });

  it("applies tabular figures to the billed numeral", () => {
    render(<BilledPrice billedUsdPerGal={5.2395} retailUsdPerGal={5.499} />);
    expect(getComputedStyle(screen.getByTestId("billed-price-value")).fontVariantNumeric).toBe("tabular-nums");
  });
});
