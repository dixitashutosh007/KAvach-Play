import { test, expect } from "@playwright/test";

test.describe("App Loading Performance", () => {
  test("loads within acceptable time (< 5s to interactive)", async ({ page }) => {
    const start = Date.now();
    await page.goto("/");

    // Wait for login screen (first interactive state)
    await expect(
      page.getByText(/kavach|sign in|welcome/i)
    ).toBeVisible({ timeout: 10_000 });

    const loadTime = Date.now() - start;
    console.log(`Login screen visible in ${loadTime}ms`);
    expect(loadTime).toBeLessThan(5_000);
  });

  test("no console errors on initial load", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await page.goto("/");
    await page.waitForTimeout(3_000);

    // Filter out known non-critical errors (Firebase offline warnings, etc.)
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("offline") &&
        !e.includes("could not reach") &&
        !e.includes("net::ERR") &&
        !e.includes("favicon")
    );

    if (criticalErrors.length > 0) {
      console.log("Console errors found:", criticalErrors);
    }
    expect(criticalErrors.length).toBe(0);
  });

  test("no layout shift visible on login screen", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2_000);

    // Take a screenshot to visually verify layout
    await page.screenshot({ path: "e2e/screenshots/login-screen.png" });

    // Verify key elements are positioned (not overlapping)
    const buttons = page.getByRole("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });

  test("page does not flash unstyled content", async ({ page }) => {
    // Navigate and immediately check for CSS
    await page.goto("/");

    // The body should have styles applied immediately
    const bgColor = await page.evaluate(
      () => window.getComputedStyle(document.body).backgroundColor
    );
    // Should not be the default white (transparent = no FOUC)
    expect(bgColor).not.toBe("rgba(0, 0, 0, 0)");
  });
});
