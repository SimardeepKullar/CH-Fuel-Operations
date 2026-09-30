// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuarantineScreen, { type QuarantineRejection } from "./QuarantineScreen";

afterEach(cleanup);

const REJECTIONS: QuarantineRejection[] = [
  {
    lineNumber: 12,
    authCode: "B100002-DF",
    code: "AMOUNT_IMBALANCE",
    message: "DF: expected 2250 cents, parsed 2350 cents (delta 100)",
  },
  {
    lineNumber: 0,
    authCode: null,
    code: "GRAND_TOTAL_IMBALANCE",
    message: "grand total: expected 84067 cents, parsed 84167 cents (delta 100)",
  },
];

describe("QuarantineScreen (T-42 step 42.2)", () => {
  it("names the failing code(s), the offending row, auth code, and expected-vs-parsed detail", () => {
    render(<QuarantineScreen invoiceNumber="100002" rejections={REJECTIONS} />);
    const text = screen.getByTestId("quarantine-screen").textContent!;
    expect(text).toContain("100002");
    expect(text).toContain("Amount imbalance");
    expect(text).toContain("12");
    expect(text).toContain("B100002-DF");
    expect(text).toContain("expected 2250 cents, parsed 2350 cents");
    expect(text).toContain("Grand total imbalance");
  });

  it("states plainly that nothing was written", () => {
    render(<QuarantineScreen invoiceNumber="100002" rejections={REJECTIONS} />);
    expect(screen.getByTestId("quarantine-nothing-written").textContent!.toLowerCase()).toContain(
      "nothing was written",
    );
  });

  it("offers a way back to history when given one, and omits it otherwise", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <QuarantineScreen invoiceNumber="100002" rejections={REJECTIONS} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByTestId("quarantine-back"));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(<QuarantineScreen invoiceNumber="100002" rejections={REJECTIONS} />);
    expect(screen.queryByTestId("quarantine-back")).toBeNull();
  });
});
