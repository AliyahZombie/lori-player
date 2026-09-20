import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:1420",
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    viewport: { width: 840, height: 720 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
  },
});
