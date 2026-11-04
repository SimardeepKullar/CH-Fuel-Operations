import { describe, expect, it } from "vitest";
import { orphanedMigrationsMessage } from "./migrate.js";

describe("orphanedMigrationsMessage (T-100)", () => {
  const orphaned = ["0003_squashed_away.sql"];

  it("suggests db:reset only for a target the guard would let it destroy", () => {
    const message = orphanedMigrationsMessage(orphaned, "migrations/synthetic", "postgres://ch_fuel:ch_fuel@localhost:5433/ch_fuel_dev", {});
    expect(message).toMatch(/0003_squashed_away\.sql/);
    expect(message).toMatch(/npm run db:reset/);
  });

  it.each([
    ["a Neon database", "postgresql://u:p@ep-x.us-east-1.aws.neon.tech/neondb", {}],
    ["APP_ENV=production", "postgres://ch_fuel:ch_fuel@localhost:5433/ch_fuel_dev", { APP_ENV: "production" }],
    ["the legacy ch_fuel_planner", "postgres://ch_fuel:ch_fuel@localhost:5433/ch_fuel_planner", {}],
  ])("tells the operator not to reset %s", (_label, url, env) => {
    const message = orphanedMigrationsMessage(orphaned, "migrations/real", url, env);
    expect(message).toMatch(/0003_squashed_away\.sql/);
    expect(message).not.toMatch(/npm run db:reset/);
    expect(message).toMatch(/do not reset/i);
    expect(message).not.toContain(":p@");
  });
});
