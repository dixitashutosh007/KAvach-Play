/**
 * D-20 Player UI enhancement — Home, Club and Player Profile (real browser).
 *
 * Local dev server + synthetic session harness (mocked auth, synthetic store;
 * no Firestore, no network writes, no payments). Extra fixtures (a recent
 * announcement, polls, a badge, Studio plans/history, an Out of Play range) are
 * added to the synthetic store before the app boots.
 */
import { test, expect, Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { injectSyntheticSession, RoleConfig } from "./helpers/synthetic-session";

const SHOTS = path.resolve(process.cwd(), "docs/qa/player-ui-enhancement/screenshots");
test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));
const shoot = async (page: Page, name: string) => {
  if (test.info().project.name !== "Desktop Chrome") return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const now = Date.now();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const inThisMonth = (day: number) => iso(new Date(new Date().getFullYear(), new Date().getMonth(), day, 12));

async function open(page: Page, uid: string, extra: Record<string, unknown> = {}, role: Omit<RoleConfig, "uid"> = {}, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await injectSyntheticSession(page, { uid, ...role });
  await page.addInitScript(
    ({ uid, now, extra }) => {
      const s = (window as any).__KAVACH_TEST_STORE__;
      const playerId = `player-${uid}`;
      s.posts = [
        ...(s.posts || []),
        { id: "post-recent-ann", title: "KPL 5.0 Registrations Open!", text: "Auction 20 Oct, tournament 12–14 Dec.", isAnnouncement: true, isPinned: true, comments: [], createdAt: { seconds: Math.floor(now / 1000) - 86400 } },
      ];
      s.polls = [
        { id: "poll-active", title: "Which ground do you prefer for Sunday matches?", type: "singleChoice", options: ["RR Ground", "Sultanpur"], isActive: true, isSticked: false, createdAt: { seconds: Math.floor(now / 1000) - 3600 } },
        { id: "poll-old", title: "Old closed poll", type: "singleChoice", options: ["A", "B"], isActive: false, isSticked: false, createdAt: { seconds: Math.floor(now / 1000) - 90 * 86400 } },
      ];
      s.pollResponses = [
        { id: "r1", pollId: "poll-active", playerId: uid, response: "RR Ground" },
        { id: "r2", pollId: "poll-active", playerId: "someone-else", response: "Sultanpur" },
      ];
      s.badges = [{ id: "b1", playerId: "player-teammate-1", badgeType: "stunner", grantedAt: { seconds: Math.floor(now / 1000) } }];
      s.subscriptionPlans = [{ id: "plan-1m", name: "Monthly Nets Pass", durationDays: 30, fee: 1500, benefits: "Unlimited nets", isActive: true }];
      s.subscriptionHistory = [{ id: "h1", playerId, planId: "plan-1m", planName: "Monthly Nets Pass", paidAmount: 1500, newExpiryDate: "2027-03-31", adminId: "a", adminName: "A", createdAt: { seconds: Math.floor(now / 1000) - 5 * 86400 } }];
      Object.assign(s, extra);
    },
    { uid, now, extra },
  );
  await page.goto("/");
  await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 30_000 });
}

const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

test.describe("D-20 Home", () => {
  test("compact Home: greeting, banner, dues, upcoming matches, Quick Access (4), feed; no announcements or club stats", async ({ page }) => {
    await open(page, "ui-home");
    await expect(page.locator('[data-testid="player-home-greeting"]')).toBeVisible();
    await expect(page.locator('[data-testid="campaign-hero-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="personal-payment-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="upcoming-matches-section"]')).toBeVisible();
    const quick = await page.locator('[data-testid^="home-quick-"]:not([data-testid="home-quick-actions"])').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    expect(quick).toEqual(["home-quick-players", "home-quick-studio", "home-quick-shop", "home-quick-opinion"]);
    await expect(page.locator('[data-testid="club-announcements-section"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="club-performance-message"], [data-testid="club-performance-card"]')).toHaveCount(0);
    // Single page gutter: Home content starts 16px from the viewport edge on mobile.
    const left = await page.locator('[data-testid="player-home-container"]').evaluate((el) => el.getBoundingClientRect().left);
    expect(left).toBe(16);
    await noOverflow(page);
  });
});

test.describe("D-20 Club", () => {
  test("stats card, circuit standings data gap, tiles, 30-day announcements with View More, Pulse preview", async ({ page }) => {
    await open(page, "ui-club");
    await page.locator('[data-testid="player-mobile-bottom-nav"] button[aria-label="Club"]').click();
    await expect(page.locator('[data-testid="player-club"]')).toBeVisible();

    // Circuit standings: no invented ranks
    const standings = page.locator('[data-testid="club-circuit-standings"]');
    await expect(standings).toContainText("Not available");
    await expect(standings).not.toContainText("#1");

    // Tiles
    for (const t of ["leaderboard", "badges", "opinion", "pulse"]) await expect(page.locator(`[data-testid="club-tile-${t}"]`)).toBeVisible();

    // Announcements: only the last 30 days in the preview; View More shows the complete list
    const recent = page.locator('[data-testid="club-recent-announcements"]');
    await expect(recent.locator('[data-testid="club-announcement-post-recent-ann"]')).toBeVisible();
    await expect(recent.locator('[data-testid="club-announcement-post-announcement-1"]')).toHaveCount(0);
    await page.locator('[data-testid="club-announcements-more"]').click();
    await expect(page.locator('[data-testid="announcement-item-post-announcement-1"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="announcement-item-post-recent-ann"]')).toBeVisible();
    await page.locator('[data-testid="player-back-button"]').click();

    // Pulse preview: active poll with participation and vote count; old closed poll excluded
    const pulse = page.locator('[data-testid="club-latest-pulse"]');
    await expect(pulse.locator('[data-testid="club-poll-poll-active"]')).toContainText("2 votes");
    await expect(pulse.locator('[data-testid="club-poll-poll-active"]')).toContainText("You voted");
    await expect(pulse.locator('[data-testid="club-poll-poll-old"]')).toHaveCount(0);
    await page.locator('[data-testid="club-pulse-more"]').click();
    await expect(page.locator('[data-testid="pulse-poll-poll-active"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="pulse-poll-poll-old"]')).toHaveCount(0);
    await page.locator('[data-testid="pulse-show-older"]').click();
    await expect(page.locator('[data-testid="pulse-poll-poll-old"]')).toBeVisible();
    await page.locator('[data-testid="player-back-button"]').click();

    // Section chips filter the page
    await page.locator('[data-testid="club-chip-announcements"]').click();
    await expect(page.locator('[data-testid="club-at-a-glance"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="club-recent-announcements"]')).toBeVisible();
    await page.locator('[data-testid="club-chip-stats"]').click();
    await expect(page.locator('[data-testid="club-at-a-glance"]')).toBeVisible();
    await expect(page.locator('[data-testid="club-latest-pulse"]')).toHaveCount(0);
    await noOverflow(page);
  });

  test("an announcement link (banner / search / Club preview) opens it on the Club Announcements screen", async ({ page }) => {
    await open(page, "ui-ann-link");
    await page.evaluate(() => (window as any).__KAVACH_NAVIGATE_TAB__("announcements", "post-recent-ann"));
    const modal = page.getByRole("dialog", { name: /KPL 5\.0 Registrations Open/i });
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="player-back-button"]')).toHaveAttribute("aria-label", "Back to Club");
    await expect(page.locator('[data-testid="new-announcement-button"]')).toHaveCount(0);
  });

  test("Polls screen loads polls in Player persona (D-16 regression fixed)", async ({ page }) => {
    await open(page, "ui-polls");
    await page.locator('[data-testid="home-quick-opinion"]').click();
    await expect(page.getByText("Which ground do you prefer for Sunday matches?").first()).toBeVisible({ timeout: 10_000 });
  });

  test("Directory: paginated members, public profile without private fields, badges for that member", async ({ page }) => {
    await open(page, "ui-dir");
    await page.locator('[data-testid="player-mobile-bottom-nav"] button[aria-label="Club"]').click();
    await page.locator('[data-testid="club-directory-link"]').click();
    await expect(page.locator('[data-testid="player-directory"]')).toBeVisible();
    await expect(page.locator('[data-testid="directory-count"]')).toContainText("3 members");
    const dirText = await page.locator('[data-testid="player-directory"]').innerText();
    expect(dirText).not.toMatch(/\+91|98111/);
    await page.locator('[data-testid="directory-player-player-teammate-1"]').click();
    const profile = page.locator('[data-testid="public-player-profile"]');
    await expect(profile).toContainText("Rohit Sharma");
    await expect(profile).toContainText("KAV-045");
    const text = await profile.innerText();
    for (const secret of ["+919811100001", "9811100001", "O+", "South Delhi"]) expect(text).not.toContain(secret);
    await expect(profile).toContainText(/Stunner|Badges/);
    await shoot(page, "club-public-profile-390x844");
  });
});

test.describe("D-20 Player Profile", () => {
  test("identity, chips, personal info + edit, badges, Studio plans for non-members, dues, history, calendar, catches", async ({ page }) => {
    await open(page, "ui-prof", { outOfPlays: [{ id: "o1", playerId: "player-ui-prof", startDate: inThisMonth(10), endDate: inThisMonth(12) }] });
    await page.locator('[data-testid="header-profile-avatar"]').click();
    const hub = page.locator('[data-testid="player-profile-hub"]');
    await expect(hub).toBeVisible();
    await expect(page.locator('[data-testid="profile-name"]')).toContainText("Player ui-prof");
    await expect(page.locator('[data-testid="profile-player-id"]')).toContainText("KAV-018");
    for (const c of ["overview", "payments", "membership", "performance"]) await expect(page.locator(`[data-testid="profile-chip-${c}"]`)).toBeVisible();

    // Studio: not a member → plans from configuration and a join action into the existing Studio flow
    await expect(page.locator('[data-testid="profile-studio-status"]')).toHaveText("Inactive");
    await expect(page.locator('[data-testid="profile-studio-plans"]')).toContainText("Monthly Nets Pass");
    await expect(page.locator('[data-testid="profile-studio-plans"]')).toContainText("₹1500");

    // Personal information (own data) and Edit uses the existing form
    await page.locator('[data-testid="profile-row-personal"]').click();
    await expect(page.locator('[data-testid="profile-personal-info"]')).toContainText("Right-hand bat");
    await page.locator('[data-testid="profile-personal-edit"]').click();
    await expect(page.locator("form")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(hub).toBeVisible();

    // Past payments: match/club fees and Studio membership payments
    await page.locator('[data-testid="profile-chip-payments"]').click();
    await expect(page.locator('[data-testid="profile-dues"]')).toBeVisible();
    await page.locator('[data-testid="profile-row-history"]').click();
    await expect(page.locator('[data-testid="profile-studio-history"]')).toContainText("Monthly Nets Pass");
    await expect(page.locator('[data-testid="profile-studio-history"]')).toContainText("₹1500");
    await page.locator('[data-testid="profile-panel-back"]').click();

    // Out of Play calendar marks the stored range
    await page.locator('[data-testid="profile-chip-overview"]').click();
    await page.locator('[data-testid="profile-row-calendar"]').click();
    expect(await page.locator('[data-testid="out-of-play-calendar"] [data-blocked="true"]').count()).toBe(3);
    await page.locator('[data-testid="profile-panel-back"]').click();

    // Performance: catches only
    await page.locator('[data-testid="profile-row-performance"]').click();
    await expect(page.locator('[data-testid="profile-stunning"]')).toHaveText("5");
    await expect(page.locator('[data-testid="profile-dropped"]')).toHaveText("0");
    await noOverflow(page);
  });

  test("active Studio member sees status and validity", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectSyntheticSession(page, { uid: "ui-member" });
    await page.addInitScript(() => {
      const s = (window as any).__KAVACH_TEST_STORE__;
      const p = s.players.find((x: any) => x.id === "player-ui-member");
      p.isStudioMember = true;
      p.studioExpiryDate = "2099-03-31";
    });
    await page.goto("/");
    await page.locator('[data-testid="header-profile-avatar"]').click();
    await expect(page.locator('[data-testid="profile-studio-status"]')).toHaveText("Active");
    await expect(page.locator('[data-testid="profile-studio-detail"]')).toContainText("Valid till 31/03/2099");
  });
});

test.describe("D-20 responsive + screenshots", () => {
  for (const [w, h] of [[360, 800], [390, 844], [430, 932], [768, 1024], [1280, 800], [1440, 900]] as const) {
    test(`Home, Club, Profile at ${w}×${h} — no horizontal overflow`, async ({ page }) => {
      await open(page, `shot-${w}`, {}, {}, w, h);
      await noOverflow(page);
      await shoot(page, `home-${w}x${h}`);
      await page.evaluate(() => (window as any).__KAVACH_NAVIGATE_TAB__("club"));
      await expect(page.locator('[data-testid="player-club"]')).toBeVisible();
      await noOverflow(page);
      await shoot(page, `club-${w}x${h}`);
      await page.evaluate(() => (window as any).__KAVACH_NAVIGATE_TAB__("profile"));
      await expect(page.locator('[data-testid="player-profile-hub"]')).toBeVisible();
      await noOverflow(page);
      await shoot(page, `profile-${w}x${h}`);
    });
  }
});
