import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { searchPlayerAccessibleData } from "../lib/player-search.ts";

const root = process.cwd();
const NOW = Date.parse("2026-11-25T12:00:00Z");
const RECENT_DATE = new Date(NOW - 5 * 24 * 60 * 60 * 1000).toISOString();
const OLD_DATE = new Date(NOW - 45 * 24 * 60 * 60 * 1000).toISOString();

const baseInput = {
  now: NOW,
  matches: [
    {
      id: "m-open",
      opponent: "Royal Strikers",
      date: "2026-11-28",
      format: "T20",
      matchType: "Practice",
      groundId: "g-1",
      result: "KAvach Won",
      resultMarginAmount: 24,
      resultMarginType: "runs",
    },
    {
      id: "m-private",
      opponent: "Royal Secret",
      date: "2026-11-29",
      format: "T20",
      matchType: "Tournament",
      groundId: "g-1",
    },
    {
      id: "m-archived",
      opponent: "Royal Archived",
      date: "2026-10-01",
      format: "T30",
      matchType: "Practice",
      groundId: "g-1",
      isArchived: true,
    },
    {
      id: "m-tentative",
      opponent: "Royal Tentative",
      date: "2026-12-05",
      format: "T20",
      matchType: "Practice",
      groundId: "g-1",
      isTentative: true,
    },
  ],
  tournaments: [
    {
      id: "t-1",
      name: "Royal Premier Cup",
      groundId: "g-1",
      organiserName: "Secret Org",
      organiserPhone: "9333333333",
      gpayNumber: "9444444444",
      jerseyColor: "Scarlet Red",
      format: "T30",
      amountPerMatch: 12000,
      perPlayerFee: 1050,
      status: "Ongoing",
    },
    {
      id: "t-disabled",
      name: "Royal Hidden Cup",
      groundId: "g-1",
      organiserName: "Org",
      organiserPhone: "9333333333",
      gpayNumber: "9444444444",
      jerseyColor: "Whites",
      format: "T20",
      amountPerMatch: 10000,
      perPlayerFee: 900,
      status: "Disabled",
    },
  ],
  posts: [
    { id: "a-1", title: "Royal Jersey Launch", text: "New kit unveiling", isAnnouncement: true },
    { id: "a-admin", title: "Royal Admin Memo", text: "Internal only", isAnnouncement: true, audience: "admin" },
    { id: "f-1", title: "Royal Match Photos", text: "Gallery from Sunday", authorName: "Rohit", isAnnouncement: false },
  ],
  players: [
    {
      id: "p-1",
      name: "Royal Sharma",
      kavachId: "KAV-01",
      jerseyName: "ROHIT",
      jerseyNumber: "45",
      battingStyle: "Right-hand bat",
      phone: "9998887776",
      mobile: "9998887776",
      email: "royal@secret.com",
      dob: "1995-05-01",
      emergencyContact: "9000000000",
      locality: "Secret Nagar",
    },
    { id: "p-2", name: "Royal Disabled", kavachId: "KAV-02", disabled: true },
    { id: "p-3", name: "Royal Merged", kavachId: "KAV-03", mergedInto: "p-1" },
    { id: "p-4", name: "Royal Pending", kavachId: "KAV-04", inviteStatus: "Pending" },
    { id: "p-5", name: "Royal Rejected", kavachId: "KAV-05", inviteStatus: "Rejected" },
  ],
  grounds: [
    {
      id: "g-1",
      name: "Royal Oval Ground",
      location: "Indiranagar",
      mapUrl: "https://maps.google.com/?q=1,2",
      organiserName: "Org",
      organiserPhone: "9111111111",
      gpayNumber: "9222222222",
    },
  ],
  polls: [
    {
      id: "poll-1",
      title: "Royal Kit Color",
      type: "singleChoice",
      options: ["Scarlet", "Gold"],
      isSticked: false,
      isActive: true,
      createdAt: RECENT_DATE,
      voterIds: ["p-1"],
      responses: [{ playerId: "p-1", response: "Scarlet" }],
    },
    {
      id: "poll-recent-closed",
      title: "Royal Breakfast Poll",
      type: "singleChoice",
      options: ["Poha", "Idli"],
      isSticked: false,
      isActive: false,
      createdAt: RECENT_DATE,
    },
    {
      id: "poll-old-closed",
      title: "Royal Old Poll",
      type: "singleChoice",
      options: ["A"],
      isSticked: false,
      isActive: false,
      createdAt: OLD_DATE,
    },
  ],
  payments: [
    { id: "pay-1", matchId: "m-private", playerId: "other-player", status: "Unpaid", amount: 500 },
  ],
  mePlayer: { id: "p-1", name: "Royal Sharma" },
  isAdmin: false,
};

test("searchPlayerAccessibleData covers all 7 categories with case-insensitive partial matching", () => {
  assert.equal(searchPlayerAccessibleData({ ...baseInput, query: "   " }), null);

  const res = searchPlayerAccessibleData({ ...baseInput, query: "RoYaL" });
  assert.ok(res);

  // Matches: only eligible non-archived, non-tentative match
  assert.deepEqual(res.matches.map((m) => m.id), ["m-open"]);

  // Tournaments: ongoing included, disabled excluded, private fields stripped
  assert.deepEqual(res.tournaments.map((t) => t.id), ["t-1"]);
  assert.equal("organiserPhone" in res.tournaments[0], false);
  assert.equal("gpayNumber" in res.tournaments[0], false);
  assert.equal("amountPerMatch" in res.tournaments[0], false);

  // Announcements & Feed separated; admin-only memo excluded
  assert.deepEqual(res.announcements.map((p) => p.id), ["a-1"]);
  assert.deepEqual(res.feedPosts.map((p) => p.id), ["f-1"]);

  // Players: only active verified non-merged player; private fields stripped
  assert.deepEqual(res.players.map((p) => p.id), ["p-1"]);
  for (const key of ["phone", "mobile", "email", "dob", "emergencyContact", "locality", "chestSize", "authUid", "paymentHistory"]) {
    assert.equal(key in res.players[0], false);
  }

  // Grounds: private organiser/gpay stripped
  assert.equal(res.grounds.length, 1);
  assert.equal("organiserName" in res.grounds[0], false);
  assert.equal("organiserPhone" in res.grounds[0], false);
  assert.equal("gpayNumber" in res.grounds[0], false);

  // Polls: active + recently closed (30d) included; old closed excluded; voter/response data stripped
  assert.deepEqual(res.polls.map((p) => p.id), ["poll-1", "poll-recent-closed"]);
  assert.equal("voterIds" in res.polls[0], false);
  assert.equal("responses" in res.polls[0], false);
});

test("searchPlayerAccessibleData searches jersey name/number, match result/type/date, ground location, and poll options", () => {
  assert.deepEqual(searchPlayerAccessibleData({ ...baseInput, query: "ROHIT" })?.players.map((p) => p.id), ["p-1"]);
  assert.deepEqual(searchPlayerAccessibleData({ ...baseInput, query: "45" })?.players.map((p) => p.id), ["p-1"]);
  assert.deepEqual(searchPlayerAccessibleData({ ...baseInput, query: "24 runs" })?.matches.map((m) => m.id), ["m-open"]);
  assert.deepEqual(searchPlayerAccessibleData({ ...baseInput, query: "2026-11-28" })?.matches.map((m) => m.id), ["m-open"]);
  assert.deepEqual(searchPlayerAccessibleData({ ...baseInput, query: "indiranagar" })?.grounds.map((g) => g.id), ["g-1"]);
  assert.deepEqual(searchPlayerAccessibleData({ ...baseInput, query: "scarlet" })?.polls.map((p) => p.id), ["poll-1"]);
  assert.deepEqual(searchPlayerAccessibleData({ ...baseInput, query: "idli" })?.polls.map((p) => p.id), ["poll-recent-closed"]);

  const noMatch = searchPlayerAccessibleData({ ...baseInput, query: "zzzz_not_found" });
  assert.ok(noMatch);
  assert.equal(noMatch.matches.length, 0);
  assert.equal(noMatch.tournaments.length, 0);
  assert.equal(noMatch.players.length, 0);
  assert.equal(noMatch.grounds.length, 0);
  assert.equal(noMatch.announcements.length, 0);
  assert.equal(noMatch.feedPosts.length, 0);
  assert.equal(noMatch.polls.length, 0);
});

test("searchPlayerAccessibleData blocks private field discovery, disabled/unlinked accounts, and disabled features", () => {
  for (const secret of ["9998887776", "royal@secret.com", "9000000000", "Secret Nagar", "9111111111", "9222222222", "9333333333", "9444444444"]) {
    const r = searchPlayerAccessibleData({ ...baseInput, query: secret });
    assert.equal(r?.players.length, 0);
    assert.equal(r?.grounds.length, 0);
    assert.equal(r?.tournaments.length, 0);
  }

  // Unlinked user cannot discover matches
  const unlinkedRes = searchPlayerAccessibleData({ ...baseInput, mePlayer: null, query: "Royal" });
  assert.deepEqual(unlinkedRes?.matches.map((m) => m.id), []);

  // Disabled player account cannot discover any records
  const disabledRes = searchPlayerAccessibleData({
    ...baseInput,
    mePlayer: { id: "p-1", name: "Royal Sharma", disabled: true },
    query: "Royal",
  });
  assert.equal(disabledRes?.matches.length, 0);
  assert.equal(disabledRes?.players.length, 0);
  assert.equal(disabledRes?.polls.length, 0);

  // Disabled feature flags hide corresponding categories
  const disabledFeatures = searchPlayerAccessibleData({
    ...baseInput,
    query: "royal",
    isFeatureEnabled: (k) => !["matches", "polls", "announcements", "feed"].includes(k),
  });
  assert.equal(disabledFeatures?.matches.length, 0);
  assert.equal(disabledFeatures?.tournaments.length, 0);
  assert.equal(disabledFeatures?.polls.length, 0);
  assert.equal(disabledFeatures?.announcements.length, 0);
  assert.equal(disabledFeatures?.feedPosts.length, 0);
});

test("Global Search UI & AppHeader enforce lazy-loading, debouncing, navigation guards, and player-only entry", () => {
  const globalSearchSrc = fs.readFileSync(path.join(root, "components/search/PlayerGlobalSearch.tsx"), "utf8");
  const headerSrc = fs.readFileSync(path.join(root, "components/layout/AppHeader.tsx"), "utf8");
  const pageSrc = fs.readFileSync(path.join(root, "app/page.tsx"), "utf8");

  // Debounce + on-demand lazy loaders + loading/error/empty/no-results/Show More states
  assert.match(globalSearchSrc, /SEARCH_DEBOUNCE_MS = 200/);
  assert.match(globalSearchSrc, /store\.ensurePosts\?\.\(\)/);
  assert.match(globalSearchSrc, /store\.ensurePolls\?\.\(\)/);
  assert.match(globalSearchSrc, /store\.ensureTournaments\?\.\(\)/);
  assert.match(globalSearchSrc, /Show more/);
  assert.match(globalSearchSrc, /data-testid="search-loading-state"/);
  assert.match(globalSearchSrc, /data-testid="search-error-state"/);
  assert.match(globalSearchSrc, /data-testid="search-no-results"/);

  // Correct destination routing (Polls -> "pulse", Announcements -> "announcements", Tournaments -> "matches")
  assert.match(globalSearchSrc, /onNavigateTab\("pulse", poll\.id\)/);
  assert.match(globalSearchSrc, /onNavigateTab\("announcements", p\.id\)/);
  assert.match(globalSearchSrc, /onNavigateTab\("matches", `tournament_\$\{t\.id\}`\)/);
  assert.doesNotMatch(globalSearchSrc, /admin-tools|\/api\/admin\/access/);

  // Header search button only in player persona; page revalidates match navigation
  assert.match(headerSrc, /persona === "player" && onOpenSearch/);
  assert.match(headerSrc, /data-testid="header-search-btn"/);
  assert.match(pageSrc, /PlayerGlobalSearchModal/);
  assert.match(pageSrc, /validateMatchNavigation\(/);
});
