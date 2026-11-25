import { test, expect } from "@playwright/test";
import { injectSyntheticSession } from "./helpers/synthetic-session";

test.describe("DEF-R3-006: Finance Workspace & Role Navigation Isolation", () => {
  test("Finance Admin sees Home + Finance nav, all 7 Finance sections, and expandable Match Finance on desktop without overflow", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("status of 401")) {
        consoleErrors.push(msg.text());
      }
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await injectSyntheticSession(page, {
      uid: "fin-admin-e2e",
      role: "player",
      isFinanceAdmin: true,
      isClubAdmin: false,
      isSuperAdmin: false,
      matches: [
        {
          id: "m-fin-1",
          opponent: "Strikers XI",
          date: "2026-11-22",
          time: "07:00",
          format: "T20",
          matchType: "Weekend",
          groundId: "ground-1",
          fee: 500,
          result: "Won",
          squadPlayerIds: ["player-fin-admin-e2e"],
        },
      ],
      payments: [
        {
          id: "pay-fin-1",
          matchId: "m-fin-1",
          playerId: "player-fin-admin-e2e",
          status: "Unpaid",
          availability: "Yes",
        },
      ],
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const toggle = page.locator('[data-testid="header-persona-toggle"]');
    await expect(toggle).toBeVisible();
    await toggle.click();

    // Desktop sidebar shows Home and Finance only for Finance Admin-only
    await expect(page.locator('[data-testid="sidebar-tab-home"]')).toBeVisible();
    await expect(page.locator('[data-testid="sidebar-tab-finance"]')).toBeVisible();
    await expect(page.locator('[data-testid="sidebar-tab-matches"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="sidebar-tab-club"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="sidebar-tab-design"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="sidebar-tab-settings"]')).toHaveCount(0);

    // Finance Admin lands on Finance workspace (or can click Finance tab)
    await page.locator('[data-testid="sidebar-tab-finance"]').click();
    const workspace = page.locator('[data-testid="admin-finance-workspace"]');
    await expect(workspace).toBeVisible();

    for (const key of ["overview", "matches", "dues", "razor", "plans", "fee", "activity"]) {
      await expect(page.locator(`[data-testid="finance-tab-${key}"]`)).toBeVisible();
    }

    // Match Finance section & desktop expandable row
    await page.locator('[data-testid="finance-tab-matches"]').click();
    await expect(page.getByText("Match Fee Accounting")).toBeVisible();
    const matchExpandBtn = page.getByRole("button", { name: /0 Paid \/ 1 Unpaid/i }).first();
    await expect(matchExpandBtn).toBeVisible();
    await matchExpandBtn.click();
    await expect(page.getByText("Player fin-admin-e2e").first()).toBeVisible();

    const overflowDesktop = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflowDesktop).toBe(false);

    // Mobile 390x844 check
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileNav = page.locator('[data-testid="admin-mobile-bottom-nav"]');
    await expect(mobileNav).toBeVisible();
    expect(
      await mobileNav.locator("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))),
    ).toEqual(["Home", "Finance"]);

    const overflowMobile = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflowMobile).toBe(false);
    expect(consoleErrors).toEqual([]);
  });

  test("Club Admin-only hides Finance & Settings in desktop/mobile nav and Finance APIs reject unauthenticated/unauthorized calls", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectSyntheticSession(page, {
      uid: "club-admin-e2e",
      role: "player",
      isClubAdmin: true,
      isFinanceAdmin: false,
      isSuperAdmin: false,
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const toggle = page.locator('[data-testid="header-persona-toggle"]');
    await expect(toggle).toBeVisible();
    await toggle.click();

    const mobileNav = page.locator('[data-testid="admin-mobile-bottom-nav"]');
    await expect(mobileNav).toBeVisible();
    expect(
      await mobileNav.locator("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))),
    ).toEqual(["Home", "Match Center", "Club", "Design Studio"]);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('[data-testid="sidebar-tab-finance"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="sidebar-tab-settings"]')).toHaveCount(0);

    // Direct API calls without UI navigation must not return 200
    for (const url of [
      "/api/finance/assignments",
      "/api/finance/reports/sponsorship?from=2026-11-01&to=2026-11-30",
      "/api/finance/subscriptions?month=2026-11",
    ]) {
      const res = await request.get(url);
      expect([401, 403]).toContain(res.status());
    }
  });

  test("Ordinary Player has no Admin persona toggle and cannot see Admin Finance workspace", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectSyntheticSession(page, {
      uid: "player-e2e",
      role: "player",
      isClubAdmin: false,
      isFinanceAdmin: false,
      isSuperAdmin: false,
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator('[data-testid="header-persona-toggle"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="admin-finance-workspace"]')).toHaveCount(0);
  });
});
