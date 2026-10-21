import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/sync-e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
    { name: "android-chrome", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
  use: { baseURL: "http://127.0.0.1:18766", trace: "retain-on-failure" },
  webServer: { command: "node scripts/serve-sync-test.mjs", url: "http://127.0.0.1:18766/api/v1/health", reuseExistingServer: false },
});
