import { test, expect, type Page } from "@playwright/test";
import { injectSyntheticSession } from "./helpers/synthetic-session";

/**
 * Real-browser verification for the Match Center corrections:
 * - no visible RSVP / jersey-colour text on Match Center or Player Home
 * - jersey shown as infographic, alternating card surfaces
 * - expand/collapse and availability actions never open the detail view; card tap does
 * - admin authority from appUsers flags / claim, never from the role string alone
 *
 * Uses the injected synthetic store only (no Firebase / Firestore access).
 */

const FORBIDDEN_VISIBLE = [/\bRSVP\b/i, /Scarlet Red/i, /\bWhites\b/, /Immediate Fixture/i, /Report By/i, /Your Availability/i];

async function expectNoForbiddenText(page: Page) {
  const text = await page.locator("body").innerText();
  for (const pattern of FORBIDDEN_VISIBLE) {
    expect(text, `visible text must not match ${pattern}`).not.toMatch(pattern);
  }
}

async function openMatches(page: Page) {
  // Mobile bottom nav and desktop header nav both expose a visible "Matches" button.
  await page.locator('button:has-text("Matches"):visible').first().click();
  await expect(page.locator('[data-testid="player-match-center"]')).toBeVisible({ timeout: 10000 });
}

test.describe("Match Center corrections — real browser", () => {
  test("Match Center: no RSVP or jersey text, infographic shown, cards alternate", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, { uid: "player-alpha", role: "player" });
    await page.goto("/");
    await openMatches(page);

    await expectNoForbiddenText(page);
    await expect(page.locator('[data-testid="jersey-infographic"]').first()).toBeVisible();

    const variants = await page
      .locator('[data-testid^="player-match-card-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-variant")));
    expect(variants.length).toBeGreaterThan(1);
    expect(variants).toContain("alternate");
    expect(variants).toContain("default");
  });

  test("Expand toggles details without opening the detail view; card tap opens it", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, { uid: "player-alpha", role: "player" });
    await page.goto("/");
    await openMatches(page);

    const card = page.locator('[data-testid="player-match-card-match-upcoming-1"]');
    const expand = page.locator('[data-testid="expand-button-match-upcoming-1"]');
    await expand.click();
    await expect(expand).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('[data-testid="match-secondary-details-match-upcoming-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="player-match-detail-view"]')).toHaveCount(0);

    await expand.click();
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('[data-testid="player-match-detail-view"]')).toHaveCount(0);

    // Availability action must not open the detail view.
    await card.getByRole("radio", { name: "Mark availability as Tentative" }).click();
    await expect(page.getByText(/Availability updated: Tentative/i)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="player-match-detail-view"]')).toHaveCount(0);

    // Card tap (on the opponent heading) opens the detail view.
    await card.getByText(/vs Delhi Challengers/i).click();
    await expect(page.locator('[data-testid="player-match-detail-view"]')).toBeVisible({ timeout: 5000 });
    await expectNoForbiddenText(page);
  });

  test("Keyboard: 'View Details' button opens the detail view", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await injectSyntheticSession(page, { uid: "player-alpha", role: "player" });
    await page.goto("/");
    await openMatches(page);

    const viewDetails = page.locator('[data-testid="view-details-match-upcoming-1"]');
    await viewDetails.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="player-match-detail-view"]')).toBeVisible({ timeout: 5000 });
  });

  test("Player Home: upcoming cards show no RSVP / jersey text and use the infographic", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, { uid: "player-alpha", role: "player" });
    await page.goto("/");
    const section = page.locator('[data-testid="upcoming-matches-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });

    await expectNoForbiddenText(page);
    await expect(section.locator('[data-testid="jersey-infographic"]').first()).toBeVisible();
    await expect(section.getByRole("radio", { name: "Mark availability as Playing" }).first()).toBeVisible();
    await expect(section.getByRole("radio", { name: "Mark availability as Out" }).first()).toBeVisible();
  });

  test("Admin access comes from appUsers permission flags", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await injectSyntheticSession(page, { uid: "match-admin", role: "player", isMatchAdmin: true });
    await page.goto("/");
    await expect(page.locator('[data-testid="header-persona-toggle"]')).toBeVisible({ timeout: 10000 });
  });

  test("role: 'admin' string without flags or claim does NOT grant admin access", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await injectSyntheticSession(page, { uid: "role-only", role: "admin" });
    await page.goto("/");
    await expect(page.locator('[data-testid="upcoming-matches-section"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="header-persona-toggle"]')).toHaveCount(0);
  });
});
