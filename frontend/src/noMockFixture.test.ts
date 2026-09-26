import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T-21 step 21.2: "Grep proves no component imports a local fixture."
 * `frontend/src/data/trips.ts` was a design artefact (T-04), never a stub —
 * it is deleted, and no component may import it (or any replacement under
 * `data/`) again.
 */
const COMPONENT_FILES = [
  "components/Sidebar.tsx",
  "components/TopBar.tsx",
  "components/PlanTab.tsx",
  "components/RecentTab.tsx",
  "components/DevToolsTab.tsx",
  "components/RouteMap.tsx",
  "app/(app)/page.tsx",
];

describe("no component reads from a local fixture", () => {
  for (const file of COMPONENT_FILES) {
    it(`${file} does not import from ../data/trips or ./data/trips`, () => {
      const source = readFileSync(join(import.meta.dirname, file), "utf8");
      expect(source).not.toMatch(/data\/trips/);
    });
  }
});
