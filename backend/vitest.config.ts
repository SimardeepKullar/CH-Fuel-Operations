import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // A worker that dies mid-file never reaches its afterEach, so its
    // throwaway schema outlives the run. Sweep them before any file starts.
    globalSetup: ["test/support/sweepStaleSchemas.ts"],
    // The intermittent "Worker exited unexpectedly" (T-50) was not Postgres
    // connection exhaustion: Postgres logged no FATAL, and max_connections
    // is 100. The workers were aborting natively (exit 0xC0000409) under
    // Node 24 on Windows — 9 of 13 full runs — and never under Node 22, the
    // version .nvmrc and CI pin (0 of 10). scripts/check-node.mjs now fails
    // the git hooks on a mismatch. Two forks is what that clean Node 22
    // measurement ran with; unit tests are cheap enough that the cap costs
    // nothing noticeable.
    pool: "forks",
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 2,
      },
    },
  },
});
