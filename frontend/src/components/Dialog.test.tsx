// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dialog from "./Dialog";

afterEach(cleanup);

describe("Dialog (T-67)", () => {
  it("is a named modal dialog around its children", () => {
    render(
      <Dialog label="Exchange rate" onClose={() => undefined}>
        <p>inside</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Exchange rate" }).textContent).toBe("inside");
  });

  it("Escape and a click on the backdrop dismiss it; a click inside does not", () => {
    const onClose = vi.fn();
    render(
      <Dialog label="x" onClose={onClose} backdropTestId="backdrop">
        <p>inside</p>
      </Dialog>,
    );
    fireEvent.mouseDown(screen.getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId("backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
