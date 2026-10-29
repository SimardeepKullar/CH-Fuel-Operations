import { defineConfig } from "vitest/config";

// A non-UTC zone, so a timestamp rendered in the viewer's zone when it should
// read as printed fails here and on CI alike (T-81). Under UTC the two agree
// and the bug passes unseen. Set before the workers fork, which inherit it.
process.env.TZ = "America/Toronto";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
