/**
 * Admin Club Recognition & KAvach Stats — Firestore Emulator integration tests.
 * Run: npm run test:emulator -- tests/admin-club-recognition.emulator.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator)";

const ist = (date, time = "00:00") => Date.parse(`${date}T${time}:00+05:30`);
const MON_0900 = ist("2026-11-23", "09:00");

describe("Admin Club Recognition & KAvach Stats — Emulator transactions", { skip }, () => {
  let db;
  let catchesRoute, statsRoute, potwRoute;
  let seq = 0;
  const saved = {};
  const uid = (p) => `${p}_${++seq}`;

  before(async () => {
    Object.assign(process.env, { NODE_ENV: "test", KAVACH_TEST_AUTH_BYPASS: "true" });
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = getApps().length
      ? getApps()[0]
      : initializeApp({ projectId: "kavach-club-recognition-test" });
    db = getFirestore(app);
    (await import("../lib/server-db.ts")).setServerDbForTesting(db);
    catchesRoute = await import("../app/api/admin/catches/route.ts");
    statsRoute = await import("../app/api/admin/player-stats/route.ts");
    potwRoute = await import("../app/api/admin/player-of-weekend/route.ts");
    for (const l of ["log", "info", "warn", "error"]) {
      saved[l] = console[l];
      console[l] = () => {};
    }
  });

  after(() => Object.assign(console, saved));

  async function call(handler, method, { actor = "admin_1", roles = "clubAdmin", body, now, query = "" } = {}) {
    const headers = {
      "content-type": "application/json",
      "x-test-uid": actor,
      "x-test-roles": roles,
    };
    if (now) headers["x-test-now"] = String(now);
    const res = await handler(
      new Request(`http://localhost/api/x${query}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
    let json = {};
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, json };
  }

  it("Catch recording: idempotencyKey deduplicates identical/concurrent requests and allows distinct keys", async () => {
    const playerId = uid("player");
    await db.collection("players").doc(playerId).set({
      name: "Catch Player",
      stunningCatches: 1,
      droppedCatches: 0,
    });

    const key1 = uid("idem");
    const [r1, r2] = await Promise.all([
      call(catchesRoute.POST, "POST", {
        body: { playerId, type: "stunning", count: 2, idempotencyKey: key1 },
      }),
      call(catchesRoute.POST, "POST", {
        body: { playerId, type: "stunning", count: 2, idempotencyKey: key1 },
      }),
    ]);

    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(
      [r1.json.deduplicated, r2.json.deduplicated].filter(Boolean).length,
      1,
    );

    let pSnap = await db.collection("players").doc(playerId).get();
    assert.equal(pSnap.data().stunningCatches, 3); // 1 + 2 once

    let logSnap = await db.collection("catchLog").where("playerId", "==", playerId).get();
    assert.equal(logSnap.size, 1);

    let auditSnap = await db
      .collection("auditLogs")
      .where("entity", "==", "catch")
      .where("entityId", "==", `catch_${key1}`)
      .get();
    assert.equal(auditSnap.size, 1);

    // Distinct key creates a separate entry
    const key2 = uid("idem");
    const r3 = await call(catchesRoute.POST, "POST", {
      body: { playerId, type: "dropped", count: 1, idempotencyKey: key2 },
    });
    assert.equal(r3.status, 200);
    assert.equal(r3.json.deduplicated, false);

    pSnap = await db.collection("players").doc(playerId).get();
    assert.equal(pSnap.data().stunningCatches, 3);
    assert.equal(pSnap.data().droppedCatches, 1);
  });

  it("Catch correction & deletion: concurrent PATCH, repeated PATCH/DELETE, type switch, and disabled player guard", async () => {
    const playerId = uid("player");
    await db.collection("players").doc(playerId).set({
      name: "Fielder",
      stunningCatches: 0,
      droppedCatches: 0,
    });

    const key = uid("idem");
    const created = await call(catchesRoute.POST, "POST", {
      body: { playerId, type: "stunning", count: 2, idempotencyKey: key },
    });
    const entryId = created.json.id;

    // Concurrent corrections
    const [c1, c2] = await Promise.all([
      call(catchesRoute.PATCH, "PATCH", {
        body: { entryId, type: "stunning", count: 4, comment: "Edit A" },
      }),
      call(catchesRoute.PATCH, "PATCH", {
        body: { entryId, type: "dropped", count: 3, comment: "Edit B" },
      }),
    ]);
    assert.equal(c1.status, 200);
    assert.equal(c2.status, 200);

    const entryAfter = (await db.collection("catchLog").doc(entryId).get()).data();
    const playerAfter = (await db.collection("players").doc(playerId).get()).data();
    assert.equal(playerAfter.stunningCatches, entryAfter.type === "stunning" ? entryAfter.count : 0);
    assert.equal(playerAfter.droppedCatches, entryAfter.type === "dropped" ? entryAfter.count : 0);

    // Repeated identical PATCH is a no-op
    const repeatPatch = await call(catchesRoute.PATCH, "PATCH", {
      body: {
        entryId,
        type: entryAfter.type,
        count: entryAfter.count,
        comment: entryAfter.comment || "",
      },
    });
    assert.equal(repeatPatch.status, 200);
    assert.equal(repeatPatch.json.unchanged, true);

    // Disabled player cannot be corrected
    await db.collection("players").doc(playerId).update({ disabled: true });
    const blockedPatch = await call(catchesRoute.PATCH, "PATCH", {
      body: { entryId, type: "stunning", count: 1 },
    });
    assert.equal(blockedPatch.status, 400);

    // Delete reverses totals; repeated delete returns 404 without double subtraction
    const del1 = await call(catchesRoute.DELETE, "DELETE", { query: `?entryId=${entryId}` });
    assert.equal(del1.status, 200);
    const playerFinal = (await db.collection("players").doc(playerId).get()).data();
    assert.equal(playerFinal.stunningCatches, 0);
    assert.equal(playerFinal.droppedCatches, 0);

    const del2 = await call(catchesRoute.DELETE, "DELETE", { query: `?entryId=${entryId}` });
    assert.equal(del2.status, 404);
  });

  it("KAvach Stats: concurrent creates produce one deterministic doc; multiple legacy duplicates return 409", async () => {
    const playerId = uid("player");
    await db.collection("players").doc(playerId).set({ name: "Batter" });

    // Concurrent creates for (playerId, 2026)
    const [s1, s2] = await Promise.all([
      call(statsRoute.POST, "POST", { body: { playerId, year: 2026, runs: 250, wickets: 4 } }),
      call(statsRoute.POST, "POST", { body: { playerId, year: 2026, runs: 300, wickets: 5 } }),
    ]);
    assert.equal(s1.status, 200);
    assert.equal(s2.status, 200);

    const snap = await db
      .collection("playerStats")
      .where("playerId", "==", playerId)
      .where("year", "==", 2026)
      .get();
    assert.equal(snap.size, 1);
    assert.equal(snap.docs[0].id, `${playerId}_2026`);

    // Multiple legacy duplicates for a new year -> 409 Conflict instead of silent overwrite
    const legacy1 = uid("legacy");
    const legacy2 = uid("legacy");
    await Promise.all([
      db.collection("playerStats").doc(legacy1).set({ playerId, year: 2025, runs: 100, wickets: 1 }),
      db.collection("playerStats").doc(legacy2).set({ playerId, year: 2025, runs: 120, wickets: 2 }),
    ]);

    const conflict = await call(statsRoute.POST, "POST", {
      body: { playerId, year: 2025, runs: 220, wickets: 3 },
    });
    assert.equal(conflict.status, 409);
    assert.match(conflict.json.error, /Multiple duplicate/);
  });

  it("POTW lifecycle: recipient change reassigns notification, retract preserves unrelated docs, concurrent edit/retract safe", async () => {
    const p1 = uid("player");
    const p2 = uid("player");
    const u1 = uid("user");
    const u2 = uid("user");
    const unrelatedPost = uid("post");
    const unrelatedBadge = uid("badge");

    await Promise.all([
      db.collection("players").doc(p1).set({ name: "Player One", photoURL: "https://example.com/1.png" }),
      db.collection("players").doc(p2).set({ name: "Player Two", photoURL: "https://example.com/2.png" }),
      db.collection("appUsers").doc(u1).set({ playerId: p1, email: "1@test.com", role: "player" }),
      db.collection("appUsers").doc(u2).set({ playerId: p2, email: "2@test.com", role: "player" }),
      db.collection("posts").doc(unrelatedPost).set({ title: "Club Notice", text: "Keep me" }),
      db.collection("badges").doc(unrelatedBadge).set({ playerId: p1, badgeType: "mvp" }),
    ]);

    const weekendId = "2026-11-21";
    const createRes = await call(potwRoute.POST, "POST", {
      now: MON_0900,
      body: { weekendId, playerId: p1, message: "Great knock!" },
    });
    assert.equal(createRes.status, 200);

    // Edit recipient p1 -> p2
    const editRes = await call(potwRoute.PATCH, "PATCH", {
      now: MON_0900,
      body: { weekendId, playerId: p2, message: "5 wickets!" },
    });
    assert.equal(editRes.status, 200);

    const notifSnap = await db.collection("notifications").doc(`potw_${weekendId}`).get();
    assert.equal(notifSnap.exists, true);
    assert.equal(notifSnap.data().userId, u2);

    const postSnap = await db.collection("posts").doc(`potw_${weekendId}`).get();
    assert.equal(postSnap.data().potw.playerId, p2);
    assert.equal(postSnap.data().potw.message, "5 wickets!");

    // Concurrent edit + retract
    const [concEdit, concDel] = await Promise.all([
      call(potwRoute.PATCH, "PATCH", {
        now: MON_0900,
        body: { weekendId, playerId: p1, message: "Race edit" },
      }),
      call(potwRoute.DELETE, "DELETE", {
        now: MON_0900,
        query: `?weekendId=${weekendId}`,
      }),
    ]);
    assert.ok([200, 404].includes(concEdit.status));
    assert.equal(concDel.status, 200);

    // Ensure retracted + repeated delete is idempotent
    const repeatDel = await call(potwRoute.DELETE, "DELETE", {
      now: MON_0900,
      query: `?weekendId=${weekendId}`,
    });
    assert.equal(repeatDel.status, 200);
    assert.equal(repeatDel.json.alreadyRetracted, true);

    assert.equal((await db.collection("badges").doc(`potw_${weekendId}`).get()).exists, false);
    assert.equal((await db.collection("posts").doc(`potw_${weekendId}`).get()).exists, false);
    assert.equal((await db.collection("notifications").doc(`potw_${weekendId}`).get()).exists, false);

    // Unrelated docs untouched
    assert.equal((await db.collection("posts").doc(unrelatedPost).get()).exists, true);
    assert.equal((await db.collection("badges").doc(unrelatedBadge).get()).exists, true);
  });

  it("POTW historical award: edit updates badge without creating a banner post, retract removes badge", async () => {
    const p1 = uid("player");
    const p2 = uid("player");
    const histWeekend = "2026-11-07";

    await Promise.all([
      db.collection("players").doc(p1).set({ name: "Hist One" }),
      db.collection("players").doc(p2).set({ name: "Hist Two" }),
      db.collection("matches").doc(uid("match")).set({ date: histWeekend, result: "KAvach Won" }),
    ]);

    const createHist = await call(potwRoute.POST, "POST", {
      now: MON_0900,
      body: { weekendId: histWeekend, playerId: p1, message: "Historical", source: "history" },
    });
    assert.equal(createHist.status, 200);
    assert.equal((await db.collection("posts").doc(`potw_${histWeekend}`).get()).exists, false);

    const editHist = await call(potwRoute.PATCH, "PATCH", {
      now: MON_0900,
      body: { weekendId: histWeekend, playerId: p2, message: "Updated historical" },
    });
    assert.equal(editHist.status, 200);
    assert.equal((await db.collection("posts").doc(`potw_${histWeekend}`).get()).exists, false);
    assert.equal((await db.collection("badges").doc(`potw_${histWeekend}`).get()).data().playerId, p2);

    const delHist = await call(potwRoute.DELETE, "DELETE", {
      now: MON_0900,
      query: `?weekendId=${histWeekend}`,
    });
    assert.equal(delHist.status, 200);
    assert.equal((await db.collection("badges").doc(`potw_${histWeekend}`).get()).exists, false);
  });

  it("POTW recipient change to unlinked player removes old notification without creating a new one", async () => {
    const pLinked = uid("player");
    const pUnlinked = uid("player");
    const uLinked = uid("user");
    const weekendId = "2026-11-14";

    await Promise.all([
      db.collection("players").doc(pLinked).set({ name: "Linked Player" }),
      db.collection("players").doc(pUnlinked).set({ name: "Unlinked Player" }),
      db.collection("appUsers").doc(uLinked).set({ playerId: pLinked, email: "linked@test.com", role: "player" }),
      db.collection("matches").doc(uid("match")).set({ date: weekendId, result: "KAvach Won" }),
    ]);

    // Award to linked player (creates badge, post, notification)
    await db.collection("badges").doc(`potw_${weekendId}`).set({
      badgeType: "player_of_the_weekend",
      playerId: pLinked,
      playerName: "Linked Player",
      weekendId,
    });
    await db.collection("posts").doc(`potw_${weekendId}`).set({
      kind: "potw",
      isAnnouncement: true,
      potw: { playerId: pLinked, playerName: "Linked Player", weekendId },
      text: "Linked Player — Great",
    });
    await db.collection("notifications").doc(`potw_${weekendId}`).set({
      userId: uLinked,
      title: "POTW",
      metadata: { kind: "potw", weekendId },
    });

    // Change recipient to unlinked player
    const editRes = await call(potwRoute.PATCH, "PATCH", {
      now: MON_0900,
      body: { weekendId, playerId: pUnlinked, message: "Unlinked star" },
    });
    assert.equal(editRes.status, 200);

    const badgeSnap = await db.collection("badges").doc(`potw_${weekendId}`).get();
    assert.equal(badgeSnap.data().playerId, pUnlinked);
    const postSnap = await db.collection("posts").doc(`potw_${weekendId}`).get();
    assert.equal(postSnap.data().potw.playerId, pUnlinked);
    assert.equal((await db.collection("notifications").doc(`potw_${weekendId}`).get()).exists, false);

    // Retract cleans up badge & post and writes audit entry
    const delRes = await call(potwRoute.DELETE, "DELETE", {
      now: MON_0900,
      query: `?weekendId=${weekendId}`,
    });
    assert.equal(delRes.status, 200);
    assert.equal((await db.collection("badges").doc(`potw_${weekendId}`).get()).exists, false);
    assert.equal((await db.collection("posts").doc(`potw_${weekendId}`).get()).exists, false);
  });
});
