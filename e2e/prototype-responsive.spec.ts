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
  { name: "360x800", width: 360, height: 800, isMobile: true },
  { name: "390x844", width: 390, height: 844, isMobile: true },
  { name: "430x932", width: 430, height: 932, isMobile: true },
  { name: "768x1024", width: 768, height: 1024, isMobile: false },
  { name: "1280x800", width: 1280, height: 800, isMobile: false },
  { name: "1440x900", width: 1440, height: 900, isMobile: false },
];

test.describe("KAvach Play — Responsive Ergonomics & Overflow Suite", () => {
  for (const vp of REQUIRED_VIEWPORTS) {
    test(`renders at ${vp.name} (${vp.width}x${vp.height}) without horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/prototype");
      await page.waitForLoadState("domcontentloaded");

      // 1. Verify Header and brand are visible and not clipped
      const brandHeading = page.locator("h1", { hasText: "KAvach Play" });
      await expect(brandHeading).toBeVisible();

      // 2. Assert document width does not exceed viewport width (no horizontal overflow)
      const isOverflowing = await page.evaluate(() => {
        const docWidth = document.documentElement.scrollWidth;
        const viewportWidth = window.innerWidth;
        return docWidth > viewportWidth;
      });
      expect(isOverflowing).toBeFalsy();

      // 3. Navigation visibility rules
      if (vp.width >= 1024) {
        // Desktop breakpoint: Desktop sidebar visible, mobile bottom nav hidden
        await expect(page.locator('nav[aria-label="Desktop Player Navigation"]')).toBeVisible();
        await expect(page.locator('nav[aria-label="Player Primary Navigation"]')).toBeHidden();
      } else {
        // Mobile / Tablet breakpoint: Mobile bottom nav visible for player mode
        await expect(page.locator('nav[aria-label="Player Primary Navigation"]')).toBeVisible();
      }

      // 4. Important content is visible and unclipped
      await expect(page.getByText("Next Fixture").first()).toBeVisible();

      // 5. Capture responsive screenshot
      const shotPath = path.join(SCREENSHOT_DIR, `prototype-${vp.name}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });
      expect(fs.existsSync(shotPath)).toBeTruthy();
    });
  }
});

test.describe("KAvach Play — Player & Admin Navigation Suite", () => {
  test("verifies all 5 player navigation destinations across tabs", async ({ page }) => {
    await page.goto("/prototype");
    await page.locator("button:visible", { hasText: "View Player" }).first().click();

    const playerNav = page.locator('nav[aria-label="Player Primary Navigation"], nav[aria-label="Desktop Player Navigation"]');

    // 1. Home Feed
    await playerNav.locator("button:visible", { hasText: "Home" }).first().click();
    await expect(page.getByText("Next Fixture").first()).toBeVisible();

    // 2. Matches Tab
    await playerNav.locator("button:visible", { hasText: "Matches" }).first().click();
    await expect(page.getByText("All Matches").first()).toBeVisible();
    await expect(page.getByText("KAvach Cricket Club vs Spartans CC").first()).toBeVisible();

    // 3. Payments Tab
    await playerNav.locator("button:visible", { hasText: "Payments" }).first().click();
    await expect(page.locator("text=Total Payable Obligations")).toBeVisible();
    await expect(page.locator("text=Waived per Club Policy (Option A)")).toBeVisible();

    // 4. Performance Tab
    await playerNav.locator("button:visible", { hasText: "Performance" }).first().click();
    await expect(page.locator("text=Player Performance & Career Stats")).toBeVisible();
    await expect(page.locator("text=Milestone Badges & Club Honors")).toBeVisible();

    // 5. Club Tab
    await playerNav.locator("button:visible", { hasText: "Club" }).first().click();
    await expect(page.locator("text=Club Experience & Member Services")).toBeVisible();
    await expect(page.locator("text=Official Player Card")).toBeVisible();
  });

  test("verifies all 7 administrator command hubs and sub-tabs", async ({ page }) => {
    await page.goto("/prototype");
    await page.locator("button:visible", { hasText: "View Admin (Console)" }).first().click();

    // 1. Overview Hub
    await page.locator("button:visible", { hasText: "Overview" }).first().click();
    await expect(page.getByText("Next Match Readiness").first()).toBeVisible();

    // 2. Match Centre Hub (with Grounds & Tournaments sub-tabs)
    await page.locator("button:visible", { hasText: "Match Centre" }).first().click();
    await expect(page.locator("text=Match Centre & Squad Operations")).toBeVisible();
    await page.locator("button:visible", { hasText: "Grounds & Venues (MOD-10)" }).first().click();
    await expect(page.locator("text=Kavach Arena Ground 1")).toBeVisible();
    await page.locator("button:visible", { hasText: "Tournaments & Leagues (MOD-17)" }).first().click();
    await expect(page.locator("text=Premier Cricket League 2026")).toBeVisible();

    // 3. Player Roster Hub
    await page.locator("button:visible", { hasText: "Player Roster" }).first().click();
    await expect(page.locator("text=Club Player Roster & Memberships")).toBeVisible();

    // 4. Finance & Dues Hub
    await page.locator("button:visible", { hasText: "Finance & Dues" }).first().click();
    await expect(page.locator("text=Finance & Collections Command")).toBeVisible();
    await expect(page.locator("text=Total Liquid Collected")).toBeVisible();

    // 5. Studio & Nets Hub
    await page.locator("button:visible", { hasText: "Studio & Nets" }).first().click();
    await expect(page.locator("text=Studio & Nets Command")).toBeVisible();
    await expect(page.locator("text=Lane 1: Fast Bowling").first()).toBeVisible();

    // 6. Club Operations Hub
    await page.locator("button:visible", { hasText: "Club Operations" }).first().click();
    await expect(page.locator("text=Club Operations & Member Hub")).toBeVisible();
    await expect(page.locator("text=Merchandise Order Pipeline")).toBeVisible();

    // 7. Settings & Access Hub
    await page.locator("button:visible", { hasText: "Settings" }).first().click();
    await expect(page.locator("text=Governance, RBAC & Club Settings")).toBeVisible();
    await expect(page.locator("text=Granular RBAC Roles & Capabilities")).toBeVisible();
  });
});

test.describe("KAvach Play — Interactive Drawers, Modals & Simulation Clarity", () => {
  test("verifies opening and closing major drawers and modals cleanly", async ({ page }) => {
    await page.goto("/prototype");

    // 1. Match Details slide-over drawer
    await page.locator("button:visible", { hasText: "Matches" }).first().click();
    await page.locator("article").first().click();
    await expect(page.getByText("Squad & Info").first()).toBeVisible();
    await page.locator('button[aria-label="Close match details"]').first().click();
    await expect(page.locator('button[aria-label="Close match details"]')).not.toBeVisible();

    // 2. Switch to Admin mode and test Create Match Modal
    await page.locator("button:visible", { hasText: "View Admin (Console)" }).first().click();
    await page.locator("button:visible", { hasText: "Create Match" }).first().click();
    await expect(page.locator("text=Schedule New Match")).toBeVisible();
    await page.locator('button[aria-label="Close modal"]').first().click();
    await expect(page.locator("text=Schedule New Match")).not.toBeVisible();

    // 3. Record Pitch-Side Cash Modal
    await page.locator("button:visible", { hasText: "Record Pitch Cash" }).first().click();
    await expect(page.locator("text=Record Pitch-Side Cash")).toBeVisible();
    await page.locator('button[aria-label="Close modal"]').first().click();
    await expect(page.locator("text=Record Pitch-Side Cash")).not.toBeVisible();

    // 4. Duplicate Player Merge Modal
    await page.locator("button:visible", { hasText: "Player Roster" }).first().click();
    await page.locator("button:visible", { hasText: "Merge Duplicate" }).first().click();
    await expect(page.getByRole("heading", { name: "Merge Duplicate Players" })).toBeVisible();
    await page.locator('button[aria-label="Close modal"]').first().click();
    await expect(page.getByRole("heading", { name: "Merge Duplicate Players" })).not.toBeVisible();
  });

  test("verifies checkout simulation clarity and explicit simulation labeling", async ({ page }) => {
    await page.goto("/prototype");
    await page.locator("button:visible", { hasText: "View Player" }).first().click();
    await page.locator("button:visible", { hasText: "Payments" }).first().click();

    // Open Checkout modal
    const payBtn = page.locator("button:visible", { hasText: "Pay Full Balance" }).first();
    if (await payBtn.isVisible()) {
      await payBtn.click();
      // Verify renamed heading per Requirement 2
      await expect(page.locator("text=Payment Checkout — Prototype Simulation")).toBeVisible();

      // Trigger test payment simulation
      await page.locator("button:visible", { hasText: "Simulate Test Payment" }).first().click();
      await expect(page.getByText("[PROTOTYPE SIMULATION]").first()).toBeVisible();

      // Auto-dismiss or verify closed
      await expect(page.locator("text=Payment Checkout — Prototype Simulation")).not.toBeVisible({ timeout: 5000 });
    }
  });

  test("verifies interactive Design Studio generator and live SVG canvas", async ({ page }) => {
    await page.goto("/prototype");
    await page.locator("button:visible", { hasText: "View Admin (Console)" }).first().click();
    await page.locator("button:visible", { hasText: "Club Operations" }).first().click();

    // Open Design Studio section
    await page.locator("button:visible", { hasText: "Open Studio Generator" }).first().click();
    await expect(page.locator("text=1. Select Matchday Template:")).toBeVisible();

    // Select Player of Match (POTM) template
    await page.locator("button:visible", { hasText: "Player of Match (POTM)" }).first().click();
    await expect(page.locator("text=PLAYER OF THE MATCH")).toBeVisible();

    // Trigger local graphic export simulation
    await page.locator("button:visible", { hasText: "Download High-Res Graphic" }).first().click();
    await expect(page.getByText("[PROTOTYPE SIMULATION]").first()).toBeVisible();
  });

  test("verifies keyboard accessibility and focus navigation", async ({ page }) => {
    await page.goto("/prototype");
    const testButton = page.locator('button:visible', { hasText: "View Player" }).first();
    await testButton.focus();
    await expect(testButton).toBeFocused();
    await page.keyboard.press("Tab");
    const activeTagName = await page.evaluate(() => document.activeElement?.tagName);
    expect(["BUTTON", "A", "INPUT", "SELECT"]).toContain(activeTagName);
  });
});
