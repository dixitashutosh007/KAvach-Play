import { test, expect } from "@playwright/test";
import { injectSyntheticSession } from "./helpers/synthetic-session";

test.describe("Admin Global Search 2.0 — Focused Browser Validation", () => {
  test("Desktop: commands, direct object navigation, return-to-search, browser back, keyboard nav, and Player search", async ({
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
          date: "2026-12-29",
          time: "07:00",
          format: "T20",
          matchType: "Practice",
          groundId: "g-1",
          fee: 800,
          maxSquadSize: 15,
        },
      ],
      posts: [
        {
          id: "ann-1",
          title: "Winter Kit Announcement",
          text: "Collect kits on Sunday",
          authorName: "Coach",
          isAnnouncement: true,
          isPinned: true,
          comments: [],
          createdAt: 1764000000000,
        },
        {
          id: "feed-1",
          text: "Sunday Practice Highlights",
          authorName: "KAvach Badges",
          isAnnouncement: false,
          comments: [],
          createdAt: 1764000000000,
        },
      ],
    });

    page.on("pageerror", (err) => console.error("[PLAYWRIGHT PAGEERROR]", err));

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
        await new Promise((r) => setTimeout(r, 320));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            query: "Virat",
            totalCount: 1,
            commands: [],
            dateResults: [],
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
                    destination: { tab: "club", action: "players:player_stale" },
                  },
                ],
              },
            ],
          }),
        });
        return;
      }

      if (q === "Strikers") {
        await new Promise((r) => setTimeout(r, 80));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            query: "Strikers",
            totalCount: 2,
            commands: [],
            dateResults: [],
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
                    subtitle: "2026-12-29 • T20 • Practice",
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
                    destination: { tab: "finance", action: "matches:match-strikers" },
                  },
                ],
              },
            ],
          }),
        });
        return;
      }

      if (q === "Winter") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            query: "Winter",
            totalCount: 2,
            commands: [],
            dateResults: [],
            groups: [
              {
                category: "announcements",
                label: "Announcements",
                totalMatched: 1,
                items: [
                  {
                    id: "ann-1",
                    category: "announcements",
                    title: "Winter Kit Announcement",
                    destination: { tab: "club", action: "announcements:open:ann-1" },
                  },
                ],
              },
              {
                category: "feedPosts",
                label: "Feed Posts",
                totalMatched: 1,
                items: [
                  {
                    id: "feed-1",
                    category: "feedPosts",
                    title: "Sunday Practice Highlights",
                    destination: { tab: "club", action: "announcements:post:feed-1" },
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

    // 1. Player persona remains unchanged
    await page.locator('[data-testid="header-search-btn"]').click();
    await expect(page.locator('[data-testid="global-search-modal"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="global-search-modal"]')).toHaveCount(0);

    // 2. Switch to Admin persona
    await page.locator('[data-testid="header-persona-admin"]').click();
    await expect(page.locator('[data-testid="header-persona-admin"]')).toHaveAttribute("aria-pressed", "true");

    // 3. Open via header button & close via Escape
    await page.locator('[data-testid="header-search-btn"]').click();
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toHaveCount(0);

    // 4. Open via Cmd/Ctrl+K
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toBeVisible();

    const input = page.locator('[data-testid="admin-global-search-input"]');

    // 5. 1-character query does NOT hit API
    const callsBeforeOneChar = apiCallCount;
    await input.fill("V");
    await page.waitForTimeout(220);
    expect(apiCallCount).toBe(callsBeforeOneChar);
    await expect(page.locator('[data-testid="admin-search-empty-state"]')).toContainText("at least 2 characters");

    // 6. Error state + Retry recovery
    shouldFailNext = true;
    await input.fill("Strikers");
    await expect(page.locator('[data-testid="admin-search-error-state"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="admin-search-error-state"] button', { hasText: "Retry" }).click();
    await expect(page.locator('[data-testid="admin-search-group-matches"]')).toBeVisible({ timeout: 5000 });

    // 7. Rapid typing: clear -> "Virat" superseded by "Strikers" — no stale results
    await input.fill("");
    await input.fill("Virat");
    await page.waitForTimeout(200);
    await input.fill("Strikers");
    await expect(page.locator('[data-testid="admin-search-group-matches"]')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(350);
    await expect(page.getByText("Stale Virat Result")).toHaveCount(0);

    // 8. Keyboard navigation (ArrowDown + Enter) opens Match detail & shows Back to Search
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toHaveCount(0);
    await expect(page.getByText("Strikers XI").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="admin-back-to-search"]')).toBeVisible();

    // 9. Back to Search preserves query ("Strikers") & results
    await page.locator('[data-testid="admin-back-to-search"]').click();
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="admin-global-search-input"]')).toHaveValue("Strikers");
    await expect(page.locator('[data-testid="admin-search-group-matches"]')).toBeVisible();

    // 10. Direct Announcement navigation + Browser Back returns to search
    await input.fill("Winter");
    await expect(page.locator('[data-testid="admin-search-result-announcements-ann-1"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="admin-search-result-announcements-ann-1"]').click();
    await expect(page.getByText("Collect kits on Sunday").first()).toBeVisible({ timeout: 5000 });
    await page.goBack();
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="admin-global-search-input"]')).toHaveValue("Winter");

    // 11. Commands: View Date ("29 Dec") filters Match Schedule
    await input.fill("29 Dec");
    await expect(page.locator('[data-testid="admin-search-date-2026-12-29"]')).toBeVisible();
    await page.locator('[data-testid="admin-search-date-2026-12-29"]').click();
    await expect(page.locator('[data-testid="matches-date-filter"]')).toContainText("2026-12-29");

    // 12. Command: Add Match opens Add Match wizard
    await page.locator('[data-testid="admin-back-to-search"]').click();
    await input.fill("Add Match");
    await expect(page.locator('[data-testid="admin-search-command-cmd-add-match"]')).toBeVisible();
    await page.locator('[data-testid="admin-search-command-cmd-add-match"]').click();
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toHaveCount(0);
  });

  test("Mobile (375x812): Club Admin sees Club commands, no financial commands, and navigates directly", async ({
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
          query: "Unpaid",
          totalCount: 0,
          commands: [],
          dateResults: [],
          groups: [],
        }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await page.locator('[data-testid="header-persona-admin"]').click();
    await page.locator('[data-testid="header-search-btn"]').click();
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toBeVisible();

    const input = page.locator('[data-testid="admin-global-search-input"]');
    await input.fill("Unpaid");
    await expect(page.locator('[data-testid="admin-search-command-cmd-unpaid-players"]')).toHaveCount(0);

    await input.fill("Grant Badge");
    await expect(page.locator('[data-testid="admin-search-command-cmd-badge"]')).toBeVisible();
    await page.locator('[data-testid="admin-search-command-cmd-badge"]').click();
    await expect(page.locator('[data-testid="admin-global-search-modal"]')).toHaveCount(0);
  });

  test("Direct object navigation & Back to Search across Ground, Player, Feed Post, Tournament, Studio, Badge, and Catch", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await injectSyntheticSession(page, {
      uid: "admin-super-2",
      role: "admin",
      isSuperAdmin: true,
      isClubAdmin: true,
      isFinanceAdmin: true,
      tournaments: [
        {
          id: "t-1",
          name: "Royal Premier Cup",
          groundId: "g-1",
          organiserName: "Org",
          organiserPhone: "9000000000",
          gpayNumber: "9000000000",
          jerseyColor: "Scarlet Red",
          format: "T20",
          amountPerMatch: 10000,
          perPlayerFee: 900,
          status: "Ongoing",
        },
      ],
      posts: [
        {
          id: "feed-1",
          text: "Sunday Practice Highlights",
          authorName: "KAvach Badges",
          isAnnouncement: false,
          comments: [],
          createdAt: 1764000000000,
        },
      ],
    });

    await page.route("**/api/admin/search*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          query: "Royal",
          totalCount: 7,
          commands: [],
          dateResults: [],
          groups: [
            {
              category: "grounds",
              label: "Grounds",
              totalMatched: 1,
              items: [
                {
                  id: "g-1",
                  category: "grounds",
                  title: "KAvach Oval",
                  destination: { tab: "matches", action: "grounds:g-1" },
                },
              ],
            },
            {
              category: "players",
              label: "Players",
              totalMatched: 1,
              items: [
                {
                  id: "player-admin-super-2",
                  category: "players",
                  title: "Player admin-super-2",
                  destination: { tab: "club", action: "players:player_player-admin-super-2" },
                },
              ],
            },
            {
              category: "feedPosts",
              label: "Feed Posts",
              totalMatched: 1,
              items: [
                {
                  id: "feed-1",
                  category: "feedPosts",
                  title: "Sunday Practice Highlights",
                  destination: { tab: "club", action: "announcements:post:feed-1" },
                },
              ],
            },
            {
              category: "tournaments",
              label: "Tournaments",
              totalMatched: 1,
              items: [
                {
                  id: "t-1",
                  category: "tournaments",
                  title: "Royal Premier Cup",
                  destination: { tab: "matches", action: "tournaments:t-1" },
                },
              ],
            },
            {
              category: "studio",
              label: "Studio",
              totalMatched: 1,
              items: [
                {
                  id: "studio_member_player-admin-super-2",
                  category: "studio",
                  title: "Player admin-super-2 — Studio Membership",
                  destination: { tab: "club", action: "studio:player_player-admin-super-2" },
                },
              ],
            },
            {
              category: "badges",
              label: "Badges",
              totalMatched: 1,
              items: [
                {
                  id: "b-1",
                  category: "badges",
                  title: "Hat-Trick — Player",
                  destination: { tab: "club", action: "badges:open:b-1" },
                },
              ],
            },
            {
              category: "catches",
              label: "Catches",
              totalMatched: 1,
              items: [
                {
                  id: "c-1",
                  category: "catches",
                  title: "Player — Stunning Catch",
                  destination: { tab: "club", action: "badges:catch:c-1" },
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

    const input = page.locator('[data-testid="admin-global-search-input"]');
    await input.fill("Royal");
    await expect(page.locator('[data-testid="admin-search-result-grounds-g-1"]')).toBeVisible({ timeout: 5000 });

    // 1. Ground direct navigation + Back to Search
    await page.locator('[data-testid="admin-search-result-grounds-g-1"]').click();
    await expect(page.getByText("Grounds Network")).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="admin-back-to-search"]').click();
    await expect(input).toHaveValue("Royal");

    // 2. Player direct navigation + Back to Search
    await page.locator('[data-testid="admin-search-result-players-player-admin-super-2"]').click();
    await expect(page.getByText("Player admin-super-2").first()).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="admin-back-to-search"]').click();
    await expect(input).toHaveValue("Royal");

    // 3. Regular Feed Post direct navigation + Back to Search
    await page.locator('[data-testid="admin-search-result-feedPosts-feed-1"]').click();
    await expect(page.locator('[data-testid="admin-feed-post-detail-modal"]')).toBeVisible({ timeout: 5000 });
    await page.getByLabel("Close post detail").click();
    await page.locator('[data-testid="admin-back-to-search"]').click();
    await expect(input).toHaveValue("Royal");

    // 4. Tournament direct navigation + Back to Search
    await page.locator('[data-testid="admin-search-result-tournaments-t-1"]').click();
    await expect(page.getByText("Royal Premier Cup").first()).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="admin-back-to-search"]').click();
    await expect(input).toHaveValue("Royal");

    // 5. Studio Subscription direct navigation + Back to Search
    await page.locator('[data-testid="admin-search-result-studio-studio_member_player-admin-super-2"]').click();
    await expect(page.locator('[data-testid="admin-club"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="admin-back-to-search"]').click();
    await expect(input).toHaveValue("Royal");

    // 6. Badge direct navigation + Back to Search
    await page.locator('[data-testid="admin-search-result-badges-b-1"]').click();
    await expect(page.locator('[data-testid="admin-club"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="admin-back-to-search"]').click();
    await expect(input).toHaveValue("Royal");

    // 7. Catch direct navigation + Back to Search
    await page.locator('[data-testid="admin-search-result-catches-c-1"]').click();
    await expect(page.locator('[data-testid="admin-club"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="admin-back-to-search"]').click();
    await expect(input).toHaveValue("Royal");
  });
});
