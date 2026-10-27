// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PageBanner from "./PageBanner";
import SegmentedControl from "./SegmentedControl";
import { CodeBadge, GhostButton, StripChip, SubStrip } from "./SubStrip";

afterEach(cleanup);

describe("PageBanner", () => {
  it("renders the title, controls, readout and meta, and omits what it is not given", () => {
    render(<PageBanner title="Overview" controls={<span>ctl</span>} readout="All time" meta={<a href="#x">Edit rates</a>} />);
    expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(screen.getByText("ctl")).toBeTruthy();
    expect(screen.getByText("All time")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit rates" })).toBeTruthy();

    cleanup();
    const { container } = render(<PageBanner title="Import" />);
    expect(container.querySelector(".pb-controls, .pb-readout, .pb-meta")).toBeNull();
  });
});

describe("SegmentedControl", () => {
  it("marks the selected option, adds the arrow to a dropdown option, and reports a choice", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Scope"
        value="all"
        onChange={onChange}
        options={[
          { value: "all", label: "All time" },
          { value: "week", label: "Billing week", dropdown: true },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "All time" }).getAttribute("aria-pressed")).toBe("true");
    const week = screen.getByRole("button", { name: "Billing week ▾" });
    expect(week.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(week);
    expect(onChange).toHaveBeenCalledWith("week");
  });
});

describe("SubStrip", () => {
  it("lays out a label, chips with code badges, an absent chip and a ghost button", () => {
    render(
      <SubStrip label="Invoices in view">
        <StripChip>
          <CodeBadge code="US" />
          999210
        </StripChip>
        <StripChip absent>
          <CodeBadge code="CA" absent />
          No Canadian invoice this week
        </StripChip>
        <GhostButton>Show all</GhostButton>
      </SubStrip>,
    );
    expect(screen.getByText("Invoices in view")).toBeTruthy();
    expect(screen.getByText("No Canadian invoice this week").className).toContain("ss-chip-absent");
    expect(screen.getByText("US").className).toContain("ss-badge-us");
    expect(screen.getByText("CA").className).toContain("ss-badge-absent");
    expect(screen.getByRole("button", { name: "Show all" })).toBeTruthy();
  });
});
