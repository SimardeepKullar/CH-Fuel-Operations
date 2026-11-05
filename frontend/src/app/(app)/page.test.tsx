import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => redirect(...args) }));

const { default: Home } = await import("./page");

describe("Home (T-107)", () => {
  it("redirects / to the Overview landing screen", () => {
    Home();
    expect(redirect).toHaveBeenCalledWith("/overview");
  });
});
