import test from "node:test";
import assert from "node:assert/strict";
import {
  filterAndSanitizeAuditEntries,
  getPermittedAuditEntities,
} from "../lib/audit-access.ts";
import { setAuthDbForTesting } from "../lib/server-auth.ts";
import { GET as auditLogGET, POST as auditLogPOST } from "../app/api/audit/log/route.ts";

test("getPermittedAuditEntities enforces Super Admin, Club Admin, and Finance Admin boundaries", () => {
  assert.equal(
    getPermittedAuditEntities({ isSuperAdmin: true, isClubAdmin: false, isFinanceAdmin: false }),
    "ALL",
  );

  const club = getPermittedAuditEntities({
    isSuperAdmin: false,
    isClubAdmin: true,
    isFinanceAdmin: false,
  });
  assert.ok(Array.isArray(club));
  assert.equal(club.includes("post"), true);
  assert.equal(club.includes("badge"), true);
  assert.equal(club.includes("badge_type"), true);
  assert.equal(club.includes("catch"), true);
  assert.equal(club.includes("club_stats"), true);
  assert.equal(club.includes("match"), true);
  assert.equal(club.includes("payment"), false);
  assert.equal(club.includes("fee"), false);
  assert.equal(club.includes("fee_plan"), false);
  assert.equal(club.includes("fee_plan_assignment"), false);
  assert.equal(club.includes("subscription_period"), false);
  assert.equal(club.includes("user_role"), false);

  const finance = getPermittedAuditEntities({
    isSuperAdmin: false,
    isClubAdmin: false,
    isFinanceAdmin: true,
  });
  assert.ok(Array.isArray(finance));
  assert.equal(finance.includes("payment"), true);
  assert.equal(finance.includes("fee"), true);
  assert.equal(finance.includes("fee_plan"), true);
  assert.equal(finance.includes("fee_plan_assignment"), true);
  assert.equal(finance.includes("subscription_period"), true);
  assert.equal(finance.includes("badge"), false);
  assert.equal(finance.includes("catch"), false);
  assert.equal(finance.includes("post"), false);
  assert.equal(finance.includes("club_stats"), false);
});

test("filterAndSanitizeAuditEntries strips financial diffs from shared match/subscription entries for Club Admin", () => {
  const entries = [
    {
      id: "a-1",
      entity: "match",
      summary: "Updated base match fee for vs Tigers (fee ₹800)",
      changes: [
        { field: "opponent", oldValue: "Lions", newValue: "Tigers" },
        { field: "fee", oldValue: "500", newValue: "800" },
        { field: "matchFeeBudget", oldValue: "6000", newValue: "9000" },
      ],
    },
    {
      id: "a-2",
      entity: "payment",
      summary: "Marked Paid ₹800",
      changes: [{ field: "status", oldValue: "Unpaid", newValue: "Paid" }],
    },
    {
      id: "a-3",
      entity: "badge",
      summary: "Awarded badge",
      changes: [{ field: "badgeType", newValue: "hat-trick" }],
    },
  ];

  const clubView = filterAndSanitizeAuditEntries(entries, {
    isSuperAdmin: false,
    isClubAdmin: true,
    isFinanceAdmin: false,
  });
  assert.equal(clubView.length, 2);
  assert.equal(clubView[0].changes.some((c) => c.field === "fee" || c.field === "matchFeeBudget"), false);
  assert.equal(clubView[0].summary.includes("₹800"), false);
  assert.equal(clubView[1].entity, "badge");

  const financeView = filterAndSanitizeAuditEntries(entries, {
    isSuperAdmin: false,
    isClubAdmin: false,
    isFinanceAdmin: true,
  });
  assert.equal(financeView.length, 2);
  assert.equal(financeView[0].changes.some((c) => c.field === "fee"), true);
  assert.equal(financeView[1].entity, "payment");
});

test("GET /api/audit/log rejects unauthenticated, player, and cross-role entity queries", async () => {
  const prevBypass = process.env.KAVACH_TEST_AUTH_BYPASS;
  const prevEnv = process.env.NODE_ENV;
  process.env.KAVACH_TEST_AUTH_BYPASS = "true";
  process.env.NODE_ENV = "test";

  try {
    const unauth = await auditLogGET(new Request("http://localhost/api/audit/log"));
    assert.equal(unauth.status, 401);

    const player = await auditLogGET(
      new Request("http://localhost/api/audit/log", {
        headers: { "x-test-uid": "u-p", "x-test-roles": "player" },
      }),
    );
    assert.equal(player.status, 403);

    const clubAskPayment = await auditLogGET(
      new Request("http://localhost/api/audit/log?entity=payment", {
        headers: { "x-test-uid": "u-c", "x-test-roles": "clubAdmin" },
      }),
    );
    assert.equal(clubAskPayment.status, 403);

    const finAskBadge = await auditLogGET(
      new Request("http://localhost/api/audit/log?entity=badge", {
        headers: { "x-test-uid": "u-f", "x-test-roles": "financeAdmin" },
      }),
    );
    assert.equal(finAskBadge.status, 403);
  } finally {
    process.env.KAVACH_TEST_AUTH_BYPASS = prevBypass;
    process.env.NODE_ENV = prevEnv || "test";
  }
});

test("POST /api/audit/log ignores client-supplied actor fields and rejects server-authoritative entities", async () => {
  const prevBypass = process.env.KAVACH_TEST_AUTH_BYPASS;
  const prevEnv = process.env.NODE_ENV;
  process.env.KAVACH_TEST_AUTH_BYPASS = "true";
  process.env.NODE_ENV = "test";

  let writtenDoc = null;
  setAuthDbForTesting({
    collection: (name) => ({
      doc: (id) => ({
        get: async () => ({
          exists: name === "appUsers",
          data: () => ({ name: "Verified Server Actor" }),
        }),
        create: async (data) => {
          writtenDoc = { id, ...data };
        },
      }),
    }),
  });

  try {
    const rejected = await auditLogPOST(
      new Request("http://localhost/api/audit/log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-uid": "u-club",
          "x-test-roles": "clubAdmin",
        },
        body: JSON.stringify({
          actorId: "spoofed-uid",
          actorName: "Spoofed Name",
          action: "paid",
          entity: "payment",
          entityId: "p-1",
          summary: "Spoofed payment",
        }),
      }),
    );
    assert.equal(rejected.status, 403);

    const okRes = await auditLogPOST(
      new Request("http://localhost/api/audit/log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-uid": "u-club",
          "x-test-roles": "clubAdmin",
        },
        body: JSON.stringify({
          actorId: "spoofed-uid",
          actorName: "Spoofed Name",
          action: "created",
          entity: "ground",
          entityId: "g-1",
          entityLabel: "Oval Ground",
          summary: "Created ground Oval Ground",
        }),
      }),
    );
    assert.equal(okRes.status, 200);
    assert.equal(writtenDoc.actorId, "u-club");
    assert.equal(writtenDoc.actorName, "Verified Server Actor");
  } finally {
    setAuthDbForTesting(null);
    process.env.KAVACH_TEST_AUTH_BYPASS = prevBypass;
    process.env.NODE_ENV = prevEnv || "test";
  }
});
