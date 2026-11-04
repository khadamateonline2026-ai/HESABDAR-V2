import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:8080", headless: true },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 8080",
    port: 8080,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
