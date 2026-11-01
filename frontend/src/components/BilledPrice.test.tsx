// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import BilledPrice from "./BilledPrice";

afterEach(cleanup);

describe("BilledPrice", () => {
  it("renders the billed price at 4dp — 5.24 never appears where 5.2395 is the value", () => {
    render(<BilledPrice billedPerUnit={5.2395} currency="USD" />);
    const text = screen.getByTestId("billed-price-value").textContent;
    expect(text).toBe("US$5.2395");
    expect(text).not.toBe("US$5.24");
  });

  it("prints no discount line — the price stands alone (T-80)", () => {
    render(<BilledPrice billedPerUnit={5.2395} currency="USD" />);
    expect(screen.queryByTestId("billed-price-discount")).toBeNull();
    expect(document.body.textContent).not.toContain("disc");
  });

  it("renders em dashes, never 0 or $0.00, when the stop carries no TA line", () => {
    render(<BilledPrice billedPerUnit={null} currency="USD" />);
    expect(screen.getByTestId("billed-price-value").textContent).toBe("—");
  });

  it("a CAD price carries CA$, not a bare dollar sign", () => {
    render(<BilledPrice billedPerUnit={1.9046} currency="CAD" />);
    expect(screen.getByTestId("billed-price-value").textContent).toBe("CA$1.9046");
  });

  it("applies tabular figures to the billed numeral", () => {
    render(<BilledPrice billedPerUnit={5.2395} currency="USD" />);
    expect(getComputedStyle(screen.getByTestId("billed-price-value")).fontVariantNumeric).toBe("tabular-nums");
  });
});
