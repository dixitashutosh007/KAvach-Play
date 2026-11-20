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

  test("2B. Enforces player-specific match visibility, search isolation, and open fixture RSVP", async ({
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

    // 3. Confirm squad-restricted match is strictly excluded from DOM/UI
    await expect(page.locator('[data-testid="match-card-match-ineligible-squad"]')).toHaveCount(0);

    // 4. Confirm open fixture (match-upcoming-4) is visible and actionable for 1-tap RSVP
    const matchOpen = page.locator('[data-testid="match-card-match-upcoming-4"]');
    await expect(matchOpen).toBeVisible();
    await expect(matchOpen.getByText(/vs Faridabad Kings/i)).toBeVisible();

    const openPlayingBtn = matchOpen.getByRole("button", { name: "Mark availability as Playing" });
    await expect(openPlayingBtn).toBeVisible();
    await openPlayingBtn.click();
    await expect(page.getByText(/Availability marked as Playing/i)).toBeVisible({ timeout: 4000 });
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

  // ── 4. Navigation Workflows & Guarded Match Navigation ────────────────────
  test("4A. Pay Now navigates to Finance tab", async ({ page }) => {
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

  test("4B. Tournament campaign navigation opens tournament fixtures without missing-match rejection", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
      tournaments: [
        {
          id: "tournament-winter-cup-2026",
          name: "Winter Super Cup 2026",
          status: "Ongoing",
          format: "T20",
          jerseyColor: "Scarlet Red",
          notes: "Official Winter Championship.",
        },
      ],
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 1. Verify Campaign Hero Banner renders tournament slide with realistic tournament ID
    const banner = page.locator('[data-testid="campaign-hero-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner.getByText("Winter Super Cup 2026")).toBeVisible();

    const viewFixturesBtn = banner.getByRole("button", { name: "View Fixtures" });
    await expect(viewFixturesBtn).toBeVisible();
    await viewFixturesBtn.click();

    // 2. Verify navigation opens Match Schedule view without missing-match error toast
    await expect(page.getByRole("heading", { name: /Match Schedule/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Match not found or no longer available/i)).toHaveCount(0);
    await expect(page.getByText(/You are not eligible/i)).toHaveCount(0);

    // 3. Verify tournament fixture is visible; the tournament badge lives in the
    //    card's progressive-disclosure details, so expand the card to reveal it.
    const tournamentCard = page
      .locator('[data-testid^="player-match-card-"]')
      .filter({ hasText: /vs Winter Warriors/i });
    await expect(tournamentCard).toBeVisible();
    await tournamentCard.locator('[data-testid^="expand-button-"]').click();
    await expect(tournamentCard.getByText(/Winter Super Cup 2026/i)).toBeVisible();
  });

  test("4C. Match Day Alert: eligible player opens match, squad-ineligible player alert suppressed, admin retains access", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    // 1. Eligible Player: Opens match from alert
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
      withAlertMatch: true,
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const alertBanner = page.locator('[data-testid="match-day-alert-match-alert-today"]');
    await expect(alertBanner).toBeVisible({ timeout: 5000 });
    await expect(alertBanner.getByText(/vs Mumbai Masters/i)).toBeVisible();

    const viewMatchBtn = alertBanner.getByRole("button", { name: /View Match/i });
    await expect(viewMatchBtn).toBeVisible();
    await viewMatchBtn.click();

    // Verifies navigation to Match Details view
    await expect(page.getByRole("button", { name: /Back/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: /vs Mumbai Masters/i })).toBeVisible();

    // 2. Active Verified Player Excluded from Squad: Alert is authoritatively suppressed
    // - Player is active and verified (not disabled, merged, pending, or rejected)
    // - Match has confirmed squad assignments for other players (teammate-1, teammate-2)
    // - The current player has no assignment for that match
    // - The match is within the Match Day Alert time window
    // - Verify the Match Day Alert is not rendered for this player
    await injectSyntheticSession(page, {
      uid: "player-beta",
      role: "player",
      status: "Active",
      withAlertMatch: true,
      alertSquadAssignedToOthersOnly: true,
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Match Day Alert is authoritatively not rendered for squad-excluded player
    const excludedAlert = page.locator('[data-testid="match-day-alert-match-alert-today"]');
    await expect(excludedAlert).toHaveCount(0);

    // 3. Administrator: Retains legitimate access to fixtures from alert
    await injectSyntheticSession(page, {
      uid: "admin-alpha",
      role: "admin",
      isMatchAdmin: true,
      isClubAdmin: true,
      withAlertMatch: true,
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const adminAlert = page.locator('[data-testid="match-day-alert-match-alert-today"]');
    await expect(adminAlert).toBeVisible({ timeout: 5000 });
    await adminAlert.getByRole("button", { name: /View Match/i }).click();
    await expect(page.getByRole("button", { name: /Back/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: /vs Mumbai Masters/i })).toBeVisible();
  });

  test("4D. Guarded match navigation: eligibility revoked after rendering blocks navigation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
      tournaments: [],
      posts: [
        {
          id: "post-featured-match",
          authorId: "admin-system",
          authorName: "Club Management",
          title: "Super Clash: Delhi Challengers",
          text: "Official matchday preview and squad details.",
          isPinned: true,
          isAnnouncement: true,
          matchId: "match-upcoming-1",
        },
      ],
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 1. Verify Campaign Hero Banner renders the featured match slide
    const banner = page.locator('[data-testid="campaign-hero-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner.getByText("Super Clash: Delhi Challengers")).toBeVisible();

    const viewMatchCta = banner.getByRole("button", { name: "View Match" });
    await expect(viewMatchCta).toBeVisible();

    // 2. Revoke player eligibility dynamically after rendering:
    // Admin assigns squad to teammates (teammate-1, teammate-2), excluding player-alpha
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("kavach:test:update-store", {
          detail: {
            payments: [
              {
                id: "pay-upcoming-teammate-1",
                playerId: "player-teammate-1",
                matchId: "match-upcoming-1",
                status: "Unpaid",
                availability: "Confirmed",
              },
              {
                id: "pay-upcoming-teammate-2",
                playerId: "player-teammate-2",
                matchId: "match-upcoming-1",
                status: "Unpaid",
                availability: "Confirmed",
              },
            ],
          },
        })
      );
    });

    // 3. Trigger navigation on the rendered CTA button
    await viewMatchCta.click();

    // 4. Verify guard uses updated context, blocks navigation, and shows authoritative toast
    await expect(page.getByText(/You are not eligible to access this match/i)).toBeVisible({ timeout: 4000 });
    // Player remains on Home tab (no Match Details heading mounted)
    await expect(page.getByRole("button", { name: /Back/i })).toHaveCount(0);
  });

  test("4E. Guarded match navigation: missing match blocks navigation with authoritative error", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
      tournaments: [],
      posts: [
        {
          id: "post-missing-match",
          authorId: "admin-system",
          authorName: "Club Management",
          title: "Cancelled Fixture Preview",
          text: "This fixture has been removed from the schedule.",
          isPinned: true,
          isAnnouncement: true,
          matchId: "match-missing-nonexistent-999",
        },
      ],
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 1. Verify Campaign Hero Banner renders the slide
    const banner = page.locator('[data-testid="campaign-hero-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner.getByText("Cancelled Fixture Preview")).toBeVisible();

    const viewMatchCta = banner.getByRole("button", { name: "View Match" });
    await expect(viewMatchCta).toBeVisible();

    // 2. Trigger navigation for missing match
    await viewMatchCta.click();

    // 3. Verify guard blocks navigation and displays authoritative missing-match toast
    await expect(page.getByText(/Match not found or no longer available/i)).toBeVisible({ timeout: 4000 });
    await expect(page.getByRole("button", { name: /Back/i })).toHaveCount(0);
  });

  test("4F. Guarded match navigation: eligible player navigates from search results", async ({
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
    await searchInput.fill("Delhi");
    const searchResult = page.locator('[data-testid="search-result-match-match-upcoming-1"]');
    await expect(searchResult).toBeVisible();
    await searchResult.click();

    // Verifies navigation to Match Details view for Delhi Challengers
    await expect(page.getByRole("button", { name: /Back/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: /vs Delhi Challengers/i })).toBeVisible();
  });

  test("4G. Guarded match navigation: eligible player navigates from upcoming matches", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const upcomingCard = page.locator('[data-testid="match-card-match-upcoming-1"]');
    await expect(upcomingCard).toBeVisible();
    await upcomingCard.getByRole("button", { name: /details & directions/i }).click();

    // Verifies navigation to Match Details view
    await expect(page.getByRole("button", { name: /Back/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: /vs Delhi Challengers/i })).toBeVisible();
  });

  test("4H. Guarded match navigation: administrator navigates to restricted and tentative matches", async ({
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

    // Admin navigates to squad-restricted fixture from search
    await searchInput.fill("Jaipur");
    const restrictedResult = page.locator('[data-testid="search-result-match-match-ineligible-squad"]');
    await expect(restrictedResult).toBeVisible();
    await restrictedResult.click();
    await expect(page.getByRole("button", { name: /Back/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: /vs Jaipur Strikers/i })).toBeVisible();
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
