import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8787",
    headless: true,
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 8787",
    port: 8787,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
