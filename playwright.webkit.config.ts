/**
 * iPhone Safari-engine (WebKit) checks — `npx playwright test -c playwright.webkit.config.ts`.
 *
 * Runs e2e/iphone/*.webkit.ts on Playwright WebKit with iPhone device profiles
 * (touch, mobile viewport, device scale factor). Requires the WebKit browser:
 * `npx playwright install webkit` (+ `install-deps webkit` on Linux). Playwright
 * WebKit is the Safari engine but not iOS Safari itself; text autosizing and
 * real-device chrome still need a physical-device check in independent QA.
 */
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e/iphone",
  testMatch: "**/*.webkit.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: BASE_URL, trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "iPhone 320 (Display Zoom)", use: { ...devices["iPhone 13 Mini"], viewport: { width: 320, height: 568 } } },
    { name: "iPhone 375", use: { ...devices["iPhone 13 Mini"] } },
    { name: "iPhone 390", use: { ...devices["iPhone 14"] } },
    { name: "iPhone 430", use: { ...devices["iPhone 14 Pro Max"] } },
  ],
  ...(BASE_URL.includes("localhost") ? { webServer: { command: "npm run dev", url: BASE_URL, reuseExistingServer: true, timeout: 180_000 } } : {}),
});
