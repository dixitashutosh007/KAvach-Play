/**
 * iPhone (WebKit) — Player Matches card metadata and the CricHeroes opponent link.
 * Synthetic session only; no network writes. Screenshots: docs/qa/weekend-match-operations/screenshots/iphone-*.
 */
import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { injectSyntheticSession, createSyntheticStore } from "../helpers/synthetic-session";

const SHOTS = path.resolve(process.cwd(), "docs/qa/weekend-match-operations/screenshots");
const LONG = "Royal Challengers Bengaluru Veterans Cricket Club XI";
const URL1 = "https://cricheroes.com/scorecard/12345/kavach-vs-royal";

function matches() {
  return createSyntheticStore({ uid: "iph", role: "player" }).matches.map((m: any, i: number) => ({
    ...m,
    matchType: i % 2 ? "Tournament" : "Practice",
    ...(m.id === "match-upcoming-1" ? { opponent: LONG, matchUrl: URL1 } : {}),
  }));
}

test("Player Matches: format + jersey visible in the top-right corner, no overlap, long names clamp, link opens CricHeroes", async ({ page, context }, info) => {
  await context.route("https://cricheroes.com/**", (r) => r.fulfill({ contentType: "text/html", body: "<title>stub</title>" }));
  await injectSyntheticSession(page, { uid: "iph", role: "player", matches: matches() });
  await page.goto("/");
  await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-testid="player-nav-matches"]').tap();
  // Scope to the Player Matches screen (Home's carousel uses the same card ids).
  const screen = page.locator('[data-testid="player-match-center"]');
  await expect(screen).toBeVisible({ timeout: 15_000 });
  const card = screen.locator('[data-testid="player-match-card-match-upcoming-1"]');
  await expect(card).toBeVisible({ timeout: 15_000 });
  // Wait for the tab's slide-in animation to finish: the list must be rendered and stationary.
  let last = "";
  await expect
    .poll(async () => {
      const now = await screen.locator('[data-testid^="player-match-card-"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)).join(","));
      const settled = now !== "" && now === last;
      last = now;
      return settled;
    }, { intervals: [250], timeout: 10_000 })
    .toBe(true);

  const layout = await screen.locator('[data-testid^="player-match-card-"]').evaluateAll((cards) =>
    cards.map((el) => {
      const r = el.getBoundingClientRect();
      const box = (s: string) => {
        const e = el.querySelector(s);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return b.width ? { l: b.left, r: b.right, t: b.top, b: b.bottom } : null;
      };
      const chips = box('[data-testid^="match-card-chips-"]');
      const ribbon = box('[data-testid^="category-ribbon-"]');
      const next = box('[data-testid="next-match-highlight"]');
      const opp = box('[data-testid^="match-opponent-"]');
      const logi = box('[data-testid^="match-card-logistics-"]');
      const ov = (a: any, b: any) => !!a && !!b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
      return {
        id: el.getAttribute("data-testid"),
        chips: !!chips && chips.r <= r.right + 0.5 && chips.l >= r.left && chips.t <= r.top + 2,
        chipsTopRight: !!chips && r.right - chips.r < 4,
        overlaps: [ov(chips, ribbon), ov(chips, next), ov(ribbon, next), ov(opp, logi)].some(Boolean),
        insideViewport: r.left >= 0 && r.right <= window.innerWidth + 0.5,
        where: `${Math.round(r.left)}..${Math.round(r.right)} of ${window.innerWidth}; ${el.parentElement?.parentElement?.getAttribute("data-testid")}`,
      };
    }),
  );
  expect(layout.length).toBeGreaterThan(3);
  for (const c of layout) {
    expect(c.chips, `${c.id} chips visible`).toBe(true);
    expect(c.chipsTopRight, `${c.id} chips in the top-right corner`).toBe(true);
    expect(c.overlaps, `${c.id} no overlap`).toBe(false);
    expect(c.insideViewport, `${c.id} inside viewport (${(c as any).where})`).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(card.locator('[data-testid^="format-badge-compact-"]')).toBeVisible();
  await expect(card.locator('[data-testid="jersey-infographic"]').first()).toBeVisible();

  // Long opponent name: clamped to two lines inside the identity column.
  const nameLines = await card.locator('[data-testid="cricheroes-link-match-upcoming-1"] .line-clamp-2').evaluate((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)));
  expect(nameLines).toBeLessThanOrEqual(2);
  // The external-link icon stays visible beside a truncated name, inside the card.
  const icon = card.locator('[data-testid="cricheroes-icon-match-upcoming-1"]');
  await expect(icon).toBeVisible();
  const [ib, cb] = [await icon.boundingBox(), await card.boundingBox()];
  expect(ib!.x + ib!.width).toBeLessThanOrEqual(cb!.x + cb!.width);

  fs.mkdirSync(SHOTS, { recursive: true });
  const tag = info.project.name.match(/\d+/)![0];
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: path.join(SHOTS, `iphone-after-${tag}-card.png`) });

  // Tap the opponent: CricHeroes opens in a new tab; the card's detail view does not open.
  const link = card.locator('[data-testid="cricheroes-link-match-upcoming-1"]');
  await expect(link).toHaveAttribute("target", "_blank");
  const [popup] = await Promise.all([context.waitForEvent("page"), link.tap()]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe(URL1);
  await popup.close();
  await expect(card).toBeVisible();
  await expect(page.getByText(/Match Squad|Squad \(/i)).toHaveCount(0);
});
