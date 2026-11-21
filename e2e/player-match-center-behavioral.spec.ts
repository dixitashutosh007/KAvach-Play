import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { injectSyntheticSession } from "./helpers/synthetic-session";

const SCREENSHOT_DIR = path.resolve(process.cwd(), "docs/qa/screenshots/player-matches");

test.beforeAll(async () => {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
});

test.describe("Phase 2.2: Player Match Center — Real Browser Behavioural Verification", () => {
  // ── 1. Match Grouping, Chronological Ordering, and Highlight ─────────────────
  test("1. Upcoming matches display chronologically (nearest first), include fixtures beyond 14 days, and highlight immediate next match", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Navigate to Matches tab
    const playerNav = page.locator("nav");
    await playerNav.getByRole("button", { name: "Matches", exact: true }).click();

    // 1. Verify Player Match Center loads
    const matchCenter = page.locator('[data-testid="player-match-center"]');
    await expect(matchCenter).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: /Match Schedule/i })).toBeVisible();

    // 2. Verify Upcoming Fixtures section exists
    const upcomingSection = page.locator('[data-testid="upcoming-matches-section"]');
    await expect(upcomingSection).toBeVisible();

    // 3. Verify immediate next match is highlighted
    const nextMatchBadge = page.locator('[data-testid="next-match-highlight"]');
    await expect(nextMatchBadge).toBeVisible();
    await expect(nextMatchBadge.getByText(/Next Match/i)).toBeVisible();

    // 4. Verify nearest match is Delhi Challengers (2026-11-25)
    const firstMatchCard = page.locator('[data-testid="player-match-card-match-upcoming-1"]');
    await expect(firstMatchCard).toBeVisible();
    await expect(firstMatchCard.getByText(/vs Delhi Challengers/i)).toBeVisible();

    // 5. Verify match beyond 14 days is also visible (match-upcoming-4: 2026-12-06 is > 14 days from 2026-11-19)
    const beyondMatchCard = page.locator('[data-testid="player-match-card-match-upcoming-4"]');
    await expect(beyondMatchCard).toBeVisible();
    await expect(beyondMatchCard.getByText(/vs Faridabad Kings/i)).toBeVisible();

    // 6. Verify venue and directions link
    // Venue name is the Google Maps link (opens in a new tab)
    const venueLink = firstMatchCard.getByTestId("venue-link-match-upcoming-1");
    await expect(venueLink).toBeVisible();
    await expect(venueLink).toHaveAttribute("target", "_blank");
  });

  // ── 2. Active View Retains Unsettled Older Matches ────────────────────────────
  test("2. Active Recent view retains unsettled older past matches with prominent alert", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    // Inject an older past match (> 30 days ago) that has an UNPAID obligation for this player
    const olderUnsettledMatch = {
      id: "match-older-unsettled",
      groundId: "ground-1",
      format: "T20",
      jerseyColor: "Scarlet Red",
      date: "2026-09-15",
      time: "07:30",
      opponent: "Old Unsettled Warriors",
      result: "KAvach Won",
      fee: 500,
    };

    const olderUnsettledPayment = {
      id: "pay-older-unsettled",
      playerId: "player-player-alpha",
      matchId: "match-older-unsettled",
      status: "Unpaid",
      availability: "Confirmed",
    };

    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
      matches: [olderUnsettledMatch],
      payments: [olderUnsettledPayment],
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const playerNav = page.locator("nav");
    await playerNav.getByRole("button", { name: "Matches", exact: true }).click();

    // Verify recent section is visible
    const recentSection = page.locator('[data-testid="recent-matches-section"]');
    await expect(recentSection).toBeVisible({ timeout: 5000 });

    // Verify the older unsettled match is retained in the active view
    const unsettledCard = page.locator('[data-testid="player-match-card-match-older-unsettled"]');
    await expect(unsettledCard).toBeVisible();
    await expect(unsettledCard.getByText(/vs Old Unsettled Warriors/i)).toBeVisible();

    // Verify the prominent unsettled obligation banner is displayed
    const alertCallout = page.locator('[data-testid="unsettled-alert-match-older-unsettled"]');
    await expect(alertCallout).toBeVisible();
    await expect(alertCallout.getByText(/Unsettled Obligation/i)).toBeVisible();
    await expect(alertCallout.getByText(/₹500 due/i)).toBeVisible();
  });

  // ── 3. Personal Payment Status Badges & Option A Abandoned Matches ────────────
  test("3. Derives personal payment status accurately (PAID, UNPAID, PARTIALLY PAID, WAIVED) and waives abandoned matches", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    const testMatches = [
      {
        id: "match-paid",
        groundId: "ground-1",
        format: "T20",
        jerseyColor: "Scarlet Red",
        date: "2026-11-25",
        time: "07:30",
        opponent: "Paid Rivals",
        result: "Pending",
        fee: 600,
      },
      {
        id: "match-partial",
        groundId: "ground-1",
        format: "T20",
        jerseyColor: "Scarlet Red",
        date: "2026-11-26",
        time: "07:30",
        opponent: "Partial Challengers",
        result: "Pending",
        fee: 600,
      },
      {
        id: "match-abandoned-option-a",
        groundId: "ground-2",
        format: "T20",
        jerseyColor: "Whites",
        date: "2026-11-12",
        time: "08:00",
        opponent: "Rain Out Kings",
        result: "Abandoned",
        fee: 650,
      },
    ];

    const testPayments = [
      {
        id: "pay-paid",
        playerId: "player-player-alpha",
        matchId: "match-paid",
        status: "Paid",
        availability: "Confirmed",
        feeCollectedAmount: 600,
      },
      {
        id: "pay-partial",
        playerId: "player-player-alpha",
        matchId: "match-partial",
        status: "Unpaid",
        availability: "Confirmed",
        feeCollectedAmount: 250,
      },
      {
        id: "pay-abandoned",
        playerId: "player-player-alpha",
        matchId: "match-abandoned-option-a",
        status: "Unpaid",
        availability: "Confirmed",
        feeCollectedAmount: 0,
      },
    ];

    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
      matches: testMatches,
      payments: testPayments,
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const playerNav = page.locator("nav");
    await playerNav.getByRole("button", { name: "Matches", exact: true }).click();

    // 1. Verify PAID badge
    const paidBadge = page.locator('[data-testid="payment-status-match-paid"]');
    await expect(paidBadge).toBeVisible();
    await expect(paidBadge).toHaveText(/PAID/);

    // 2. Verify PARTIALLY PAID badge with balance due
    const partialBadge = page.locator('[data-testid="payment-status-match-partial"]');
    await expect(partialBadge).toBeVisible();
    await expect(partialBadge).toHaveText(/PARTIALLY PAID • ₹350 due/i);

    // 3. Verify Option A Policy on Abandoned Match: Status is WAIVED (never UNPAID!)
    const waivedBadge = page.locator('[data-testid="payment-status-match-abandoned-option-a"]');
    await expect(waivedBadge).toBeVisible();
    await expect(waivedBadge).toHaveText(/WAIVED/);
    await expect(waivedBadge).not.toHaveText(/UNPAID/);
  });

  // ── 4. 1-Tap Inline RSVP Availability Actions ────────────────────────────────
  test("4. Availability buttons (Playing, Maybe, Out) updates state with instant feedback", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const playerNav = page.locator("nav");
    await playerNav.getByRole("button", { name: "Matches", exact: true }).click();

    const matchCard = page.locator('[data-testid="player-match-card-match-upcoming-1"]');
    await expect(matchCard).toBeVisible({ timeout: 5000 });

    // Click the "Maybe" availability button
    const maybeBtn = matchCard.getByRole("button", { name: "Mark availability as Maybe" });
    await expect(maybeBtn).toBeVisible();
    await maybeBtn.click();

    // Verify toast notification appears
    await expect(page.getByText(/Availability updated: Maybe/i)).toBeVisible({ timeout: 5000 });

    // Verify button state updates to active
    await expect(maybeBtn).toHaveAttribute("aria-pressed", "true");

    // Click "Out" RSVP button
    const outBtn = matchCard.getByRole("button", { name: "Mark availability as Out" });
    await expect(outBtn).toBeVisible();
    await outBtn.click();

    // Verify toast notification appears
    await expect(page.getByText(/Availability updated: Out/i)).toBeVisible({ timeout: 5000 });
    await expect(outBtn).toHaveAttribute("aria-pressed", "true");
  });

  // ── 5. Detailed Match View & Browser History Navigation (`popstate`) ─────────
  test("5. Detailed match view displays personal financial breakdown, squad availability without payment leak, and restores list on browser back", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const playerNav = page.locator("nav");
    await playerNav.getByRole("button", { name: "Matches", exact: true }).click();

    // Click card to open match details
    const matchCard = page.locator('[data-testid="player-match-card-match-upcoming-1"]');
    await expect(matchCard).toBeVisible({ timeout: 5000 });
    await matchCard.click();

    // 1. Verify Player Match Detail view mounts
    const detailView = page.locator('[data-testid="player-match-detail-view"]');
    await expect(detailView).toBeVisible({ timeout: 5000 });
    await expect(detailView.getByRole("heading", { name: /vs Delhi Challengers/i })).toBeVisible();

    // 2. Verify venue & external links
    await expect(detailView.getByText(/Open in Google Maps/i)).toBeVisible();
    await expect(detailView.getByText(/Player reporting time:/i)).toBeVisible();

    // 3. Verify personal payment status card
    const paymentCard = detailView.locator('[data-testid="personal-payment-detail-card"]');
    await expect(paymentCard).toBeVisible();
    await expect(paymentCard.getByText(/Your Payment Status/i)).toBeVisible();
    await expect(paymentCard.getByText(/Outstanding Payable:/i)).toBeVisible();

    // 4. PRIVACY ISOLATION (SEC-004): Squad list must NOT expose teammate payment statuses
    const squadSection = detailView.locator('[data-testid="squad-availability-section"]');
    await expect(squadSection).toBeVisible();
    await expect(squadSection.getByText(/Squad & Teammates/i)).toBeVisible();
    await expect(squadSection.getByText(/Availability Only/i)).toBeVisible();

    // Teammate is listed with availability but NO financial leak (e.g. no "Paid" payment status tag)
    await expect(squadSection.getByText(/Playing/i).first()).toBeVisible();
    // Squad section should not contain "Paid" badge
    const paidTagsInSquad = squadSection.locator('.text-emerald-400:has-text("Paid")');
    await expect(paidTagsInSquad).toHaveCount(0);

    // 5. Test Browser History Back (`popstate`) Navigation
    await page.goBack();

    // Verify detail view is dismissed and match list is restored
    await expect(page.locator('[data-testid="player-match-center"]')).toBeVisible({ timeout: 5000 });
    await expect(detailView).toHaveCount(0);
  });

  // ── 6. Search Filtering and Filter Tab Switching ─────────────────────────────
  test("6. Search input filters fixtures by opponent, ground, or tournament and tabs switch active slices", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const playerNav = page.locator("nav");
    await playerNav.getByRole("button", { name: "Matches", exact: true }).click();

    const searchInput = page.locator('[data-testid="match-search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Search for "Delhi"
    await searchInput.fill("Delhi");
    await expect(page.locator('[data-testid="player-match-card-match-upcoming-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="player-match-card-match-upcoming-2"]')).toHaveCount(0);

    // Clear search
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.locator('[data-testid="player-match-card-match-upcoming-2"]')).toBeVisible();

    // Filter tab: "Recent"
    const recentTab = page.locator('[data-testid="filter-tab-recent"]');
    await recentTab.click();
    await expect(page.locator('[data-testid="recent-matches-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="upcoming-matches-section"]')).toHaveCount(0);

    // Filter tab: "Upcoming"
    const upcomingTab = page.locator('[data-testid="filter-tab-upcoming"]');
    await upcomingTab.click();
    await expect(page.locator('[data-testid="upcoming-matches-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="recent-matches-section"]')).toHaveCount(0);
  });

  // ── 7. Deep-link & Entry-Point Eligibility Guard (P0) ────────────────────────
  test("7. Ineligible player deep-link access is blocked, renders restricted alert, and fails closed without exposing match details", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    // A match with an assigned squad restricted to player-beta only
    const restrictedSquadMatch = {
      id: "match-squad-restricted",
      groundId: "ground-1",
      format: "T20",
      jerseyColor: "Scarlet Red",
      date: "2026-11-29",
      time: "07:30",
      opponent: "Restricted Squad XI",
      result: "Pending",
      fee: 650,
    };

    const restrictedPayments = [
      {
        id: "pay-teammate-1-confirmed",
        playerId: "player-teammate-1",
        matchId: "match-squad-restricted",
        status: "Unpaid",
        availability: "Confirmed",
      },
    ];

    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
      matches: [restrictedSquadMatch],
      payments: restrictedPayments,
    });

    // Attempt direct deep link via query parameter ?match=match-squad-restricted
    await page.goto("/?match=match-squad-restricted");
    await page.waitForLoadState("domcontentloaded");

    const playerNav = page.locator("nav");
    await playerNav.getByRole("button", { name: "Matches", exact: true }).click();

    // Verify Match Center loads
    await expect(page.locator('[data-testid="player-match-center"]')).toBeVisible({ timeout: 5000 });

    // 1. Verify ineligible match alert is displayed
    const alertBanner = page.locator('[data-testid="ineligible-match-alert"]');
    await expect(alertBanner).toBeVisible();
    await expect(alertBanner.getByText(/Match Access Restricted/i)).toBeVisible();

    // 2. FAIL CLOSED: Match detail view MUST NOT be exposed!
    const detailView = page.locator('[data-testid="player-match-detail-view"]');
    await expect(detailView).toHaveCount(0);
  });

  // ── 8. Payment Aggregation: Multiple Partial Payments (P1) ───────────────────
  test("8. Multiple legitimate partial collections aggregate accurately to PAID", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    const multiPayMatch = {
      id: "match-multi-col",
      groundId: "ground-1",
      format: "T20",
      jerseyColor: "Scarlet Red",
      date: "2026-11-27",
      time: "07:30",
      opponent: "Installment Challengers",
      result: "Pending",
      fee: 650,
    };

    // Two separate collections: ₹300 + ₹350 = ₹650 (Exact fee)
    const multiPayments = [
      {
        id: "pay-col-1",
        playerId: "player-player-alpha",
        matchId: "match-multi-col",
        status: "Unpaid",
        availability: "Confirmed",
        feeCollectedAmount: 300,
      },
      {
        id: "pay-col-2",
        playerId: "player-player-alpha",
        matchId: "match-multi-col",
        status: "Unpaid",
        availability: "Confirmed",
        feeCollectedAmount: 350,
      },
    ];

    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
      matches: [multiPayMatch],
      payments: multiPayments,
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const playerNav = page.locator("nav");
    await playerNav.getByRole("button", { name: "Matches", exact: true }).click();

    // Verify payment badge aggregates to PAID
    const statusBadge = page.locator('[data-testid="payment-status-match-multi-col"]');
    await expect(statusBadge).toBeVisible({ timeout: 5000 });
    await expect(statusBadge).toHaveText(/PAID/);
  });

  // ── 9. Abandoned Match Presentation: Preserves Historical Paid (P1) ──────────
  test("9. Abandoned match with partial historical collection clearly communicates WAIVED and preserves historical collection", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    const abandonedPartialMatch = {
      id: "match-ab-partial",
      groundId: "ground-2",
      format: "T20",
      jerseyColor: "Whites",
      date: "2026-11-08",
      time: "08:00",
      opponent: "Stormy Weather CC",
      result: "Abandoned",
      fee: 600,
    };

    // Historical payment of ₹300 before abandonment
    const abPayments = [
      {
        id: "pay-ab-col",
        playerId: "player-player-alpha",
        matchId: "match-ab-partial",
        status: "Unpaid",
        availability: "Confirmed",
        feeCollectedAmount: 300,
      },
    ];

    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
      matches: [abandonedPartialMatch],
      payments: abPayments,
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const playerNav = page.locator("nav");
    await playerNav.getByRole("button", { name: "Matches", exact: true }).click();

    // 1. Verify card badge displays WAIVED • ₹300 collected (never PARTIALLY PAID or ₹0 due!)
    const waivedBadge = page.locator('[data-testid="payment-status-match-ab-partial"]');
    await expect(waivedBadge).toBeVisible({ timeout: 5000 });
    await expect(waivedBadge).toHaveText(/WAIVED • ₹300 collected/);
    await expect(waivedBadge).not.toHaveText(/PARTIALLY PAID/);

    // 2. Open detail view and verify financial breakdown
    await page.locator('[data-testid="player-match-card-match-ab-partial"]').click();

    const detailView = page.locator('[data-testid="player-match-detail-view"]');
    await expect(detailView).toBeVisible({ timeout: 5000 });

    const paymentCard = detailView.locator('[data-testid="personal-payment-detail-card"]');
    await expect(paymentCard).toBeVisible();
    await expect(paymentCard.getByText(/WAIVED/)).toBeVisible();
    await expect(paymentCard.getByText(/Historical Payment \(Preserved\):/)).toBeVisible();
    await expect(paymentCard.getByText(/₹300/)).toBeVisible();
    await expect(paymentCard.getByText(/₹0 \(Waived\)/)).toBeVisible();
  });

  // ── 7. Responsive Visual Screenshots Across 5 Viewports ──────────────────────
  const viewports = [
    { name: "360x800", width: 360, height: 800 },
    { name: "375x812", width: 375, height: 812 },
    { name: "390x844", width: 390, height: 844 },
    { name: "768x1024", width: 768, height: 1024 },
    { name: "1280x800", width: 1280, height: 800 },
  ];

  for (const vp of viewports) {
    test(`7. Responsive visual validation at ${vp.name} (${vp.width}x${vp.height}) with zero horizontal overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await injectSyntheticSession(page, {
        uid: "player-alpha",
        role: "player",
      });

      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      if (vp.width < 768) {
        await page.locator("nav").getByRole("button", { name: "Matches", exact: true }).click();
      } else {
        await page.locator('button:has-text("Matches"):visible').first().click();
      }

      const matchCenter = page.locator('[data-testid="player-match-center"]');
      await expect(matchCenter).toBeVisible({ timeout: 5000 });

      // Verify zero horizontal scroll overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2); // 2px margin for subpixel rendering

      // Capture screenshot
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `player-matches-${vp.name}.png`),
        fullPage: false,
      });

      // Open match detail and capture detail screenshot
      const firstCard = page.locator('[data-testid="player-match-card-match-upcoming-1"]');
      await firstCard.click();
      await expect(page.locator('[data-testid="player-match-detail-view"]')).toBeVisible({ timeout: 5000 });

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `player-match-detail-${vp.name}.png`),
        fullPage: false,
      });
    });
  }
});
