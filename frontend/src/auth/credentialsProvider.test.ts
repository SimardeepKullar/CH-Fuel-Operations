import { describe, expect, it, vi } from "vitest";

// authenticateUser's own DB lookup and its timing-safety property are
// covered by backend/test/integration/users.test.ts against a real
// database. This test only proves authorize() parses credentials and
// shapes authenticateUser's result the way NextAuth expects.
vi.mock("@ch/core/catalog/users", () => ({
  authenticateUser: vi.fn(async (_pool: unknown, email: string, password: string) => {
    if (email === "dispatch@ch-logistics.example" && password === "correct horse battery staple") {
      return { id: "u1", email, displayName: "M. Hodson", role: "dispatcher" };
    }
    return null;
  }),
}));
vi.mock("@ch/core/db/pool", () => ({ getPool: vi.fn() }));

const { authorize } = await import("./credentialsProvider");

describe("authorize()", () => {
  it("returns the user's identity for correct credentials", async () => {
    const result = await authorize({
      email: "dispatch@ch-logistics.example",
      password: "correct horse battery staple",
    });
    expect(result).toEqual({
      id: "u1",
      email: "dispatch@ch-logistics.example",
      name: "M. Hodson",
      role: "dispatcher",
    });
  });

  it("returns null for a wrong password", async () => {
    const result = await authorize({
      email: "dispatch@ch-logistics.example",
      password: "wrong password",
    });
    expect(result).toBeNull();
  });

  it("returns null for an unknown email without throwing", async () => {
    const result = await authorize({ email: "nobody@nowhere.example", password: "whatever" });
    expect(result).toBeNull();
  });

  it("returns null when credentials are missing, without throwing", async () => {
    await expect(authorize({})).resolves.toBeNull();
  });
});
