import { describe, expect, it } from "vitest";
import { displayCase } from "./transactions.js";

describe("displayCase", () => {
  it("title-cases all-caps text, keeps BVD, and leaves mixed case alone", () => {
    expect(displayCase("BVD MISSISSAUGA - SHAWSON")).toBe("BVD Mississauga - Shawson");
    expect(displayCase("MISSISSAUGA")).toBe("Mississauga");
    expect(displayCase("BVD Comber")).toBe("BVD Comber");
    expect(displayCase("")).toBe("");
  });
});
