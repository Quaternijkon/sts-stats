import { defineConfig } from "@playwright/test";
import common from "./playwright.config";

export default defineConfig(common, {
  use: { ...common.use, baseURL: "http://127.0.0.1:1421/sts2stats/" },
  webServer: { command: "node scripts/serve-web.mjs", url: "http://127.0.0.1:1421/sts2stats/", reuseExistingServer: false, timeout: 30000 },
});
