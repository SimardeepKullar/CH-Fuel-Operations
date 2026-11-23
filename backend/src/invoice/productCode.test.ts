import { describe, expect, it } from "vitest";
import { codesForProductOf } from "./productCode.js";

describe("codesForProductOf (T-130)", () => {
  it("either DEF code yields both, so a DEF filter matches DE lines too", () => {
    expect(codesForProductOf("DF")).toEqual(["DF", "DE"]);
    expect(codesForProductOf("DE")).toEqual(["DF", "DE"]);
  });

  it("a code that is its product's only spelling yields itself", () => {
    expect(codesForProductOf("TA")).toEqual(["TA"]);
    expect(codesForProductOf("S")).toEqual(["S"]);
  });

  it("an unknown code matches only itself, never a guessed product", () => {
    expect(codesForProductOf("ZZ")).toEqual(["ZZ"]);
  });
});
