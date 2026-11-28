/**
 * Firebase Auth + Firestore Emulator validation for Badges 2.0 Phase 1:
 * - Server-side non-stackable badge uniqueness (including legacy docs)
 * - Concurrent duplicate-award prevention across multiple Club Admins
 * - Stackable badge multiple awards regression
 * - Idempotent retry deduplication without duplicate audit logs
 * - System-awarded POTW rejection on manual badge endpoint
 * - Transactional server audit logging with server-derived actor identity
 * - Admin Global Search `badgeTypes` collection regression
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { initializeApp, getApps, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const ROOT = pathToFileURL(process.cwd() + "/").href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
const ROOT = ${JSON.stringify(ROOT)};
export async function resolve(spec, ctx, next) {
  if (spec === "next/server") return next("next/server.js", ctx);
  if (spec.startsWith("@/")) spec = new URL(spec.slice(2) + (/\\.[a-z]+$/.test(spec) ? "" : ".ts"), ROOT).href;
  return next(spec, ctx);
}`),
  import.meta.url,
);

const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);

async function signInEmulatorUser(auth, uid, claims = {}) {
  try {
    await auth.createUser({ uid, email: `${uid}@kavach.test` });
  } catch {}
  if (Object.keys(claims).length > 0) {
    await auth.setCustomUserClaims(uid, claims);
  }
  const customToken = await auth.createCustomToken(uid, claims);
  const res = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const data = await res.json();
  if (!res.ok || !data.idToken) {
    throw new Error(`Failed to exchange custom token for ${uid}: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

describe("Badges Phase 1 (Firebase Auth + Firestore Emulator)", { skip: !hasEmulator ? "Emulator not running" : false }, () => {
  let app;
  let db;
  let auth;
  let badgesRoute;
  let searchRoute;
  let admin1Token;
  let admin2Token;

  before(async () => {
    const projectId = process.env.GCLOUD_PROJECT || "demo-kavach-play";
    app = getApps().length ? getApps()[0] : initializeApp({ projectId });
    db = getFirestore(app);
    auth = getAuth(app);

    const { setServerDbForTesting } = await import("../lib/server-db.ts");
    setServerDbForTesting(db);

    badgesRoute = await import("../app/api/admin/badges/route.ts");
    searchRoute = await import("../app/api/admin/search/route.ts");

    await db.collection("appUsers").doc("club-admin-1").set({
      uid: "club-admin-1",
      name: "Admin One",
      status: "Active",
      isClubAdmin: true,
    });
    await db.collection("appUsers").doc("club-admin-2").set({
      uid: "club-admin-2",
      name: "Admin Two",
      status: "Active",
      isClubAdmin: true,
    });

    admin1Token = await signInEmulatorUser(auth, "club-admin-1");
    admin2Token = await signInEmulatorUser(auth, "club-admin-2");
  });

  after(async () => {
    if (app) await deleteApp(app);
  });

  const postBadge = (token, body) =>
    badgesRoute.POST(
      new Request("http://localhost/api/admin/badges", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }),
    );

  it("prevents duplicate non-stackable badge awards and writes transactional audit with server-derived actor", async () => {
    const first = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        id: "client-ignored-1",
        playerId: "p-dup-1",
        playerName: "Rohan",
        badgeType: "year_1",
        awardedBy: "spoofed-uid",
        awardedByName: "Spoofed Name",
      },
      idempotencyKey: "dup_test_1",
    });
    assert.equal(first.status, 200);
    const firstJson = await first.json();
    assert.equal(firstJson.ok, true);

    const second = await postBadge(admin2Token, {
      target: "badge",
      badge: {
        id: "client-ignored-2",
        playerId: "p-dup-1",
        playerName: "Rohan",
        badgeType: "year_1",
      },
      idempotencyKey: "dup_test_2",
    });
    assert.equal(second.status, 409);

    const badgeSnap = await db
      .collection("badges")
      .where("playerId", "==", "p-dup-1")
      .where("badgeType", "==", "year_1")
      .get();
    assert.equal(badgeSnap.size, 1);
    const badgeDoc = badgeSnap.docs[0].data();
    assert.equal(badgeDoc.awardedBy, "club-admin-1");
    assert.equal(badgeDoc.awardedByName, "Admin One");

    const auditSnap = await db
      .collection("auditLogs")
      .where("entity", "==", "badge")
      .where("entityId", "==", badgeSnap.docs[0].id)
      .get();
    assert.equal(auditSnap.size, 1);
    assert.equal(auditSnap.docs[0].data().actorId, "club-admin-1");
    assert.equal(auditSnap.docs[0].data().actorName, "Admin One");
    assert.equal(auditSnap.docs[0].data().source, "server_authoritative");
  });

  it("blocks awarding non-stackable badge when a legacy random-ID badge already exists", async () => {
    await db.collection("badges").doc("legacy-random-uuid-123").set({
      playerId: "p-legacy-1",
      playerName: "Vikram",
      badgeType: "original",
      awardedBy: "legacy-admin",
      awardedByName: "Legacy Admin",
      redeemed: false,
    });

    const res = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        playerId: "p-legacy-1",
        playerName: "Vikram",
        badgeType: "original",
      },
      idempotencyKey: "legacy_dup_1",
    });
    assert.equal(res.status, 409);

    const snap = await db
      .collection("badges")
      .where("playerId", "==", "p-legacy-1")
      .where("badgeType", "==", "original")
      .get();
    assert.equal(snap.size, 1);
  });

  it("enforces uniqueness under concurrent requests from two Club Admins", async () => {
    const [r1, r2] = await Promise.all([
      postBadge(admin1Token, {
        target: "badge",
        badge: {
          id: "race-1",
          playerId: "p-race-1",
          playerName: "Arjun",
          badgeType: "elite",
        },
        idempotencyKey: "race_key_admin1",
      }),
      postBadge(admin2Token, {
        target: "badge",
        badge: {
          id: "race-2",
          playerId: "p-race-1",
          playerName: "Arjun",
          badgeType: "elite",
        },
        idempotencyKey: "race_key_admin2",
      }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 409]);

    const badgeSnap = await db
      .collection("badges")
      .where("playerId", "==", "p-race-1")
      .where("badgeType", "==", "elite")
      .get();
    assert.equal(badgeSnap.size, 1);

    const auditSnap = await db
      .collection("auditLogs")
      .where("entity", "==", "badge")
      .where("entityId", "==", badgeSnap.docs[0].id)
      .get();
    assert.equal(auditSnap.size, 1);
  });

  it("deduplicates stackable retry after lost response even with a different client badge.id", async () => {
    const r1 = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        id: "stack-lost-1",
        playerId: "p-stack-lost",
        playerName: "Rohit",
        badgeType: "centurion",
      },
      idempotencyKey: "stack_lost_resp_key",
    });
    assert.equal(r1.status, 200);
    const j1 = await r1.json();
    assert.equal(j1.id, "stack-lost-1");

    // Simulated response loss: client retries with same idempotencyKey but new UUID badge.id
    const r2 = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        id: "stack-lost-2-new-uuid",
        playerId: "p-stack-lost",
        playerName: "Rohit",
        badgeType: "centurion",
      },
      idempotencyKey: "stack_lost_resp_key",
    });
    assert.equal(r2.status, 200);
    const j2 = await r2.json();
    assert.equal(j2.deduplicated, true);
    assert.equal(j2.id, "stack-lost-1");

    const badgeSnap = await db
      .collection("badges")
      .where("playerId", "==", "p-stack-lost")
      .where("badgeType", "==", "centurion")
      .get();
    assert.equal(badgeSnap.size, 1);
  });

  it("returns original successful result on non-stackable retry after lost response even with a different client badge.id", async () => {
    const r1 = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        id: "ns-lost-1",
        playerId: "p-ns-lost",
        playerName: "Karan",
        badgeType: "year_2",
      },
      idempotencyKey: "ns_lost_resp_key",
    });
    assert.equal(r1.status, 200);
    const j1 = await r1.json();
    assert.equal(j1.id, "ns-lost-1");

    const r2 = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        id: "ns-lost-2-new-uuid",
        playerId: "p-ns-lost",
        playerName: "Karan",
        badgeType: "year_2",
      },
      idempotencyKey: "ns_lost_resp_key",
    });
    assert.equal(r2.status, 200);
    const j2 = await r2.json();
    assert.equal(j2.deduplicated, true);
    assert.equal(j2.id, "ns-lost-1");

    const badgeSnap = await db
      .collection("badges")
      .where("playerId", "==", "p-ns-lost")
      .where("badgeType", "==", "year_2")
      .get();
    assert.equal(badgeSnap.size, 1);
  });

  it("rejects reusing an idempotency key with a different player or badge type", async () => {
    const r1 = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        id: "mismatch-orig-1",
        playerId: "p-mismatch-1",
        playerName: "Gill",
        badgeType: "centurion",
      },
      idempotencyKey: "mismatch_idem_key",
    });
    assert.equal(r1.status, 200);

    const diffPlayer = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        id: "mismatch-orig-2",
        playerId: "p-mismatch-2",
        playerName: "Other",
        badgeType: "centurion",
      },
      idempotencyKey: "mismatch_idem_key",
    });
    assert.equal(diffPlayer.status, 409);

    const diffBadge = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        id: "mismatch-orig-3",
        playerId: "p-mismatch-1",
        playerName: "Gill",
        badgeType: "hattrick",
      },
      idempotencyKey: "mismatch_idem_key",
    });
    assert.equal(diffBadge.status, 409);
  });

  it("concurrent identical idempotent requests produce one badge and one audit record", async () => {
    const [r1, r2] = await Promise.all([
      postBadge(admin1Token, {
        target: "badge",
        badge: {
          id: "conc-idem-1",
          playerId: "p-conc-idem",
          playerName: "Bumrah",
          badgeType: "5wh",
        },
        idempotencyKey: "conc_idem_shared_key",
      }),
      postBadge(admin1Token, {
        target: "badge",
        badge: {
          id: "conc-idem-2",
          playerId: "p-conc-idem",
          playerName: "Bumrah",
          badgeType: "5wh",
        },
        idempotencyKey: "conc_idem_shared_key",
      }),
    ]);

    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);

    const badgeSnap = await db
      .collection("badges")
      .where("playerId", "==", "p-conc-idem")
      .where("badgeType", "==", "5wh")
      .get();
    assert.equal(badgeSnap.size, 1);

    const auditSnap = await db
      .collection("auditLogs")
      .where("entity", "==", "badge")
      .where("entityId", "==", badgeSnap.docs[0].id)
      .get();
    assert.equal(auditSnap.size, 1);
  });

  it("supports award, revoke, and re-award for a non-stackable badge", async () => {
    const grant1 = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        id: "reaward-1",
        playerId: "p-reaward-1",
        playerName: "Jadeja",
        badgeType: "core",
      },
      idempotencyKey: "reaward_grant_1",
    });
    assert.equal(grant1.status, 200);

    const revoke = await badgesRoute.DELETE(
      new Request("http://localhost/api/admin/badges?target=badge&id=reaward-1&idempotencyKey=reaward_del_1", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${admin1Token}` },
      }),
    );
    assert.equal(revoke.status, 200);

    const grant2 = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        id: "reaward-2",
        playerId: "p-reaward-1",
        playerName: "Jadeja",
        badgeType: "core",
      },
      idempotencyKey: "reaward_grant_2",
    });
    assert.equal(grant2.status, 200);

    const snap = await db
      .collection("badges")
      .where("playerId", "==", "p-reaward-1")
      .where("badgeType", "==", "core")
      .get();
    assert.equal(snap.size, 1);
    assert.equal(snap.docs[0].id, "reaward-2");
  });

  it("rejects unknown badge types and inactive custom badge types, and honours active custom stackability", async () => {
    const unknownRes = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        playerId: "p-val-1",
        playerName: "Player",
        badgeType: "nonexistent_badge_xyz",
      },
      idempotencyKey: "unknown_bt_1",
    });
    assert.equal(unknownRes.status, 400);

    await db.collection("badgeTypes").doc("archived_custom_badge").set({
      id: "archived_custom_badge",
      label: "Archived",
      short: "Arch",
      tier: "bronze",
      emoji: "A",
      stackable: false,
      active: false,
      order: 101,
    });
    const inactiveRes = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        playerId: "p-val-1",
        playerName: "Player",
        badgeType: "archived_custom_badge",
      },
      idempotencyKey: "inactive_bt_1",
    });
    assert.equal(inactiveRes.status, 400);

    await db.collection("badgeTypes").doc("active_stackable_custom").set({
      id: "active_stackable_custom",
      label: "Super Sub",
      short: "Sub",
      tier: "silver",
      emoji: "S",
      stackable: true,
      active: true,
      order: 102,
    });
    const c1 = await postBadge(admin1Token, {
      target: "badge",
      badge: { id: "cust-s-1", playerId: "p-val-1", playerName: "Player", badgeType: "active_stackable_custom" },
      idempotencyKey: "active_cust_s1",
    });
    const c2 = await postBadge(admin1Token, {
      target: "badge",
      badge: { id: "cust-s-2", playerId: "p-val-1", playerName: "Player", badgeType: "active_stackable_custom" },
      idempotencyKey: "active_cust_s2",
    });
    assert.equal(c1.status, 200);
    assert.equal(c2.status, 200);
  });

  it("accepts all 19 manual built-in badge IDs and restricts player_of_weekend", async () => {
    const { BUILTIN_BADGE_CATALOG } = await import("../lib/badge-awarding.ts");
    const allIds = Object.keys(BUILTIN_BADGE_CATALOG);
    assert.equal(allIds.length, 20);

    for (const bt of allIds) {
      if (bt === "player_of_weekend") continue;
      const res = await postBadge(admin1Token, {
        target: "badge",
        badge: {
          id: `builtin-${bt}`,
          playerId: "p-builtin-all",
          playerName: "All Builtin",
          badgeType: bt,
        },
        idempotencyKey: `builtin_key_${bt}`,
      });
      assert.equal(res.status, 200, `Expected built-in badge ${bt} to be accepted`);
    }
  });

  it("allows multiple awards for stackable badges", async () => {
    const r1 = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        id: "stack-1",
        playerId: "p-stack-1",
        playerName: "Virat",
        badgeType: "centurion",
        note: "102* vs Lions",
      },
      idempotencyKey: "stack_key_1",
    });
    const r2 = await postBadge(admin2Token, {
      target: "badge",
      badge: {
        id: "stack-2",
        playerId: "p-stack-1",
        playerName: "Virat",
        badgeType: "centurion",
        note: "115 vs Tigers",
      },
      idempotencyKey: "stack_key_2",
    });

    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);

    const snap = await db
      .collection("badges")
      .where("playerId", "==", "p-stack-1")
      .where("badgeType", "==", "centurion")
      .get();
    assert.equal(snap.size, 2);
  });

  it("rejects manual awarding of system-managed player_of_weekend badge", async () => {
    const res = await postBadge(admin1Token, {
      target: "badge",
      badge: {
        playerId: "p-potw-1",
        playerName: "Dev",
        badgeType: "player_of_weekend",
      },
      idempotencyKey: "potw_manual_block",
    });
    assert.equal(res.status, 400);
  });

  it("Admin Global Search resolves custom badgeTypes stored in badgeTypes collection", async () => {
    await db.collection("badgeTypes").doc("custom_clutch_finisher").set({
      id: "custom_clutch_finisher",
      label: "Clutch Finisher",
      short: "Clutch",
      tier: "gold",
      emoji: "⚡",
      stackable: false,
      order: 100,
    });
    await db.collection("badges").doc("badge-clutch-1").set({
      playerId: "p-clutch-1",
      playerName: "Surya",
      badgeType: "custom_clutch_finisher",
      awardedBy: "club-admin-1",
      awardedByName: "Admin One",
      redeemed: false,
    });

    const res = await searchRoute.GET(
      new Request("http://localhost/api/admin/search?q=Clutch", {
        headers: { Authorization: `Bearer ${admin1Token}` },
      }),
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    const badgesGroup = (data.groups || []).find((g) => g.category === "badges");
    assert.ok(badgesGroup, "Expected badges group in search results");
    assert.ok(
      badgesGroup.items.some((item) => item.id === "badge-clutch-1" && item.title.includes("Clutch Finisher")),
      "Expected badge resolved with label from badgeTypes collection in search results",
    );
  });

  it("rejects malformed supplied idempotencyKey with 400 while allowing omitted key", async () => {
    for (const badKey of ["", "   ", "has space", "bad/slash", 123, null]) {
      const res = await postBadge(admin1Token, {
        target: "badge",
        badge: { id: "bad-key-1", playerId: "p-bad-key", playerName: "Test", badgeType: "centurion" },
        idempotencyKey: badKey,
      });
      assert.equal(res.status, 400, `Expected 400 for invalid idempotencyKey: ${JSON.stringify(badKey)}`);
    }

    const omitted = await postBadge(admin1Token, {
      target: "badge",
      badge: { id: "omitted-key-1", playerId: "p-omit-key", playerName: "Omit", badgeType: "centurion" },
    });
    assert.equal(omitted.status, 200);
  });

  it("does not recreate a revoked badge on idempotency replay and requires a new key for re-award", async () => {
    const grant1 = await postBadge(admin1Token, {
      target: "badge",
      badge: { id: "rev-replay-1", playerId: "p-rev-replay", playerName: "Pant", badgeType: "original" },
      idempotencyKey: "rev_replay_key_1",
    });
    assert.equal(grant1.status, 200);

    const del = await badgesRoute.DELETE(
      new Request("http://localhost/api/admin/badges?target=badge&id=rev-replay-1&idempotencyKey=rev_del_1", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${admin1Token}` },
      }),
    );
    assert.equal(del.status, 200);

    const replay = await postBadge(admin1Token, {
      target: "badge",
      badge: { id: "rev-replay-2", playerId: "p-rev-replay", playerName: "Pant", badgeType: "original" },
      idempotencyKey: "rev_replay_key_1",
    });
    assert.equal(replay.status, 409);
    const replayJson = await replay.json();
    assert.match(replayJson.error, /no longer present|revoked/i);

    const afterReplaySnap = await db
      .collection("badges")
      .where("playerId", "==", "p-rev-replay")
      .where("badgeType", "==", "original")
      .get();
    assert.equal(afterReplaySnap.size, 0, "Replay of revoked award must not recreate badge");

    const reaward = await postBadge(admin1Token, {
      target: "badge",
      badge: { id: "rev-replay-3", playerId: "p-rev-replay", playerName: "Pant", badgeType: "original" },
      idempotencyKey: "rev_replay_key_2",
    });
    assert.equal(reaward.status, 200);
  });

  it("protects built-in catalogue definitions from conflicting Firestore badgeTypes overrides", async () => {
    await db.collection("badgeTypes").doc("year_3").set({
      id: "year_3",
      label: "3 Years",
      short: "3Y",
      tier: "silver",
      emoji: "3",
      stackable: true, // conflicts with BUILTIN_BADGE_CATALOG.year_3.stackable === false
      active: true,
      order: 3,
    });
    const conflictStack = await postBadge(admin1Token, {
      target: "badge",
      badge: { id: "cat-conf-1", playerId: "p-cat-conf", playerName: "Cat", badgeType: "year_3" },
      idempotencyKey: "cat_conf_1",
    });
    assert.equal(conflictStack.status, 409);

    await db.collection("badgeTypes").doc("year_4").set({
      id: "year_4",
      label: "4 Years",
      short: "4Y",
      tier: "silver",
      emoji: "4",
      stackable: false,
      active: false, // built-in cannot be deactivated via override
      order: 4,
    });
    const conflictInactive = await postBadge(admin1Token, {
      target: "badge",
      badge: { id: "cat-conf-2", playerId: "p-cat-conf", playerName: "Cat", badgeType: "year_4" },
      idempotencyKey: "cat_conf_2",
    });
    assert.equal(conflictInactive.status, 409);

    await db.collection("badgeTypes").doc("year_5").set({
      id: "year_5",
      label: "5 Years",
      short: "5Y",
      tier: "gold",
      emoji: "5",
      stackable: false,
      active: true,
      order: 5,
    });
    const matchingBuiltin = await postBadge(admin1Token, {
      target: "badge",
      badge: { id: "cat-ok-5", playerId: "p-cat-conf", playerName: "Cat", badgeType: "year_5" },
      idempotencyKey: "cat_ok_5",
    });
    assert.equal(matchingBuiltin.status, 200);
  });

  it("classifies stackable doc-ID collision as 409 and returns 500 for contention without duplicate or unexpected failure", async () => {
    // 1. Stackable badge document-ID collision
    const s1 = await postBadge(admin1Token, {
      target: "badge",
      badge: { id: "stack-doc-col-1", playerId: "p-doc-col", playerName: "Col", badgeType: "centurion" },
      idempotencyKey: "doc_col_k1",
    });
    assert.equal(s1.status, 200);

    const s2 = await postBadge(admin1Token, {
      target: "badge",
      badge: { id: "stack-doc-col-1", playerId: "p-doc-col", playerName: "Col", badgeType: "centurion" },
      idempotencyKey: "doc_col_k2",
    });
    assert.equal(s2.status, 409);
    const s2Json = await s2.json();
    assert.match(s2Json.error, /document ID already exists/i);

    // 2. Transaction contention without an idempotency record or lock -> 500 (not 409)
    const origRunTx = db.runTransaction.bind(db);
    try {
      db.runTransaction = async () => {
        const err = new Error("10 ABORTED: Transaction contention");
        err.code = 10;
        throw err;
      };
      const contentionRes = await postBadge(admin1Token, {
        target: "badge",
        badge: { id: "contend-no-dup", playerId: "p-contend-none", playerName: "None", badgeType: "centurion" },
        idempotencyKey: "contend_no_dup_k1",
      });
      assert.equal(contentionRes.status, 500);

      // 3. Unexpected transaction failure -> 500 (not 409)
      db.runTransaction = async () => {
        throw new Error("Unexpected internal failure");
      };
      const unexpectedRes = await postBadge(admin1Token, {
        target: "badge",
        badge: { id: "unexpected-fail", playerId: "p-unexp", playerName: "Unexp", badgeType: "centurion" },
        idempotencyKey: "unexpected_fail_k1",
      });
      assert.equal(unexpectedRes.status, 500);
    } finally {
      db.runTransaction = origRunTx;
    }
  });
});
