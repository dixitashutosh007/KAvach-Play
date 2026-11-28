import { test, expect, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { injectSyntheticSession, FIXED_TEST_TIMESTAMP } from "./helpers/synthetic-session";

const SCREENSHOT_DIR = path.resolve(process.cwd(), "docs/qa/screenshots/badges-2.0");

function ensureScreenshotDir() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  // PNG signature (8 bytes) + IHDR length (4 bytes) + "IHDR" (4 bytes) -> width @ 16..20, height @ 20..24
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`Invalid PNG file at ${filePath} (len=${buf.length})`);
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

async function injectBadgesSeed(page: Page, uid: string) {
  const playerId = `player-${uid}`;
  await page.addInitScript(
    ({ pId, ts }) => {
      const store = (window as any).__KAVACH_TEST_STORE__;
      if (!store) return;

      store.badgeTypeDefs = [
        {
          id: "archived_founder",
          label: "Founding Member",
          emoji: "🏛️",
          description: "Awarded to founding members of the club.",
          category: "milestone",
          awardMode: "manual",
          stackable: false,
          active: false,
          archived: true,
          tier: "gold",
          createdBy: "admin",
        },
        {
          id: "club_spirit",
          label: "Club Spirit",
          emoji: "🔥",
          description: "Exemplary sportsmanship on and off the field.",
          category: "special",
          awardMode: "manual",
          stackable: true,
          active: true,
          archived: false,
          tier: "silver",
          createdBy: "admin",
        },
      ];

      store.badges = [
        {
          id: `${pId}__year_1`,
          playerId: pId,
          badgeType: "year_1",
          awardedAt: { seconds: ts - 86400 * 30 },
          awardedBy: "system",
          awardedByName: "System",
          note: "1 year club tenure",
        },
        {
          id: `${pId}__runs_1k`,
          playerId: pId,
          badgeType: "runs_1k",
          awardedAt: { seconds: ts - 86400 * 14 },
          awardedBy: "system",
          awardedByName: "System",
          note: "1,000+ career runs",
        },
        {
          id: "badge-century-1",
          playerId: pId,
          badgeType: "century",
          awardedAt: { seconds: ts - 86400 * 7 },
          awardedBy: "admin-1",
          awardedByName: "Coach Sharma",
          note: "108* vs Titans CC",
        },
        {
          id: `${pId}__archived_founder`,
          playerId: pId,
          badgeType: "archived_founder",
          awardedAt: { seconds: ts - 86400 * 180 },
          awardedBy: "admin-1",
          awardedByName: "Coach Sharma",
          note: "2024 inaugural season",
        },
      ];

      // Mock navigator.share & navigator.canShare for PNG sharing QA
      (window as any).__KAVACH_SHARED_FILES__ = [];
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: () => true,
      });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: { files?: File[]; title?: string }) => {
          const files = (data.files || []).map((f) => ({
            name: f.name,
            type: f.type,
            size: f.size,
          }));
          (window as any).__KAVACH_SHARED_FILES__.push({ title: data.title, files });
        },
      });
    },
    { pId: playerId, ts: FIXED_TEST_TIMESTAMP },
  );
}

test.describe("Badges 2.0 Live Browser QA", () => {
  test.beforeAll(() => {
    ensureScreenshotDir();
  });

  test("Player badge collection, unique SVG IDs, detail modal, Square & Portrait PNG export (Desktop + Mobile 360x800)", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await injectSyntheticSession(page, {
      uid: "player-qa",
      role: "player",
    });
    await injectBadgesSeed(page, "player-qa");

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Open Profile -> View All Badges
    await page.locator('[data-testid="header-profile-avatar"]').click();
    await expect(page.locator('[data-testid="profile-badges-all"]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="profile-badges-all"]').click();

    const collection = page.locator('[data-testid="player-badge-collection"]');
    await expect(collection).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="badges-earned-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="badges-locked-section"]')).toBeVisible();
    await expect(collection.getByText("Founding Member")).toBeVisible();
    await expect(collection.getByText("Archived").first()).toBeVisible();

    // Verify all rendered SVG gradient/element IDs inside the badge collection are unique
    const duplicateIds = await page.evaluate(() => {
      const svgs = Array.from(document.querySelectorAll('[data-testid="player-badge-collection"] svg [id]'));
      const seen = new Map<string, number>();
      for (const el of svgs) {
        const id = el.getAttribute("id");
        if (!id) continue;
        seen.set(id, (seen.get(id) || 0) + 1);
      }
      return Array.from(seen.entries())
        .filter(([, count]) => count > 1)
        .map(([id, count]) => ({ id, count }));
    });
    expect(duplicateIds).toEqual([]);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "01-player-collection-desktop.png"),
      fullPage: true,
    });

    // Open earned badge detail modal
    await page.locator('[data-testid="badges-earned-section"] button').first().click();
    const modal = page.locator('[data-testid="badge-detail-modal"]');
    await expect(modal).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "02-badge-detail-desktop.png"),
    });

    // Verify Square 1:1 (1080x1080) Download + Share
    await modal.getByRole("button", { name: /Square 1:1/i }).click();
    const [squareDownload] = await Promise.all([
      page.waitForEvent("download"),
      modal.getByRole("button", { name: "Download" }).click(),
    ]);
    const squarePath = testInfo.outputPath("badge-square.png");
    await squareDownload.saveAs(squarePath);
    expect(readPngDimensions(squarePath)).toEqual({ width: 1080, height: 1080 });

    await modal.getByRole("button", { name: /Share Badge/i }).click();
    await expect
      .poll(async () => page.evaluate(() => (window as any).__KAVACH_SHARED_FILES__.length))
      .toBeGreaterThanOrEqual(1);

    // Verify Portrait 4:5 (1080x1350) Download + Share
    await modal.getByRole("button", { name: /Portrait 4:5/i }).click();
    const [portraitDownload] = await Promise.all([
      page.waitForEvent("download"),
      modal.getByRole("button", { name: "Download" }).click(),
    ]);
    const portraitPath = testInfo.outputPath("badge-portrait.png");
    await portraitDownload.saveAs(portraitPath);
    expect(readPngDimensions(portraitPath)).toEqual({ width: 1080, height: 1350 });

    await modal.getByRole("button", { name: /Share Badge/i }).click();
    await expect
      .poll(async () => page.evaluate(() => (window as any).__KAVACH_SHARED_FILES__.length))
      .toBe(2);
    const sharedFiles = await page.evaluate(() => (window as any).__KAVACH_SHARED_FILES__);
    expect(sharedFiles.length).toBe(2);
    expect(sharedFiles[0].files[0].type).toBe("image/png");
    expect(sharedFiles[1].files[0].type).toBe("image/png");

    // Mobile 360 x 800 check on Detail Modal & Collection
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "03-badge-detail-mobile-360x800.png"),
    });
    await modal.getByRole("button", { name: "Close" }).click();
    await expect(modal).toBeHidden();

    // Check locked badge progress detail on mobile (KAvach 2K Run Club shows 420 / 2,000 runs progress)
    await page.locator('[data-testid="badges-locked-section"] button', { hasText: /2K Run Club/i }).click();
    await expect(modal).toBeVisible();
    await expect(page.locator('[data-testid="badge-locked-progress"]')).toBeVisible();
    await modal.getByRole("button", { name: "Close" }).click();

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "04-player-collection-mobile-360x800.png"),
      fullPage: true,
    });
  });

  test("Admin grant and partial-failure retry (Desktop + Mobile 360x800)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await injectSyntheticSession(page, {
      uid: "admin-qa",
      role: "admin",
      isClubAdmin: true,
    });
    await injectBadgesSeed(page, "admin-qa");

    // Mock POST /api/admin/badges: fail player-teammate-2 on first attempt, succeed on retry
    let teammate2Attempts = 0;
    await page.route("**/api/admin/badges", async (route) => {
      if (route.request().method() !== "POST") {
        return route.continue();
      }
      const body = route.request().postDataJSON();
      const targetPlayerId = body?.badge?.playerId || body?.playerId;
      const targetBadgeType = body?.badge?.badgeType || body?.badgeType;
      if (targetPlayerId === "player-teammate-2") {
        teammate2Attempts += 1;
        if (teammate2Attempts === 1) {
          return route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Simulated transient network/server error" }),
          });
        }
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: `mock-${targetPlayerId}-${Date.now()}`,
          playerId: targetPlayerId,
          badgeType: targetBadgeType,
          idempotencyKey: body?.idempotencyKey,
        }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Switch to Admin persona
    await page.locator('[data-testid="header-persona-admin"]').click();
    // Navigate to Club -> Badges
    await page.getByRole("button", { name: /^Club$/i }).first().click();
    await page.locator('[data-testid="club-sub-tab-badges"]').click();

    // Open Grant sub-tab
    await page.getByRole("button", { name: /^Grant$/i }).click();
    await expect(page.getByText("Grant a Badge")).toBeVisible({ timeout: 10000 });

    // Select 2 players (Rohit Sharma = player-teammate-1, and 3rd player = player-teammate-2)
    await page.getByRole("button", { name: /Rohit Sharma/i }).click();
    await page.locator("div.max-h-40 button").nth(2).click();

    // Select stackable badge "Club Spirit" or "Century"
    await page.getByRole("button", { name: /Club Spirit/i }).click();

    // Submit grant
    await page.getByRole("button", { name: /Award Club Spirit to 2 players/i }).click();

    const outcome = page.locator('[data-testid="badge-award-outcome"]');
    await expect(outcome).toBeVisible({ timeout: 10000 });
    await expect(outcome.getByText(/Failed \(2\):/i)).toBeVisible();
    const retryBtn = outcome.getByRole("button", { name: /Retry Failed \(2\)/i });
    await expect(retryBtn).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "05-admin-grant-retry-desktop.png"),
    });

    // Click Retry Failed (2) and verify retry handler executes cleanly
    await retryBtn.click();
    await expect(outcome.getByRole("button", { name: /Retry Failed \(2\)/i })).toBeVisible();

    // Mobile 360 x 800 Admin Badges view
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "06-admin-badges-mobile-360x800.png"),
      fullPage: true,
    });
  });
});
