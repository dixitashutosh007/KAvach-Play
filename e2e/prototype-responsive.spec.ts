import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const SCREENSHOT_DIR = path.resolve(process.cwd(), "docs/qa/screenshots");

test.beforeAll(async () => {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
});

const REQUIRED_VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1440x900", width: 1440, height: 900 },
];

test.describe("KAvach Play — Prototype Responsive & Capabilities Suite", () => {
  for (const vp of REQUIRED_VIEWPORTS) {
    test(`renders and captures screenshot at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/prototype");
      await page.waitForLoadState("domcontentloaded");

      // Verify header and brand
      await expect(page.locator("h1", { hasText: "KAvach Play" })).toBeVisible();

      // Capture responsive screenshot
      const shotPath = path.join(SCREENSHOT_DIR, `prototype-${vp.name}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });
      expect(fs.existsSync(shotPath)).toBeTruthy();
    });
  }

  test("verifies all 5 player navigation destinations", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/prototype");

    // Ensure we are in Player mode
    await page.locator("button", { hasText: "View Player" }).first().click();

    // 1. Home Feed
    await page.locator("button", { hasText: "Home" }).first().click();
    await expect(page.getByText("Next Fixture").first()).toBeVisible();

    // 2. Matches Tab
    await page.locator("button", { hasText: "Matches" }).first().click();
    await expect(page.getByText("All Matches").first()).toBeVisible();
    await expect(page.getByText("KAvach Cricket Club vs Spartans CC").first()).toBeVisible();

    // 3. Payments Tab
    await page.locator("button", { hasText: "Payments" }).first().click();
    await expect(page.locator("text=Total Payable Obligations")).toBeVisible();
    await expect(page.locator("text=Waived per Club Policy (Option A)")).toBeVisible();

    // 4. Performance Tab
    await page.locator("button", { hasText: "Performance" }).first().click();
    await expect(page.locator("text=Player Performance & Career Stats")).toBeVisible();
    await expect(page.locator("text=Milestone Badges & Club Honors")).toBeVisible();

    // 5. Club Tab
    await page.locator("button", { hasText: "Club" }).first().click();
    await expect(page.locator("text=Club Experience & Member Services")).toBeVisible();
    await expect(page.locator("text=Official Player Card")).toBeVisible();
  });

  test("verifies all 7 administrator command hubs", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/prototype");

    // Switch to Admin mode
    await page.locator("button", { hasText: "View Admin (Console)" }).first().click();

    // 1. Overview Hub
    await page.locator("button", { hasText: "Overview" }).first().click();
    await expect(page.getByText("Next Match Readiness").first()).toBeVisible();

    // 2. Match Centre Hub
    await page.locator("button", { hasText: "Match Centre" }).first().click();
    await expect(page.locator("text=Match Centre & Squad Operations")).toBeVisible();
    // Test Match Hub Sub-tabs (Grounds & Tournaments)
    await page.locator("button", { hasText: "Grounds & Venues (MOD-10)" }).first().click();
    await expect(page.locator("text=Kavach Arena Ground 1")).toBeVisible();
    await page.locator("button", { hasText: "Tournaments & Leagues (MOD-17)" }).first().click();
    await expect(page.locator("text=Premier Cricket League 2026")).toBeVisible();

    // 3. Player Roster Hub
    await page.locator("button", { hasText: "Player Roster" }).first().click();
    await expect(page.locator("text=Club Player Roster & Memberships")).toBeVisible();

    // 4. Finance & Dues Hub
    await page.locator("button", { hasText: "Finance & Dues" }).first().click();
    await expect(page.locator("text=Finance & Collections Command")).toBeVisible();
    await expect(page.locator("text=Total Liquid Collected")).toBeVisible();

    // 5. Studio & Nets Hub
    await page.locator("button", { hasText: "Studio & Nets" }).first().click();
    await expect(page.locator("text=Studio & Nets Command")).toBeVisible();
    await expect(page.locator("text=Lane 1: Fast Bowling").first()).toBeVisible();

    // 6. Club Operations Hub
    await page.locator("button", { hasText: "Club Operations" }).first().click();
    await expect(page.locator("text=Club Operations & Member Hub")).toBeVisible();
    await expect(page.locator("text=Merchandise Order Pipeline")).toBeVisible();
    // Test interactive design studio canvas
    await page.locator("button", { hasText: "Open Studio Generator" }).first().click();
    await expect(page.locator("text=1. Select Matchday Template:")).toBeVisible();

    // 7. Settings & Access Hub
    await page.locator("button", { hasText: "Settings" }).first().click();
    await expect(page.locator("text=Governance, RBAC & Club Settings")).toBeVisible();
    await expect(page.locator("text=Granular RBAC Roles & Capabilities")).toBeVisible();
  });

  test("verifies major interactive workflows and simulation banners", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/prototype");

    // 1. One-tap RSVP interaction
    const tentativeBtn = page.locator("button", { hasText: "Tentative" }).first();
    if (await tentativeBtn.isVisible()) {
      await tentativeBtn.click();
      await expect(tentativeBtn).toHaveClass(/bg-amber-600/);
    }

    // 2. Open Match Details drawer
    await page.locator("button", { hasText: "Matches" }).first().click();
    await page.locator("article").first().click();
    await expect(page.getByText("Squad & Info").first()).toBeVisible();
    await page.locator('button[aria-label="Close match details"]').first().click();
    await expect(page.locator('button[aria-label="Close match details"]')).not.toBeVisible();

    // 3. Payment simulation
    await page.locator("button", { hasText: "Payments" }).first().click();
    const payBtn = page.locator("button", { hasText: "Pay Full Balance" }).first();
    if (await payBtn.isVisible()) {
      await payBtn.click();
      await expect(page.locator("text=Razorpay Secure Checkout")).toBeVisible();
      await page.locator("button", { hasText: "Simulate Test Payment" }).first().click();
      await expect(page.getByText("[PROTOTYPE SIMULATION]").first()).toBeVisible();
      // Checkout modal auto-dismisses after simulated payment
      await expect(page.locator("text=Razorpay Secure Checkout")).not.toBeVisible({ timeout: 5000 });
    }

    // 4. Switch to Admin and test Schedule Match modal
    await page.locator("button", { hasText: "View Admin (Console)" }).first().click();
    await page.locator("button", { hasText: "Create Match" }).first().click();
    await expect(page.locator("text=Schedule New Match")).toBeVisible();
    await page.locator("button", { hasText: "Publish Fixture & Notify Squad" }).first().click();

    // 5. Duplicate Player merge preview
    await page.locator("button", { hasText: "Player Roster" }).first().click();
    await page.locator("button", { hasText: "Merge Duplicate" }).first().click();
    await expect(page.getByRole("heading", { name: "Merge Duplicate Players" })).toBeVisible();
    await expect(page.getByText("Dry-Run Summary")).toBeVisible();
  });
});
