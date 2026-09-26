import { describe, expect, it } from "vitest";
import { decideAuthorization } from "./authorization";

describe("decideAuthorization", () => {
  it("redirects an anonymous page request to /signin", () => {
    expect(decideAuthorization("/", false)).toEqual({ redirectTo: "/signin" });
  });

  it("returns a 401 for an anonymous GET /api/v1/health, not a redirect", () => {
    expect(decideAuthorization("/api/v1/health", false)).toEqual({ problemStatus: 401 });
  });

  it("returns a 401 for an anonymous GET /api/v1/plans/{id}", () => {
    expect(decideAuthorization("/api/v1/plans/abc-123", false)).toEqual({ problemStatus: 401 });
  });

  it("lets an authenticated page request through", () => {
    expect(decideAuthorization("/", true)).toBeNull();
  });

  it("lets an authenticated /api/ request through", () => {
    expect(decideAuthorization("/api/v1/health", true)).toBeNull();
  });

  it("lets an anonymous visit to /signin through", () => {
    expect(decideAuthorization("/signin", false)).toBeNull();
  });

  it("redirects an authenticated visit to /signin back to /", () => {
    expect(decideAuthorization("/signin", true)).toEqual({ redirectTo: "/" });
  });
});
