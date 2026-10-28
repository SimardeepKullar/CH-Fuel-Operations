import { describe, expect, it } from "vitest";
import { applySessionUser, applyUserToToken } from "./sessionCallbacks";

describe("session callbacks", () => {
  it("carries the user's id and role from sign-in into the token", () => {
    const token = applyUserToToken<{ sub?: string; role?: string }>({}, { id: "u-1", role: "dispatcher" });
    expect(token.sub).toBe("u-1");
    expect(token.role).toBe("dispatcher");
  });

  it("leaves the token alone on a later request, when there is no user", () => {
    const token = { sub: "u-1", role: "dispatcher" };
    expect(applyUserToToken(token, undefined)).toEqual(token);
  });

  // The receipt routes read `session.user.id` as `checked_by`; without it they 401 a signed-in dispatcher.
  it("puts the token's id on session.user, so a signed-in request has an identity", () => {
    const session = { user: { email: "d@example.com", name: "D", role: "" as string, id: "" } };
    const out = applySessionUser(session, { sub: "u-1", role: "dispatcher" });
    expect(out.user.id).toBe("u-1");
    expect(out.user.role).toBe("dispatcher");
  });

  it("an id-less token yields an empty id, which the route treats as signed out", () => {
    const session = { user: { email: "d@example.com", name: "D", role: "", id: "" } };
    const out = applySessionUser(session, {});
    expect(out.user.id).toBe("");
    expect(out.user.role).toBe("dispatcher");
  });
});
