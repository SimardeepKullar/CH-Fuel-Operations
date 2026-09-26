import { describe, expect, it } from "vitest";
import { startServeCli } from "./serve.js";

/** `/health` needs no database to return 200 — it degrades `db.reachable`
 * to `false` instead of requiring one — so this stays a pure smoke test with
 * no DATABASE_URL required, unlike the API paths serve.ts also exposes.
 * It asserts the response's shape, not exact values: whether the DB/provider
 * are actually reachable here depends on the environment this test runs in. */
describe("startServeCli", () => {
  it("mounts createApp({ authRequired: false }) as a real HTTP server with no session check", async () => {
    const port = 34567 + Math.floor(Math.random() * 1000);
    const server = startServeCli(port);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", () => resolve());
        server.once("error", reject);
      });

      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { db: { reachable: boolean }; latestSheetDate: unknown; latestInvoicePeriod: unknown };
      expect(typeof body.db.reachable).toBe("boolean");
      expect(body).toHaveProperty("latestSheetDate");
      expect(body).toHaveProperty("latestInvoicePeriod");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("binds 127.0.0.1 and returns RFC 9457 problem+json for an unknown route, same as authRequired: true", async () => {
    const port = 35567 + Math.floor(Math.random() * 1000);
    const server = startServeCli(port);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", () => resolve());
        server.once("error", reject);
      });

      const response = await fetch(`http://127.0.0.1:${port}/api/v1/nope`);
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      const body = (await response.json()) as { title: string };
      expect(body.title).toBe("Not Found");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
