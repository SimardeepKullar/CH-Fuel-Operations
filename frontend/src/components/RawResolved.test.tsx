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

  it('primary="raw", resolved state: shows the raw value as primary, resolved as the secondary line', () => {
    render(<RawResolved value={{ resolved: "072", raw: "072R", agrees: true }} showRawWhenAgreeing primary="raw" />);
    expect(document.querySelector(".rr-value")?.textContent).toBe("072R");
    expect(document.querySelector(".rr-raw")?.textContent).toBe("072");
  });

  it('primary="raw", disagreeing state: shows the raw (pumped) value as primary and ≠assigned truck as secondary', () => {
    render(<RawResolved value={{ resolved: "072", raw: "0", agrees: false }} primary="raw" />);
    const wrapper = document.querySelector('[data-state="disagreeing"]');
    expect(wrapper).not.toBeNull();
    expect(document.querySelector(".rr-disagree-value")?.textContent).toBe("0");
    expect(document.querySelector(".rr-disagree-raw")?.textContent).toBe("≠072");
  });

  it('primary="raw" does not change the unmatched state (raw alone either way)', () => {
    render(<RawResolved value={{ resolved: null, raw: "J SMITH", agrees: null }} primary="raw" />);
    const el = screen.getByText("J SMITH");
    expect(el.getAttribute("data-state")).toBe("unmatched");
  });

  it("primary defaults to resolved, leaving the Driver column's rendering unchanged", () => {
    render(<RawResolved value={{ resolved: "072", raw: "0", agrees: false }} />);
    expect(document.querySelector(".rr-disagree-value")?.textContent).toBe("072");
    expect(document.querySelector(".rr-disagree-raw")?.textContent).toBe("≠0");
  });
});
