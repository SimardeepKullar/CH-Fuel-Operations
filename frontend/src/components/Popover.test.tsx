// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("Popover placement (T-87)", () => {
  function place(buttonLeft: number, buttonRight: number, viewport: number, panelWidth: number) {
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: viewport });
    const offset = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(panelWidth);
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: buttonLeft, right: buttonRight, bottom: 100 } as DOMRect);
    fireEvent.click(setup());
    const left = screen.getByRole("dialog").style.left;
    offset.mockRestore();
    rect.mockRestore();
    return left;
  }

  it("opens under the button's left edge when it fits", () => {
    expect(place(100, 180, 1000, 190)).toBe("100px");
  });

  it("lines up with the button's right edge when it would pass the visible width", () => {
    expect(place(1100, 1180, 1200, 190)).toBe("990px");
  });

  it("never starts off the left of the screen", () => {
    expect(place(20, 100, 200, 190)).toBe("8px");
  });
});
