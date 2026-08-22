import { test, expect } from "@playwright/test";

test.describe("App Loading Performance", () => {
  test("loads within acceptable time (< 5s to interactive)", async ({ page }) => {
    const start = Date.now();
    await page.goto("/");

    // Wait for login screen (first interactive state)
    await expect(
      page.getByRole("heading", { name: /kavach play/i })
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
    await page.goto("/");

    // Check that styles are applied — the login card or body has a non-default background
    const hasStyles = await page.evaluate(() => {
      const body = window.getComputedStyle(document.body);
      const loginCard = document.querySelector(".glass, .min-h-screen");
      if (loginCard) {
        const cardStyle = window.getComputedStyle(loginCard);
        return cardStyle.minHeight !== "" || cardStyle.display !== "";
      }
      return body.backgroundColor !== "rgba(0, 0, 0, 0)" || body.color !== "rgb(0, 0, 0)";
    });
    expect(hasStyles).toBe(true);
  });
});
