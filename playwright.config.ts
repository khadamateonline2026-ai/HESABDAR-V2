import { defineConfig } from "@playwright/test";

// E2E_BASE_URL runs the read-only smoke checks against a deployed site;
// without it a local preview (needs the app's auth env) is started.
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: external || "http://127.0.0.1:8080", headless: true },
  webServer: external
    ? undefined
    : {
        command: "npm run preview -- --host 127.0.0.1 --port 8080",
        port: 8080,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
