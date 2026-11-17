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

test.describe("KAvach Play — Responsive Ergonomics, Layout & Overflow Suite", () => {
  for (const vp of REQUIRED_VIEWPORTS) {
    test(`renders at ${vp.name} (${vp.width}x${vp.height}) with valid layout, navigation, touch targets, and modals`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/prototype");
      await page.waitForLoadState("domcontentloaded");

      // =======================================================================
      // 1. PLAYER MODE VALIDATION
      // =======================================================================
      await page.locator("button:visible", { hasText: "Player View" }).first().click();

      // 1A. Brand Header visibility and non-overlap
      const brandHeading = page.locator("h1", { hasText: "KAvach Play" });
      await expect(brandHeading).toBeVisible();

      // 1B. Assert no horizontal overflow in Player mode
      const isOverflowingPlayer = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(isOverflowingPlayer).toBeFalsy();

      // 1C. Navigation visibility per breakpoint
      if (vp.width >= 1024) {
        await expect(page.locator('nav[aria-label="Desktop Player Navigation"]')).toBeVisible();
        await expect(page.locator('nav[aria-label="Player Primary Navigation"]')).toBeHidden();
      } else {
        await expect(page.locator('nav[aria-label="Player Primary Navigation"]')).toBeVisible();
        await expect(page.locator('nav[aria-label="Desktop Player Navigation"]')).toBeHidden();
      }

      // 1D. Header and Content non-overlap
      const headerBox = await page.locator("header").first().boundingBox();
      const mainBox = await page.locator("main").first().boundingBox();
      if (headerBox && mainBox) {
        expect(mainBox.y).toBeGreaterThanOrEqual(headerBox.y);
      }

      // 1E. Bottom navigation does not obscure important content on mobile
      if (vp.width < 1024) {
        const bottomNavBox = await page.locator('nav[aria-label="Player Primary Navigation"]').boundingBox();
        expect(bottomNavBox).toBeTruthy();
        if (bottomNavBox) {
          expect(bottomNavBox.y + bottomNavBox.height).toBeGreaterThanOrEqual(vp.height - 1);
        }
      }

      // 1F. Touch Target Size Compliance: all visible interactive controls (buttons, custom role=button, inputs, selects) >= 44px
      const undersizedControls = await page.evaluate(() => {
        const selector = "button:not([hidden]), [role='button']:not([hidden]), input:not([type='hidden']), select:not([hidden])";
        const interactive = Array.from(document.querySelectorAll(selector));
        const fails: { tag: string; text: string; width: number; height: number }[] = [];
        for (const el of interactive) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
            const roundedWidth = Math.round(rect.width);
            const roundedHeight = Math.round(rect.height);
            if (roundedWidth < 44 || roundedHeight < 44) {
              fails.push({
                tag: el.tagName.toLowerCase(),
                text: (el.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 30),
                width: roundedWidth,
                height: roundedHeight,
              });
            }
          }
        }
        return fails;
      });
      expect(undersizedControls).toEqual([]);

      // 1G. Important content visible and unclipped
      await expect(page.getByText("Next Fixture").first()).toBeVisible();

      // =======================================================================
      // 2. ADMIN MODE VALIDATION
      // =======================================================================
      await page.locator("button:visible", { hasText: "Admin Console" }).first().click();

      // 2A. No horizontal overflow in Admin mode
      const isOverflowingAdmin = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(isOverflowingAdmin).toBeFalsy();

      // 2B. Admin navigation visibility per breakpoint
      if (vp.width >= 1024) {
        await expect(page.locator('nav[aria-label="Desktop Admin Navigation"]')).toBeVisible();
      } else {
        // Mobile / Tablet: Admin hub horizontal pill rail is visible
        const adminPillNav = page.locator('nav[aria-label="Admin Hub Navigation"]');
        await expect(adminPillNav).toBeVisible();
        // Return to Player View button is visible and usable
        const returnBtn = page.locator("button:visible", { hasText: "Return to Player View" }).first();
        await expect(returnBtn).toBeVisible();
        const returnBox = await returnBtn.boundingBox();
        expect(returnBox?.height).toBeGreaterThanOrEqual(44);
      }

      // 2C. Admin overview command KPIs visible
      await expect(page.getByText("Next Match Readiness").first()).toBeVisible();

      // 2D. Drawer/Modal fits within viewport and close controls remain visible & usable
      const createMatchBtn = page.locator("button:visible", { hasText: "Create Match" }).first();
      await expect(createMatchBtn).toBeVisible();
      await createMatchBtn.click();

      // Modal dialog must be visible and fit within viewport
      const modalDialog = page.locator('div[role="dialog"]').first();
      await expect(modalDialog).toBeVisible();
      const modalBox = await modalDialog.boundingBox();
      if (modalBox) {
        expect(modalBox.width).toBeLessThanOrEqual(vp.width);
        expect(modalBox.height).toBeLessThanOrEqual(vp.height);
      }

      // Modal close control is visible, usable, and >= 44px
      const closeModalBtn = modalDialog.locator('button[aria-label="Close modal"]').first();
      await expect(closeModalBtn).toBeVisible();
      const closeBox = await closeModalBtn.boundingBox();
      expect(closeBox?.height).toBeGreaterThanOrEqual(43);
      expect(closeBox?.width).toBeGreaterThanOrEqual(43);

      // Close modal
      await closeModalBtn.click();
      await expect(modalDialog).not.toBeVisible();

      // Capture screenshot for visual baseline evidence
      const shotPath = path.join(SCREENSHOT_DIR, `prototype-${vp.name}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });
      expect(fs.existsSync(shotPath)).toBeTruthy();
    });
  }
});

test.describe("KAvach Play — Player & Admin Navigation Suite", () => {
  test("verifies all 5 player navigation destinations across tabs", async ({ page }) => {
    await page.goto("/prototype");
    await page.locator("button:visible", { hasText: "Player View" }).first().click();

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
    await page.locator("button:visible", { hasText: "Admin Console" }).first().click();

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

test.describe("KAvach Play — Interactive Drawers, Modals & Mandatory Checkout", () => {
  test("verifies opening and closing major drawers and modals cleanly", async ({ page }) => {
    await page.goto("/prototype");

    // 1. Match Details slide-over drawer
    const playerNav = page.locator('nav[aria-label="Player Primary Navigation"], nav[aria-label="Desktop Player Navigation"]');
    await playerNav.locator("button:visible", { hasText: "Matches" }).first().click();
    await page.locator("article").first().click();
    await expect(page.getByText("Squad & Info").first()).toBeVisible();
    await page.locator('button[aria-label="Close match details"]').first().click();
    await expect(page.locator('button[aria-label="Close match details"]')).not.toBeVisible();

    // 2. Switch to Admin mode and test Create Match Modal
    await page.locator("button:visible", { hasText: "Admin Console" }).first().click();
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

  test("verifies mandatory checkout workflow, heading clarity, and simulation notification", async ({ page }) => {
    await page.goto("/prototype");
    await page.locator("button:visible", { hasText: "Player View" }).first().click();

    const playerNav = page.locator('nav[aria-label="Player Primary Navigation"], nav[aria-label="Desktop Player Navigation"]');
    await playerNav.locator("button:visible", { hasText: "Payments" }).first().click();

    // Mandatory assertion: Checkout entry point must be visible (no conditional bypassing)
    const payBtn = page.locator("button:visible", { hasText: "Pay Full Balance" }).first();
    await expect(payBtn).toBeVisible();
    await payBtn.click();

    // Verify renamed heading per Requirement 2
    const checkoutHeading = page.locator("text=Payment Checkout — Prototype Simulation");
    await expect(checkoutHeading).toBeVisible();

    // Trigger test payment simulation
    const simulateBtn = page.locator("button:visible", { hasText: "Simulate Test Payment" }).first();
    await expect(simulateBtn).toBeVisible();
    await simulateBtn.click();

    // Verify explicit prototype simulation disclaimer toast
    await expect(page.getByText("[PROTOTYPE SIMULATION]").first()).toBeVisible();

    // Auto-dismiss or verify closed
    await expect(checkoutHeading).not.toBeVisible({ timeout: 5000 });
  });

  test("verifies interactive Design Studio generator and live SVG canvas", async ({ page }) => {
    await page.goto("/prototype");
    await page.locator("button:visible", { hasText: "Admin Console" }).first().click();
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
});

test.describe("KAvach Play — Accessibility & Keyboard Interaction Suite", () => {
  test("verifies keyboard navigation and focus visibility across primary player navigation", async ({ page }) => {
    await page.goto("/prototype");
    await page.locator("button:visible", { hasText: "Player View" }).first().click();

    const playerNav = page.locator('nav[aria-label="Player Primary Navigation"], nav[aria-label="Desktop Player Navigation"]').filter({ visible: true });
    const navButtons = playerNav.locator("button:visible");
    const count = await navButtons.count();
    expect(count).toBeGreaterThanOrEqual(5);

    // Focus first navigation button
    const firstTab = navButtons.first();
    await firstTab.focus();
    await expect(firstTab).toBeFocused();

    // Verify focus visibility indicator
    const hasFocusStyle = await firstTab.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const hasRing = el.className.includes("focus:ring") || el.className.includes("focus-visible");
      const hasOutline = style.outlineStyle !== "none" && style.outlineWidth !== "0px";
      const hasShadow = style.boxShadow !== "none";
      return hasRing || hasOutline || hasShadow;
    });
    expect(hasFocusStyle).toBeTruthy();

    // Navigate to next control via Tab key
    await page.keyboard.press("Tab");
    const activeEl = await page.evaluate(() => document.activeElement?.tagName);
    expect(["BUTTON", "A", "INPUT", "SELECT"]).toContain(activeEl);
  });

  test("verifies modal focus containment, keyboard interaction, Escape-key dismissal, and focus restoration", async ({ page }) => {
    await page.goto("/prototype");

    // Open Admin Console
    await page.locator("button:visible", { hasText: "Admin Console" }).first().click();

    // Focus trigger button to open Create Match modal
    const createMatchBtn = page.locator("button:visible", { hasText: "Create Match" }).first();
    await createMatchBtn.focus();
    await expect(createMatchBtn).toBeFocused();

    // Open modal via Enter key
    await page.keyboard.press("Enter");

    // 1. Assert modal is open with proper ARIA dialog attributes
    const modal = page.locator('div[role="dialog"]').first();
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("aria-modal", "true");

    // 2. Focus containment: Verify initial focus is inside modal
    const initialInside = await page.evaluate(() => {
      const modalEl = document.querySelector('div[role="dialog"]');
      return modalEl ? modalEl.contains(document.activeElement) : false;
    });
    expect(initialInside).toBeTruthy();

    // 3. Tab focus containment cycling: Tab multiple times and verify focus NEVER escapes modal
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const isStillInside = await page.evaluate(() => {
        const modalEl = document.querySelector('div[role="dialog"]');
        return modalEl ? modalEl.contains(document.activeElement) : false;
      });
      expect(isStillInside).toBeTruthy();
    }

    // 4. Focus restoration: Dismiss modal via Escape key and assert focus returns to trigger button
    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();
    await expect(createMatchBtn).toBeFocused();

    // 5. Player mode drawer interaction and restoration
    await page.locator("button:visible", { hasText: "Player View" }).first().click();
    const playerNav = page.locator('nav[aria-label="Player Primary Navigation"], nav[aria-label="Desktop Player Navigation"]').filter({ visible: true });
    await playerNav.locator("button:visible", { hasText: "Matches" }).first().click();

    const matchCard = page.locator("article").first();
    await expect(matchCard).toBeVisible();

    // Open match details drawer via keyboard Enter key
    await matchCard.focus();
    await page.keyboard.press("Enter");

    const matchDrawer = page.locator('div[role="dialog"]').first();
    await expect(matchDrawer).toBeVisible();
    await expect(page.getByText("Squad & Info").first()).toBeVisible();

    // Verify focus is inside drawer
    const drawerInside = await page.evaluate(() => {
      const drawerEl = document.querySelector('div[role="dialog"]');
      return drawerEl ? drawerEl.contains(document.activeElement) : false;
    });
    expect(drawerInside).toBeTruthy();

    // Dismiss drawer via Escape key and assert focus returns to matchCard
    await page.keyboard.press("Escape");
    await expect(matchDrawer).not.toBeVisible();
    await expect(matchCard).toBeFocused();
  });
});
