import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Each integration test file opens two `pg.Pool`s (an admin pool and a
    // schema-scoped one). Vitest's default worker count runs enough files
    // at once that their combined connections can exhaust Postgres faster
    // than it reclaims them, crashing a worker outright rather than failing
    // a single test — observed locally as an intermittent "Worker exited
    // unexpectedly". Capping fork concurrency keeps the full suite
    // (`npm test`, unit + integration) reliably green; unit tests are cheap
    // enough that the reduced parallelism costs nothing noticeable.
    pool: "forks",
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 2,
      },
    },
  },
});
