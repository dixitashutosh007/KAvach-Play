/**
 * Circuit Standings — Admin Club → Club Stats manager and the Player Club display.
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
test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));
const shoot = async (page: Page, name: string) => {
  if (test.info().project.name !== "Desktop Chrome") return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const SEED = [
  { id: "india-wins__player-teammate-1", circuit: "india-wins", playerId: "player-teammate-1", playerName: "Rohit Sharma", rank: 1, value: 42, asOf: "2026-11-20" },
  { id: "india-wins__player-teammate-2", circuit: "india-wins", playerId: "player-teammate-2", playerName: "Virat Kohli", rank: 2, value: 37, asOf: "2026-11-20" },
  { id: "bangalore-played__player-teammate-2", circuit: "bangalore-played", playerId: "player-teammate-2", playerName: "Virat Kohli", rank: 1, value: 118, asOf: "2026-11-18" },
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
    const json = await page.evaluate(
      ({ method, body }) => {
        const ts = (window as any).__KAVACH_TEST_STORE__;
        const names: Record<string, string> = Object.fromEntries(ts.players.map((p: any) => [p.id, p.name]));
        const rows: any[] = ts.circuitStandings;
        if (method === "DELETE") ts.circuitStandings = rows.filter((r) => r.id !== body.id);
        else {
          const { id: oldId, ...v } = body;
          const id = `${v.circuit}__${v.playerId}`;
          ts.circuitStandings = [...rows.filter((r) => r.id !== oldId && r.id !== id), { id, ...v, playerName: names[v.playerId] }];
        }
        window.dispatchEvent(new Event("kavach:test:circuit-standings"));
        return { ok: true };
      },
      { method, body },
    );
    await route.fulfill({ status: method === "POST" ? 201 : 200, json });
  });
}

test.describe("Player Club displays saved circuit standings", () => {
  test("card shows each circuit's leader; empty circuits stay 'Not available'; Stats lists every rank", async ({ page }) => {
    await open(page, "cs-player", { role: "player" }, SEED);
    await page.locator('[data-testid="sidebar-player-club"]').click();
    const card = page.locator('[data-testid="club-circuit-standings"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="club-circuit-india-wins-leader"]')).toHaveText("#1 Rohit Sharma42 wins");
    await expect(page.locator('[data-testid="club-circuit-bangalore-played-leader"]')).toHaveText("#1 Virat Kohli118 matches");
    await expect(page.locator('[data-testid="club-circuit-india-played"]')).toContainText("Not available");
    await expect(page.locator('[data-testid="club-circuit-bangalore-wins"]')).toContainText("Not available");
    await expect(page.locator('[data-testid="club-circuit-note"]')).toHaveText("Circuit standings as of 20 Nov 2026.");
    await shoot(page, "01-player-club-standings");
    await page.locator('[data-testid="club-chip-stats"]').click();
    const full = page.locator('[data-testid="club-circuit-full-india-wins"]');
    await expect(full).toContainText("#1Rohit Sharma42 wins");
    await expect(full).toContainText("#2Virat Kohli37 wins");
    await shoot(page, "02-player-club-stats-full");
  });

  test("no records: every circuit says 'Not available' (nothing invented)", async ({ page }) => {
    await open(page, "cs-player-empty", { role: "player" }, []);
    await page.locator('[data-testid="sidebar-player-club"]').click();
    const card = page.locator('[data-testid="club-circuit-standings"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText("Not available")).toHaveCount(4);
    await expect(page.locator('[data-testid="club-circuit-note"]')).toHaveText("Circuit standings will appear here once the club publishes them.");
  });

  test("mobile 390: standings card fits without horizontal scroll", async ({ page }) => {
    await open(page, "cs-player-m", { role: "player" }, SEED, 390, 844);
    await page.locator('[data-testid="player-nav-club"]').click();
    await expect(page.locator('[data-testid="club-circuit-india-wins-leader"]')).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (test.info().project.name === "Desktop Chrome") await page.screenshot({ path: path.join(SHOTS, "03-player-club-standings-390.png") });
  });
});

test.describe("Admin Club → Club Stats → Circuit Standings", () => {
  test("Club Admin reviews, adds, edits and deletes standings; the Player card follows", async ({ page }) => {
    const calls: any[] = [];
    await mockApi(page, calls);
    await open(page, "cs-admin", { role: "admin", isClubAdmin: true }, SEED);
    await toAdmin(page);
    await nav(page, "club", "leaderboard");
    const admin = page.locator('[data-testid="circuit-standings-admin"]');
    await expect(admin).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="club-statistics-admin"]')).toBeVisible(); // alongside Club Statistics

    // Review existing records before editing.
    await expect(page.locator('[data-testid="circuit-tab-india-wins"]')).toContainText("(2)");
    await expect(page.locator('[data-testid="circuit-row-india-wins__player-teammate-1"]')).toContainText("Rohit Sharma");
    await expect(page.locator('[data-testid="circuit-row-india-wins__player-teammate-1"]')).toContainText("42 wins · as of 20 Nov 2026");
    await shoot(page, "04-admin-circuit-standings");

    // Add: Bangalore – Most Wins, Rohit, rank 1, 30 wins.
    await page.locator('[data-testid="circuit-tab-bangalore-wins"]').click();
    await expect(page.locator('[data-testid="circuit-empty"]')).toBeVisible();
    await page.locator('[data-testid="circuit-add"]').click();
    const form = page.locator('[data-testid="circuit-form"]');
    await expect(page.locator('[data-testid="circuit-form-circuit"]')).toHaveValue("bangalore-wins");
    // Client-side validation blocks an incomplete record without calling the server.
    await page.locator('[data-testid="circuit-form-save"]').click();
    await expect(page.locator('[data-testid="circuit-form-error"]')).toHaveText("Choose a player.");
    expect(calls).toHaveLength(0);
    await page.locator('[data-testid="circuit-form-player-search"]').fill("rohit");
    await page.locator('[data-testid="circuit-form-player"]').selectOption("player-teammate-1");
    await page.locator('[data-testid="circuit-form-rank"]').fill("1");
    await page.locator('[data-testid="circuit-form-value"]').fill("x");
    await page.locator('[data-testid="circuit-form-save"]').click();
    await expect(page.locator('[data-testid="circuit-form-error"]')).toHaveText("Wins must be a whole number.");
    await page.locator('[data-testid="circuit-form-value"]').fill("30");
    await page.locator('[data-testid="circuit-form-asof"]').fill("2026-11-21");
    await shoot(page, "05-admin-add-standing");
    await page.locator('[data-testid="circuit-form-save"]').click();
    await expect(form).toHaveCount(0);
    expect(calls.at(-1)).toEqual({ method: "POST", body: { circuit: "bangalore-wins", playerId: "player-teammate-1", rank: 1, value: 30, asOf: "2026-11-21" } });
    await expect(page.locator('[data-testid="circuit-row-bangalore-wins__player-teammate-1"]')).toContainText("30 wins");

    // Edit: Virat in India – Most Wins becomes 40 wins.
    await page.locator('[data-testid="circuit-tab-india-wins"]').click();
    await page.locator('[data-testid="circuit-edit-india-wins__player-teammate-2"]').click();
    await expect(page.locator('[data-testid="circuit-form-player"]')).toHaveValue("player-teammate-2");
    await expect(page.locator('[data-testid="circuit-form-value"]')).toHaveValue("37");
    // A player already ranked in this circuit cannot be picked twice.
    await expect(page.locator('[data-testid="circuit-form-player"] option[value="player-teammate-1"]')).toBeDisabled();
    await page.locator('[data-testid="circuit-form-value"]').fill("40");
    await page.locator('[data-testid="circuit-form-save"]').click();
    await expect(form).toHaveCount(0);
    expect(calls.at(-1)).toEqual({ method: "PUT", body: { id: "india-wins__player-teammate-2", circuit: "india-wins", playerId: "player-teammate-2", rank: 2, value: 40, asOf: "2026-11-20" } });
    await expect(page.locator('[data-testid="circuit-row-india-wins__player-teammate-2"]')).toContainText("40 wins");

    // Delete (with confirmation): Rohit's India – Most Wins record.
    await page.locator('[data-testid="circuit-delete-india-wins__player-teammate-1"]').click();
    await shoot(page, "06-admin-delete-confirm");
    await page.locator('[data-testid="circuit-confirm-delete-india-wins__player-teammate-1"]').click();
    await expect(page.locator('[data-testid="circuit-row-india-wins__player-teammate-1"]')).toHaveCount(0);
    expect(calls.at(-1)).toEqual({ method: "DELETE", body: { id: "india-wins__player-teammate-1" } });

    // The Player Club card reflects the saved records.
    await toAdmin(page);
    await page.locator('[data-testid="sidebar-player-club"]').click();
    await expect(page.locator('[data-testid="club-circuit-india-wins-leader"]')).toHaveText("#2 Virat Kohli40 wins");
    await expect(page.locator('[data-testid="club-circuit-bangalore-wins-leader"]')).toHaveText("#1 Rohit Sharma30 wins");
  });

  test("a server refusal is shown in the form and nothing changes", async ({ page }) => {
    await page.route("**/api/admin/circuit-standings", (route) => route.fulfill({ status: 409, json: { error: "Rohit Sharma already has a standing in this circuit. Edit that record instead." } }));
    await open(page, "cs-admin-err", { role: "admin", isClubAdmin: true }, []);
    await toAdmin(page);
    await nav(page, "club", "leaderboard");
    await page.locator('[data-testid="circuit-add"]').click();
    await page.locator('[data-testid="circuit-form-player"]').selectOption("player-teammate-1");
    await page.locator('[data-testid="circuit-form-value"]').fill("5");
    await page.locator('[data-testid="circuit-form-save"]').click();
    await expect(page.locator('[data-testid="circuit-form-error"]')).toContainText("already has a standing");
    await expect(page.locator('[data-testid="circuit-empty"]')).toBeVisible();
  });

  test("Finance-only admin gets no Circuit Standings management", async ({ page }) => {
    await open(page, "cs-fin", { role: "admin", isFinanceAdmin: true }, SEED);
    await toAdmin(page);
    await nav(page, "club", "leaderboard");
    await page.waitForTimeout(800);
    await expect(page.locator('[data-testid="circuit-standings-admin"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="circuit-add"]')).toHaveCount(0);
  });

  test("mobile 390: manager and form fit without horizontal scroll", async ({ page }) => {
    await open(page, "cs-admin-m", { role: "admin", isClubAdmin: true }, SEED, 390, 844);
    await toAdmin(page);
    await nav(page, "club", "leaderboard");
    await expect(page.locator('[data-testid="circuit-standings-admin"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="circuit-add"]').click();
    await page.locator('[data-testid="circuit-form"]').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (test.info().project.name === "Desktop Chrome") await page.screenshot({ path: path.join(SHOTS, "07-admin-circuit-form-390.png"), fullPage: false });
  });
});
