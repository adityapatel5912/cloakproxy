import { defineConfig } from "@playwright/test";

/**
 * E2E runs a headed Chromium with the unpacked dist/ extension loaded.
 * Side panels cannot be automated directly, so specs open the extension page
 * (chrome-extension://<id>/sidepanel.html) as a normal tab — it is the same
 * React workbench and the same Firebase context as the real side panel.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    headless: true,
    viewport: { width: 420, height: 900 }, // realistic side-panel width
    screenshot: "only-on-failure",
  },
});
