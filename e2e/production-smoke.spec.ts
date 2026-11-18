/**
 * Production-Build Smoke Verification Suite (e2e/production-smoke.spec.ts)
 *
 * Runs against an actual production build served via `next start` (NODE_ENV=production).
 *
 * Scope & Limitations:
 * This smoke suite verifies production server startup, unauthenticated landing readiness,
 * absence/non-functionality of development-mode synthetic test hooks, and absence of
 * uncaught browser runtime exceptions during boot.
 * It does NOT test authenticated user workflows, server-side RBAC token verification,
 * or live Firestore security rules (which are verified via Firebase Emulator suites).
 */

import { test, expect } from "@playwright/test";

test.describe("Production-Build Smoke Verification Suite (NODE_ENV=production)", () => {
  test("1. Production server responds with HTTP 200, renders unauthenticated LoginScreen, and boots with zero runtime exceptions", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    const response = await page.goto("/");
    expect(response, "HTTP response must not be null").not.toBeNull();
    expect(response!.status(), "HTTP status must be 200").toBe(200);

    // 1. Wait for application readiness: authoritative LoginScreen branding
    const brandHeading = page.locator('h1:has-text("Kavach Play")');
    await expect(brandHeading).toBeVisible({ timeout: 15_000 });

    const portalSubheading = page.locator("text=Sports Management Portal");
    await expect(portalSubheading).toBeVisible({ timeout: 5000 });

    // 2. Unauthenticated user must see phone/google authentication entry point (non-conditional)
    const phoneInput = page.locator('input[type="tel"]');
    const googleButton = page.locator('button:has-text("Sign in with Google")');
    await expect(phoneInput.or(googleButton)).toBeVisible({ timeout: 5000 });

    // 3. Authenticated-only surfaces must NOT be rendered
    await expect(page.locator("nav")).not.toBeVisible();
    await expect(page.locator("text=Admin Console")).not.toBeVisible();
    await expect(page.locator("text=Return to Player View")).not.toBeVisible();

    // 4. Assert zero uncaught browser runtime exceptions after full hydration and readiness
    expect(
      pageErrors.map((e) => e.message),
      "No uncaught browser runtime exceptions should occur during startup",
    ).toEqual([]);
  });

  test("2. Synthetic test hooks are strictly absent or non-functional in the production runtime", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    // Attempt synthetic identity and state injection before page initialization
    await page.addInitScript(() => {
      (window as any).__KAVACH_TEST_USER__ = {
        uid: "malicious-fake-admin-uid",
        email: "fake-admin@kavachplay.test",
        displayName: "Malicious Fake Admin",
      };
      (window as any).__KAVACH_TEST_ADMIN_CLAIM__ = true;
      (window as any).__KAVACH_TEST_STORE__ = {
        appConfig: { clubName: "INJECTED MALICIOUS CLUB" },
        players: [{ id: "fake", authUid: "malicious-fake-admin-uid", name: "Injected Player" }],
        appUsers: [{ id: "malicious-fake-admin-uid", role: "admin", isSuperAdmin: true }],
      };
    });

    const response = await page.goto("/");
    expect(response, "HTTP response must not be null").not.toBeNull();
    expect(response!.status(), "HTTP status must be 200").toBe(200);

    // Wait for application readiness
    const brandHeading = page.locator('h1:has-text("Kavach Play")');
    await expect(brandHeading).toBeVisible({ timeout: 15_000 });

    // Verify each synthetic hook:
    // In production build, process.env.NODE_ENV !== "production" is dead-code eliminated (statically false).
    // The application MUST NOT read __KAVACH_TEST_USER__, __KAVACH_TEST_ADMIN_CLAIM__, or __KAVACH_TEST_STORE__.
    // And the application MUST NOT attach its own internal __KAVACH_NAVIGATE_TAB__ or __KAVACH_SET_PERSONA__ hooks to window.
    const appHooks = await page.evaluate(() => {
      return {
        hasNavigateHook: typeof (window as any).__KAVACH_NAVIGATE_TAB__ !== "undefined",
        hasSetPersonaHook: typeof (window as any).__KAVACH_SET_PERSONA__ !== "undefined",
      };
    });

    // In a production build, app/page.tsx strictly isolates navigation hooks behind process.env.NODE_ENV !== "production"
    expect(appHooks.hasNavigateHook, "__KAVACH_NAVIGATE_TAB__ must not be attached in production").toBe(false);
    expect(appHooks.hasSetPersonaHook, "__KAVACH_SET_PERSONA__ must not be attached in production").toBe(false);

    // Injected club name and user identity must NOT appear in DOM
    await expect(page.locator("text=INJECTED MALICIOUS CLUB")).not.toBeVisible();
    await expect(page.locator("text=Malicious Fake Admin")).not.toBeVisible();

    // Authenticated application navigation or Admin Console must NOT be unlocked
    await expect(page.locator("nav")).not.toBeVisible();
    await expect(page.locator("text=Admin Console")).not.toBeVisible();
    await expect(page.locator("text=Return to Player View")).not.toBeVisible();

    // The user MUST remain unauthenticated on LoginScreen
    await expect(page.locator("text=Sports Management Portal")).toBeVisible();

    // Verify zero uncaught browser runtime exceptions after synthetic injection attempt
    expect(
      pageErrors.map((e) => e.message),
      "Synthetic injection attempts must not cause uncaught runtime crashes",
    ).toEqual([]);
  });
});
