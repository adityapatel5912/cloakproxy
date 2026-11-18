import { defineConfig } from "vitest/config";

/** Separate Vitest config avoids Vite version duplication in plugin typing. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
