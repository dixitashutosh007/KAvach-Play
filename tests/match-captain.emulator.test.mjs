/**
 * Match Captain Management (`tests/match-captain.emulator.test.mjs`).
 *
 * Production code exercised against the Firestore emulator:
 *   - app/api/admin/match-captain/route.ts
 *   - lib/match-captain-server.ts
 *   - firestore.rules matches/{matchId}
 *
 * Run: node scripts/run-emulator-tests.mjs tests/match-captain.emulator.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip =
  (!emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via scripts/run-emulator-tests.mjs)") ||
  (process.env.KAVACH_TEST_AUTH_BYPASS !== "true" && "KAVACH_TEST_AUTH_BYPASS not set");

const CLUB = { uid: "u_club", roles: "clubAdmin" };
const SUPER = { uid: "u_super", roles: "superAdmin" };
const FIN = { uid: "u_fin", roles: "financeAdmin" };
const PLAYER = { uid: "u_player" };
const LEGACY = { uid: "u_legacy", roles: "matchAdmin" };

describe("Match Captain Management — server API & Firestore rules", { skip }, () => {
  let db;
  let route;
  const saved = {};

  before(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      AWS_BRANCH: "main",
      NEXT_PUBLIC_FIRESTORE_DATABASE_ID: "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412",
    });
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = getApps().length
      ? getApps()[0]
      : initializeApp({ projectId: "kavach-match-captain-test" });
    db = getFirestore(app);
    (await import("../lib/server-db.ts")).setServerDbForTesting(db);
    route = await import("../app/api/admin/match-captain/route.ts");
    for (const l of ["log", "info", "warn", "error"]) {
      saved[l] = console[l];
      console[l] = () => {};
    }
  });

  after(() => {
    for (const [l, fn] of Object.entries(saved)) console[l] = fn;
  });

  function postCaptain(body, caller) {
    const headers = { "content-type": "application/json" };
    if (caller?.uid) headers["x-test-uid"] = caller.uid;
    if (caller?.roles) headers["x-test-roles"] = caller.roles;
    return route.POST(
      new Request("http://localhost/api/admin/match-captain", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
  }

  it("rejects unauthorized roles (Finance Admin, Player, retired matchAdmin) with 403", async () => {
    for (const caller of [FIN, PLAYER, LEGACY]) {
      const res = await postCaptain({ matchId: "m1", captainId: "p1" }, caller);
      assert.equal(res.status, 403, `Expected 403 for ${caller.uid}`);
    }
  });

  it("atomically adds captain to squad, preserves existing squad/financials on change/clear, rejects unavailable/inactive, and handles concurrency", async () => {
    await db.collection("matches").doc("m_cap_1").set({
      id: "m_cap_1",
      groundId: "g1",
      format: "T20",
      jerseyColor: "Scarlet Red",
      opponent: "Falcons",
      matchType: "Practice",
      fee: 500,
      date: "2026-11-28",
      time: "09:00",
      maxSquadSize: 12,
    });
    await db.collection("players").doc("p_non_squad").set({
      id: "p_non_squad",
      name: "Non Squad Captain",
      mobile: "9876543210",
      inviteStatus: "Verified",
    });
    await db.collection("players").doc("p_squad").set({
      id: "p_squad",
      name: "Squad Captain",
      mobile: "9876543211",
      inviteStatus: "Verified",
    });
    await db.collection("players").doc("p_unavail").set({
      id: "p_unavail",
      name: "Unavailable Player",
      mobile: "9876543219",
      inviteStatus: "Verified",
    });
    await db.collection("players").doc("p_disabled").set({
      id: "p_disabled",
      name: "Disabled Player",
      mobile: "9876543212",
      disabled: true,
      inviteStatus: "Verified",
    });
    await db.collection("players").doc("p_pending").set({
      id: "p_pending",
      name: "Pending Signup",
      mobile: "9876543213",
      inviteStatus: "Pending",
    });
    await db.collection("players").doc("p_merge_done").set({
      id: "p_merge_done",
      name: "Completed Merge",
      mobile: "9876543214",
      inviteStatus: "Verified",
      mergeStatus: "completed",
    });

    // Existing Paid squad record for p_squad (financials must remain untouched)
    await db.collection("matches").doc("m_cap_1").collection("payments").doc("pay_squad_1").set({
      id: "pay_squad_1",
      matchId: "m_cap_1",
      playerId: "p_squad",
      status: "Paid",
      availability: "Confirmed",
      feeOverride: 250,
    });

    // Explicit unavailable ("No") record for p_unavail
    await db.collection("matches").doc("m_cap_1").collection("payments").doc("pay_unavail_1").set({
      id: "pay_unavail_1",
      matchId: "m_cap_1",
      playerId: "p_unavail",
      status: "Not Playing",
      availability: "No",
    });

    // 1. Assign non-squad player as captain -> automatically added to squad
    const res1 = await postCaptain({ matchId: "m_cap_1", captainId: "p_non_squad" }, CLUB);
    assert.equal(res1.status, 200);
    const j1 = await res1.json();
    assert.equal(j1.captainId, "p_non_squad");
    assert.equal(j1.squadAction, "added_to_squad");

    const mAfter1 = (await db.collection("matches").doc("m_cap_1").get()).data();
    assert.equal(mAfter1.captainId, "p_non_squad");

    const nonSquadPaySnap = await db
      .collection("matches")
      .doc("m_cap_1")
      .collection("payments")
      .where("playerId", "==", "p_non_squad")
      .get();
    assert.equal(nonSquadPaySnap.size, 1);
    assert.equal(nonSquadPaySnap.docs[0].data().status, "Unpaid");

    // 2. Reject unavailable ("No") player without overriding status
    const resUnavail = await postCaptain({ matchId: "m_cap_1", captainId: "p_unavail" }, CLUB);
    assert.equal(resUnavail.status, 400);
    const unavailPay = (
      await db.collection("matches").doc("m_cap_1").collection("payments").doc("pay_unavail_1").get()
    ).data();
    assert.equal(unavailPay.status, "Not Playing");
    assert.equal(unavailPay.availability, "No");

    // 3. Reject inactive/disabled, pending signup, and completed-merge players
    const resDisabled = await postCaptain({ matchId: "m_cap_1", captainId: "p_disabled" }, SUPER);
    assert.equal(resDisabled.status, 400);
    const resPending = await postCaptain({ matchId: "m_cap_1", captainId: "p_pending" }, SUPER);
    assert.equal(resPending.status, 400);
    const resMergeDone = await postCaptain({ matchId: "m_cap_1", captainId: "p_merge_done" }, SUPER);
    assert.equal(resMergeDone.status, 400);

    // 4. Change captain to p_squad (already in squad) -> no duplicate, financials preserved, previous captain stays in squad
    const res2 = await postCaptain({ matchId: "m_cap_1", captainId: "p_squad" }, SUPER);
    assert.equal(res2.status, 200);
    const j2 = await res2.json();
    assert.equal(j2.squadAction, "already_in_squad");
    const mAfter2 = (await db.collection("matches").doc("m_cap_1").get()).data();
    assert.equal(mAfter2.captainId, "p_squad");

    const squadPaySnap = await db
      .collection("matches")
      .doc("m_cap_1")
      .collection("payments")
      .where("playerId", "==", "p_squad")
      .get();
    assert.equal(squadPaySnap.size, 1);
    assert.equal(squadPaySnap.docs[0].data().status, "Paid");
    assert.equal(squadPaySnap.docs[0].data().feeOverride, 250);

    const prevCapPaySnap = await db
      .collection("matches")
      .doc("m_cap_1")
      .collection("payments")
      .where("playerId", "==", "p_non_squad")
      .get();
    assert.equal(prevCapPaySnap.size, 1);
    assert.equal(prevCapPaySnap.docs[0].data().status, "Unpaid");

    // 5. Concurrent captain assignments -> no duplicate squad rows
    const [conc1, conc2] = await Promise.all([
      postCaptain({ matchId: "m_cap_1", captainId: "p_non_squad" }, CLUB),
      postCaptain({ matchId: "m_cap_1", captainId: "p_non_squad" }, SUPER),
    ]);
    assert.equal(conc1.status, 200);
    assert.equal(conc2.status, 200);
    const afterConcPay = await db
      .collection("matches")
      .doc("m_cap_1")
      .collection("payments")
      .where("playerId", "==", "p_non_squad")
      .get();
    assert.equal(afterConcPay.size, 1);

    // 6. Clear captain -> captainId removed, player remains in squad
    const res3 = await postCaptain({ matchId: "m_cap_1", captainId: null }, CLUB);
    assert.equal(res3.status, 200);
    const mAfter3 = (await db.collection("matches").doc("m_cap_1").get()).data();
    assert.equal(mAfter3.captainId, undefined);
    const afterClearPay = await db
      .collection("matches")
      .doc("m_cap_1")
      .collection("payments")
      .where("playerId", "==", "p_non_squad")
      .get();
    assert.equal(afterClearPay.size, 1);

    // 7. Audit log distinguishes newly added vs already in squad
    const auditSnap = await db.collection("auditLogs").where("entityId", "==", "m_cap_1").get();
    const summaries = auditSnap.docs.map((d) => d.data().summary);
    assert.ok(summaries.some((s) => s.includes("(newly added to squad)")));
    assert.ok(summaries.some((s) => s.includes("(already in squad)")));
  });

  it("enforces Firestore rules for captainId on matches/{matchId}", async () => {
    const { initializeTestEnvironment, assertSucceeds, assertFails } = await import(
      "@firebase/rules-unit-testing"
    );
    const [host, port] = emulatorHost.split(":");
    const rules = fs.readFileSync("firestore.rules", "utf8");
    const env = await initializeTestEnvironment({
      projectId: "kavach-match-captain-rules",
      firestore: { host, port: Number(port), rules },
    });

    try {
      await env.withSecurityRulesDisabled(async (ctx) => {
        const adminDb = ctx.firestore();
        await adminDb.collection("appUsers").doc("u_club_admin").set({
          role: "player",
          isClubAdmin: true,
          status: "Active",
        });
        await adminDb.collection("appUsers").doc("u_regular").set({
          role: "player",
          status: "Active",
        });
        await adminDb.collection("grounds").doc("g1").set({
          name: "Main Ground",
          mapUrl: "https://maps.example",
          organiserName: "Org",
          gpayNumber: "9999999999",
        });
      });

      const { serverTimestamp } = await import("firebase/firestore");
      const clubCtx = env.authenticatedContext("u_club_admin", { email: "club@kavach.test" });
      await assertSucceeds(
        clubCtx.firestore().collection("matches").doc("m_rules_1").set({
          groundId: "g1",
          format: "T20",
          jerseyColor: "Scarlet Red",
          opponent: "Eagles",
          matchType: "Practice",
          fee: 500,
          date: "2026-11-28",
          time: "09:00",
          maxSquadSize: 12,
          captainId: "p1",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      );

      // Regular player cannot update captainId
      const playerCtx = env.authenticatedContext("u_regular", { email: "p@kavach.test" });
      await assertFails(
        playerCtx.firestore().collection("matches").doc("m_rules_1").update({
          captainId: "u_regular",
          updatedAt: serverTimestamp(),
        }),
      );
    } finally {
      await env.cleanup();
    }
  });
});
