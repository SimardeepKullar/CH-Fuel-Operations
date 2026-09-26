import { describe, expect, it } from "vitest";
import { problemResponse } from "./problem.js";

describe("problemResponse", () => {
  it("serves application/problem+json at the given status", async () => {
    const response = problemResponse({ title: "Not Found", status: 404, detail: "no route" });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    await expect(response.json()).resolves.toEqual({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "no route",
    });
  });

  it("defaults type to about:blank when not given", async () => {
    const response = problemResponse({ title: "Oops", status: 500 });
    const body = (await response.json()) as { type: string };
    expect(body.type).toBe("about:blank");
  });
});
