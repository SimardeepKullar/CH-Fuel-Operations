// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import RawResolved from "./RawResolved";

afterEach(cleanup);

describe("RawResolved", () => {
  it("resolved state: shows the resolved value in the resolved treatment, raw hidden by default", () => {
    render(<RawResolved value={{ resolved: "072", raw: "072", agrees: true }} />);
    const el = screen.getByText("072");
    expect(el.closest("[data-state]")?.getAttribute("data-state")).toBe("resolved");
    expect(document.querySelector(".rr-raw")).toBeNull();
  });

  it("resolved state with showRawWhenAgreeing: also shows the raw value in the raw treatment", () => {
    render(<RawResolved value={{ resolved: "072", raw: "072", agrees: true }} showRawWhenAgreeing />);
    expect(document.querySelector(".rr-value")?.textContent).toBe("072");
    expect(document.querySelector(".rr-raw")?.textContent).toBe("072");
  });

  it("disagreeing state: shows both the resolved and raw values, and the ≠ marker", () => {
    render(<RawResolved value={{ resolved: "072", raw: "0", agrees: false }} />);
    const wrapper = document.querySelector('[data-state="disagreeing"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.textContent).toContain("072");
    expect(wrapper!.textContent).toContain("≠0");
  });

  it("unmatched state (resolved === null): shows raw alone in the raw treatment, not a guess", () => {
    render(<RawResolved value={{ resolved: null, raw: "J SMITH", agrees: null }} />);
    const el = screen.getByText("J SMITH");
    expect(el.getAttribute("data-state")).toBe("unmatched");
    expect(el.className).toContain("rr-unmatched");
  });

  it("rawOnly forces the raw treatment even when a resolved value exists", () => {
    render(<RawResolved value={{ resolved: "072", raw: "072", agrees: true }} rawOnly />);
    const el = screen.getByText("072");
    expect(el.getAttribute("data-state")).toBe("unmatched");
  });
});
