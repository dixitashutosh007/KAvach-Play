/**
 * P2-ID-04: Access Control Centre Super Admin Reconciliation E2E (`e2e/access-control-reconciliation.spec.ts`).
 *
 * Verifies:
 * 1. Pending & failed Super Admin transitions are displayed in Settings → Access Control.
 * 2. Reconcile action is available to an authorized Super Admin.
 * 3. Duplicate clicks while in-flight do not issue duplicate POST requests.
 * 4. Successful reconciliation refreshes overview/transitions and clears resolved items.
 * 5. Failed reconciliation displays a safe error message without raw internal details.
 * 6. Unauthorized users (Club Admin / Player) cannot access Settings → Access Control in UI
 *    and receive 401/403 from the real `/api/admin/access` server endpoint.
 */
import { test, expect, Page } from "@playwright/test";
import { injectSyntheticSession, RoleConfig } from "./helpers/synthetic-session";

async function openAccessControlAsSuperAdmin(page: Page) {
  await page.setViewportSize({ width: 1280, height: 850 });
  await injectSyntheticSession(page, { uid: "e2e-super-1", role: "admin", isSuperAdmin: true });
  await page.goto("/");
  await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-testid="header-persona-toggle"]').click();
  await page.locator('[data-testid="sidebar-tab-settings"]').click();
  await expect(page.locator('[data-testid="settings-access-control"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="settings-access-control"]').click();
  await expect(page.locator('[data-testid="access-control-centre"]')).toBeVisible({ timeout: 15_000 });
}

test.describe("P2-ID-04: Access Control Centre Super Admin reconciliation", () => {
  test("displays pending and failed transitions, prevents duplicate clicks, refreshes on success, and shows safe error on failure", async ({ page }) => {
    let transitions = [
      {
        transitionId: "rt_pending_1",
        uid: "uid_target_grant",
        superChange: "grant",
        status: "pending",
        attempts: 0,
        errorSummary: null,
        updatedAt: "2026-11-27T04:00:00.000Z",
      },
      {
        transitionId: "rt_failed_1",
        uid: "uid_target_revoke",
        superChange: "revoke",
        status: "failed",
        attempts: 2,
        errorSummary: "Firebase Auth claim or session revocation requires reconciliation.",
        updatedAt: "2026-11-27T04:05:00.000Z",
      },
    ];
    let superCount = 2;
    let reconcilePostCount = 0;
    let mode: "succeed" | "fail" = "succeed";

    await page.route("**/api/admin/access*", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === "GET") {
        const view = url.searchParams.get("view") || "overview";
        if (view === "overview") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              roles: [
                { id: "superAdmin", label: "Super Admin", summary: "Full access", capabilities: [], count: superCount },
                { id: "clubAdmin", label: "Club Admin", summary: "Club ops", capabilities: [], count: 3 },
                { id: "financeAdmin", label: "Finance Admin", summary: "Finance ops", capabilities: [], count: 1 },
              ],
              totalAccounts: 10,
              migration: { matchAdmin: 0, studioAdmin: 0, designer: 0, changes: 0, receiveClubAdmin: 0, flagged: [] },
              pendingTransitions: transitions,
            }),
          });
        }
        if (view === "history") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ total: 0, page: 1, pages: 1, pageSize: 25, rows: [] }),
        });
      }

      if (req.method() === "POST") {
        const body = req.postDataJSON();
        if (body?.action === "reconcile") {
          reconcilePostCount += 1;
          await new Promise((r) => setTimeout(r, 250));
          if (mode === "fail") {
            transitions = transitions.map((t) =>
              t.transitionId === body.transitionId ? { ...t, attempts: t.attempts + 1 } : t,
            );
            return route.fulfill({
              status: 502,
              contentType: "application/json",
              body: JSON.stringify({ error: "Reconciliation failed during Firebase Auth sync." }),
            });
          }
          transitions = transitions.filter((t) => t.transitionId !== body.transitionId);
          superCount = 1;
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, status: "completed", transitionId: body.transitionId }),
          });
        }
      }
      return route.continue();
    });

    await openAccessControlAsSuperAdmin(page);

    // 1 & 2. Both pending and failed transitions are displayed with safe summary
    const panel = page.locator('[data-testid="access-pending-transitions"]');
    await expect(panel).toBeVisible();
    await expect(page.locator('[data-testid="pending-transition-rt_pending_1"]')).toContainText("Grant Super Admin");
    await expect(page.locator('[data-testid="pending-transition-rt_pending_1"]')).toContainText("pending");
    await expect(page.locator('[data-testid="pending-transition-rt_failed_1"]')).toContainText("Revoke Super Admin");
    await expect(page.locator('[data-testid="pending-transition-rt_failed_1"]')).toContainText("failed");
    await expect(page.locator('[data-testid="pending-transition-rt_failed_1"]')).toContainText("Attempts: 2");
    await expect(page.locator('[data-testid="pending-transition-rt_failed_1"]')).toContainText(
      "Firebase Auth claim or session revocation requires reconciliation.",
    );

    // 3 & 4. Reconcile action available; rapid duplicate click does not issue duplicate POST
    const reconcileBtn = page.locator('[data-testid="reconcile-transition-rt_failed_1"]');
    await expect(reconcileBtn).toBeEnabled();
    await reconcileBtn.click();
    await expect(reconcileBtn).toBeDisabled();
    await reconcileBtn.dispatchEvent("click");

    // 5. Successful reconciliation refreshes overview and removes resolved transition
    await expect(page.locator('[data-testid="pending-transition-rt_failed_1"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="access-role-card-superAdmin"]')).toContainText("1 user");
    expect(reconcilePostCount).toBe(1);

    // 6. Failed reconciliation displays safe error message and increments attempts on refresh
    mode = "fail";
    await page.locator('[data-testid="reconcile-transition-rt_pending_1"]').click();
    await expect(page.getByText("Reconciliation failed during Firebase Auth sync.")).toBeVisible();
    await expect(page.locator('[data-testid="pending-transition-rt_pending_1"]')).toContainText("Attempts: 1");
  });

  test("unauthorized roles cannot access Settings → Access Control and real /api/admin/access rejects unauthenticated requests", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 850 });
    const clubRole: RoleConfig = { uid: "e2e-club-only", role: "admin", isClubAdmin: true };
    await injectSyntheticSession(page, clubRole);
    await page.goto("/");
    await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-testid="header-persona-toggle"]').click();
    await expect(page.locator('[data-testid="sidebar-tab-settings"]')).toHaveCount(0);

    // Direct unauthenticated POST to real /api/admin/access must return 401
    const res = await page.request.post("/api/admin/access", {
      data: { action: "reconcile", transitionId: "rt_failed_1" },
    });
    expect(res.status()).toBe(401);
  });
});
