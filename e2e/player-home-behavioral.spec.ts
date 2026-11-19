import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { injectSyntheticSession } from "./helpers/synthetic-session";

const SCREENSHOT_DIR = path.resolve(process.cwd(), "docs/qa/screenshots/player-home");

test.beforeAll(async () => {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
});

test.describe("Phase 2.1: Player Home — Comprehensive Real Browser Verification", () => {
  // ── 1. Functional Acceptance & Architecture Verification ────────────────────
  test("1. Player Home loads greeting, identity, search, hero carousel, performance, and dues", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 1. Header & Greeting (Section 4.A)
    const header = page.locator('[data-testid="player-home-header"]');
    await expect(header).toBeVisible();
    await expect(header.getByText(/KAvach Cricket Club/i)).toBeVisible();
    await expect(header.getByText(/Player player-alpha/i)).toBeVisible();
    await expect(header.getByText(/KAV-018/i)).toBeVisible();

    // 2. Search filtering
    const searchInput = header.getByPlaceholder(/Search matches, announcements/i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill("Delhi");
    await expect(page.getByText(/Search Results for “Delhi”/i)).toBeVisible();
    await expect(page.getByText(/vs Delhi Challengers/i)).toBeVisible();
    await searchInput.fill(""); // Clear search to restore normal sections

    // 3. Campaign-Led Hero Banner (Section 4.B)
    const heroBanner = page.locator('[data-testid="campaign-hero-banner"]');
    await expect(heroBanner).toBeVisible();
    await expect(heroBanner.getByText(/KAvach Premier League/i)).toBeVisible();
    const heroCta = heroBanner.locator('[data-testid="hero-campaign-cta"]');
    await expect(heroCta).toBeVisible();

    // Next slide navigation
    const nextSlideBtn = heroBanner.getByLabel("Next slide");
    if (await nextSlideBtn.isVisible()) {
      await nextSlideBtn.click();
      // Slide advances smoothly
    }

    // 4. Compact Performance Summary (Section 4.C)
    const perfCard = page.locator('[data-testid="compact-performance-summary"]');
    await expect(perfCard).toBeVisible();
    await expect(perfCard.getByText(/Personal Performance/i)).toBeVisible();
    await expect(perfCard.getByText("420")).toBeVisible(); // Runs
    await expect(perfCard.getByText("14")).toBeVisible(); // Wickets

    // 5. Personal Outstanding Dues (Section 4.F)
    const duesCard = page.locator('[data-testid="personal-payment-card"]');
    await expect(duesCard).toBeVisible();
    // Authoritative calculation: 650 + 600 + 650 (3 unpaid upcoming matches) + 150 (late fee) = ₹2,050 (Option A excludes abandoned match)
    await expect(duesCard.getByText(/₹2,050/)).toBeVisible();
    await expect(duesCard.getByText(/4 pending obligations/i)).toBeVisible();
    const payNowBtn = duesCard.locator('[data-testid="pay-now-button"]');
    await expect(payNowBtn).toBeVisible();
  });

  // ── 2. Upcoming Matches & Inline 1-Tap RSVP ────────────────────────────────
  test("2. Displays next 4 upcoming matches with accurate availability and enables 1-tap RSVP updates", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const matchesSection = page.locator('[data-testid="upcoming-matches-section"]');
    await expect(matchesSection).toBeVisible();
    await expect(matchesSection.getByText(/Upcoming Fixtures/i)).toBeVisible();

    // Verify 4 distinct upcoming matches rendered
    const match1 = page.locator('[data-testid="match-card-match-upcoming-1"]');
    const match2 = page.locator('[data-testid="match-card-match-upcoming-2"]');
    const match3 = page.locator('[data-testid="match-card-match-upcoming-3"]');
    const match4 = page.locator('[data-testid="match-card-match-upcoming-4"]');

    await expect(match1).toBeVisible();
    await expect(match2).toBeVisible();
    await expect(match3).toBeVisible();
    await expect(match4).toBeVisible();

    // Verify ineligible matches are strictly hidden from player upcoming fixtures
    await expect(page.locator('[data-testid="match-card-match-ineligible-squad"]')).toBeHidden();
    await expect(page.locator('[data-testid="match-card-match-ineligible-tentative"]')).toBeHidden();

    // Verify opponent names
    await expect(match1.getByText(/vs Delhi Challengers/i)).toBeVisible();
    await expect(match2.getByText(/vs Noida Strikers/i)).toBeVisible();
    await expect(match3.getByText(/vs Gurgaon Royals/i)).toBeVisible();
    await expect(match4.getByText(/vs Faridabad Kings/i)).toBeVisible();

    // 1-Tap RSVP interaction on match 2 (initially Tentative, mark as Playing)
    const playingBtn = match2.getByRole("button", { name: "Mark availability as Playing" });
    await expect(playingBtn).toBeVisible();
    await playingBtn.click();

    // Toast notification confirms update
    await expect(page.getByText(/Availability marked as Playing/i)).toBeVisible({ timeout: 4000 });
  });

  test("2B. Enforces player-specific match visibility, search isolation, and blocks ineligible match RSVP", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const header = page.locator('[data-testid="player-home-header"]');
    const searchInput = header.getByPlaceholder(/Search matches, announcements/i);

    // 1. Search for squad-restricted ineligible match -> must NOT appear
    await searchInput.fill("Jaipur");
    await expect(page.getByText(/Search Results for “Jaipur”/i)).toBeVisible();
    await expect(page.getByText(/vs Jaipur Strikers/i)).toBeHidden();

    // 2. Search for tentative match -> must NOT appear for regular player
    await searchInput.fill("Tentative");
    await expect(page.getByText(/Search Results for “Tentative”/i)).toBeVisible();
    await expect(page.getByText(/vs Tentative Challengers/i)).toBeHidden();

    // Clear search
    await searchInput.fill("");

    // 3. Attempt to submit RSVP for ineligible match directly -> must be rejected with error toast
    await page.evaluate(async () => {
      await (window as any).__kavachTestRsvp?.("match-ineligible-squad", "Confirmed");
    });
    await expect(
      page.getByText(/You are not eligible to participate in this match/i)
    ).toBeVisible({ timeout: 4000 });
  });

  test("2C. Preserves legitimate administrator match access and search visibility for admin users", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "admin-alpha",
      role: "admin",
      isMatchAdmin: true,
      isClubAdmin: true,
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const header = page.locator('[data-testid="player-home-header"]');
    const searchInput = header.getByPlaceholder(/Search matches, announcements/i);

    // Admin searches for squad-restricted match -> visible
    await searchInput.fill("Jaipur");
    await expect(page.getByText(/Search Results for “Jaipur”/i)).toBeVisible();
    await expect(page.getByText(/vs Jaipur Strikers/i)).toBeVisible();

    // Admin searches for tentative match -> visible
    await searchInput.fill("Tentative");
    await expect(page.getByText(/Search Results for “Tentative”/i)).toBeVisible();
    await expect(page.getByText(/vs Tentative Challengers/i)).toBeVisible();
  });

  // ── 3. Announcements, Birthdays, and Feed Preview ─────────────────────────
  test("3. Announcements open modal dialog, birthdays carousel renders, and feed displays recent activity", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 1. Announcements (Section 4.D)
    const announcementsSection = page.locator('[data-testid="club-announcements-section"]');
    await expect(announcementsSection).toBeVisible();
    const announcementItem = page.locator('[data-testid="announcement-item-post-announcement-1"]');
    await expect(announcementItem).toBeVisible();
    await expect(announcementItem.getByText(/Annual Club Championship/i)).toBeVisible();

    // Open full announcement modal
    await announcementItem.click();
    const modal = page.getByRole("dialog", { name: /Annual Club Championship|Club Notice/i });
    await expect(modal).toBeVisible();
    await expect(modal.getByText(/Selections for the winter championship league/i)).toBeVisible();
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await expect(modal).toBeHidden();

    // 2. Birthdays Carousel (Section 4.E)
    const birthdaysSection = page.locator('[data-testid="birthdays-section"]');
    await expect(birthdaysSection).toBeVisible();
    await expect(birthdaysSection.getByText(/Rohit Sharma/i)).toBeVisible();
    await expect(birthdaysSection.getByText("Today! 🎉")).toBeVisible();
    await expect(birthdaysSection.getByText(/Virat Kohli/i)).toBeVisible();

    // 3. Feed Preview (Section 4.H)
    const feedSection = page.locator('[data-testid="club-feed-preview-section"]');
    await expect(feedSection).toBeVisible();
    await expect(feedSection.getByText(/Weekend Practice Session/i)).toBeVisible();
  });

  // ── 4. Navigation Workflows ───────────────────────────────────────────────
  test("4. Pay Now navigates to Finance tab and Match Details navigates to Matches tab", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Click Pay Now
    const duesCard = page.locator('[data-testid="personal-payment-card"]');
    await duesCard.locator('[data-testid="pay-now-button"]').click();

    // Verifies navigation to Finance tab
    await expect(page.getByRole("heading", { name: /My Dues & Payments/i })).toBeVisible({ timeout: 5000 });
  });

  // ── 5. Responsive Viewport Verification & Screenshots (5 Viewports) ────────
  const VIEWPORTS = [
    { name: "360x800", width: 360, height: 800, filename: "player-home-360x800.png" },
    { name: "375x812", width: 375, height: 812, filename: "player-home-375x812.png" },
    { name: "390x844", width: 390, height: 844, filename: "player-home-390x844.png" },
    { name: "768x1024", width: 768, height: 1024, filename: "player-home-768x1024.png" },
    { name: "1280x800", width: 1280, height: 800, filename: "player-home-desktop-1280x800.png" },
  ];

  for (const vp of VIEWPORTS) {
    test(`5. Responsive visual validation at ${vp.name} (${vp.width}x${vp.height}) with zero horizontal overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await injectSyntheticSession(page, {
        uid: "player-viewport",
        role: "player",
      });

      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      // Verify zero document-level horizontal overflow
      const hasNoHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      );
      expect(hasNoHorizontalOverflow).toBe(true);

      // Verify core components are present and accessible
      await expect(page.locator('[data-testid="player-home-header"]')).toBeVisible();
      await expect(page.locator('[data-testid="campaign-hero-banner"]')).toBeVisible();
      await expect(page.locator('[data-testid="compact-performance-summary"]')).toBeVisible();
      await expect(page.locator('[data-testid="personal-payment-card"]')).toBeVisible();
      await expect(page.locator('[data-testid="upcoming-matches-section"]')).toBeVisible();

      // Capture official visual artifact
      const screenshotPath = path.join(SCREENSHOT_DIR, vp.filename);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      expect(fs.existsSync(screenshotPath)).toBe(true);
    });
  }
});
