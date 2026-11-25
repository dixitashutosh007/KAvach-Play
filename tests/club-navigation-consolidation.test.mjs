import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CLUB_SECTIONS,
  getVisibleClubSections,
  resolveClubSection,
} from "../lib/admin-navigation.ts";

const root = process.cwd();

test("ClubTab uses a single consolidated horizontally scrollable navigation bar without duplicate ClubMenu", () => {
  const tabSrc = fs.readFileSync(path.join(root, "components/ClubTab.tsx"), "utf8");
  assert.match(tabSrc, /data-testid="club-sub-tabs"/);
  assert.match(tabSrc, /role="tablist"/);
  assert.match(tabSrc, /flex-nowrap/);
  assert.match(tabSrc, /overflow-x-auto/);
  assert.match(tabSrc, /no-scrollbar/);
  assert.match(tabSrc, /shrink-0 whitespace-nowrap/);
  assert.match(tabSrc, /scrollIntoView/);
  assert.doesNotMatch(tabSrc, /flex-wrap/);
  assert.doesNotMatch(tabSrc, /club-menu-button|ClubMenu|data-testid="club-menu"/);

  for (const s of CLUB_SECTIONS) {
    assert.match(tabSrc, new RegExp(`show\\("${s.key}"\\)`), `ClubTab must render section ${s.key}`);
  }
});

test("All 7 Club sections, deep links, shortcuts, and role/feature gates resolve cleanly", () => {
  const clubAdmin = { isSuperAdmin: false, isClubAdmin: true, isFinanceAdmin: false };
  const superAdmin = { isSuperAdmin: true, isClubAdmin: true, isFinanceAdmin: true };
  const financeOnly = { isSuperAdmin: false, isClubAdmin: false, isFinanceAdmin: true };

  assert.deepEqual(
    getVisibleClubSections(clubAdmin),
    ["players", "studio", "announcements", "pulse", "leaderboard", "badges", "shop"],
  );
  assert.deepEqual(
    getVisibleClubSections(superAdmin),
    ["players", "studio", "announcements", "pulse", "leaderboard", "badges", "shop"],
  );
  assert.deepEqual(getVisibleClubSections(financeOnly), []);

  // Feature flags hide Pulse ("opinion") and Badges ("badges")
  assert.deepEqual(
    getVisibleClubSections(clubAdmin, (f) => f !== "opinion" && f !== "badges"),
    ["players", "studio", "announcements", "leaderboard", "shop"],
  );

  const visible = getVisibleClubSections(clubAdmin);
  assert.deepEqual(resolveClubSection(null, visible), { section: "players", subAction: null, denied: null });
  assert.deepEqual(resolveClubSection("invite_player", visible), { section: "players", subAction: "invite", denied: null });
  assert.deepEqual(resolveClubSection("badges_grant", visible), { section: "badges", subAction: "grant", denied: null });
  assert.deepEqual(resolveClubSection("shop:orders", visible), { section: "shop", subAction: "orders", denied: null });
  assert.deepEqual(resolveClubSection("shop:products", visible), { section: "shop", subAction: "products", denied: null });
  assert.deepEqual(resolveClubSection("leaderboard", visible), { section: "leaderboard", subAction: null, denied: null });
});
