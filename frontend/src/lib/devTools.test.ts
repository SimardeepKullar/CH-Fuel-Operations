import { describe, expect, it } from "vitest";
import { devToolsEnabled } from "./devTools";

describe("devToolsEnabled (T-104)", () => {
  it("is off in production and preview", () => {
    expect(devToolsEnabled("production")).toBe(false);
    expect(devToolsEnabled("preview")).toBe(false);
  });

  it("is on in development, real, test and when APP_ENV is unset", () => {
    expect(devToolsEnabled("development")).toBe(true);
    expect(devToolsEnabled("real")).toBe(true);
    expect(devToolsEnabled("test")).toBe(true);
    expect(devToolsEnabled(undefined)).toBe(true);
    expect(devToolsEnabled("")).toBe(true);
  });
});
