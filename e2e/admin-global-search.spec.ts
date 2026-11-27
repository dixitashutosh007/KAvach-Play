import { test, expect } from "@playwright/test";
import { injectSyntheticSession } from "./helpers/synthetic-session";

test.describe("Admin Global Search — Focused Browser Validation", () => {
  test("Desktop: header button, Cmd/Ctrl+K, Escape, min-length, loading/stale/no-results/error states, and result navigation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await injectSyntheticSession(page, {
      uid: "admin-super-1",
      role: "admin",
      isSuperAdmin: true,
      isClubAdmin: true,
      isFinanceAdmin: true,
      matches: [
        {
          id: "match-strikers",
          opponent: "Strikers XI",
          date: "2026-11-30",
          time: "07:00",
          format: "T20",
          matchType: "Practice",
          groundId: "g-1",
          fee: 800,
          maxSquadSize: 15,
        },
      ],
    });

    let apiCallCount = 0;
    let shouldFailNext = false;

    await page.route("**/api/admin/search*", async (route) => {
      apiCallCount += 1;
      const url = new URL(route.request().url());
      const q = (url.searchParams.get("q") || "").trim();

      if (shouldFailNext) {
        shouldFailNext = false;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Simulated search failure" }),
        });
        return;
      }

      if (q === "Virat") {
        // Delay first query so rapid typing supersedes it
        await new Promise((r) => setTimeout(r, 350));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            query: "Virat",
            totalCount: 1,
            groups: [
              {
                category: "players",
                label: "Players",
                totalMatched: 1,
                items: [
                  {
                    id: "stale-player",
                    category: "players",
                    title: "Stale Virat Result",
                    destination: { tab: "club", action: "players" },
                  },
                ],
              },
            ],
          }),
        });
        return;
      }

      if (q === "Strikers") {
        await new Promise((r) => setTimeout(r, 120));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            query: "Strikers",
            totalCount: 2,
            groups: [
              {
                category: "matches",
                label: "Matches",
                totalMatched: 1,
                items: [
                  {
                    id: "match-strikers",
                    category: "matches",
                    title: "vs Strikers XI",
                    subtitle: "2026-11-30 • T20 • Practice",
                    badges: ["Pending"],
                    meta: "₹800",
                    destination: { tab: "matches", action: "match_match-strikers" },
                  },
                ],
              },
              {
                category: "finance",
                label: "Finance & Dues",
                totalMatched: 1,
                items: [
                  {
                    id: "pay-strikers",
                    category: "finance",
                    title: "Player 1 — vs Strikers XI",
                    badges: ["Match Fee", "Unpaid"],
                    meta: "₹800",
                    destination: { tab: "finance", action: "matches" },
                  },
                ],
              },
            ],
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ query: q, totalCount: 0, groups: [] }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 1. Player persona first: header search opens PlayerGlobalSearchModal
    await page.locator('[data-testid="header-search-btn"]').click();
    await expect(page.locator('[data-testid="global-search-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="global-search-modal"]')).toHaveCount(0);

    // 2. Switch to Admin persona
    await page.locator('[data-testid="header-persona-admin"]').click();
    await expect(page.locator('[data-testid="header-persona-admin"]')).toHaveAttribute("aria-pressed", "true");

    // 3. Open via header button & close via Escape
    await page.locator('[data-testid="header-search-btn"]').click();
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="admin-search-empty-state"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toHaveCount(0);

    // 4. Open via Cmd/Ctrl+K
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toBeVisible();

    const input = page.locator('[data-testid="admin-global-search-input"]');

    // 5. 1-character query does NOT hit API
    const callsBeforeOneChar = apiCallCount;
    await input.fill("V");
    await page.waitForTimeout(300);
    expect(apiCallCount).toBe(callsBeforeOneChar);
    await expect(page.locator('[data-testid="admin-search-empty-state"]')).toContainText("at least 2 characters");

    // 6. Error state + Retry recovery
    shouldFailNext = true;
    await input.fill("Strikers");
    await expect(page.locator('[data-testid="admin-search-error-state"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="admin-search-error-state"] button', { hasText: "Retry" }).click();
    await expect(page.locator('[data-testid="admin-search-group-matches"]')).toBeVisible({ timeout: 5000 });

    // 7. No-results state
    await input.fill("ZzzNoMatch");
    await expect(page.locator('[data-testid="admin-search-no-results"]')).toBeVisible({ timeout: 5000 });

    // 8. Rapid typing: clear -> "Virat" (delayed) superseded by "Strikers" — loading state & no stale results
    await input.fill("");
    await input.fill("Virat");
    await expect(page.locator('[data-testid="admin-search-loading-state"]')).toBeVisible();
    await page.waitForTimeout(260); // let Virat request start
    await input.fill("Strikers");
    await expect(page.locator('[data-testid="admin-search-group-matches"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="admin-search-group-finance"]')).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.getByText("Stale Virat Result")).toHaveCount(0);

    // 9. Select a match result and verify navigation closes modal & opens Match Center
    await page.locator('[data-testid="admin-search-result-matches-match-strikers"]').click();
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toHaveCount(0);
    await expect(page.getByText("Strikers XI").first()).toBeVisible({ timeout: 5000 });
  });

  test("Mobile (375x812): Admin Global Search opens cleanly from header and navigates", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "admin-club-1",
      role: "admin",
      isClubAdmin: true,
    });

    await page.route("**/api/admin/search*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          query: "Ground",
          totalCount: 1,
          groups: [
            {
              category: "grounds",
              label: "Grounds",
              totalMatched: 1,
              items: [
                {
                  id: "g-1",
                  category: "grounds",
                  title: "KAvach Oval Ground",
                  subtitle: "Koramangala",
                  destination: { tab: "matches", action: "grounds" },
                },
              ],
            },
          ],
        }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await page.locator('[data-testid="header-persona-admin"]').click();
    await page.locator('[data-testid="header-search-btn"]').click();
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toBeVisible();

    await page.locator('[data-testid="admin-global-search-input"]').fill("Ground");
    await expect(page.locator('[data-testid="admin-search-group-grounds"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="admin-search-result-grounds-g-1"]').click();
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toHaveCount(0);
  });
});
