/**
 * D-20 Player UI enhancement (`tests/player-ui-enhancement.test.mjs`).
 *
 * Imports PRODUCTION modules (lib/club-feed.ts, lib/out-of-play-calendar.ts)
 * and checks the app wiring that keeps Club loading bounded and the Directory
 * public-only. No browser, emulator, network or database access.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const req = createRequire(import.meta.url);
function load(f) {
  const abs = path.resolve(f);
  const js = ts.transpileModule(fs.readFileSync(abs, "utf-8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  return mod.exports;
}
const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");
const feed = load("lib/club-feed.ts");
const cal = load("lib/out-of-play-calendar.ts");

const NOW = Date.UTC(2026, 10, 24, 12);
const daysAgo = (n) => ({ seconds: Math.floor((NOW - n * 86400000) / 1000) });

describe("30-day window (announcements, Pulse)", () => {
  it("keeps items from the last 30 days, newest first, and drops older or undated items", () => {
    const items = [
      { id: "a", createdAt: daysAgo(31) },
      { id: "b", createdAt: daysAgo(2) },
      { id: "c", createdAt: daysAgo(29) },
      { id: "d" },
      { id: "e", createdAt: new Date(NOW - 1000) },
    ];
    assert.deepEqual(feed.withinRecentWindow(items, NOW).map((i) => i.id), ["e", "b", "c"]);
  });
  it("toMillis understands Firestore Timestamps, {seconds}, Dates, ISO strings and numbers", () => {
    assert.equal(feed.toMillis({ toMillis: () => 5 }), 5);
    assert.equal(feed.toMillis({ seconds: 2 }), 2000);
    assert.equal(feed.toMillis(new Date(7)), 7);
    assert.equal(feed.toMillis("1970-01-01T00:00:01.000Z"), 1000);
    assert.equal(feed.toMillis(9), 9);
    assert.equal(feed.toMillis(undefined), null);
    assert.equal(feed.toMillis("nonsense"), null);
  });
  it("Pulse ordering: active polls first (pinned first), then closed polls from the last 30 days; duplicates removed", () => {
    const polls = [
      { id: "old-closed", isActive: false, createdAt: daysAgo(40) },
      { id: "recent-closed", isActive: false, createdAt: daysAgo(3) },
      { id: "active", isActive: true, createdAt: daysAgo(60) },
      { id: "pinned", isActive: true, isSticked: true, createdAt: daysAgo(90) },
      { id: "active", isActive: true, createdAt: daysAgo(60) },
    ];
    assert.deepEqual(feed.orderPulsePolls(polls, NOW).map((p) => p.id), ["pinned", "active", "recent-closed"]);
  });
});

describe("Player Directory privacy (R2-B owner principle)", () => {
  const full = {
    id: "p1", name: "Asha", photoURL: "https://x/y.jpg", kavachId: "KAV-1", jerseyNumber: "7", battingStyle: "RHB",
    mobile: "+919999999999", email: "a@b.c", dob: "1990-01-01", bloodGroup: "O+", emergencyContact: "+918888888888",
    locality: "Indiranagar", chestSize: "40", waistSize: "32", authUid: "uid-1", lastPaidAmount: 500, studioExpiryDate: "2027-01-01",
  };
  it("toPublicPlayer keeps only public fields", () => {
    const pub = feed.toPublicPlayer(full);
    for (const k of ["mobile", "email", "dob", "bloodGroup", "emergencyContact", "locality", "chestSize", "waistSize", "authUid", "lastPaidAmount", "studioExpiryDate"]) {
      assert.equal(k in pub, false, k);
    }
    assert.deepEqual(Object.keys(pub).sort(), ["battingStyle", "id", "jerseyNumber", "kavachId", "name", "photoURL"].sort());
  });
  it("the public field list contains no private field", () => {
    for (const k of ["mobile", "email", "dob", "bloodGroup", "emergencyContact", "locality", "chestSize", "waistSize"]) {
      assert.ok(!feed.PUBLIC_PLAYER_FIELDS.includes(k), k);
    }
  });
  it("filterDirectory hides disabled, pending and rejected members, searches name/jersey/ID and sorts by name", () => {
    const players = [
      { id: "1", name: "Zed" },
      { id: "2", name: "Amit", jerseyName: "AMI" },
      { id: "3", name: "Gone", disabled: true },
      { id: "4", name: "New", inviteStatus: "Pending" },
      { id: "5", name: "No", inviteStatus: "Rejected" },
      { id: "6", name: "Bala", kavachId: "KAV-77" },
    ];
    assert.deepEqual(feed.filterDirectory(players, "").map((p) => p.id), ["2", "6", "1"]);
    assert.deepEqual(feed.filterDirectory(players, "kav-77").map((p) => p.id), ["6"]);
    assert.deepEqual(feed.filterDirectory(players, "ami").map((p) => p.id), ["2"]);
  });
  it("the Directory renders only toPublicPlayer() output (source check)", () => {
    const dir = src("components/club/PlayerDirectory.tsx");
    assert.match(dir, /resolvePublicDirectoryPlayer/);
    assert.match(src("lib/club-feed.ts"), /return toPublicPlayer\(p\);/);
    for (const k of ["\\.mobile", "\\.email", "\\.dob", "bloodGroup", "emergencyContact", "\\.locality"]) {
      assert.doesNotMatch(dir, new RegExp(k), k);
    }
  });
});

describe("Out of Play calendar helpers", () => {
  it("builds a Monday-first grid with the right number of days", () => {
    const g = cal.buildMonthGrid(2026, 10); // November 2026 starts on a Sunday
    assert.equal(g.filter((c) => c === null).length, 6);
    assert.equal(g.filter(Boolean).length, 30);
    assert.deepEqual(g[6], { day: 1, iso: "2026-11-01" });
    const feb = cal.buildMonthGrid(2028, 1); // leap year
    assert.equal(feb.filter(Boolean).length, 29);
  });
  it("marks inclusive ranges and single days as blocked", () => {
    const ranges = [{ startDate: "2026-11-10", endDate: "2026-11-12" }, { startDate: "2026-11-20" }];
    assert.equal(cal.isDateBlocked("2026-11-10", ranges), true);
    assert.equal(cal.isDateBlocked("2026-11-12", ranges), true);
    assert.equal(cal.isDateBlocked("2026-11-13", ranges), false);
    assert.equal(cal.isDateBlocked("2026-11-20", ranges), true);
    assert.equal(cal.isDateBlocked("2026-11-21", ranges), false);
  });
});

describe("Bounded Club loading (source checks)", () => {
  const page = src("app/page.tsx");
  const hook = src("hooks/useClubData.ts");
  it("the Player Club tab maps to a key outside every whole-collection loader set", () => {
    assert.match(page, /const activeTab = persona === "player" && activeTabBase === "club" \? "player_club" : activeTabBase;/);
    assert.doesNotMatch(page, /new Set\(\[[^\]]*"player_club"/);
  });
  it("Club previews use bounded queries only (30-day window, own responses, counts), cached and refresh-aware", () => {
    assert.match(hook, /where\("createdAt", ">=", Timestamp\.fromDate\(recentWindowStart\(\)\)\)/);
    assert.match(hook, /where\("playerId", "==", uid\)/);
    assert.match(hook, /getCountFromServer\(query\(collection\(db, "pollResponses"\), where\("pollId", "==", p\.id\)\)\)/);
    assert.match(hook, /limit\(50\)/);
    assert.match(hook, /const CACHE_TTL_MS = 60_000;/);
    assert.doesNotMatch(hook, /onSnapshot/);
  });
  it("Player Polls & Pulse screens load polls (D-16 regression fixed) and the player profile loads plans", () => {
    assert.match(page, /const POLL_TABS = new Set\(\["club", "opinion", "pulse"\]\);/);
    assert.match(page, /const SUB_PLAN_TABS = new Set\(\["studio", "club", "profile"\]\);/);
  });
  it("Profile payment history reads only the member's own membership history (R2-C)", () => {
    assert.match(src("components/profile/PlayerProfileHub.tsx"), /where\("playerId", "==", playerId\)/);
  });
  it("circuit standings are not invented: no numeric ranks are rendered", () => {
    const club = src("components/club/PlayerClubTab.tsx");
    assert.match(club, /Not available/);
    assert.doesNotMatch(club, /#1<|#2<|rank: \d/);
  });
});

describe("P2-API-08: Bounded player directory pagination never returns incomplete results as complete", () => {
  it("succeeds across multiple pages and combines all records", async () => {
    const pages = [
      { ok: true, status: 200, json: async () => ({ players: [{ id: "p1" }, { id: "p2" }], hasMore: true, nextCursor: "c1" }) },
      { ok: true, status: 200, json: async () => ({ players: [{ id: "p3" }, { id: "p4" }], hasMore: true, nextCursor: "c2" }) },
      { ok: true, status: 200, json: async () => ({ players: [{ id: "p5" }], hasMore: false, nextCursor: null }) },
    ];
    let idx = 0;
    const res = await feed.fetchAllPlayerPages({
      buildUrl: (cursor) => (cursor ? `/api/players/public?cursor=${cursor}` : "/api/players/public"),
      fetchPage: async () => pages[idx++],
    });
    assert.equal(res.ok, true);
    assert.equal(res.pagesFetched, 3);
    assert.deepEqual(
      res.players.map((p) => p.id),
      ["p1", "p2", "p3", "p4", "p5"],
    );
  });

  it("fails explicitly on page 2 without returning partial page 1 results", async () => {
    const urls = [];
    const pages = [
      { ok: true, status: 200, json: async () => ({ players: [{ id: "p1" }], hasMore: true, nextCursor: "c1" }) },
      { ok: false, status: 503, json: async () => ({ error: "Firestore unavailable" }) },
    ];
    let idx = 0;
    const res = await feed.fetchAllPlayerPages({
      buildUrl: (cursor) => (cursor ? `/api/players/public?cursor=${cursor}` : "/api/players/public"),
      fetchPage: async (url) => {
        urls.push(url);
        return pages[idx++];
      },
    });
    assert.equal(res.ok, false);
    assert.equal(res.failedPage, 2);
    assert.equal(res.players, undefined);
    assert.match(res.error, /page 2.*Firestore unavailable/i);
    assert.equal(urls.length, 2);
  });

  it("fails explicitly on page 4 without returning partial pages 1-3 results", async () => {
    const pages = [
      { ok: true, status: 200, json: async () => ({ players: [{ id: "p1" }], hasMore: true, nextCursor: "c1" }) },
      { ok: true, status: 200, json: async () => ({ players: [{ id: "p2" }], hasMore: true, nextCursor: "c2" }) },
      { ok: true, status: 200, json: async () => ({ players: [{ id: "p3" }], hasMore: true, nextCursor: "c3" }) },
      async () => {
        throw new Error("Connection reset");
      },
    ];
    let idx = 0;
    const res = await feed.fetchAllPlayerPages({
      buildUrl: (cursor) => (cursor ? `/api/finance/players?cursor=${cursor}` : "/api/finance/players"),
      fetchPage: async () => {
        const next = pages[idx++];
        return typeof next === "function" ? next() : next;
      },
    });
    assert.equal(res.ok, false);
    assert.equal(res.failedPage, 4);
    assert.equal(res.players, undefined);
    assert.match(res.error, /page 4.*Connection reset/i);
  });

  it("useStore, PlayerDirectory, and FinanceTab expose error/retry state instead of partial results", () => {
    const storeSrc = src("hooks/useStore.ts");
    const dirSrc = src("components/club/PlayerDirectory.tsx");
    const finSrc = src("components/FinanceTab.tsx");
    assert.match(storeSrc, /playersDirectoryLoading/);
    assert.match(storeSrc, /playersDirectoryError/);
    assert.match(storeSrc, /retryPlayersDirectory/);
    assert.match(storeSrc, /fetchAllPlayerPages/);
    assert.match(dirSrc, /data-testid="directory-error"/);
    assert.match(dirSrc, /data-testid="directory-retry-btn"/);
    assert.match(finSrc, /data-testid="finance-directory-error"/);
    assert.match(finSrc, /data-testid="finance-directory-retry-btn"/);
  });
});
