import { defineConfig } from "vitest/config";

// Vitest runs only the unit tests. The Playwright smoke (*.spec.js) needs a live
// backend and is excluded so it is never collected here.
export default defineConfig({
  test: {
    include: ["test/**/*.test.js"],
    exclude: ["test/**/*.spec.js", "node_modules/**"],
  },
});
