// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Popover from "./Popover";

afterEach(cleanup);

function setup() {
  render(
    <>
      <Popover trigger="More" triggerClassName="t" panelLabel="More filters" panelClassName="p">
        <select aria-label="Card" />
      </Popover>
      <button>elsewhere</button>
    </>,
  );
  return screen.getByRole("button", { name: "More" });
}

describe("Popover (T-87)", () => {
  it("toggles from its button, with aria-expanded and aria-controls following", () => {
    const button = setup();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe(screen.getByRole("dialog", { name: "More filters" }).id);
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves focus into the panel on opening", () => {
    fireEvent.click(setup());
    expect(document.activeElement).toBe(screen.getByLabelText("Card"));
  });

  it("Escape closes it and returns focus to the button", () => {
    const button = setup();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByLabelText("Card"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("a click outside closes it; a click inside does not", () => {
    fireEvent.click(setup());
    fireEvent.pointerDown(screen.getByLabelText("Card"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.pointerDown(screen.getByText("elsewhere"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tabbing out closes it", () => {
    fireEvent.click(setup());
    fireEvent.blur(screen.getByLabelText("Card"), { relatedTarget: screen.getByText("elsewhere") });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
