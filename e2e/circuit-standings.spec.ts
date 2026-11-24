/**
 * Circuit Standings — the club's rank and total in each circuit.
 * Admin Club → Club Stats manager and the Player Club display.
 *
 * Local dev server + synthetic session harness (no Firestore). The API is mocked
 * here and the mock updates the synthetic store the same way the live Firestore
 * listener would; authorisation, validation and persistence are covered against the
 * emulator in tests/circuit-standings.emulator.test.mjs.
 */
import { test, expect, Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { injectSyntheticSession, RoleConfig } from "./helpers/synthetic-session";

const SHOTS = path.resolve(process.cwd(), "docs/qa/circuit-standings/screenshots");
test.beforeAll(() => {
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
});
const shoot = async (page: Page, name: string) => {
  if (test.info().project.name !== "Desktop Chrome") return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

// The owner's examples.
const SEED = [
  { id: "india-wins", circuit: "india-wins", rank: 20, value: 500 },
  { id: "india-played", circuit: "india-played", rank: 15, value: 700 },
  { id: "bangalore-wins", circuit: "bangalore-wins", rank: 4, value: 115 },
];

async function open(page: Page, uid: string, role: Omit<RoleConfig, "uid">, standings: any[], width = 1280, height = 900) {
  await page.setViewportSize({ width, height });
  await injectSyntheticSession(page, { uid, ...role });
  await page.addInitScript((rows) => {
    (window as any).__KAVACH_TEST_STORE__.circuitStandings = rows;
  }, standings);
  await page.goto("/");
  await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 30_000 });
}
const toAdmin = (page: Page) => page.locator('[data-testid="header-persona-toggle"]').click();
const nav = (page: Page, tab: string, action?: string) => page.evaluate(([t, a]) => (window as any).__KAVACH_NAVIGATE_TAB__(t, a), [tab, action]);

/** Mock of /api/admin/circuit-standings that applies the change to the synthetic store. */
async function mockApi(page: Page, calls: any[]) {
  await page.route("**/api/admin/circuit-standings", async (route) => {
    const method = route.request().method();
    const body = route.request().postDataJSON();
    calls.push({ method, body });
    await page.evaluate(
      ({ method, body }) => {
        const ts = (window as any).__KAVACH_TEST_STORE__;
        const rest = (ts.circuitStandings as any[]).filter((r) => r.id !== body.circuit);
        ts.circuitStandings = method === "DELETE" ? rest : [...rest, { id: body.circuit, ...body }];
        window.dispatchEvent(new Event("kavach:test:circuit-standings"));
      },
      { method, body },
    );
    await route.fulfill({ json: { ok: true, changed: true } });
  });
}

test.describe("Player Club shows the club's circuit standings", () => {
  test("each circuit shows KAvach's rank and total; an unset circuit says 'Not available'", async ({ page }) => {
    await open(page, "cs-player", { role: "player" }, SEED);
    await page.locator('[data-testid="sidebar-player-club"]').click();
    await expect(page.locator('[data-testid="club-circuit-standings"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="club-circuit-india-wins-standing"]')).toHaveText("#20500 wins");
    await expect(page.locator('[data-testid="club-circuit-india-played-standing"]')).toHaveText("#15700 matches played");
    await expect(page.locator('[data-testid="club-circuit-bangalore-wins-standing"]')).toHaveText("#4115 wins");
    await expect(page.locator('[data-testid="club-circuit-bangalore-played"]')).toContainText("Not available");
    await expect(page.locator('[data-testid="club-circuit-note"]')).toHaveText("KAvach's all-time rank in each circuit.");
    await shoot(page, "01-player-club-standings");
  });

  test("nothing saved: every circuit says 'Not available' (nothing invented)", async ({ page }) => {
    await open(page, "cs-player-empty", { role: "player" }, []);
    await page.locator('[data-testid="sidebar-player-club"]').click();
    const card = page.locator('[data-testid="club-circuit-standings"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText("Not available")).toHaveCount(4);
    await expect(page.locator('[data-testid="club-circuit-note"]')).toHaveText("Circuit standings will appear here once the club publishes them.");
  });

  test("mobile 390: standings fit without horizontal scroll", async ({ page }) => {
    await open(page, "cs-player-m", { role: "player" }, SEED, 390, 844);
    await page.locator('[data-testid="player-nav-club"]').click();
    await expect(page.locator('[data-testid="club-circuit-india-played-standing"]')).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (test.info().project.name === "Desktop Chrome") await page.screenshot({ path: path.join(SHOTS, "02-player-club-standings-390.png") });
  });
});

test.describe("Admin Club → Club Stats → Circuit Standings", () => {
  test("Club Admin reviews, sets, edits and clears standings; the Player card follows", async ({ page }) => {
    const calls: any[] = [];
    await mockApi(page, calls);
    await open(page, "cs-admin", { role: "admin", isClubAdmin: true }, SEED);
    await toAdmin(page);
    await nav(page, "club", "leaderboard");
    await expect(page.locator('[data-testid="circuit-standings-admin"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="club-statistics-admin"]')).toBeVisible(); // alongside Club Statistics

    // Review: saved values shown and pre-filled; no player selection anywhere.
    await expect(page.locator('[data-testid="circuit-india-wins-saved"]')).toHaveText("#20 · 500 wins");
    await expect(page.locator('[data-testid="circuit-india-wins-rank"]')).toHaveValue("20");
    await expect(page.locator('[data-testid="circuit-india-wins-value"]')).toHaveValue("500");
    await expect(page.locator('[data-testid="circuit-bangalore-played-saved"]')).toHaveText("Not set");
    await expect(page.locator('[data-testid="circuit-standings-admin"] select')).toHaveCount(0);
    await expect(page.locator('[data-testid="circuit-india-wins-save"]')).toBeDisabled(); // unchanged
    await shoot(page, "03-admin-circuit-standings");

    // Set the missing one: Bangalore – Most Played #4 · 200. Validation first.
    await page.locator('[data-testid="circuit-bangalore-played-rank"]').fill("4");
    await page.locator('[data-testid="circuit-bangalore-played-value"]').fill("200+");
    await page.locator('[data-testid="circuit-bangalore-played-save"]').click();
    await expect(page.locator('[data-testid="circuit-bangalore-played-error"]')).toHaveText("Matches played must be a whole number.");
    expect(calls).toHaveLength(0);
    await page.locator('[data-testid="circuit-bangalore-played-value"]').fill("200");
    await page.locator('[data-testid="circuit-bangalore-played-save"]').click();
    await expect(page.locator('[data-testid="circuit-bangalore-played-saved"]')).toHaveText("#4 · 200 matches played");
    expect(calls.at(-1)).toEqual({ method: "PUT", body: { circuit: "bangalore-played", rank: 4, value: 200 } });

    // Edit: India – Most Wins becomes #18 · 512.
    await page.locator('[data-testid="circuit-india-wins-rank"]').fill("18");
    await page.locator('[data-testid="circuit-india-wins-value"]').fill("512");
    await page.locator('[data-testid="circuit-india-wins-save"]').click();
    await expect(page.locator('[data-testid="circuit-india-wins-saved"]')).toHaveText("#18 · 512 wins");
    expect(calls.at(-1)).toEqual({ method: "PUT", body: { circuit: "india-wins", rank: 18, value: 512 } });

    // Clear (with confirmation): Bangalore – Most Wins.
    await page.locator('[data-testid="circuit-bangalore-wins-clear"]').click();
    await shoot(page, "04-admin-clear-confirm");
    await page.locator('[data-testid="circuit-bangalore-wins-confirm-clear"]').click();
    await expect(page.locator('[data-testid="circuit-bangalore-wins-saved"]')).toHaveText("Not set");
    await expect(page.locator('[data-testid="circuit-bangalore-wins-rank"]')).toHaveValue("");
    expect(calls.at(-1)).toEqual({ method: "DELETE", body: { circuit: "bangalore-wins" } });

    // The Player Club card reflects the saved standings.
    await toAdmin(page);
    await page.locator('[data-testid="sidebar-player-club"]').click();
    await expect(page.locator('[data-testid="club-circuit-india-wins-standing"]')).toHaveText("#18512 wins");
    await expect(page.locator('[data-testid="club-circuit-bangalore-played-standing"]')).toHaveText("#4200 matches played");
    await expect(page.locator('[data-testid="club-circuit-bangalore-wins"]')).toContainText("Not available");
  });

  test("a server refusal is shown on the card and the saved value is kept", async ({ page }) => {
    await page.route("**/api/admin/circuit-standings", (route) => route.fulfill({ status: 500, json: { error: "Could not save the standing. Nothing was changed; try again." } }));
    await open(page, "cs-admin-err", { role: "admin", isClubAdmin: true }, SEED);
    await toAdmin(page);
    await nav(page, "club", "leaderboard");
    await page.locator('[data-testid="circuit-india-wins-rank"]').fill("19");
    await page.locator('[data-testid="circuit-india-wins-save"]').click();
    await expect(page.locator('[data-testid="circuit-india-wins-error"]')).toContainText("Nothing was changed");
    await expect(page.locator('[data-testid="circuit-india-wins-saved"]')).toHaveText("#20 · 500 wins");
  });

  test("Finance-only admin gets no Circuit Standings management", async ({ page }) => {
    await open(page, "cs-fin", { role: "admin", isFinanceAdmin: true }, SEED);
    await toAdmin(page);
    await nav(page, "club", "leaderboard");
    await page.waitForTimeout(800);
    await expect(page.locator('[data-testid="circuit-standings-admin"]')).toHaveCount(0);
  });

  test("mobile 390: manager fits without horizontal scroll", async ({ page }) => {
    await open(page, "cs-admin-m", { role: "admin", isClubAdmin: true }, SEED, 390, 844);
    await toAdmin(page);
    await nav(page, "club", "leaderboard");
    await expect(page.locator('[data-testid="circuit-standings-admin"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="circuit-standings-admin"]').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (test.info().project.name === "Desktop Chrome") await page.screenshot({ path: path.join(SHOTS, "05-admin-circuit-standings-390.png") });
  });
});
