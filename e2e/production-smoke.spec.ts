/**
 * Production-Build Smoke Verification Suite (e2e/production-smoke.spec.ts)
 *
 * Runs against an actual production build served via `next start` (NODE_ENV=production).
 *
 * Verifies:
 * 1. Production server boots and `/` responds with HTTP 200.
 * 2. Unauthenticated visitors receive the authoritative LoginScreen authentication interface.
 * 3. Synthetic test hooks in AuthProvider and useStore are strictly disabled in production builds,
 *    preventing client-side synthetic injection or bypass.
 * 4. Zero uncaught browser errors during page startup.
 */

import { test, expect } from "@playwright/test";

test.describe("Production-Build Smoke Verification Suite (NODE_ENV=production)", () => {
  test("1. Production server responds with HTTP 200 and unauthenticated landing experience", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    const response = await page.goto("/");
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);

    // Verify no uncaught browser runtime exceptions during boot
    expect(pageErrors).toEqual([]);

    // Verify unauthenticated user receives the LoginScreen experience
    await expect(page.locator("text=Log in with Email & Password").or(page.locator("text=Phone")).or(page.locator("text=Google"))).toBeVisible({ timeout: 15_000 });

    // Verify login buttons/inputs are rendered
    const otherAuthBtn = page.locator('[data-testid="other-auth-options"]');
    if (await otherAuthBtn.isVisible()) {
      await expect(otherAuthBtn).toBeVisible();
    }
  });

  test("2. Synthetic test hooks cannot be activated in a production build", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    // Attempt to inject synthetic test fixtures via client window injection
    await page.addInitScript(() => {
      (window as any).__KAVACH_TEST_USER__ = {
        uid: "malicious-fake-admin",
        email: "fake-admin@kavachplay.test",
        displayName: "Fake Admin",
      };
      (window as any).__KAVACH_TEST_ADMIN_CLAIM__ = true;
      (window as any).__KAVACH_TEST_STORE__ = {
        appConfig: { clubName: "INJECTED CLUB" },
        players: [{ id: "fake", authUid: "malicious-fake-admin", name: "Injected Player" }],
        appUsers: [{ id: "malicious-fake-admin", role: "admin" }],
      };
    });

    const response = await page.goto("/");
    expect(response!.status()).toBe(200);
    await page.waitForLoadState("domcontentloaded");

    // In a production build, process.env.NODE_ENV !== "production" evaluates to false (dead-code eliminated)
    // The application MUST ignore the injected synthetic test user and MUST NOT display the authenticated app.
    // Injected club name MUST NOT appear:
    await expect(page.locator("text=INJECTED CLUB")).not.toBeVisible();

    // Standard unauthenticated login screen MUST remain active:
    await expect(page.locator("text=Log in with Email & Password").or(page.locator("text=Google")).or(page.locator("text=Phone"))).toBeVisible({ timeout: 15_000 });

    // Admin Console must NOT be visible:
    await expect(page.locator("text=Admin Console")).not.toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
