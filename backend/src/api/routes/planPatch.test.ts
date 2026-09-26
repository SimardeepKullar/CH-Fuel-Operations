import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { handlePatchPlan } from "./planPatch.js";

/** Fails the test the moment anything on it is called — proves a 400/404
 * from request validation never reaches the database (mirrors plans.test.ts). */
const untouchedPool = new Proxy(
  {},
  {
    get(): never {
      throw new Error("route touched the database before request validation finished");
    },
  },
) as Pool;

const USER_ID = "22222222-2222-2222-2222-222222222222";

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/plans/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function problemOf(response: Response): Promise<{ title: string; status: number; detail?: string }> {
  expect(response.headers.get("content-type")).toBe("application/problem+json");
  return (await response.json()) as { title: string; status: number; detail?: string };
}

describe("handlePatchPlan: request validation, before anything is touched", () => {
  it("returns 404 problem+json for a non-uuid id without touching the database", async () => {
    const response = await handlePatchPlan(
      untouchedPool,
      "not-a-uuid",
      patchRequest({ sentToDriver: true }),
      new URL("http://localhost/api/v1/plans/not-a-uuid"),
      USER_ID,
    );
    expect(response.status).toBe(404);
    expect((await problemOf(response)).title).toBe("Not Found");
  });

  it("rejects a non-JSON body as 400 without touching the database", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const request = new Request(`http://localhost/api/v1/plans/${id}`, { method: "PATCH", body: "not json" });
    const response = await handlePatchPlan(untouchedPool, id, request, new URL(request.url), USER_ID);
    expect(response.status).toBe(400);
    expect((await problemOf(response)).title).toBe("Bad Request");
  });

  it("rejects a body missing sentToDriver as 400 without touching the database", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const response = await handlePatchPlan(untouchedPool, id, patchRequest({}), new URL(`http://localhost/api/v1/plans/${id}`), USER_ID);
    expect(response.status).toBe(400);
  });

  it("rejects sentToDriver as a non-boolean as 400 without touching the database", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const response = await handlePatchPlan(
      untouchedPool,
      id,
      patchRequest({ sentToDriver: "yes" }),
      new URL(`http://localhost/api/v1/plans/${id}`),
      USER_ID,
    );
    expect(response.status).toBe(400);
  });

  it("rejects an unknown key alongside sentToDriver as 400 (strict schema)", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const response = await handlePatchPlan(
      untouchedPool,
      id,
      patchRequest({ sentToDriver: true, dispatchedBy: USER_ID }),
      new URL(`http://localhost/api/v1/plans/${id}`),
      USER_ID,
    );
    expect(response.status).toBe(400);
  });
});
