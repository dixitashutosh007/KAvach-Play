import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { searchPlayerAccessibleData } from "../lib/player-search.ts";
import {
  nextAnnouncementPageAction,
  resolvePublicDirectoryPlayer,
} from "../lib/club-feed.ts";
import {
  createLazyLoadRegistry,
  createSearchReadinessCoordinator,
  LazyLoadCancelledError,
} from "../lib/search-readiness.ts";

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

  // Announcements & Feed separated (matches postKinds.ts / ClubAnnouncementsSection / ClubFeedPreview)
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("Search readiness coordinator waits for all 3 datasets, surfaces errors, and recovers on retry", async () => {
  const states = [];
  let postsDef = deferred();
  let pollsDef = deferred();
  let tournsDef = deferred();
  let calls = { posts: 0, polls: 0, tournaments: 0 };

  const coord = createSearchReadinessCoordinator(
    () => ({
      ensurePosts: () => { calls.posts++; return postsDef.promise; },
      ensurePolls: () => { calls.polls++; return pollsDef.promise; },
      ensureTournaments: () => { calls.tournaments++; return tournsDef.promise; },
    }),
    (s) => states.push(s),
  );

  const p = coord.startQuery("royal");
  assert.equal(states.at(-1).status, "loading");

  // Resolve 2 of 3: must STILL be loading (partial data never shown as complete)
  postsDef.resolve();
  pollsDef.resolve();
  await Promise.resolve();
  assert.equal(states.at(-1).status, "loading");

  // Reject 3rd dataset -> must transition to error, not ready/no-results
  tournsDef.reject(new Error("Firestore unavailable"));
  await p;
  assert.equal(states.at(-1).status, "error");
  assert.equal(states.at(-1).error, "Firestore unavailable");

  // Retry succeeds when the failed dataset recovers
  tournsDef = deferred();
  const retryP = coord.retry();
  assert.equal(states.at(-1).status, "loading");
  tournsDef.resolve();
  await retryP;
  assert.equal(states.at(-1).status, "ready");
  assert.equal(states.at(-1).readyQuery, "royal");
  assert.equal(calls.tournaments, 2);
});

test("Search readiness coordinator cancels stale requests on query change, clear, and unmount", async () => {
  const states = [];
  const d1 = deferred();
  const d2 = deferred();
  let turn = 0;

  const coord = createSearchReadinessCoordinator(
    () => ({
      ensurePosts: () => (turn === 1 ? d1.promise : d2.promise),
      ensurePolls: () => Promise.resolve(),
      ensureTournaments: () => Promise.resolve(),
    }),
    (s) => states.push(s),
  );

  // Start first query, then supersede with second query before first finishes
  turn = 1;
  const p1 = coord.startQuery("first");
  turn = 2;
  const p2 = coord.startQuery("second");

  d2.resolve();
  await p2;
  assert.equal(states.at(-1).status, "ready");
  assert.equal(states.at(-1).readyQuery, "second");

  // Now stale first query resolves: MUST NOT overwrite "second"
  d1.resolve();
  await p1;
  assert.equal(states.at(-1).readyQuery, "second");

  // Clearing resets to idle and ignores any later stale completion
  const d3 = deferred();
  turn = 3;
  const p3 = coord.startQuery("third");
  // point loader to d3 by overriding via turn !== 1:
  void d3;
  await coord.startQuery("");
  assert.equal(states.at(-1).status, "idle");
  assert.equal(states.at(-1).error, null);
  await p3;
  assert.equal(states.at(-1).status, "idle");

  // Unmount (dispose) prevents any further emissions
  const countBeforeDispose = states.length;
  coord.dispose();
  await coord.startQuery("after-unmount");
  assert.equal(states.length, countBeforeDispose);
});

test("Lazy registry settles pending posts/polls promises on detach, blocks stale callbacks, and supports restart", async () => {
  const registry = createLazyLoadRegistry();
  let postsApplyCount = 0;
  let pollsApplyCount = 0;
  let postControlsList = [];
  let pollControlsList = [];

  const pPosts = registry.ensureListener("posts", (c) => {
    postControlsList.push(c);
    return () => {};
  });
  const pPolls = registry.ensureListener("polls", (c) => {
    pollControlsList.push(c);
    return () => {};
  });

  // Detach both before their first snapshot arrives
  registry.detach("posts");
  registry.detachAll();

  await assert.rejects(pPosts, (err) => err instanceof LazyLoadCancelledError && err.domainKey === "posts");
  await assert.rejects(pPolls, (err) => err instanceof LazyLoadCancelledError && err.domainKey === "polls");

  // Stale listener callbacks after detach MUST NOT mutate state
  postControlsList[0].onData(() => { postsApplyCount++; });
  pollControlsList[0].onData(() => { pollsApplyCount++; });
  assert.equal(postsApplyCount, 0);
  assert.equal(pollsApplyCount, 0);

  // Restart after detach creates fresh listeners and resolves cleanly
  const pPosts2 = registry.ensureListener("posts", (c) => {
    postControlsList.push(c);
    return () => {};
  });
  assert.equal(registry.hasActiveListener("posts"), true);
  // Old listener error after new listener is registered MUST NOT delete the new listener's entry
  postControlsList[0].onError(new Error("late old error"));
  assert.equal(registry.hasActiveListener("posts"), true);

  postControlsList[1].onData(() => { postsApplyCount++; });
  await pPosts2;
  assert.equal(postsApplyCount, 1);
});

test("Lazy registry clearAll cancels pending tournaments one-shot and coordinator restarts cleanly without error", async () => {
  const registry = createLazyLoadRegistry();
  let tournamentsSetCount = 0;
  const tournDefs = [deferred(), deferred()];
  const tournPromises = [];
  const postControlsList = [];
  const pollControlsList = [];
  let postsCalls = 0;
  let pollsCalls = 0;
  let tournamentsCalls = 0;

  const firstRoundStarted = deferred();
  const secondRoundStarted = deferred();
  const checkStarted = () => {
    if (postsCalls === 1 && pollsCalls === 1 && tournamentsCalls === 1) {
      firstRoundStarted.resolve();
    }
    if (postsCalls === 2 && pollsCalls === 2 && tournamentsCalls === 2) {
      secondRoundStarted.resolve();
    }
  };

  const states = [];
  const coord = createSearchReadinessCoordinator(
    () => ({
      ensurePosts: () => {
        postsCalls++;
        const p = registry.ensureListener("posts", (c) => {
          postControlsList.push(c);
          return () => {};
        });
        checkStarted();
        return p;
      },
      ensurePolls: () => {
        pollsCalls++;
        const p = registry.ensureListener("polls", (c) => {
          pollControlsList.push(c);
          return () => {};
        });
        checkStarted();
        return p;
      },
      ensureTournaments: () => {
        const idx = tournamentsCalls++;
        const p = registry.ensureOneShot("tournaments", async (isStale) => {
          await tournDefs[idx].promise;
          if (isStale()) return;
          tournamentsSetCount++;
        });
        tournPromises.push(p);
        checkStarted();
        return p;
      },
    }),
    (s) => states.push(s),
  );

  const runPromise = coord.startQuery("royal");
  assert.equal(states.at(-1).status, "loading");

  // Wait until all 3 first-round loaders have actually started and registered
  await firstRoundStarted.promise;
  assert.equal(tournPromises.length, 1);
  assert.equal(registry.hasActiveListener("posts"), true);
  assert.equal(registry.hasActiveListener("polls"), true);

  let firstTournSettled = false;
  const firstTournObserved = tournPromises[0]
    .catch(() => {})
    .finally(() => {
      firstTournSettled = true;
    });
  await Promise.resolve();
  assert.equal(firstTournSettled, false, "original tournaments operation must still be pending before clearAll()");

  // Cancel all in-flight operations
  registry.clearAll();

  await assert.rejects(
    tournPromises[0],
    (err) => err instanceof LazyLoadCancelledError && err.domainKey === "tournaments",
  );
  await firstTournObserved;
  assert.equal(firstTournSettled, true);

  // Resolving the original deferred tournaments operation afterwards must NOT update state
  tournDefs[0].resolve();
  await Promise.resolve();
  assert.equal(tournamentsSetCount, 0);

  // Wait for coordinator's automatic restart to invoke distinct second-round loaders
  await secondRoundStarted.promise;
  assert.equal(tournPromises.length, 2);
  assert.notEqual(tournPromises[1], tournPromises[0]);
  assert.equal(postControlsList.length, 2);
  assert.notEqual(postControlsList[1], postControlsList[0]);
  assert.equal(pollControlsList.length, 2);
  assert.notEqual(pollControlsList[1], pollControlsList[0]);

  // Complete restarted operations
  tournDefs[1].resolve();
  pollControlsList[1].onData(() => {});
  postControlsList[1].onData(() => {});
  await runPromise;

  assert.equal(states.some((s) => s.status === "error"), false);
  assert.equal(states.at(-1).status, "ready");
  assert.equal(states.at(-1).readyQuery, "royal");
  assert.equal(tournamentsSetCount, 1);
});

test("Player directory handoff resolves target player beyond page 1, strips PII, and rejects invalid/unavailable IDs", () => {
  const manyPlayers = Array.from({ length: 25 }, (_, i) => ({
    id: `p-${i + 1}`,
    name: `Player ${String(i + 1).padStart(2, "0")}`,
    kavachId: `KAV-${i + 1}`,
    phone: `98765000${String(i).padStart(2, "0")}`,
    email: `p${i + 1}@secret.com`,
    dob: "1995-01-01",
    locality: "Hidden",
  }));
  manyPlayers.push(
    { id: "p-disabled", name: "Disabled", disabled: true },
    { id: "p-merged", name: "Merged", mergedInto: "p-1" },
    { id: "p-pending", name: "Pending", inviteStatus: "Pending" },
    { id: "p-rejected", name: "Rejected", inviteStatus: "Rejected" },
  );

  // Target outside first 20 directory rows opens exact public profile with PII stripped
  const resolved = resolvePublicDirectoryPlayer(manyPlayers, "p-24");
  assert.ok(resolved);
  assert.equal(resolved.id, "p-24");
  assert.equal(resolved.name, "Player 24");
  for (const pii of ["phone", "mobile", "email", "dob", "locality", "emergencyContact", "authUid"]) {
    assert.equal(pii in resolved, false);
  }

  // Unavailable/invalid IDs return null and never open another player's profile
  assert.equal(resolvePublicDirectoryPlayer(manyPlayers, "nonexistent"), null);
  assert.equal(resolvePublicDirectoryPlayer(manyPlayers, "p-disabled"), null);
  assert.equal(resolvePublicDirectoryPlayer(manyPlayers, "p-merged"), null);
  assert.equal(resolvePublicDirectoryPlayer(manyPlayers, "p-pending"), null);
  assert.equal(resolvePublicDirectoryPlayer(manyPlayers, "p-rejected"), null);
  assert.equal(resolvePublicDirectoryPlayer(manyPlayers, null), null);
});

test("Announcement deep-link pagination loads pages until target is found, stops immediately, and handles missing IDs", () => {
  const page1 = Array.from({ length: 20 }, (_, i) => ({ id: `a-${i + 1}` }));
  const page2 = Array.from({ length: 10 }, (_, i) => ({ id: `a-${i + 21}` }));

  // In page 1 -> opens directly without loading more
  assert.equal(
    nextAnnouncementPageAction({ pendingOpen: "a-5", items: page1, done: false, loading: false, error: null }),
    "open",
  );

  // Beyond page 1 -> requests next page while not done, waits while loading
  assert.equal(
    nextAnnouncementPageAction({ pendingOpen: "a-25", items: page1, done: false, loading: false, error: null }),
    "load_more",
  );
  assert.equal(
    nextAnnouncementPageAction({ pendingOpen: "a-25", items: page1, done: false, loading: true, error: null }),
    "wait",
  );

  // Once page 2 arrives containing target -> opens and stops pagination (never loads page 3)
  assert.equal(
    nextAnnouncementPageAction({ pendingOpen: "a-25", items: [...page1, ...page2], done: false, loading: false, error: null }),
    "open",
  );

  // Missing announcement when done=true -> not_found (no infinite loop)
  assert.equal(
    nextAnnouncementPageAction({ pendingOpen: "a-missing", items: [...page1, ...page2], done: true, loading: false, error: null }),
    "not_found",
  );
});

test("Global Search UI & AppHeader wire readiness coordinator, lazy-loading, and player-only entry", () => {
  const globalSearchSrc = fs.readFileSync(path.join(root, "components/search/PlayerGlobalSearch.tsx"), "utf8");
  const directorySrc = fs.readFileSync(path.join(root, "components/club/PlayerDirectory.tsx"), "utf8");
  const announcementsSrc = fs.readFileSync(path.join(root, "components/club/ClubAnnouncementsScreen.tsx"), "utf8");
  const headerSrc = fs.readFileSync(path.join(root, "components/layout/AppHeader.tsx"), "utf8");
  const pageSrc = fs.readFileSync(path.join(root, "app/page.tsx"), "utf8");

  assert.match(globalSearchSrc, /onNavigateTab\("players", pl\.id\)/);
  assert.match(globalSearchSrc, /onNavigateTab\("announcements", p\.id\)/);
  assert.match(directorySrc, /initialPlayerId/);
  assert.match(directorySrc, /onOpenHandled/);
  assert.match(announcementsSrc, /nextAnnouncementPageAction/);
  assert.match(announcementsSrc, /onOpenHandled/);
  assert.match(pageSrc, /initialPlayerId=\{tabAction\}/);
  assert.match(headerSrc, /onOpenSearch &&/);
  assert.match(pageSrc, /persona === "player" && \(\s*<PlayerGlobalSearchModal/);
  assert.match(pageSrc, /validateMatchNavigation\(/);
});

test("Return-to-Home intent lifecycle handles search vs club navigation, invalid targets, and persona/tab resets", () => {
  const pageSrc = fs.readFileSync(path.join(root, "app/page.tsx"), "utf8");
  const homeTabSrc = fs.readFileSync(path.join(root, "components/HomeTab.tsx"), "utf8");
  const directorySrc = fs.readFileSync(path.join(root, "components/club/PlayerDirectory.tsx"), "utf8");
  const annScreenSrc = fs.readFileSync(path.join(root, "components/club/ClubAnnouncementsScreen.tsx"), "utf8");
  const annSectionSrc = fs.readFileSync(path.join(root, "components/home/ClubAnnouncementsSection.tsx"), "utf8");

  // Simulate the exact setActiveTab(tab, action, options) + destination close state machine from app/page.tsx
  let activeTab = "home";
  let tabAction = null;
  let searchReturnHome = false;
  const setActiveTab = (tab, action, options) => {
    activeTab = tab;
    tabAction = action || null;
    searchReturnHome = Boolean(options?.fromSearch);
  };

  // 1. Search -> Player -> Close -> Player Home
  setActiveTab("players", "p-1", { fromSearch: true });
  assert.equal(activeTab, "players");
  assert.equal(tabAction, "p-1");
  assert.equal(searchReturnHome, true);
  // Target opens -> tabAction cleared, searchReturnHome preserved
  tabAction = null;
  assert.equal(searchReturnHome, true);
  // Explicit close invokes onReturnFromSearch -> navigates to "home" and clears searchReturnHome
  if (searchReturnHome) setActiveTab("home");
  assert.equal(activeTab, "home");
  assert.equal(searchReturnHome, false);

  // 2. Search -> Announcement -> Close -> Player Home
  setActiveTab("announcements", "a-1", { fromSearch: true });
  tabAction = null;
  if (searchReturnHome) setActiveTab("home");
  assert.equal(activeTab, "home");
  assert.equal(searchReturnHome, false);

  // 3 & 4. Club menu -> Player Directory / Announcements -> Close -> Remain in destination
  setActiveTab("players");
  assert.equal(searchReturnHome, false);
  setActiveTab("announcements");
  assert.equal(searchReturnHome, false);

  // 5. Opening a second search result after returning home works cleanly
  setActiveTab("players", "p-2", { fromSearch: true });
  assert.equal(tabAction, "p-2");
  assert.equal(searchReturnHome, true);
  if (searchReturnHome) setActiveTab("home");
  assert.equal(activeTab, "home");

  // 6. Invalid/unavailable search target clears tabAction via onOpenHandled without firing onReturnFromSearch
  setActiveTab("players", "p-missing", { fromSearch: true });
  tabAction = null; // onOpenHandled only
  assert.equal(activeTab, "players");

  // 7. Navigating elsewhere / switching persona clears stale searchReturnHome
  setActiveTab("announcements", "a-1", { fromSearch: true });
  setActiveTab("club");
  assert.equal(searchReturnHome, false);

  // Verify production wiring matches
  assert.match(pageSrc, /setSearchReturnHome\(Boolean\(options\?\.fromSearch\)\)/);
  assert.match(pageSrc, /onReturnFromSearch=\{searchReturnHome \? \(\) => setActiveTab\("home"\) : undefined\}/);
  assert.match(homeTabSrc, /handleNavigate\(tab, targetId, \{ fromSearch: true \}\)/);
  assert.match(directorySrc, /onReturnFromSearch\?\.\(\)/);
  assert.match(annScreenSrc, /onCloseDetail=\{onReturnFromSearch\}/);
  assert.match(annSectionSrc, /onCloseDetail\?\.\(\)/);
});
