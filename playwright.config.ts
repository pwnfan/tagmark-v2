import { defineConfig } from "@playwright/test";

// Chrome action popups use the "other" target type, so attach to their real UI.
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = "1";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  expect: { timeout: 5_000 },
  workers: 1,
  reporter: "list",
});
