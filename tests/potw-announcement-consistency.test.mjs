import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  executeAnnouncementDelete,
  executeBadgeDelete,
  filterBannerAnnouncements,
  getPotwWeekendIdFromBadge,
  getPotwWeekendIdFromPost,
  selectPlayerHomePotw,
} from "../lib/weekend-ops.ts";
import { toMillis } from "../lib/club-feed.ts";

const root = process.cwd();

test("getPotwWeekendIdFromPost identifies POTW strictly by kind and potw.weekendId metadata", () => {
  assert.equal(
    getPotwWeekendIdFromPost({ kind: "potw", potw: { weekendId: "2026-11-21" } }),
    "2026-11-21",
  );
  // Never infer from title or text
  assert.equal(
    getPotwWeekendIdFromPost({ title: "Player of the Weekend", text: "Player of the Weekend 2026-11-21" }),
    null,
  );
  assert.equal(getPotwWeekendIdFromPost({ kind: "potw", potw: { weekendId: "invalid" } }), null);
  assert.equal(getPotwWeekendIdFromPost(null), null);
});

test("executeAnnouncementDelete routes POTW announcements to POTW API and never falls back to direct delete", async () => {
  let apiCalls = [];
  let directCalls = 0;

  const ok = await executeAnnouncementDelete({
    post: { id: "potw_2026-11-21", kind: "potw", potw: { weekendId: "2026-11-21" } },
    deleteViaPotwApi: async (wid) => {
      apiCalls.push(wid);
      return true;
    },
    deleteDirectDoc: async () => {
      directCalls++;
      return true;
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(apiCalls, ["2026-11-21"]);
  assert.equal(directCalls, 0);

  // API failure -> returns false and does NOT fall back to direct deletion
  const failed = await executeAnnouncementDelete({
    post: { id: "potw_2026-11-21", kind: "potw", potw: { weekendId: "2026-11-21" } },
    deleteViaPotwApi: async () => false,
    deleteDirectDoc: async () => {
      directCalls++;
      return true;
    },
  });
  assert.equal(failed, false);
  assert.equal(directCalls, 0);
});

test("executeAnnouncementDelete deletes normal announcements via direct delete without calling POTW API", async () => {
  let apiCalls = 0;
  let directCalls = 0;

  const ok = await executeAnnouncementDelete({
    post: { id: "post-1", title: "Player of the Weekend", text: "Club notice", isAnnouncement: true },
    deleteViaPotwApi: async () => {
      apiCalls++;
      return true;
    },
    deleteDirectDoc: async () => {
      directCalls++;
      return true;
    },
  });

  assert.equal(ok, true);
  assert.equal(apiCalls, 0);
  assert.equal(directCalls, 1);
});

test("getPotwWeekendIdFromBadge & executeBadgeDelete route POTW badges through POTW API without fallback", async () => {
  assert.equal(getPotwWeekendIdFromBadge("potw_2026-11-21", { badgeType: "player_of_the_weekend" }), "2026-11-21");
  assert.equal(getPotwWeekendIdFromBadge("b-1", { badgeType: "mvp" }), null);

  let apiCalls = [];
  let directCalls = 0;

  const ok = await executeBadgeDelete({
    badgeId: "potw_2026-11-21",
    badge: { badgeType: "player_of_the_weekend", weekendId: "2026-11-21" },
    deleteViaPotwApi: async (wid) => {
      apiCalls.push(wid);
      return true;
    },
    deleteDirectDoc: async () => {
      directCalls++;
      return true;
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(apiCalls, ["2026-11-21"]);
  assert.equal(directCalls, 0);

  const failed = await executeBadgeDelete({
    badgeId: "potw_2026-11-21",
    badge: { badgeType: "player_of_the_weekend", weekendId: "2026-11-21" },
    deleteViaPotwApi: async () => false,
    deleteDirectDoc: async () => {
      directCalls++;
      return true;
    },
  });
  assert.equal(failed, false);
  assert.equal(directCalls, 0);

  const nonPotw = await executeBadgeDelete({
    badgeId: "mvp_1",
    badge: { badgeType: "mvp" },
    deleteViaPotwApi: async () => {
      apiCalls.push("wrong");
      return true;
    },
    deleteDirectDoc: async () => {
      directCalls++;
      return true;
    },
  });
  assert.equal(nonPotw, true);
  assert.equal(directCalls, 1);
});

test("useStore & app/page.tsx keep Club posts live, prevent duplicate deletes, and guard POTW metadata", () => {
  const storeSrc = fs.readFileSync(path.join(root, "hooks/useStore.ts"), "utf8");
  const pageSrc = fs.readFileSync(path.join(root, "app/page.tsx"), "utf8");
  assert.match(storeSrc, /executeAnnouncementDelete/);
  assert.match(storeSrc, /executeBadgeDelete/);
  assert.match(storeSrc, /deletingPostIdsRef/);
  assert.match(storeSrc, /deletingBadgeIdsRef/);
  assert.match(storeSrc, /\/api\/admin\/player-of-weekend\?weekendId=/);
  assert.match(storeSrc, /if \(k === "kind" \|\| k === "potw"\) continue;/);
  assert.match(pageSrc, /POSTS_TABS = new Set\(\["home", "club"\]\)/);
});

test("Player Home POTW selector: 7-day expiry, immediate replacement, historical exclusion, and live updates", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const NOW = Date.parse("2026-11-25T10:00:00Z");

  const mkPotw = (id, ageMs, overrides = {}) => ({
    id,
    kind: "potw",
    isAnnouncement: true,
    createdAt: new Date(NOW - ageMs).toISOString(),
    potw: {
      playerId: `player_${id}`,
      playerName: `Winner ${id}`,
      photoURL: "https://example.com/photo.jpg",
      message: `Message ${id}`,
      weekendId: "2026-11-21",
      weekendLabel: "Nov 21–22, 2026",
      ...(overrides.potw || {}),
    },
    ...overrides,
  });

  const normalAnnouncement = {
    id: "ann-1",
    isAnnouncement: true,
    title: "Kit Distribution",
    text: "Collect kits",
    createdAt: new Date(NOW - 1000).toISOString(),
  };
  const feedPost = {
    id: "feed-1",
    isAnnouncement: false,
    text: "Great net session",
    createdAt: new Date(NOW - 1000).toISOString(),
  };

  // 1. No POTW announcement exists
  assert.equal(selectPlayerHomePotw([normalAnnouncement, feedPost], NOW, toMillis), null);

  // 2. One current POTW announcement is displayed
  const single = mkPotw("p1", 2 * DAY_MS);
  const resSingle = selectPlayerHomePotw([normalAnnouncement, single, feedPost], NOW, toMillis);
  assert.ok(resSingle);
  assert.equal(resSingle.postId, "p1");
  assert.equal(resSingle.playerName, "Winner p1");
  assert.equal(resSingle.photoURL, "https://example.com/photo.jpg");
  assert.equal(resSingle.message, "Message p1");
  assert.equal(resSingle.weekendLabel, "Nov 21–22, 2026");

  // 3 & 4. Multiple POTW posts -> newest eligible replaces older immediately
  const older = mkPotw("old", 4 * DAY_MS);
  const newer = mkPotw("new", 1 * 60 * 60 * 1000);
  assert.equal(selectPlayerHomePotw([older, newer], NOW, toMillis)?.postId, "new");

  // 5. Visible just before 7-day boundary
  assert.equal(selectPlayerHomePotw([mkPotw("edge", 7 * DAY_MS - 1)], NOW, toMillis)?.postId, "edge");

  // 6. Hidden at and after 7-day boundary
  assert.equal(selectPlayerHomePotw([mkPotw("exact", 7 * DAY_MS)], NOW, toMillis), null);
  assert.equal(selectPlayerHomePotw([mkPotw("past", 7 * DAY_MS + 1000)], NOW, toMillis), null);

  // 7. Historical awards never appear on Player Home
  const hist1 = mkPotw("h1", 1000, { historical: true });
  const hist2 = mkPotw("h2", 1000, { potw: { playerName: "Hist", historical: true } });
  assert.equal(selectPlayerHomePotw([hist1, hist2], NOW, toMillis), null);

  // 8. Missing or invalid createdAt is handled safely (never substitutes NOW)
  for (const badCreatedAt of [undefined, null, "not-a-date", {}]) {
    const bad = mkPotw("bad", 1000, { createdAt: badCreatedAt });
    assert.equal(selectPlayerHomePotw([bad], NOW, toMillis), null);
  }

  // 9. Editing current POTW updates visible announcement
  const edited = mkPotw("new", 1 * 60 * 60 * 1000, {
    potw: { playerId: "p2", playerName: "Aashna", photoURL: "https://example.com/aashna.jpg", message: "4 wickets!", weekendLabel: "Nov 21–22, 2026" },
  });
  const resEdited = selectPlayerHomePotw([older, edited], NOW, toMillis);
  assert.equal(resEdited?.playerName, "Aashna");
  assert.equal(resEdited?.message, "4 wickets!");
  assert.equal(resEdited?.photoURL, "https://example.com/aashna.jpg");

  // 10. Deleting current POTW removes it (when no other active POTW exists)
  assert.equal(selectPlayerHomePotw([normalAnnouncement, feedPost], NOW, toMillis), null);

  // 11. Deleting an older POTW does not remove the current announcement
  assert.equal(selectPlayerHomePotw([edited, normalAnnouncement], NOW, toMillis)?.postId, "new");

  // 12. Unsafe photoURL is stripped so fallback avatar renders
  const unsafePhoto = mkPotw("unsafe", 1000, { potw: { playerName: "Safe Fallback", photoURL: "javascript:alert(1)" } });
  assert.equal(selectPlayerHomePotw([unsafePhoto], NOW, toMillis)?.photoURL, undefined);
});

test("Player Home renders POTW solely in PotwHomeSection (not duplicated in CampaignHeroBanner)", () => {
  const NOW = Date.parse("2026-11-25T10:00:00Z");
  const potwPost = {
    id: "potw_2026-11-21",
    kind: "potw",
    isAnnouncement: true,
    isPinned: false,
    text: "Aashna — 4 wickets!",
    createdAt: new Date(NOW - 3600_000).toISOString(),
    potw: {
      playerId: "p-aashna",
      playerName: "Aashna",
      message: "4 wickets!",
      weekendId: "2026-11-21",
      weekendLabel: "Nov 21–22, 2026",
    },
  };
  const pinnedNotice = {
    id: "notice-1",
    isAnnouncement: true,
    isPinned: true,
    title: "Sunday Nets",
    text: "7 AM sharp",
    createdAt: new Date(NOW - 7200_000).toISOString(),
  };
  const allPosts = [potwPost, pinnedNotice];

  // Dedicated section receives full posts and shows Aashna
  assert.equal(selectPlayerHomePotw(allPosts, NOW, toMillis)?.playerName, "Aashna");

  // CampaignHeroBanner receives filterBannerAnnouncements(posts) which excludes POTW while keeping notices
  const bannerAnnouncements = filterBannerAnnouncements(allPosts);
  assert.deepEqual(bannerAnnouncements.map((p) => p.id), ["notice-1"]);

  const homeTabSrc = fs.readFileSync(path.join(root, "components/HomeTab.tsx"), "utf8");
  assert.match(homeTabSrc, /<CampaignHeroBanner[\s\S]*announcements=\{bannerAnnouncements\}/);
  assert.match(homeTabSrc, /<PotwHomeSection posts=\{posts\} nowMs=\{nowMs\} \/>/);
});
