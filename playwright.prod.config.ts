import { defineConfig, devices } from "@playwright/test";

const PROD_PORT = process.env.PROD_PORT || "3005";
const BASE_URL = `http://127.0.0.1:${PROD_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /production-smoke\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [
    ["html", { outputFolder: "playwright-report-prod", open: "never" }],
    [process.env.CI ? "github" : "list"],
  ],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },

  projects: [
    {
      name: "Desktop Chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  webServer: {
    command: "node .next/standalone/server.js",
    url: BASE_URL,
    env: {
      PORT: PROD_PORT,
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
