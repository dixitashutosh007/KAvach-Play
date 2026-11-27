import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  executeAdminSearch,
  getPermittedAdminSearchCategories,
} from "../lib/admin-search.ts";
import { isAdminDestinationVisible } from "../lib/admin-navigation.ts";
import { setAuthDbForTesting } from "../lib/server-auth.ts";
import { GET as adminSearchGET } from "../app/api/admin/search/route.ts";

const sampleDataset = {
  players: [
    {
      id: "p-1",
      name: "Virat Sharma",
      kavachId: "KAV-101",
      jerseyNumber: "18",
      jerseyName: "VIRAT",
      mobile: "9876500001",
      email: "virat.secret@example.com",
      locality: "Indiranagar",
      inviteStatus: "Accepted",
      isStudioMember: true,
      studioPlan: "3M",
      studioExpiryDate: "2027-01-15",
    },
  ],
  grounds: [
    {
      id: "g-1",
      name: "Virat Oval Ground",
      location: "Koramangala",
      organiserName: "Ramesh",
    },
  ],
  tournaments: [
    {
      id: "t-1",
      name: "Virat Memorial Cup",
      groundId: "g-1",
      startDate: "2026-12-01",
      endDate: "2026-12-20",
      status: "Ongoing",
      format: "T20",
    },
  ],
  matches: [
    {
      id: "m-1",
      opponent: "Virat Challengers",
      date: "2026-11-30",
      groundId: "g-1",
      tournamentId: "t-1",
      format: "T20",
      matchType: "Tournament",
      result: "KAvach Won",
      fee: 850,
    },
  ],
  announcements: [
    {
      id: "a-1",
      title: "Virat Net Session",
      text: "Practice starts at 6 AM",
      authorName: "Coach",
      isAnnouncement: true,
      isPinned: true,
    },
  ],
  polls: [
    {
      id: "poll-1",
      title: "Virat Jersey Poll",
      type: "singleChoice",
      options: ["Scarlet", "Whites"],
      isActive: true,
      isSticked: false,
    },
  ],
  badgeTypeDefs: [
    { id: "hat-trick", label: "Virat Hat-Trick", tier: "gold" },
  ],
  badges: [
    {
      id: "b-1",
      playerId: "p-1",
      playerName: "Virat Sharma",
      badgeType: "hat-trick",
      awardedAt: "2026-11-20",
      note: "Match winner",
    },
  ],
  catches: [
    {
      id: "c-1",
      playerId: "p-1",
      playerName: "Virat Sharma",
      type: "stunning",
      count: 2,
      matchId: "m-1",
      comment: "One-handed diving catch",
      recordedAt: "2026-11-21",
    },
  ],
  matchPayments: [
    {
      id: "pay-1",
      matchId: "m-1",
      playerId: "p-1",
      status: "Unpaid",
      feeOverride: 850,
      razorpayPaymentId: "pay_secret_rzp_123",
    },
  ],
  otherFees: [
    {
      id: "fee-1",
      playerId: "p-1",
      title: "Virat Kit Dues",
      amount: 1200,
      status: "Unpaid",
      comment: "Pending kit balance",
    },
    {
      id: "noshow-1",
      playerId: "p-1",
      title: "No Show",
      amount: 500,
      status: "Unpaid",
      comment: "Virat missed Sunday net",
      createdAt: "2026-11-22",
    },
  ],
  feePlans: [
    {
      id: "fp-1",
      name: "Virat Monthly Plan",
      type: "monthly",
      monthlyAmount: 2500,
      description: "Monthly match pass",
      isActive: true,
    },
  ],
  feePlanAssignments: [
    {
      id: "fpa-1",
      playerId: "p-1",
      planId: "fp-1",
      planName: "Virat Monthly Plan",
      startDate: "2026-11-01",
      endDate: null,
    },
  ],
  subscriptionHistory: [
    {
      id: "sub-1",
      playerId: "p-1",
      planName: "Virat Studio 3M",
      newExpiryDate: "2027-01-15",
      paidAmount: 4500,
    },
  ],
  merchandises: [
    {
      id: "merch-1",
      name: "Virat Edition Jersey",
      category: "Jersey",
      description: "Official scarlet kit",
      status: "Accepting Orders",
    },
  ],
  merchOrders: [
    {
      id: "ord-1",
      playerId: "p-1",
      playerName: "Virat Sharma",
      merchName: "Virat Edition Jersey",
      size: "L",
      orderStatus: "Order Placed",
    },
  ],
};

test("Super Admin receives all 12 categories with valid destinations", () => {
  const roles = { isSuperAdmin: true, isClubAdmin: true, isFinanceAdmin: true };
  const res = executeAdminSearch(sampleDataset, "Virat", roles);
  const categories = res.groups.map((g) => g.category);

  assert.deepEqual(categories.sort(), [
    "announcements",
    "badges",
    "catches",
    "finance",
    "grounds",
    "matches",
    "noShows",
    "players",
    "pulse",
    "shop",
    "studio",
    "tournaments",
  ]);

  for (const group of res.groups) {
    for (const item of group.items) {
      assert.equal(isAdminDestinationVisible(item.destination.tab, roles), true);
    }
  }
});

test("Club Admin receives operational categories and ZERO financial data or counts", () => {
  const roles = { isSuperAdmin: false, isClubAdmin: true, isFinanceAdmin: false };
  const permitted = getPermittedAdminSearchCategories(roles);
  assert.equal(permitted.includes("finance"), false);
  assert.equal(permitted.includes("noShows"), false);

  const res = executeAdminSearch(sampleDataset, "Virat", roles);
  const categories = res.groups.map((g) => g.category);
  assert.equal(categories.includes("finance"), false);
  assert.equal(categories.includes("noShows"), false);

  // Also ensure searching financial keywords returns nothing
  const rzpSearch = executeAdminSearch(sampleDataset, "pay_secret_rzp_123", roles);
  assert.equal(rzpSearch.totalCount, 0);

  const planSearch = executeAdminSearch(sampleDataset, "Monthly Plan", roles);
  assert.equal(planSearch.totalCount, 0);

  // Matches and Studio must not leak financial amounts to Club Admin
  const matchGroup = res.groups.find((g) => g.category === "matches");
  assert.ok(matchGroup && matchGroup.items.length > 0);
  assert.equal(matchGroup.items[0].meta, undefined);

  const studioGroup = res.groups.find((g) => g.category === "studio");
  assert.ok(studioGroup && studioGroup.items.length > 0);
  assert.equal(studioGroup.items[0].meta, undefined);
  for (const item of studioGroup.items) {
    assert.equal(item.meta, undefined);
  }

  for (const group of res.groups) {
    for (const item of group.items) {
      assert.equal(isAdminDestinationVisible(item.destination.tab, roles), true);
    }
  }
});

test("Finance Admin receives financial & permitted categories without player PII", () => {
  const roles = { isSuperAdmin: false, isClubAdmin: false, isFinanceAdmin: true };
  const res = executeAdminSearch(sampleDataset, "Virat", roles);
  const categories = res.groups.map((g) => g.category);

  assert.equal(categories.includes("finance"), true);
  assert.equal(categories.includes("noShows"), true);
  assert.equal(categories.includes("players"), true);
  assert.equal(categories.includes("matches"), true);
  assert.equal(categories.includes("studio"), true);

  // Club-only categories must not appear
  for (const forbidden of ["grounds", "announcements", "pulse", "badges", "catches", "tournaments", "shop"]) {
    assert.equal(categories.includes(forbidden), false);
  }

  // Finance Admin must NOT be able to search by or receive player PII (mobile/email/locality)
  const piiMobile = executeAdminSearch(sampleDataset, "9876500001", roles);
  assert.equal(piiMobile.totalCount, 0);
  const piiEmail = executeAdminSearch(sampleDataset, "virat.secret@example.com", roles);
  assert.equal(piiEmail.totalCount, 0);

  const playerGroup = res.groups.find((g) => g.category === "players");
  assert.ok(playerGroup && playerGroup.items.length === 1);
  assert.equal(playerGroup.items[0].subtitle?.includes("9876500001"), false);
  assert.equal(playerGroup.items[0].subtitle?.includes("virat.secret"), false);

  for (const group of res.groups) {
    for (const item of group.items) {
      assert.equal(isAdminDestinationVisible(item.destination.tab, roles), true);
    }
  }
});

test("totalCount sums group.totalMatched even when perCategoryLimit truncates group.items", () => {
  const roles = { isSuperAdmin: true, isClubAdmin: true, isFinanceAdmin: true };
  const dataset = {
    matches: Array.from({ length: 5 }, (_, i) => ({
      id: `m-${i}`,
      opponent: `Bulk Strikers ${i}`,
      date: "2026-11-30",
      format: "T20",
      matchType: "Practice",
    })),
    players: Array.from({ length: 4 }, (_, i) => ({
      id: `p-${i}`,
      name: `Bulk Player ${i}`,
    })),
  };

  const res = executeAdminSearch(dataset, "Bulk", roles, 2);
  const matchGroup = res.groups.find((g) => g.category === "matches");
  const playerGroup = res.groups.find((g) => g.category === "players");

  assert.equal(matchGroup.items.length, 2);
  assert.equal(matchGroup.totalMatched, 5);
  assert.equal(playerGroup.items.length, 2);
  assert.equal(playerGroup.totalMatched, 4);
  assert.equal(res.totalCount, 9);
});

function createMockDb(queriedPaths, selectedFieldsByPath = {}, pagedDocsByPath = {}) {
  const rateLimitStore = new Map();
  const makeSnap = (docs) => ({
    empty: docs.length === 0,
    docs: docs.map((d) => ({
      id: d.id,
      data: () => d.data,
      ref: { parent: { parent: { id: d.parentId || "parent-1" } } },
    })),
  });

  const makeQuery = (name) => {
    let cursorId = null;
    let pageLimit = 500;
    const q = {
      select: (...fields) => {
        selectedFieldsByPath[name] = fields;
        return q;
      },
      where: () => q,
      orderBy: () => q,
      limit: (n) => {
        pageLimit = n;
        return q;
      },
      startAfter: (docSnap) => {
        cursorId = docSnap?.id || null;
        return q;
      },
      doc: (id) => ({
        id,
        path: `${name}/${id}`,
      }),
      get: async () => {
        queriedPaths.push(name);
        if (pagedDocsByPath[name]) {
          const all = pagedDocsByPath[name];
          const startIdx = cursorId ? all.findIndex((d) => d.id === cursorId) + 1 : 0;
          return makeSnap(all.slice(startIdx, startIdx + pageLimit));
        }
        if (name === "players") {
          return makeSnap([{ id: "p-1", data: sampleDataset.players[0] }]);
        }
        if (name === "payments") {
          return makeSnap([{ id: "pay-1", data: sampleDataset.matchPayments[0] }]);
        }
        if (name === "otherFees") {
          return makeSnap([{ id: "fee-1", data: sampleDataset.otherFees[0] }]);
        }
        return makeSnap([]);
      },
    };
    return q;
  };

  return {
    collection: (name) => makeQuery(name),
    collectionGroup: (name) => makeQuery(name),
    runTransaction: async (fn) => {
      const tx = {
        get: async (ref) => {
          const existing = rateLimitStore.get(ref.path);
          return existing
            ? { exists: true, data: () => existing }
            : { exists: false, data: () => undefined };
        },
        set: (ref, data) => {
          rateLimitStore.set(ref.path, data);
        },
      };
      return fn(tx);
    },
  };
}

test("GET /api/admin/search rejects unauthenticated, player, and disabled callers", async () => {
  const prevBypass = process.env.KAVACH_TEST_AUTH_BYPASS;
  const prevEnv = process.env.NODE_ENV;
  process.env.KAVACH_TEST_AUTH_BYPASS = "true";
  process.env.NODE_ENV = "test";

  try {
    // 1. Unauthenticated
    const unauthRes = await adminSearchGET(new Request("http://localhost/api/admin/search?q=Virat"));
    assert.equal(unauthRes.status, 401);

    // 2. Plain player
    const playerRes = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=Virat", {
        headers: { "x-test-uid": "u-player", "x-test-roles": "player" },
      }),
    );
    assert.equal(playerRes.status, 403);

    // 3. Disabled admin
    const disabledRes = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=Virat", {
        headers: {
          "x-test-uid": "u-disabled",
          "x-test-roles": "clubAdmin",
          "x-test-status": "Disabled",
        },
      }),
    );
    assert.equal(disabledRes.status, 403);

    // 4. Empty & 1-character queries rejected with 400
    const emptyRes = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=%20%20", {
        headers: { "x-test-uid": "u-club", "x-test-roles": "clubAdmin" },
      }),
    );
    assert.equal(emptyRes.status, 400);

    const shortRes = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=a", {
        headers: { "x-test-uid": "u-club", "x-test-roles": "clubAdmin" },
      }),
    );
    assert.equal(shortRes.status, 400);
    const shortBody = await shortRes.json();
    assert.match(shortBody.error, /at least 2/i);

    // 5. Overly long query
    const longRes = await adminSearchGET(
      new Request(`http://localhost/api/admin/search?q=${"a".repeat(121)}`, {
        headers: { "x-test-uid": "u-club", "x-test-roles": "clubAdmin" },
      }),
    );
    assert.equal(longRes.status, 400);
  } finally {
    process.env.KAVACH_TEST_AUTH_BYPASS = prevBypass;
    process.env.NODE_ENV = prevEnv || "test";
  }
});

test("GET /api/admin/search never queries financial collections for Club Admin", async () => {
  const prevBypass = process.env.KAVACH_TEST_AUTH_BYPASS;
  const prevEnv = process.env.NODE_ENV;
  process.env.KAVACH_TEST_AUTH_BYPASS = "true";
  process.env.NODE_ENV = "test";

  const queried = [];
  const selected = {};
  setAuthDbForTesting(createMockDb(queried, selected));

  try {
    const res = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=Virat", {
        headers: { "x-test-uid": "u-club", "x-test-roles": "clubAdmin" },
      }),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(queried.includes("payments"), false);
    assert.equal(queried.includes("otherFees"), false);
    assert.equal(queried.includes("feePlans"), false);
    assert.equal(queried.includes("financePlanAssignments"), false);
    assert.equal(body.groups.some((g) => g.category === "finance" || g.category === "noShows"), false);

    // Verify field-level Firestore .select() projections exclude financial fields for Club Admin
    assert.equal(selected.matches.includes("fee"), false);
    assert.equal(selected.matches.includes("financeStatus"), false);
    assert.equal(selected.matches.includes("groundFeePaidAmount"), false);
    assert.equal(selected.subscriptionHistory.includes("paidAmount"), false);
    assert.equal(selected.merchOrders.includes("price"), false);
    assert.equal(selected.merchOrders.includes("paymentStatus"), false);
    assert.equal(selected.tournaments.includes("amountPerMatch"), false);
    assert.equal(selected.tournaments.includes("perPlayerFee"), false);
  } finally {
    setAuthDbForTesting(null);
    process.env.KAVACH_TEST_AUTH_BYPASS = prevBypass;
    process.env.NODE_ENV = prevEnv || "test";
  }
});

test("GET /api/admin/search enforces non-PII .select() for Finance Admin and includes financial fields for Finance/Super Admin", async () => {
  const prevBypass = process.env.KAVACH_TEST_AUTH_BYPASS;
  const prevEnv = process.env.NODE_ENV;
  process.env.KAVACH_TEST_AUTH_BYPASS = "true";
  process.env.NODE_ENV = "test";

  const finQueried = [];
  const finSelected = {};
  setAuthDbForTesting(createMockDb(finQueried, finSelected));

  try {
    const finRes = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=Virat", {
        headers: { "x-test-uid": "u-fin", "x-test-roles": "financeAdmin" },
      }),
    );
    assert.equal(finRes.status, 200);
    assert.equal(finSelected.players.includes("mobile"), false);
    assert.equal(finSelected.players.includes("email"), false);
    assert.equal(finSelected.players.includes("locality"), false);
    assert.equal(finSelected.matches.includes("fee"), true);
    assert.equal(finSelected.subscriptionHistory.includes("paidAmount"), true);
    assert.equal(finQueried.includes("polls"), false);
    assert.equal(finQueried.includes("merchOrders"), false);

    const superQueried = [];
    const superSelected = {};
    setAuthDbForTesting(createMockDb(superQueried, superSelected));
    const superRes = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=Virat", {
        headers: { "x-test-uid": "u-super", "x-test-admin": "true" },
      }),
    );
    assert.equal(superRes.status, 200);
    assert.equal(superSelected.players.includes("mobile"), true);
    assert.equal(superSelected.matches.includes("fee"), true);
    assert.equal(superSelected.subscriptionHistory.includes("paidAmount"), true);
  } finally {
    setAuthDbForTesting(null);
    process.env.KAVACH_TEST_AUTH_BYPASS = prevBypass;
    process.env.NODE_ENV = prevEnv || "test";
  }
});

test("GET /api/admin/search paginates beyond 500 documents via cursor", async () => {
  const prevBypass = process.env.KAVACH_TEST_AUTH_BYPASS;
  const prevEnv = process.env.NODE_ENV;
  process.env.KAVACH_TEST_AUTH_BYPASS = "true";
  process.env.NODE_ENV = "test";

  // Create 505 matches so the matching record sits on page 2 (> 500)
  const manyMatches = Array.from({ length: 505 }, (_, idx) => ({
    id: `m-${String(idx).padStart(4, "0")}`,
    data: {
      opponent: idx === 504 ? "Target Beyond Limit XI" : `Filler Team ${idx}`,
      date: "2026-11-30",
      format: "T20",
      matchType: "Practice",
    },
  }));

  const queried = [];
  const selected = {};
  setAuthDbForTesting(createMockDb(queried, selected, { matches: manyMatches }));

  try {
    const res = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=Target%20Beyond%20Limit", {
        headers: { "x-test-uid": "u-club", "x-test-roles": "clubAdmin" },
      }),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    const matchGroup = body.groups.find((g) => g.category === "matches");
    assert.ok(matchGroup);
    assert.equal(matchGroup.items.length, 1);
    assert.equal(matchGroup.items[0].id, "m-0504");
  } finally {
    setAuthDbForTesting(null);
    process.env.KAVACH_TEST_AUTH_BYPASS = prevBypass;
    process.env.NODE_ENV = prevEnv || "test";
  }
});

test("GET /api/admin/search enforces per-UID shared rate limit (429 + Retry-After)", async () => {
  const prevBypass = process.env.KAVACH_TEST_AUTH_BYPASS;
  const prevEnv = process.env.NODE_ENV;
  process.env.KAVACH_TEST_AUTH_BYPASS = "true";
  process.env.NODE_ENV = "test";

  setAuthDbForTesting(createMockDb([]));

  try {
    for (let i = 0; i < 30; i++) {
      const okRes = await adminSearchGET(
        new Request("http://localhost/api/admin/search?q=Virat", {
          headers: { "x-test-uid": "u-ratelimit", "x-test-roles": "clubAdmin" },
        }),
      );
      assert.equal(okRes.status, 200);
    }

    const limitedRes = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=Virat", {
        headers: { "x-test-uid": "u-ratelimit", "x-test-roles": "clubAdmin" },
      }),
    );
    assert.equal(limitedRes.status, 429);
    assert.ok(Number(limitedRes.headers.get("Retry-After")) >= 1);
  } finally {
    setAuthDbForTesting(null);
    process.env.KAVACH_TEST_AUTH_BYPASS = prevBypass;
    process.env.NODE_ENV = prevEnv || "test";
  }
});

test("Header and page integration preserve PlayerGlobalSearch and wire AdminGlobalSearch", () => {
  const headerSrc = fs.readFileSync(path.join(process.cwd(), "components/layout/AppHeader.tsx"), "utf8");
  const pageSrc = fs.readFileSync(path.join(process.cwd(), "app/page.tsx"), "utf8");

  assert.equal(headerSrc.includes("{onOpenSearch && ("), true);
  assert.equal(pageSrc.includes("<PlayerGlobalSearchModal"), true);
  assert.equal(pageSrc.includes("<AdminGlobalSearchModal"), true);
  assert.equal(pageSrc.includes('e.key.toLowerCase() === "k"'), true);
});
