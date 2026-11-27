import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { POST as initPaymentsPOST } from "../app/api/admin/matches/initialize-payments/route.ts";
import { getServerFirestore } from "../lib/server-db.ts";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skipReason = !emulatorHost
  ? "FIRESTORE_EMULATOR_HOST not set (run via emulator)"
  : false;

function reqWithUser(body, uid, roles) {
  const headers = { "content-type": "application/json" };
  if (uid) headers["x-test-uid"] = uid;
  if (roles) headers["x-test-roles"] = roles;
  return new Request("http://localhost/api/admin/matches/initialize-payments", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/matches/initialize-payments (Emulator)", { skip: skipReason }, () => {
  let db;

  before(async () => {
    if (!emulatorHost) return;
    process.env.NODE_ENV = "test";
    process.env.KAVACH_TEST_AUTH_BYPASS = "true";
    process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412";
    db = getServerFirestore();

    await db.doc("appUsers/u_club_admin").set({ uid: "u_club_admin", isClubAdmin: true, accountStatus: "active" });
    await db.doc("appUsers/u_player").set({ uid: "u_player", role: "player", accountStatus: "active" });
    await db.doc("appUsers/u_retired_ma").set({ uid: "u_retired_ma", isMatchAdmin: true, accountStatus: "active" });

    await db.doc("players/pl_1").set({ id: "pl_1", name: "Active One", inviteStatus: "Verified" });
    await db.doc("players/pl_2").set({ id: "pl_2", name: "Active Two", inviteStatus: "Verified" });
    await db.doc("players/pl_disabled").set({ id: "pl_disabled", name: "Disabled", disabled: true, inviteStatus: "Verified" });
    await db.doc("players/pl_pending").set({ id: "pl_pending", name: "Pending", inviteStatus: "Pending" });
  });

  it("allows Club Admin (200) and rejects Player / retired Match Admin (403) and unauthenticated (401)", async () => {
    const matchId = `m_auth_${Date.now()}`;
    await db.doc(`matches/${matchId}`).set({ id: matchId, opponent: "Auth XI", date: "2026-12-01", fee: 8000 });

    const r401 = await initPaymentsPOST(reqWithUser({ matchId }, null));
    assert.equal(r401.status, 401);

    const rPlayer = await initPaymentsPOST(reqWithUser({ matchId }, "u_player", "player"));
    assert.equal(rPlayer.status, 403);

    const rRetired = await initPaymentsPOST(reqWithUser({ matchId }, "u_retired_ma", "matchAdmin"));
    assert.equal(rRetired.status, 403);

    const rClub = await initPaymentsPOST(reqWithUser({ matchId }, "u_club_admin", "clubAdmin"));
    assert.equal(rClub.status, 200);
    const body = await rClub.json();
    assert.equal(body.ok, true);
    assert.ok(body.createdCount >= 2);
  });

  it("idempotently recovers partial match creation without overwriting existing payments or duplicating rows", async () => {
    const matchId = `m_recover_${Date.now()}`;
    await db.doc(`matches/${matchId}`).set({ id: matchId, opponent: "Recover XI", date: "2026-12-02", fee: 8000 });

    // Pre-existing Paid payment for pl_1 must NOT be overwritten
    await db.doc(`matches/${matchId}/payments/pay_existing_1`).set({
      id: "pay_existing_1",
      matchId,
      playerId: "pl_1",
      status: "Paid",
      availability: "Yes",
      feeCollectedAmount: 8000,
    });

    const r1 = await initPaymentsPOST(reqWithUser({ matchId }, "u_club_admin", "clubAdmin"));
    assert.equal(r1.status, 200);
    const d1 = await r1.json();
    assert.equal(d1.alreadyInitializedCount, 1);
    assert.ok(d1.createdCount >= 1);

    // Existing Paid doc is intact
    const existingDoc = await db.doc(`matches/${matchId}/payments/pay_existing_1`).get();
    assert.equal(existingDoc.data()?.status, "Paid");
    assert.equal(existingDoc.data()?.feeCollectedAmount, 8000);

    // Retry is idempotent (0 new rows created)
    const r2 = await initPaymentsPOST(reqWithUser({ matchId }, "u_club_admin", "clubAdmin"));
    assert.equal(r2.status, 200);
    const d2 = await r2.json();
    assert.equal(d2.createdCount, 0);
  });

  it("handles concurrent Promise.all requests safely without duplicate rows and preserves Paid/Waived/overridden records", async () => {
    const matchId = `m_conc_${Date.now()}`;
    await db.doc(`matches/${matchId}`).set({ id: matchId, opponent: "Concurrent XI", date: "2026-12-03", fee: 8000 });
    await db.doc("players/pl_3").set({ id: "pl_3", name: "Active Three", inviteStatus: "Verified" });
    await db.doc("players/pl_4").set({ id: "pl_4", name: "Active Four", inviteStatus: "Verified" });

    // Pre-existing Paid, Waived, and manually overridden rows with legacy random IDs
    await db.doc(`matches/${matchId}/payments/legacy_paid_1`).set({
      id: "legacy_paid_1",
      matchId,
      playerId: "pl_1",
      status: "Paid",
      availability: "Yes",
      feeCollectedAmount: 8000,
    });
    await db.doc(`matches/${matchId}/payments/legacy_waived_2`).set({
      id: "legacy_waived_2",
      matchId,
      playerId: "pl_2",
      status: "Waived",
      availability: "No",
      feeOverride: 300,
    });

    const playersSnap = await db.collection("players").get();
    const eligiblePlayers = playersSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => !p.disabled && !p.mergedInto && p.mergeStatus !== "in_progress" && p.inviteStatus !== "Rejected" && p.inviteStatus !== "Pending");
    const expectedMissing = eligiblePlayers.filter((p) => p.id !== "pl_1" && p.id !== "pl_2").length;

    // Fire 5 simultaneous initialization requests
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => initPaymentsPOST(reqWithUser({ matchId }, "u_club_admin", "clubAdmin"))),
    );
    const payloads = await Promise.all(responses.map((r) => {
      assert.equal(r.status, 200);
      return r.json();
    }));

    const totalCreatedWave1 = payloads.reduce((sum, p) => sum + p.createdCount, 0);
    assert.equal(totalCreatedWave1, expectedMissing, "Combined createdCount across concurrent calls must equal actual new rows");

    const paymentsAfterWave1 = await db.collection(`matches/${matchId}/payments`).get();
    assert.equal(paymentsAfterWave1.size, eligiblePlayers.length, "Exactly one payment doc per eligible player");

    // Verify each eligible player appears exactly once
    const seenPlayers = new Set();
    for (const doc of paymentsAfterWave1.docs) {
      const pid = doc.data()?.playerId;
      assert.ok(!seenPlayers.has(pid), `Duplicate payment row found for player ${pid}`);
      seenPlayers.add(pid);
    }

    // Verify existing Paid and Waived/overridden records & IDs are untouched
    const paidDoc = await db.doc(`matches/${matchId}/payments/legacy_paid_1`).get();
    assert.equal(paidDoc.exists, true);
    assert.equal(paidDoc.data()?.status, "Paid");
    assert.equal(paidDoc.data()?.feeCollectedAmount, 8000);

    const waivedDoc = await db.doc(`matches/${matchId}/payments/legacy_waived_2`).get();
    assert.equal(waivedDoc.exists, true);
    assert.equal(waivedDoc.data()?.status, "Waived");
    assert.equal(waivedDoc.data()?.feeOverride, 300);

    // Second concurrent wave must create 0 new docs
    const wave2 = await Promise.all(
      Array.from({ length: 3 }, () => initPaymentsPOST(reqWithUser({ matchId }, "u_club_admin", "clubAdmin"))),
    );
    const wave2Bodies = await Promise.all(wave2.map((r) => r.json()));
    assert.equal(wave2Bodies.reduce((s, p) => s + p.createdCount, 0), 0);
    const paymentsAfterWave2 = await db.collection(`matches/${matchId}/payments`).get();
    assert.equal(paymentsAfterWave2.size, eligiblePlayers.length);
  });

  it("rejects closed, archived, and Abandoned matches with 409", async () => {
    const mClosed = `m_closed_${Date.now()}`;
    const mArchived = `m_arch_${Date.now()}`;
    const mAbandoned = `m_aband_${Date.now()}`;

    await db.doc(`matches/${mClosed}`).set({ id: mClosed, opponent: "Closed XI", date: "2026-12-04", financeStatus: "closed" });
    await db.doc(`matches/${mArchived}`).set({ id: mArchived, opponent: "Archived XI", date: "2026-12-04", isArchived: true });
    await db.doc(`matches/${mAbandoned}`).set({ id: mAbandoned, opponent: "Abandoned XI", date: "2026-12-04", result: "Abandoned" });

    const rClosed = await initPaymentsPOST(reqWithUser({ matchId: mClosed }, "u_club_admin", "clubAdmin"));
    assert.equal(rClosed.status, 409);

    const rArchived = await initPaymentsPOST(reqWithUser({ matchId: mArchived }, "u_club_admin", "clubAdmin"));
    assert.equal(rArchived.status, 409);

    const rAbandoned = await initPaymentsPOST(reqWithUser({ matchId: mAbandoned }, "u_club_admin", "clubAdmin"));
    assert.equal(rAbandoned.status, 409);
  });
});
