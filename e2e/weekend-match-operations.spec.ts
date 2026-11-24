/**
 * Weekend match operations — real browser suite (`e2e/weekend-match-operations.spec.ts`).
 *
 * Local dev server + synthetic session harness: no Firestore, no network writes,
 * no payments. The weekend API routes are MOCKED here with page.route (the
 * synthetic session has no ID token, so the real server would refuse it); their
 * authorisation, idempotency and data effects are covered against the emulator
 * in tests/weekend-ops.emulator.test.mjs. This suite verifies the UI: Admin-persona
 * only prompts, one modal at a time, skip/session behaviour, request payloads,
 * the toggle indicator, the backfill queue, CricHeroes links and the POTW banner.
 */
import { test, expect, Page, Route } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { injectSyntheticSession, createSyntheticStore, RoleConfig } from "./helpers/synthetic-session";

const SHOTS = path.resolve(process.cwd(), "docs/qa/weekend-match-operations/screenshots");
test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));
const shoot = async (page: Page, name: string) => {
  if (test.info().project.name !== "Desktop Chrome") return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const M = (id: string, date: string, opponent: string, extra: Record<string, unknown> = {}) => ({
  id, date, time: "07:00", format: "T20", opponent, groundId: "ground-1", matchType: "Practice", result: "Pending", ...extra,
});

function promptsBody(over: Partial<Record<"results" | "potw" | "fees", any>> = {}) {
  const body: any = { now: Date.now(), mode: "testing", pending: { results: 0, potw: 0, fees: 0 } };
  for (const [k, v] of Object.entries(over)) {
    body[k] = v;
    if (k === "results") body.pending.results = v.items.length;
    if (k === "potw") body.pending.potw = v && !v.awarded ? 1 : 0;
    if (k === "fees") body.pending.fees = v.items.length;
  }
  return body;
}
const RESULTS = { items: [M("wm-sat", "2026-11-21", "Gurgaon Gladiators"), M("wm-sun", "2026-11-22", "Noida Kings", { format: "T30" })], exceptions: [{ id: "wm-x", reason: "missing_or_unknown_format" }] };
const POTW = { weekendId: "2026-11-21", label: "21 Nov – 22 Nov 2026", closesAt: Date.now() + 86400000, awarded: null, matches: [] };
const FEES = { from: "2026-11-21", to: "2026-11-22", items: [M("wm-sat", "2026-11-21", "Gurgaon Gladiators"), M("wm-sun", "2026-11-22", "Noida Kings", { result: "Abandoned" })] };

/** Mocks the weekend API. `state` mutates as saves succeed, like the server's pending state. */
async function mockApi(page: Page, state: any, calls: { url: string; body: any }[]) {
  await page.route("**/api/admin/weekend-prompts**", (route: Route) => {
    const url = route.request().url();
    if (url.includes("view=backfill")) {
      return route.fulfill({ json: { now: Date.now(), mode: "testing", items: [M("wm-old", "2026-09-06", "Faridabad Falcons")], exceptions: [{ ...M("wm-nodate", "", "Unknown XI"), reason: "missing_or_invalid_start" }] } });
    }
    return route.fulfill({ json: promptsBody(state) });
  });
  const record = async (route: Route) => {
    const body = route.request().postDataJSON();
    calls.push({ url: route.request().url(), body });
    return body;
  };
  await page.route("**/api/admin/weekend-results", async (route) => {
    const body = await record(route);
    const outcomes = body.results.map((r: any) => ({ matchId: r.matchId, status: "saved", result: r.result, ...(r.result === "Abandoned" ? { waiver: { status: "applied", waived: 3, paidPreserved: 1 } } : {}) }));
    if (state.results) state.results = { ...state.results, items: state.results.items.filter((m: any) => !body.results.some((r: any) => r.matchId === m.id)) };
    return route.fulfill({ json: { ok: true, outcomes } });
  });
  await page.route("**/api/admin/player-of-weekend", async (route) => {
    const body = await record(route);
    if (state.potw) state.potw = { ...state.potw, awarded: { playerId: body.playerId, playerName: "x" } };
    return route.fulfill({ json: { ok: true, award: { playerId: body.playerId, weekendId: body.weekendId, notified: true } } });
  });
  await page.route("**/api/finance/match-ledger", async (route) => {
    const body = await record(route);
    if (state.fees) state.fees = { ...state.fees, items: state.fees.items.filter((m: any) => m.id !== body.matchId) };
    return route.fulfill({ json: { ok: true } });
  });
}

async function open(page: Page, uid: string, role: Omit<RoleConfig, "uid">, width = 1280, height = 900) {
  await page.setViewportSize({ width, height });
  await injectSyntheticSession(page, { uid, role: "admin", ...role });
  await page.goto("/");
  await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 30_000 });
}
const toAdmin = (page: Page) => page.locator('[data-testid="header-persona-toggle"]').click();

test.describe("Weekend prompts appear only in Admin persona, one at a time", () => {
  test("Super Admin: indicator in Player persona; results → award → fees in order; payloads; partial completion", async ({ page }) => {
    const state: any = { results: RESULTS, potw: POTW, fees: FEES };
    const calls: any[] = [];
    await mockApi(page, state, calls);
    await open(page, "wo-super", { isSuperAdmin: true });

    // Player persona: indicator only — no modal, no task bar.
    await expect(page.locator('[data-testid="header-persona-pending"]')).toHaveText("5");
    await expect(page.locator('[data-testid^="weekend-"][data-testid$="-modal"], [data-testid="weekend-tasks-bar"]')).toHaveCount(0);
    await shoot(page, "00-player-persona-indicator");

    await toAdmin(page);
    const results = page.locator('[data-testid="weekend-results-modal"]');
    await expect(results).toBeVisible();
    await expect(page.locator('[data-testid="weekend-potw-modal"], [data-testid="weekend-fees-modal"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="weekend-results-exceptions"]')).toContainText("1 match");
    await expect(page.locator('[data-testid="weekend-results-save"]')).toBeDisabled();
    await page.locator('[data-testid="weekend-result-wm-sat-won"]').click();
    await page.locator('[data-testid="weekend-result-wm-sun-abandoned"]').click();
    await expect(results).toContainText("Unpaid match fees for this match will be waived automatically");
    await shoot(page, "01-results-modal");
    await page.locator('[data-testid="weekend-results-save"]').click();
    await expect(results).toHaveCount(0);
    expect(calls[0].url).toContain("/api/admin/weekend-results");
    expect(calls[0].body).toEqual({ source: "prompt", results: [{ matchId: "wm-sat", result: "KAvach Won" }, { matchId: "wm-sun", result: "Abandoned" }] });

    // Next prompt opens automatically.
    const potw = page.locator('[data-testid="weekend-potw-modal"]');
    await expect(potw).toBeVisible();
    await page.locator('[data-testid="weekend-potw-search"]').fill("rohit");
    await page.locator('[data-testid^="weekend-potw-option-"]').first().click();
    await page.locator('[data-testid="weekend-potw-message"]').fill("82* off 51 balls\nand 2 stunning catches");
    await expect(page.locator('[data-testid="weekend-potw-preview"]')).toContainText("82* off 51 balls");
    await shoot(page, "02-potw-modal");
    await page.locator('[data-testid="weekend-potw-grant"]').click();
    await expect(potw).toHaveCount(0);
    const award = calls.find((c) => c.url.includes("player-of-weekend"));
    expect(award.body.weekendId).toBe("2026-11-21");
    expect(award.body.message).toBe("82* off 51 balls\nand 2 stunning catches");
    expect(award.body.playerId).toBe("player-teammate-1");

    // Fees: partial save clears only the saved match.
    const fees = page.locator('[data-testid="weekend-fees-modal"]');
    await expect(fees).toBeVisible();
    await expect(page.locator('[data-testid="weekend-fee-row-wm-sun"]')).toContainText("Abandoned");
    await page.locator('[data-testid="weekend-fee-input-wm-sat"]').fill("-5");
    await expect(page.locator('[data-testid="weekend-fees-save"]')).toBeDisabled();
    await page.locator('[data-testid="weekend-fee-input-wm-sat"]').fill("4000");
    await shoot(page, "03-fees-modal");
    await page.locator('[data-testid="weekend-fees-save"]').click();
    await expect(fees).toHaveCount(0);
    const ledger = calls.filter((c) => c.url.includes("/api/finance/match-ledger"));
    expect(ledger.map((c) => c.body)).toEqual([{ action: "setGroundFee", matchId: "wm-sat", amount: 4000, reason: "" }]);

    // Remaining work stays visible in the task bar; nothing re-opens by itself.
    await expect(page.locator('[data-testid="weekend-task-fees"]')).toHaveText(/Actual match fees \(1\)/);
    await expect(page.locator('[data-testid="weekend-task-results"], [data-testid="weekend-task-potw"]')).toHaveCount(0);
    await shoot(page, "04-task-bar-remaining");
  });

  test("Skip for Later hides a prompt for this session only; the task bar reopens it; Player persona never shows it", async ({ page }) => {
    const state: any = { results: RESULTS };
    const calls: any[] = [];
    await mockApi(page, state, calls);
    await open(page, "wo-skip", { isMatchAdmin: true });
    await toAdmin(page);
    await expect(page.locator('[data-testid="weekend-results-modal"]')).toBeVisible();
    await page.locator('[data-testid="weekend-results-skip"]').click();
    await expect(page.locator('[data-testid="weekend-results-modal"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="weekend-task-results"]')).toHaveText(/Match results \(2\)/);
    expect(calls).toHaveLength(0);

    // Same session: switching persona back and forth does not interrupt again.
    await toAdmin(page);
    await expect(page.locator('[data-testid="weekend-tasks-bar"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="header-persona-pending"]')).toHaveText("2");
    await toAdmin(page);
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="weekend-results-modal"]')).toHaveCount(0);
    await page.locator('[data-testid="weekend-task-results"]').click();
    await expect(page.locator('[data-testid="weekend-results-modal"]')).toBeVisible();
  });

  test("Finance Admin sees only the fee prompt (sections come from the server per verified role)", async ({ page }) => {
    const state: any = { fees: FEES };
    await mockApi(page, state, []);
    await open(page, "wo-fin", { isFinanceAdmin: true });
    await toAdmin(page);
    await expect(page.locator('[data-testid="weekend-fees-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="weekend-results-modal"], [data-testid="weekend-potw-modal"]')).toHaveCount(0);
  });

  test("No prompts or indicator when nothing is pending, and none for players", async ({ page }) => {
    await mockApi(page, {}, []);
    await open(page, "wo-none", { isSuperAdmin: true });
    await expect(page.locator('[data-testid="header-persona-pending"]')).toHaveCount(0);
    await toAdmin(page);
    await page.waitForTimeout(800);
    await expect(page.locator('[data-testid="weekend-tasks-bar"], [data-testid$="-modal"][data-testid^="weekend-"]')).toHaveCount(0);
  });

  test("Mobile 390: results modal is a bottom sheet with 44px choices", async ({ page }) => {
    await mockApi(page, { results: RESULTS }, []);
    await open(page, "wo-mobile", { isSuperAdmin: true }, 390, 844);
    await toAdmin(page);
    await expect(page.locator('[data-testid="weekend-results-modal"]')).toBeVisible();
    const box = await page.locator('[data-testid="weekend-result-wm-sat-won"]').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    if (test.info().project.name === "Desktop Chrome") await page.screenshot({ path: path.join(SHOTS, "05-results-modal-390.png") });
  });
});

test.describe("Historical backfill queue (explicit, Match Center)", () => {
  test("Match Admin opens the backfill queue from Match Center; nothing is pre-filled; source is backfill", async ({ page }) => {
    const calls: any[] = [];
    await mockApi(page, {}, calls);
    await page.route("**/api/admin/weekend-prompts", (route) => route.fulfill({ json: { ...promptsBody({}), results: { items: [], exceptions: [] } } }));
    await open(page, "wo-backfill", { isMatchAdmin: true });
    await toAdmin(page);
    await page.evaluate(() => (window as any).__KAVACH_NAVIGATE_TAB__("matches"));
    await page.locator('[data-testid="weekend-task-backfill"]').click();
    const modal = page.locator('[data-testid="weekend-backfill-modal"]');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("Faridabad Falcons");
    await expect(page.locator('[data-testid="weekend-results-exceptions"]')).toContainText("Unknown XI");
    await expect(page.locator('[role="radio"][aria-checked="true"]')).toHaveCount(0);
    await page.locator('[data-testid="weekend-result-wm-old-loss"]').click();
    await shoot(page, "06-backfill-queue");
    await page.locator('[data-testid="weekend-results-save"]').click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0].body).toEqual({ source: "backfill", results: [{ matchId: "wm-old", result: "KAvach Lost" }] });
  });
});

test.describe("CricHeroes hyperlink in the vs row", () => {
  const withLinks = () => {
    const base = createSyntheticStore({ uid: "wo-ch", role: "admin", isSuperAdmin: true }).matches.map((m: any) => ({ ...m }));
    const m1 = base.find((m: any) => m.id === "match-upcoming-1");
    m1.matchUrl = "https://cricheroes.com/scorecard/12345/kavach-vs-delhi";
    const m2 = base.find((m: any) => m.id === "match-upcoming-2");
    m2.matchUrl = "http://evil.example.com/phish";
    return base;
  };
  test("Player Home, Player Matches and Admin Match Center show a safe new-tab link; invalid URLs show none", async ({ page }) => {
    await mockApi(page, {}, []);
    await page.setViewportSize({ width: 1280, height: 900 });
    await injectSyntheticSession(page, { uid: "wo-ch", role: "admin", isSuperAdmin: true, matches: withLinks() });
    await page.goto("/");
    await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 30_000 });
    const check = async (where: string) => {
      const link = page.locator('[data-testid="cricheroes-link-match-upcoming-1"]:visible').first();
      await expect(link, where).toBeVisible({ timeout: 10_000 });
      await expect(link).toHaveAttribute("href", "https://cricheroes.com/scorecard/12345/kavach-vs-delhi");
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await expect(link).toContainText("View on CricHeroes");
      await expect(page.locator('[data-testid="cricheroes-link-match-upcoming-2"]')).toHaveCount(0);
    };
    await check("player home");
    await shoot(page, "07-cricheroes-player-home");
    await page.locator('[data-testid="sidebar-player-matches"]').click();
    await check("player matches");
    await shoot(page, "08-cricheroes-player-matches");
    await toAdmin(page);
    await page.evaluate(() => (window as any).__KAVACH_NAVIGATE_TAB__("matches"));
    await check("admin match center");
    await shoot(page, "09-cricheroes-admin-match-center");
  });
});

test.describe("Player of the Weekend banner", () => {
  const potwPost = (createdAtSec: number, name = "Rohan Mehta") => ({
    id: "potw_2026-11-21",
    kind: "potw",
    title: "Player of the Weekend",
    text: `${name} — 82* off 51`,
    isAnnouncement: true,
    isPinned: false,
    comments: [],
    createdAt: { seconds: createdAtSec },
    potw: { playerId: "player-teammate-1", playerName: name, photoURL: "", message: "82* off 51 balls\nand 2 stunning catches", weekendId: "2026-11-21", weekendLabel: "21 Nov – 22 Nov 2026" },
  });
  test("a current award shows on Player Home with crown, name, message and badge", async ({ page }) => {
    await mockApi(page, {}, []);
    await page.setViewportSize({ width: 1280, height: 900 });
    await injectSyntheticSession(page, { uid: "wo-banner", role: "player", posts: [potwPost(Math.floor(Date.now() / 1000) - 3600)] });
    await page.goto("/");
    const banner = page.locator('[data-testid="banner-potw"]');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="banner-potw-name"]')).toHaveText("Rohan Mehta");
    await expect(page.locator('[data-testid="banner-potw-message"]')).toContainText("2 stunning catches");
    await expect(banner.locator('[data-testid="badge-potw-icon"]')).toBeVisible();
    await expect(page.locator('[data-testid="banner-potw-initials"]')).toHaveText("RM");
    await shoot(page, "10-potw-banner-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    if (test.info().project.name === "Desktop Chrome") await page.screenshot({ path: path.join(SHOTS, "11-potw-banner-390.png") });
  });
  test("an award older than 7 days is not shown", async ({ page }) => {
    await mockApi(page, {}, []);
    await injectSyntheticSession(page, { uid: "wo-banner-old", role: "player", posts: [potwPost(Math.floor(Date.now() / 1000) - 8 * 86400)] });
    await page.goto("/");
    await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await expect(page.locator('[data-testid="banner-potw"]')).toHaveCount(0);
  });
});
