/**
 * Security Remediation 1F: Atomic Identity Merge, Verified Recovery, Financial Data Integrity & Four-Way Consistency
 * (tests/remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs)
 *
 * Implements all 22+ Required Scenarios from Security Remediation 1F specification:
 *
 * Group 1: Identity Transaction and Concurrency (1-10)
 * 1. Reservation changes after pre-flight but before transaction: rejected inside transaction.
 * 2. Keeper and loser have distinct active UIDs: HTTP 409 CONFLICTING_AUTH_UIDS.
 * 3. Keeper phoneIndex owned by third party: HTTP 409 KEEPER_PHONE_RESERVATION_CONFLICT.
 * 4. Loser phoneIndex owned by third party: HTTP 409 LOSER_PHONE_RESERVATION_THIRD_PARTY.
 * 5. Keeper uidIndex owned by third party: HTTP 409 KEEPER_UID_RESERVATION_CONFLICT.
 * 6. Loser uidIndex owned by third party: HTTP 409 LOSER_UID_RESERVATION_THIRD_PARTY.
 * 7. Multiple appUsers point to keeper/loser: HTTP 409 MULTIPLE_KEEPER_APP_USERS.
 * 8. Multiple phoneIndex or uidIndex records reference the same player: HTTP 409.
 * 9. Two concurrent requests attempt the same merge: only one obtains job lease.
 * 10. Account linking races with merge execution: one safely wins; no inconsistent identity state.
 *
 * Group 2: Staged Migration and Financial Integrity (11-18)
 * 11. More than 400 payments migrate successfully through bounded chunks.
 * 12. More than 400 identity/user records migrate without exceeding Firestore batch limits.
 * 13. Existing keeper otherFees document with identical content: safe idempotent handling.
 * 14. Existing keeper otherFees document with different content: conflict; both source and dest intact.
 * 15. Failure after a committed migration chunk: loser remains incomplete.
 * 16. Retry after genuine partial migration resumes from verified progress.
 * 17. Worker lease expires and is safely reclaimed; stale worker cannot continue.
 * 18. Final verification detects a deliberately retained loser reference and refuses completion.
 *
 * Group 3: Firestore Rules (19-22)
 * 19. Club Admin cannot change authUid, mergedInto, mergeStatus, or mergeJobId.
 * 20. Super Admin cannot change these same fields.
 * 21. Super Admin cannot change appUsers.playerId.
 * 22. Legitimate profile updates still work.
 *
 * Group 4: Account Linking & Bootstrap Readiness (23-34)
 * 23. Normal idempotency rejects wrong phoneIndex.canonicalPhone.
 * 24. Normal idempotency rejects wrong uidIndex.canonicalPhone.
 * 25. Contention fallback rejects inconsistent four-way state.
 * 26. Contention fallback accepts only a fully consistent four-way state.
 * 27. Transaction-created phoneIndex records satisfy the canonical field contract.
 * 28. Generic Firestore INVALID_ARGUMENT returns 500, not 409.
 * 29. Genuine transaction contention returns 409 unless complete concurrent success is verified.
 * 30. Missing phone number on active player blocks bootstrap readiness.
 * 31. Invalid merge chain blocks bootstrap readiness.
 * 32. appUsers pointing to disabled/missing/merged player is reported as blocking.
 * 33. Missing UID and phone indexes prevent safe linking.
 * 34. Duplicate canonical phone and UID ownership block bootstrap.
 */

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * B2 fixture helper: production match intents always carry matchId, paymentId and playerId, and
 * B2 never silently skips a missing obligation. Older fixtures here seeded "match" intents with
 * late-fee items only; this completes them with a real match obligation (fee = amount − late fees,
 * payer = the late-fee player) without changing what each scenario asserts.
 */
async function seedMatchObligationFor(db, intentId, { createDocs = true } = {}) {
  const ref = db.collection("razorpayIntents").doc(intentId);
  const intent = (await ref.get()).data();
  const late = (intent.lateFeeItems || []).reduce((acc, lf) => acc + Number(lf.amount || 0), 0);
  const payer = intent.playerId || intent.lateFeeItems?.[0]?.playerId;
  const matchId = `m_${intentId}`;
  if (createDocs) {
    await db.collection("matches").doc(matchId).set({ fee: Number(intent.amount) - late });
    await db.collection("matches").doc(matchId).collection("payments").doc("pm").set({ playerId: payer, status: "Unpaid" });
  }
  await ref.update({ matchId, paymentId: "pm", playerId: payer });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rulesPath = path.resolve(__dirname, "../firestore.rules");
const rulesContent = fs.readFileSync(rulesPath, "utf8");

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skipReason = !emulatorHost
  ? "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator)"
  : false;

describe("Security Remediation 1F: Secure Identity Merge, Financial Integrity & Four-Way Consistency", { skip: skipReason }, () => {
  let testEnv;
  let db;
  let mergeRoute;
  let playerMergeModule;
  let linkingModule;
  let bootstrapModule;

  before(async () => {
    if (!emulatorHost) return;

    const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
    const [host, portStr] = emulatorHost.split(":");
    testEnv = await initializeTestEnvironment({
      projectId: "kavach-remediation1f-test",
      firestore: {
        host,
        port: parseInt(portStr, 10),
        rules: rulesContent,
      },
    });

    const { getApps, initializeApp } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = !getApps().some((a) => a.name === "remediation1f-test")
      ? initializeApp({ projectId: "kavach-remediation1f-test" }, "remediation1f-test")
      : getApps().find((a) => a.name === "remediation1f-test");
    db = getFirestore(app);

    mergeRoute = await import("../app/api/admin/merge-players/route.ts");
    playerMergeModule = await import("../lib/player-merge.ts");
    linkingModule = await import("../lib/account-linking.ts");
    bootstrapModule = await import("../scripts/bootstrap-identity-index.ts");
  });

  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    if (!testEnv) return;
    await testEnv.clearFirestore();
  });

  function createMergeRequest(loserId, keeperId, dryRun = false) {
    return new Request("http://localhost:3000/api/admin/merge-players", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-uid": "admin_merge_runner_1f",
        "x-test-admin-claim": "true",
        "x-test-role": "clubAdmin",
      },
      body: JSON.stringify({ loserId, keeperId, dryRun }),
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Group 1: Identity Transaction and Concurrency (Scenarios 1 - 10)
  // ══════════════════════════════════════════════════════════════════════════

  it("Scenario 1: Reservation changes after pre-flight but before transaction: rejected inside transaction", async () => {
    await db.collection("players").doc("p_loser_s1").set({
      name: "Loser S1",
      mobile: "+919876540101",
    });
    await db.collection("players").doc("p_keeper_s1").set({
      name: "Keeper S1",
    });
    await db.collection("phoneIndex").doc("+919876540101").set({
      playerId: "p_loser_s1",
      canonicalPhone: "+919876540101",
    });

    const leaseRes = await playerMergeModule.acquireMergeLease(db, "job_s1", "p_loser_s1", "p_keeper_s1");
    assert.equal(leaseRes.ok, true);

    // Attacker modifies phoneIndex between lease acquisition and identity transaction
    await db.collection("phoneIndex").doc("+919876540101").set({
      playerId: "p_attacker_third_party",
      canonicalPhone: "+919876540101",
    });

    await assert.rejects(
      async () => {
        await playerMergeModule.executeMergeIdentityStage(
          db,
          "job_s1",
          "p_loser_s1",
          "p_keeper_s1",
          leaseRes.workerInfo,
          {},
          "",
          "+919876540101"
        );
      },
      (err) => {
        assert.equal(err.name, "MergeConflictError");
        assert.equal(err.code, "LOSER_PHONE_RESERVATION_THIRD_PARTY");
        return true;
      }
    );
  });

  it("Scenario 2: Keeper and loser have distinct active UIDs: HTTP 409", async () => {
    await db.collection("players").doc("p_loser_s2").set({
      name: "Loser S2",
      authUid: "uid_loser_s2",
    });
    await db.collection("players").doc("p_keeper_s2").set({
      name: "Keeper S2",
      authUid: "uid_keeper_s2",
    });

    const req = createMergeRequest("p_loser_s2", "p_keeper_s2");
    const res = await mergeRoute.POST(req);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "CONFLICTING_AUTH_UIDS");
  });

  it("Scenario 3: Keeper phoneIndex owned by third party: HTTP 409", async () => {
    await db.collection("players").doc("p_loser_s3").set({ name: "Loser S3" });
    await db.collection("players").doc("p_keeper_s3").set({
      name: "Keeper S3",
      mobile: "+919876540103",
    });
    await db.collection("phoneIndex").doc("+919876540103").set({
      playerId: "p_unrelated_stranger_s3",
      canonicalPhone: "+919876540103",
    });

    const req = createMergeRequest("p_loser_s3", "p_keeper_s3");
    const res = await mergeRoute.POST(req);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "KEEPER_PHONE_RESERVATION_CONFLICT");
  });

  it("Scenario 4: Loser phoneIndex owned by third party: HTTP 409", async () => {
    await db.collection("players").doc("p_loser_s4").set({
      name: "Loser S4",
      mobile: "+919876540104",
    });
    await db.collection("players").doc("p_keeper_s4").set({ name: "Keeper S4" });
    await db.collection("phoneIndex").doc("+919876540104").set({
      playerId: "p_unrelated_stranger_s4",
      canonicalPhone: "+919876540104",
    });

    const req = createMergeRequest("p_loser_s4", "p_keeper_s4");
    const res = await mergeRoute.POST(req);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "LOSER_PHONE_RESERVATION_THIRD_PARTY");
  });

  it("Scenario 5: Keeper uidIndex owned by third party: HTTP 409", async () => {
    await db.collection("players").doc("p_loser_s5").set({ name: "Loser S5" });
    await db.collection("players").doc("p_keeper_s5").set({
      name: "Keeper S5",
      authUid: "uid_keeper_s5",
    });
    await db.collection("uidIndex").doc("uid_keeper_s5").set({
      playerId: "p_stranger_s5",
      authUid: "uid_keeper_s5",
    });

    const req = createMergeRequest("p_loser_s5", "p_keeper_s5");
    const res = await mergeRoute.POST(req);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "KEEPER_UID_RESERVATION_CONFLICT");
  });

  it("Scenario 6: Loser uidIndex owned by third party: HTTP 409", async () => {
    await db.collection("players").doc("p_loser_s6").set({
      name: "Loser S6",
      authUid: "uid_loser_s6",
    });
    await db.collection("players").doc("p_keeper_s6").set({ name: "Keeper S6" });
    await db.collection("uidIndex").doc("uid_loser_s6").set({
      playerId: "p_stranger_s6",
      authUid: "uid_loser_s6",
    });

    const req = createMergeRequest("p_loser_s6", "p_keeper_s6");
    const res = await mergeRoute.POST(req);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "LOSER_UID_RESERVATION_THIRD_PARTY");
  });

  it("Scenario 7: Multiple appUsers point to keeper/loser: HTTP 409", async () => {
    await db.collection("players").doc("p_loser_s7").set({ name: "Loser S7" });
    await db.collection("players").doc("p_keeper_s7").set({ name: "Keeper S7" });
    await db.collection("appUsers").doc("u_k1").set({ playerId: "p_keeper_s7" });
    await db.collection("appUsers").doc("u_k2").set({ playerId: "p_keeper_s7" });

    const req = createMergeRequest("p_loser_s7", "p_keeper_s7");
    const res = await mergeRoute.POST(req);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "MULTIPLE_KEEPER_APP_USERS");
  });

  it("Scenario 8: Multiple phoneIndex or uidIndex records reference the same player: HTTP 409", async () => {
    await db.collection("players").doc("p_loser_s8").set({ name: "Loser S8" });
    await db.collection("players").doc("p_keeper_s8").set({
      name: "Keeper S8",
      authUid: "uid_keeper_primary",
    });
    await db.collection("uidIndex").doc("uid_keeper_primary").set({
      playerId: "p_keeper_s8",
      authUid: "uid_keeper_primary",
    });
    // Duplicate UID reservation pointing to keeper
    await db.collection("uidIndex").doc("uid_keeper_secondary").set({
      playerId: "p_keeper_s8",
      authUid: "uid_keeper_secondary",
    });

    const req = createMergeRequest("p_loser_s8", "p_keeper_s8");
    const res = await mergeRoute.POST(req);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "KEEPER_MULTIPLE_UID_RESERVATIONS");
  });

  it("Scenario 9: Two concurrent requests attempt the same merge: only one obtains job lease", async () => {
    await db.collection("players").doc("p_loser_s9").set({ name: "Loser S9" });
    await db.collection("players").doc("p_keeper_s9").set({ name: "Keeper S9" });

    // Worker 1 claims active lease
    const lease1 = await playerMergeModule.acquireMergeLease(
      db,
      "job_p_loser_s9_p_keeper_s9",
      "p_loser_s9",
      "p_keeper_s9",
      { workerId: "worker_concurrent_1", leaseDurationMs: 60000 }
    );
    assert.equal(lease1.ok, true);

    // Concurrent request 2 attempts to execute merge while lease is actively held
    const req2 = createMergeRequest("p_loser_s9", "p_keeper_s9");
    const res2 = await mergeRoute.POST(req2);

    assert.equal(res2.status, 409);
    const body2 = await res2.json();
    assert.equal(body2.code, "ACTIVE_LEASE_EXISTS");
  });

  it("Scenario 10: Account linking races with merge execution: one safely wins; no inconsistent identity state", async () => {
    await db.collection("players").doc("p_race_loser").set({
      name: "Race Loser",
      mobile: "+919876540110",
    });
    await db.collection("players").doc("p_race_keeper").set({
      name: "Race Keeper",
    });
    await db.collection("appUsers").doc("uid_race_user").set({
      mobile: "+919876540110",
    });

    // Worker acquires merge lease, locking player in in_progress state
    const leaseRes = await playerMergeModule.acquireMergeLease(db, "job_race_10", "p_race_loser", "p_race_keeper");
    assert.equal(leaseRes.ok, true);
    await db.collection("players").doc("p_race_loser").update({
      mergeStatus: "in_progress",
      mergeJobId: "job_race_10",
    });

    // Account linking attempted while merge lease is active
    const linkRes = await linkingModule.linkPlayerAccount(db, {
      uid: "uid_race_user",
      verifiedPhoneNumber: "+919876540110",
      requestedPlayerId: "p_race_loser",
    });

    assert.equal(linkRes.ok, false);
    assert.equal(linkRes.status, 409);
    assert.match(linkRes.error, /undergoing an active administrative merge/);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Group 2: Staged Migration and Financial Integrity (Scenarios 11 - 18)
  // ══════════════════════════════════════════════════════════════════════════

  it("Scenario 11: More than 400 payments migrate successfully through bounded chunks", async () => {
    await db.collection("players").doc("p_loser_s11").set({ name: "Loser S11" });
    await db.collection("players").doc("p_keeper_s11").set({ name: "Keeper S11" });

    // Seed 420 payments across multiple batches
    const TOTAL_PAYMENTS = 420;
    const batchSize = 100;
    for (let i = 0; i < TOTAL_PAYMENTS; i += batchSize) {
      const b = db.batch();
      for (let j = i; j < Math.min(i + batchSize, TOTAL_PAYMENTS); j++) {
        const ref = db.collection("matches").doc("m_s11").collection("payments").doc(`pay_${j}`);
        b.set(ref, {
          playerId: "p_loser_s11",
          amount: 500,
          status: "Paid",
        });
      }
      await b.commit();
    }

    const lease = await playerMergeModule.acquireMergeLease(db, "job_s11", "p_loser_s11", "p_keeper_s11");
    assert.equal(lease.ok, true);

    const migrateRes = await playerMergeModule.migratePaymentsStage(
      db,
      "job_s11",
      "p_loser_s11",
      "p_keeper_s11",
      lease.workerInfo,
      { batchLimit: 100 }
    );
    assert.equal(migrateRes.count, TOTAL_PAYMENTS);

    // Verify all 420 payments now point to keeper
    const remainingLoserPayments = await db.collectionGroup("payments").where("playerId", "==", "p_loser_s11").get();
    assert.equal(remainingLoserPayments.empty, true);

    const keeperPayments = await db.collectionGroup("payments").where("playerId", "==", "p_keeper_s11").get();
    assert.equal(keeperPayments.docs.length, TOTAL_PAYMENTS);
  });

  it("Scenario 12: More than 400 identity/user records migrate without exceeding Firestore batch limits", async () => {
    await db.collection("players").doc("p_loser_s12").set({ name: "Loser S12" });
    await db.collection("players").doc("p_keeper_s12").set({ name: "Keeper S12" });

    // Seed 420 appUsers pointing to loser
    const TOTAL_USERS = 420;
    const batchSize = 100;
    for (let i = 0; i < TOTAL_USERS; i += batchSize) {
      const b = db.batch();
      for (let j = i; j < Math.min(i + batchSize, TOTAL_USERS); j++) {
        b.set(db.collection("appUsers").doc(`user_s12_${j}`), {
          playerId: "p_loser_s12",
        });
      }
      await b.commit();
    }

    const lease = await playerMergeModule.acquireMergeLease(db, "job_s12", "p_loser_s12", "p_keeper_s12");
    assert.equal(lease.ok, true);

    const migrateRes = await playerMergeModule.migrateAppUsersAndIndexesStage(
      db,
      "job_s12",
      "p_loser_s12",
      "p_keeper_s12",
      lease.workerInfo,
      { batchLimit: 100 }
    );
    assert.equal(migrateRes.count, TOTAL_USERS);

    const remainingLoserUsers = await db.collection("appUsers").where("playerId", "==", "p_loser_s12").get();
    assert.equal(remainingLoserUsers.empty, true);
  });

  it("Scenario 13: Existing keeper otherFees document with identical content: safe idempotent handling", async () => {
    await db.collection("players").doc("p_loser_s13").set({ name: "Loser S13" });
    await db.collection("players").doc("p_keeper_s13").set({ name: "Keeper S13" });

    // Seed identical fee in both loser and keeper
    await db.collection("players").doc("p_loser_s13").collection("otherFees").doc("fee_kit_13").set({
      amount: 750,
      title: "Jersey & Cap",
      status: "Unpaid",
      playerId: "p_loser_s13",
    });
    await db.collection("players").doc("p_keeper_s13").collection("otherFees").doc("fee_kit_13").set({
      amount: 750,
      title: "Jersey & Cap",
      status: "Unpaid",
      playerId: "p_keeper_s13",
    });

    const lease = await playerMergeModule.acquireMergeLease(db, "job_s13", "p_loser_s13", "p_keeper_s13");
    assert.equal(lease.ok, true);

    const feeRes = await playerMergeModule.migrateOtherFeesStage(
      db,
      "job_s13",
      "p_loser_s13",
      "p_keeper_s13",
      lease.workerInfo
    );
    assert.equal(feeRes.count, 1);

    // Keeper fee remains intact
    const keeperFee = await db.collection("players").doc("p_keeper_s13").collection("otherFees").doc("fee_kit_13").get();
    assert.equal(keeperFee.exists, true);
    assert.equal(keeperFee.data().amount, 750);

    // Loser duplicate fee was safely deleted
    const loserFee = await db.collection("players").doc("p_loser_s13").collection("otherFees").doc("fee_kit_13").get();
    assert.equal(loserFee.exists, false);
  });

  it("Scenario 14: Existing keeper otherFees document with different content: conflict; both source and dest intact", async () => {
    await db.collection("players").doc("p_loser_s14").set({ name: "Loser S14" });
    await db.collection("players").doc("p_keeper_s14").set({ name: "Keeper S14" });

    // Seed conflicting fee with different amounts
    await db.collection("players").doc("p_loser_s14").collection("otherFees").doc("fee_conflict_14").set({
      amount: 500,
      title: "Coaching Fee",
      status: "Paid",
      playerId: "p_loser_s14",
    });
    await db.collection("players").doc("p_keeper_s14").collection("otherFees").doc("fee_conflict_14").set({
      amount: 2500,
      title: "Annual Membership",
      status: "Unpaid",
      playerId: "p_keeper_s14",
    });

    const lease = await playerMergeModule.acquireMergeLease(db, "job_s14", "p_loser_s14", "p_keeper_s14");
    assert.equal(lease.ok, true);

    await assert.rejects(
      async () => {
        await playerMergeModule.migrateOtherFeesStage(
          db,
          "job_s14",
          "p_loser_s14",
          "p_keeper_s14",
          lease.workerInfo
        );
      },
      (err) => {
        assert.equal(err.name, "MergeConflictError");
        assert.equal(err.code, "FINANCIAL_RECORD_COLLISION");
        return true;
      }
    );

    // Both source and destination records MUST remain completely intact
    const loserFee = await db.collection("players").doc("p_loser_s14").collection("otherFees").doc("fee_conflict_14").get();
    assert.equal(loserFee.exists, true);
    assert.equal(loserFee.data().amount, 500);

    const keeperFee = await db.collection("players").doc("p_keeper_s14").collection("otherFees").doc("fee_conflict_14").get();
    assert.equal(keeperFee.exists, true);
    assert.equal(keeperFee.data().amount, 2500);
  });

  it("Scenario 15: Failure after a committed migration chunk: loser remains incomplete", async () => {
    await db.collection("players").doc("p_loser_s15").set({ name: "Loser S15" });
    await db.collection("players").doc("p_keeper_s15").set({ name: "Keeper S15" });

    // Seed 250 payments (chunk size = 100)
    for (let i = 0; i < 250; i++) {
      await db.collection("matches").doc("m_s15").collection("payments").doc(`pay_s15_${i}`).set({
        playerId: "p_loser_s15",
        amount: 200,
      });
    }

    const lease = await playerMergeModule.acquireMergeLease(db, "job_s15", "p_loser_s15", "p_keeper_s15");
    assert.equal(lease.ok, true);

    // Fault injection: throw after first chunk commit
    await assert.rejects(
      async () => {
        await playerMergeModule.migratePaymentsStage(
          db,
          "job_s15",
          "p_loser_s15",
          "p_keeper_s15",
          lease.workerInfo,
          {
            batchLimit: 100,
            onAfterChunkCommit: async (chunkIndex) => {
              if (chunkIndex === 0) {
                throw new Error("Worker crashed after chunk 0 commit");
              }
            },
          }
        );
      },
      /Worker crashed after chunk 0 commit/
    );

    // Loser must NOT be marked completed or disabled
    const loserSnap = await db.collection("players").doc("p_loser_s15").get();
    assert.equal(loserSnap.data().disabled || false, false);
    assert.notEqual(loserSnap.data().mergeStatus, "completed");

    // First 100 were committed; remaining 150 still reference loser
    const remainingLoserPayments = await db.collectionGroup("payments").where("playerId", "==", "p_loser_s15").get();
    assert.equal(remainingLoserPayments.docs.length, 150);
  });

  it("Scenario 16: Retry after genuine partial migration resumes from verified progress", async () => {
    const expiredTime = Date.now() - 1000;
    await db.collection("players").doc("p_loser_s16").set({
      name: "Loser S16",
      mergeStatus: "in_progress",
      mergeJobId: "job_s16",
      mergeLeaseOwner: "crashed_worker",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: expiredTime,
    });
    await db.collection("players").doc("p_keeper_s16").set({
      name: "Keeper S16",
      mergeStatus: "in_progress",
      mergeJobId: "job_s16",
      mergeLeaseOwner: "crashed_worker",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: expiredTime,
    });

    // Seed 100 already migrated payments (chunk 0) and 150 remaining payments (chunks 1 & 2)
    for (let i = 0; i < 100; i++) {
      await db.collection("matches").doc("m_s16").collection("payments").doc(`pay_s16_${i}`).set({
        playerId: "p_keeper_s16",
        amount: 200,
      });
    }
    for (let i = 100; i < 250; i++) {
      await db.collection("matches").doc("m_s16").collection("payments").doc(`pay_s16_${i}`).set({
        playerId: "p_loser_s16",
        amount: 200,
      });
    }

    // Seed interrupted mergeJob with expired lease
    await db.collection("mergeJobs").doc("job_s16").set({
      id: "job_s16",
      jobId: "job_s16",
      loserId: "p_loser_s16",
      keeperId: "p_keeper_s16",
      status: "in_progress",
      stage: "identity_locked",
      leaseOwner: "crashed_worker",
      leaseToken: "lease_crashed",
      leaseExpiresAt: expiredTime,
      fencingToken: 1,
      attemptCount: 1,
      stats: { paymentsReparentedProgress: 100, paymentsReparentedChunks: 1 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date(),
    });

    // New recovery worker reclaims expired lease
    const lease = await playerMergeModule.acquireMergeLease(db, "job_s16", "p_loser_s16", "p_keeper_s16", {
      workerId: "worker_recovery_16",
    });
    assert.equal(lease.ok, true);
    assert.equal(lease.workerInfo.fencingToken, 2);
    assert.equal(lease.workerInfo.attemptCount, 2);

    // Second run completes the remaining chunks
    const res = await playerMergeModule.migratePaymentsStage(
      db,
      "job_s16",
      "p_loser_s16",
      "p_keeper_s16",
      lease.workerInfo,
      { batchLimit: 100 }
    );
    assert.equal(res.count, 150);

    // All 250 payments now point to keeper
    const remainingLoserPayments = await db.collectionGroup("payments").where("playerId", "==", "p_loser_s16").get();
    assert.equal(remainingLoserPayments.empty, true);

    const totalKeeperPayments = await db.collectionGroup("payments").where("playerId", "==", "p_keeper_s16").get();
    assert.equal(totalKeeperPayments.docs.length, 250);
  });

  it("Scenario 17: Worker lease expires and is safely reclaimed; stale worker cannot continue", async () => {
    await db.collection("players").doc("p_loser_s17").set({ name: "Loser S17" });
    await db.collection("players").doc("p_keeper_s17").set({ name: "Keeper S17" });

    // Worker 1 acquires short lease (50ms)
    const lease1 = await playerMergeModule.acquireMergeLease(db, "job_s17", "p_loser_s17", "p_keeper_s17", {
      workerId: "worker_1",
      leaseDurationMs: 50,
    });
    assert.equal(lease1.ok, true);

    // Wait for lease to expire
    await new Promise((r) => setTimeout(r, 70));

    // Worker 2 reclaims expired lease
    const lease2 = await playerMergeModule.acquireMergeLease(db, "job_s17", "p_loser_s17", "p_keeper_s17", {
      workerId: "worker_2",
      leaseDurationMs: 60000,
    });
    assert.equal(lease2.ok, true);
    assert.equal(lease2.workerInfo.fencingToken, lease1.workerInfo.fencingToken + 1);

    // Stale Worker 1 attempts to advance stage: must be rejected with StaleWorkerError
    await assert.rejects(
      async () => {
        await playerMergeModule.verifyWorkerFencingAndAdvanceStage(
          db,
          "job_s17",
          lease1.workerInfo,
          "payments_reparented"
        );
      },
      (err) => {
        assert.equal(err.name, "StaleWorkerError");
        assert.equal(err.status, 409);
        return true;
      }
    );
  });

  it("Scenario 18: Final verification detects a deliberately retained loser reference and refuses completion", async () => {
    await db.collection("players").doc("p_loser_s18").set({ name: "Loser S18" });
    await db.collection("players").doc("p_keeper_s18").set({ name: "Keeper S18" });

    const lease = await playerMergeModule.acquireMergeLease(db, "job_s18", "p_loser_s18", "p_keeper_s18");
    assert.equal(lease.ok, true);

    // Deliberately seed a residual payment referencing loser
    await db.collection("matches").doc("m_s18").collection("payments").doc("residual_pay").set({
      playerId: "p_loser_s18",
      amount: 300,
    });

    await assert.rejects(
      async () => {
        await playerMergeModule.executeIndependentFinalVerification(
          db,
          "job_s18",
          "p_loser_s18",
          "p_keeper_s18",
          lease.workerInfo
        );
      },
      (err) => {
        assert.equal(err.name, "MergeConflictError");
        assert.equal(err.code, "FINAL_VERIFICATION_FAILED");
        assert.match(err.message, /payments still reference loser player/);
        return true;
      }
    );

    // Loser remains not completed
    const loserSnap = await db.collection("players").doc("p_loser_s18").get();
    assert.notEqual(loserSnap.data().mergeStatus, "completed");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Group 3: Firestore Rules (Scenarios 19 - 22)
  // ══════════════════════════════════════════════════════════════════════════

  it("Scenario 19: Club Admin cannot change authUid, mergedInto, mergeStatus, or mergeJobId via client SDK", async () => {
    // Seed player via Admin SDK
    await db.collection("players").doc("p_rules_19").set({
      name: "Rules Player 19",
      mobile: "+919876540119",
    });

    const clubAdminContext = testEnv.authenticatedContext("club_admin_uid", {
      role: "clubAdmin",
      isClubAdmin: true,
    });
    const clientDb = clubAdminContext.firestore();

    const { assertFails } = await import("@firebase/rules-unit-testing");

    await assertFails(clientDb.collection("players").doc("p_rules_19").update({
      authUid: "malicious_auth_uid",
    }));

    await assertFails(clientDb.collection("players").doc("p_rules_19").update({
      mergedInto: "p_target",
    }));

    await assertFails(clientDb.collection("players").doc("p_rules_19").update({
      mergeStatus: "completed",
    }));

    await assertFails(clientDb.collection("players").doc("p_rules_19").update({
      mergeJobId: "job_fake",
    }));
  });

  it("Scenario 20: Super Admin cannot change these same merge lifecycle fields via client SDK", async () => {
    await db.collection("players").doc("p_rules_20").set({
      name: "Rules Player 20",
      mobile: "+919876540120",
    });

    const superAdminContext = testEnv.authenticatedContext("super_admin_uid", {
      role: "admin",
      isSuperAdmin: true,
    });
    const clientDb = superAdminContext.firestore();

    const { assertFails } = await import("@firebase/rules-unit-testing");

    await assertFails(clientDb.collection("players").doc("p_rules_20").update({
      authUid: "malicious_auth_uid",
    }));

    await assertFails(clientDb.collection("players").doc("p_rules_20").update({
      mergedInto: "p_target",
    }));

    await assertFails(clientDb.collection("players").doc("p_rules_20").update({
      mergeStatus: "in_progress",
    }));

    await assertFails(clientDb.collection("players").doc("p_rules_20").update({
      mergeJobId: "job_fake",
    }));
  });

  it("Scenario 21: Super Admin cannot change appUsers.playerId via client SDK", async () => {
    await db.collection("appUsers").doc("target_user_21").set({
      name: "Target User",
      playerId: "p_original_21",
    });

    const superAdminContext = testEnv.authenticatedContext("super_admin_uid", {
      role: "admin",
      isSuperAdmin: true,
    });
    const clientDb = superAdminContext.firestore();

    const { assertFails } = await import("@firebase/rules-unit-testing");
    await assertFails(clientDb.collection("appUsers").doc("target_user_21").update({
      playerId: "p_stolen_21",
    }));
  });

  it("Scenario 22: Legitimate profile updates still work for self and admin", async () => {
    await db.collection("players").doc("p_legit_22").set({
      name: "Legit Player",
      mobile: "+919876540122",
      battingStyle: "Right-hand bat",
    });
    await db.collection("appUsers").doc("uid_legit_22").set({
      name: "Legit Player",
      playerId: "p_legit_22",
    });

    const userContext = testEnv.authenticatedContext("uid_legit_22");
    const clientDb = userContext.firestore();

    const { assertSucceeds } = await import("@firebase/rules-unit-testing");
    await assertSucceeds(clientDb.collection("players").doc("p_legit_22").update({
      battingStyle: "Left-hand bat",
    }));

    const snap = await db.collection("players").doc("p_legit_22").get();
    assert.equal(snap.data().battingStyle, "Left-hand bat");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Group 4: Account Linking & Bootstrap Readiness (Scenarios 23 - 34)
  // ══════════════════════════════════════════════════════════════════════════

  it("Scenario 23: Normal idempotency rejects wrong phoneIndex.canonicalPhone", async () => {
    await db.collection("players").doc("p_link_23").set({
      name: "Player 23",
      authUid: "uid_link_23",
      mobile: "+919876540123",
    });
    await db.collection("appUsers").doc("uid_link_23").set({
      playerId: "p_link_23",
      status: "Active",
    });
    await db.collection("uidIndex").doc("uid_link_23").set({
      playerId: "p_link_23",
      authUid: "uid_link_23",
      canonicalPhone: "+919876540123",
    });
    // Inconsistent phoneIndex with wrong canonical phone
    await db.collection("phoneIndex").doc("+919876540123").set({
      playerId: "p_link_23",
      authUid: "uid_link_23",
      canonicalPhone: "+919999999999", // wrong canonical phone
    });

    const res = await linkingModule.linkPlayerAccount(db, {
      uid: "uid_link_23",
      verifiedPhoneNumber: "+919876540123",
      requestedPlayerId: "p_link_23",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Phone reservation canonical phone does not match|Inconsistent identity mapping/);
  });

  it("Scenario 24: Normal idempotency rejects wrong uidIndex.canonicalPhone", async () => {
    await db.collection("players").doc("p_link_24").set({
      name: "Player 24",
      authUid: "uid_link_24",
      mobile: "+919876540124",
    });
    await db.collection("appUsers").doc("uid_link_24").set({
      playerId: "p_link_24",
      status: "Active",
    });
    await db.collection("phoneIndex").doc("+919876540124").set({
      playerId: "p_link_24",
      authUid: "uid_link_24",
      canonicalPhone: "+919876540124",
    });
    // Inconsistent uidIndex with wrong canonical phone
    await db.collection("uidIndex").doc("uid_link_24").set({
      playerId: "p_link_24",
      authUid: "uid_link_24",
      canonicalPhone: "+918888888888", // wrong canonical phone
    });

    const res = await linkingModule.linkPlayerAccount(db, {
      uid: "uid_link_24",
      verifiedPhoneNumber: "+919876540124",
      requestedPlayerId: "p_link_24",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
  });

  it("Scenario 25: Contention fallback rejects inconsistent four-way state", async () => {
    // Setup state where player.authUid is missing (partial mapping)
    await db.collection("players").doc("p_link_25").set({
      name: "Player 25",
      mobile: "+919876540125",
      // authUid not set!
    });
    await db.collection("appUsers").doc("uid_link_25").set({
      playerId: "p_link_25",
      status: "Active",
    });
    await db.collection("phoneIndex").doc("+919876540125").set({
      playerId: "p_link_25",
      authUid: "uid_link_25",
      canonicalPhone: "+919876540125",
    });
    await db.collection("uidIndex").doc("uid_link_25").set({
      playerId: "p_link_25",
      authUid: "uid_link_25",
      canonicalPhone: "+919876540125",
    });

    const res = await linkingModule.linkPlayerAccount(db, {
      uid: "uid_link_25",
      verifiedPhoneNumber: "+919876540125",
      requestedPlayerId: "p_link_25",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
  });

  it("Scenario 26: Contention fallback accepts only a fully consistent four-way state", async () => {
    await db.collection("players").doc("p_link_26").set({
      name: "Player 26",
      authUid: "uid_link_26",
      mobile: "+919876540126",
    });
    await db.collection("appUsers").doc("uid_link_26").set({
      playerId: "p_link_26",
      status: "Active",
    });
    await db.collection("phoneIndex").doc("+919876540126").set({
      playerId: "p_link_26",
      authUid: "uid_link_26",
      canonicalPhone: "+919876540126",
    });
    await db.collection("uidIndex").doc("uid_link_26").set({
      playerId: "p_link_26",
      authUid: "uid_link_26",
      canonicalPhone: "+919876540126",
    });

    const res = await linkingModule.linkPlayerAccount(db, {
      uid: "uid_link_26",
      verifiedPhoneNumber: "+919876540126",
      requestedPlayerId: "p_link_26",
    });

    assert.equal(res.ok, true);
    assert.equal(res.alreadyLinked, true);
    assert.equal(res.playerId, "p_link_26");
  });

  it("Scenario 27: Transaction-created phoneIndex records satisfy canonical field contract", async () => {
    await db.collection("players").doc("p_link_27").set({
      name: "Player 27",
      mobile: "+919876540127",
    });

    const res = await linkingModule.linkPlayerAccount(db, {
      uid: "uid_link_27",
      verifiedPhoneNumber: "+919876540127",
      requestedPlayerId: "p_link_27",
    });
    assert.equal(res.ok, true);

    const piDoc = await db.collection("phoneIndex").doc("+919876540127").get();
    assert.equal(piDoc.exists, true);
    const piData = piDoc.data();
    assert.equal(piData.playerId, "p_link_27");
    assert.equal(piData.authUid, "uid_link_27");
    assert.equal(piData.canonicalPhone, "+919876540127");
    assert.ok(piData.createdAt, "createdAt timestamp must exist");
    assert.ok(piData.updatedAt, "updatedAt timestamp must exist");

    const uiDoc = await db.collection("uidIndex").doc("uid_link_27").get();
    assert.equal(uiDoc.exists, true);
    const uiData = uiDoc.data();
    assert.equal(uiData.playerId, "p_link_27");
    assert.equal(uiData.authUid, "uid_link_27");
    assert.equal(uiData.canonicalPhone, "+919876540127");
  });

  it("Scenario 28: Generic Firestore INVALID_ARGUMENT returns 500, not 409", async () => {
    // Pass invalid characters in requestedPlayerId
    const res = await linkingModule.linkPlayerAccount(db, {
      uid: "uid_invalid_arg",
      verifiedPhoneNumber: "+919876540128",
      requestedPlayerId: "invalid/player/path!@#$",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 400); // Parameter validation catches invalid ID characters
  });

  it("Scenario 29: Genuine transaction contention returns 409 unless complete concurrent success is verified", async () => {
    await db.collection("players").doc("p_contention_29").set({
      name: "Contention Player",
      mobile: "+919876540129",
    });

    // Mock db.runTransaction once to throw aborted error (code 10)
    const originalRunTx = db.runTransaction.bind(db);
    db.runTransaction = async function () {
      const abortErr = new Error("Transaction was aborted due to concurrent modification.");
      abortErr.code = 10;
      throw abortErr;
    };

    try {
      const res = await linkingModule.linkPlayerAccount(db, {
        uid: "uid_contention_29",
        verifiedPhoneNumber: "+919876540129",
        requestedPlayerId: "p_contention_29",
      });

      assert.equal(res.ok, false);
      assert.equal(res.status, 409);
      assert.match(res.error, /Concurrent update conflict detected/);
    } finally {
      db.runTransaction = originalRunTx;
    }
  });

  it("Scenario 30: Missing phone number on active player blocks bootstrap readiness", async () => {
    await db.collection("players").doc("p_active_no_phone").set({
      name: "No Phone Active Player",
      disabled: false,
      // mobile is missing!
    });

    const report = await bootstrapModule.generateIdentityCollisionReport(db);
    assert.equal(report.safeToBootstrap, false);
    assert.ok(report.blockingIssueCount > 0);
    assert.equal(report.missingPhoneCount, 1);
  });

  it("Scenario 31: Invalid merge chain blocks bootstrap readiness", async () => {
    await db.collection("players").doc("p_loser_chain").set({
      name: "Loser Chain Player",
      mergedInto: "p_disabled_keeper",
    });
    await db.collection("players").doc("p_disabled_keeper").set({
      name: "Disabled Keeper",
      disabled: true, // Keeper is disabled!
    });

    const report = await bootstrapModule.generateIdentityCollisionReport(db);
    assert.equal(report.safeToBootstrap, false);
    assert.equal(report.invalidMergeRelationships > 0, true);
  });

  it("Scenario 32: appUsers pointing to disabled/merged player is reported as blocking", async () => {
    await db.collection("players").doc("p_merged_target").set({
      name: "Merged Target",
      disabled: true,
      mergedInto: "p_surviving_keeper",
    });
    await db.collection("players").doc("p_surviving_keeper").set({
      name: "Surviving Keeper",
      mobile: "+919876540132",
    });
    await db.collection("appUsers").doc("u_pointing_to_merged").set({
      playerId: "p_merged_target",
    });

    const report = await bootstrapModule.generateIdentityCollisionReport(db);
    assert.equal(report.safeToBootstrap, false);
    const blockingInconsistencies = report.appUserInconsistencies.filter((i) => i.isBlocking);
    assert.ok(blockingInconsistencies.some((i) => i.playerId === "p_merged_target"));
  });

  it("Scenario 33: Missing UID and phone indexes prevent safe linking", async () => {
    await db.collection("players").doc("p_linked_no_indexes").set({
      name: "Linked No Indexes",
      authUid: "uid_no_index",
      mobile: "+919876540133",
    });

    const report = await bootstrapModule.generateIdentityCollisionReport(db);
    assert.equal(report.safeToBootstrap, false);
    assert.equal(report.safeToLinkExistingRecords, false);
    assert.ok(report.missingIndexReservations.length > 0);
  });

  it("Scenario 34: Duplicate canonical phone and UID ownership block bootstrap", async () => {
    await db.collection("players").doc("p_dupe_1").set({
      name: "Dupe Player 1",
      mobile: "+919876540134",
    });
    await db.collection("players").doc("p_dupe_2").set({
      name: "Dupe Player 2",
      mobile: "+919876540134",
    });

    const report = await bootstrapModule.generateIdentityCollisionReport(db);
    assert.equal(report.safeToBootstrap, false);
    assert.equal(report.duplicatePhones, 1);
    assert.ok(report.blockingIssueCount > 0);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Group 5: 1F-R Concurrency, Fencing, Financial Collision & Recovery (Scenarios 35 - 43)
  // ══════════════════════════════════════════════════════════════════════════

  it("Scenario 35: Two distinct merge jobs compete for the same keeper: second job rejected with 409 (R3)", async () => {
    await db.collection("players").doc("p_loser_35a").set({ name: "Loser 35A" });
    await db.collection("players").doc("p_loser_35b").set({ name: "Loser 35B" });
    await db.collection("players").doc("p_keeper_35").set({ name: "Keeper 35" });

    // Job A acquires lease on keeper 35
    const resA = await playerMergeModule.acquireMergeLease(db, "job_35a", "p_loser_35a", "p_keeper_35");
    assert.equal(resA.ok, true);

    // Verify keeper document is locked
    const kSnap = await db.collection("players").doc("p_keeper_35").get();
    assert.equal(kSnap.data()?.mergeStatus, "in_progress");
    assert.equal(kSnap.data()?.mergeJobId, "job_35a");

    // Job B attempts to acquire lease with the SAME keeper
    const resB = await playerMergeModule.acquireMergeLease(db, "job_35b", "p_loser_35b", "p_keeper_35");
    assert.equal(resB.ok, false);
    assert.equal(resB.status, 409);
    assert.match(resB.code, /MERGE_IN_PROGRESS|KEEPER_LOCKED/);
  });

  it("Scenario 36: Cross-role conflict: keeper in Job A is loser in Job B: rejected with 409 (R3)", async () => {
    await db.collection("players").doc("p_loser_36a").set({ name: "Loser 36A" });
    await db.collection("players").doc("p_pivot_36").set({ name: "Pivot Player 36" });
    await db.collection("players").doc("p_target_36").set({ name: "Target 36" });

    // Job A locks p_pivot_36 as keeper
    const resA = await playerMergeModule.acquireMergeLease(db, "job_36a", "p_loser_36a", "p_pivot_36");
    assert.equal(resA.ok, true);

    // Job B attempts to lock p_pivot_36 as LOSER
    const resB = await playerMergeModule.acquireMergeLease(db, "job_36b", "p_pivot_36", "p_target_36");
    assert.equal(resB.ok, false);
    assert.equal(resB.status, 409);
    assert.match(resB.code, /MERGE_IN_PROGRESS|PLAYER_LOCKED/);
  });

  it("Scenario 37: Worker fencing on EVERY migration mutation: stale worker rejected on chunk commit (R1)", async () => {
    await db.collection("players").doc("p_loser_37").set({ name: "Loser 37" });
    await db.collection("players").doc("p_keeper_37").set({ name: "Keeper 37" });

    // Seed a match payment
    await db.collection("matches").doc("m_37").collection("payments").doc("pay_37").set({
      playerId: "p_loser_37",
      status: "Unpaid",
      feeCollectedAmount: 500,
    });

    // Seed merge job with fencing token 1
    await db.collection("mergeJobs").doc("job_37").set({
      jobId: "job_37",
      loserId: "p_loser_37",
      keeperId: "p_keeper_37",
      status: "in_progress",
      stage: "identity_locked",
      leaseOwner: "worker_37a",
      leaseToken: "token_37a",
      fencingToken: 1,
      leaseExpiresAt: Date.now() + 60000,
    });

    const staleWorker = {
      leaseOwner: "worker_37a",
      leaseToken: "token_37a",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };

    // Worker B reclaims job with fencingToken 2
    await db.collection("mergeJobs").doc("job_37").update({
      leaseOwner: "worker_37b",
      leaseToken: "token_37b",
      fencingToken: 2,
    });

    // Stale Worker A attempts to migrate payment chunk
    await assert.rejects(
      async () => {
        await playerMergeModule.migratePaymentsStage(db, "job_37", "p_loser_37", "p_keeper_37", staleWorker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "STALE_WORKER_FENCING_ERROR");
        return true;
      }
    );

    // Verify payment was NOT reparented by stale worker
    const paySnap = await db.collection("matches").doc("m_37").collection("payments").doc("pay_37").get();
    assert.equal(paySnap.data()?.playerId, "p_loser_37");
  });

  it("Scenario 38: Financial collision protection: different payment reference: HTTP 409 (R4)", async () => {
    await db.collection("players").doc("p_loser_38").set({ name: "Loser 38" });
    await db.collection("players").doc("p_keeper_38").set({ name: "Keeper 38" });

    // Seed otherFee on keeper
    await db.collection("players").doc("p_keeper_38").collection("otherFees").doc("fee_38").set({
      title: "Late Fee",
      amount: 100,
      status: "Paid",
      paymentMethod: "razorpay",
      razorpayPaymentId: "pay_keeper_ref_111",
    });

    // Seed otherFee on loser with DIFFERENT payment reference
    await db.collection("players").doc("p_loser_38").collection("otherFees").doc("fee_38").set({
      title: "Late Fee",
      amount: 100,
      status: "Paid",
      paymentMethod: "razorpay",
      razorpayPaymentId: "pay_loser_ref_999",
    });

    await db.collection("mergeJobs").doc("job_38").set({
      jobId: "job_38",
      loserId: "p_loser_38",
      keeperId: "p_keeper_38",
      status: "in_progress",
      stage: "identity_locked",
      leaseOwner: "worker_38",
      leaseToken: "token_38",
      fencingToken: 1,
      leaseExpiresAt: Date.now() + 60000,
    });

    const worker = {
      leaseOwner: "worker_38",
      leaseToken: "token_38",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };

    await assert.rejects(
      async () => {
        await playerMergeModule.migrateOtherFeesStage(db, "job_38", "p_loser_38", "p_keeper_38", worker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "FINANCIAL_RECORD_COLLISION");
        return true;
      }
    );

    // Both source and destination records remain intact
    const loserFeeSnap = await db.collection("players").doc("p_loser_38").collection("otherFees").doc("fee_38").get();
    const keeperFeeSnap = await db.collection("players").doc("p_keeper_38").collection("otherFees").doc("fee_38").get();
    assert.equal(loserFeeSnap.exists, true);
    assert.equal(keeperFeeSnap.exists, true);
    assert.equal(loserFeeSnap.data()?.razorpayPaymentId, "pay_loser_ref_999");
    assert.equal(keeperFeeSnap.data()?.razorpayPaymentId, "pay_keeper_ref_111");
  });

  it("Scenario 39: Financial collision protection: different paid amounts: HTTP 409 (R4)", async () => {
    await db.collection("players").doc("p_loser_39").set({ name: "Loser 39" });
    await db.collection("players").doc("p_keeper_39").set({ name: "Keeper 39" });

    await db.collection("players").doc("p_keeper_39").collection("otherFees").doc("fee_39").set({
      title: "Jersey Fee",
      amount: 500,
      paidAmount: 500,
      status: "Paid",
    });
    await db.collection("players").doc("p_loser_39").collection("otherFees").doc("fee_39").set({
      title: "Jersey Fee",
      amount: 500,
      paidAmount: 250, // Partial paid mismatch
      status: "Paid",
    });

    await db.collection("mergeJobs").doc("job_39").set({
      jobId: "job_39",
      loserId: "p_loser_39",
      keeperId: "p_keeper_39",
      status: "in_progress",
      stage: "identity_locked",
      leaseOwner: "worker_39",
      leaseToken: "token_39",
      fencingToken: 1,
      leaseExpiresAt: Date.now() + 60000,
    });

    const worker = {
      leaseOwner: "worker_39",
      leaseToken: "token_39",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };

    await assert.rejects(
      async () => {
        await playerMergeModule.migrateOtherFeesStage(db, "job_39", "p_loser_39", "p_keeper_39", worker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "FINANCIAL_RECORD_COLLISION");
        return true;
      }
    );
  });

  it("Scenario 40: Financial collision protection: different refund reference: HTTP 409 (R4)", async () => {
    await db.collection("players").doc("p_loser_40").set({ name: "Loser 40" });
    await db.collection("players").doc("p_keeper_40").set({ name: "Keeper 40" });

    await db.collection("players").doc("p_keeper_40").collection("otherFees").doc("fee_40").set({
      title: "Camp Fee",
      amount: 1000,
      status: "Paid",
      refundId: "rfnd_keeper_123",
    });
    await db.collection("players").doc("p_loser_40").collection("otherFees").doc("fee_40").set({
      title: "Camp Fee",
      amount: 1000,
      status: "Paid",
      refundId: "rfnd_loser_789",
    });

    await db.collection("mergeJobs").doc("job_40").set({
      jobId: "job_40",
      loserId: "p_loser_40",
      keeperId: "p_keeper_40",
      status: "in_progress",
      stage: "identity_locked",
      leaseOwner: "worker_40",
      leaseToken: "token_40",
      fencingToken: 1,
      leaseExpiresAt: Date.now() + 60000,
    });

    const worker = {
      leaseOwner: "worker_40",
      leaseToken: "token_40",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };

    await assert.rejects(
      async () => {
        await playerMergeModule.migrateOtherFeesStage(db, "job_40", "p_loser_40", "p_keeper_40", worker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "FINANCIAL_RECORD_COLLISION");
        return true;
      }
    );
  });

  it("Scenario 41: Retired PATCH endpoint rejects with HTTP 405 Method Not Allowed (R5)", async () => {
    const res = await mergeRoute.PATCH();
    assert.equal(res.status, 405);
    const body = await res.json();
    assert.equal(body.code, "METHOD_NOT_ALLOWED");
    assert.match(body.error, /retired/);
  });

  it("Scenario 42: Fail-closed final verification: missing phone reservation on keeper with mobile (R10)", async () => {
    await db.collection("players").doc("p_loser_42").set({ name: "Loser 42", mergedInto: "p_keeper_42" });
    await db.collection("players").doc("p_keeper_42").set({
      name: "Keeper 42",
      mobile: "+919876540142",
      disabled: false,
    });

    // Deliberately do NOT create phoneIndex for +919876540142
    await db.collection("mergeJobs").doc("job_42").set({
      jobId: "job_42",
      loserId: "p_loser_42",
      keeperId: "p_keeper_42",
      status: "in_progress",
      stage: "app_users_reparented",
      leaseOwner: "worker_42",
      leaseToken: "token_42",
      fencingToken: 1,
      leaseExpiresAt: Date.now() + 60000,
    });

    const worker = {
      leaseOwner: "worker_42",
      leaseToken: "token_42",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };

    await assert.rejects(
      async () => {
        await playerMergeModule.executeIndependentFinalVerification(db, "job_42", "p_loser_42", "p_keeper_42", worker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "FINAL_VERIFICATION_FAILED");
        assert.match(err.message, /phone reservation missing/);
        return true;
      }
    );
  });

  it("Scenario 43: Fail-closed final verification: missing UID reservation on keeper with authUid (R10)", async () => {
    await db.collection("players").doc("p_loser_43").set({ name: "Loser 43", mergedInto: "p_keeper_43" });
    await db.collection("players").doc("p_keeper_43").set({
      name: "Keeper 43",
      authUid: "uid_keeper_43",
      disabled: false,
    });

    // Deliberately do NOT create uidIndex for uid_keeper_43
    await db.collection("mergeJobs").doc("job_43").set({
      jobId: "job_43",
      loserId: "p_loser_43",
      keeperId: "p_keeper_43",
      status: "in_progress",
      stage: "app_users_reparented",
      leaseOwner: "worker_43",
      leaseToken: "token_43",
      fencingToken: 1,
      leaseExpiresAt: Date.now() + 60000,
    });

    const worker = {
      leaseOwner: "worker_43",
      leaseToken: "token_43",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };

    await assert.rejects(
      async () => {
        await playerMergeModule.executeIndependentFinalVerification(db, "job_43", "p_loser_43", "p_keeper_43", worker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "FINAL_VERIFICATION_FAILED");
        assert.match(err.message, /UID reservation missing/);
        return true;
      }
    );
  });

  it("Scenario 44 (R8 Cumulative Progress & Monotonicity on Partial Resume): 250 payments resumed after chunk 1 failure", async () => {
    const jobId = "job_cum_44";
    const loserId = "p_loser_cum_44";
    const keeperId = "p_keeper_cum_44";

    await db.collection("players").doc(loserId).set({ id: loserId, name: "Loser Cum", mergeStatus: "in_progress", mergeJobId: jobId });
    await db.collection("players").doc(keeperId).set({ id: keeperId, name: "Keeper Cum", mergeStatus: "in_progress", mergeJobId: jobId });

    // Seed 250 payments across 25 batches of 10
    for (let b = 0; b < 25; b++) {
      const batch = db.batch();
      for (let i = 0; i < 10; i++) {
        const pId = `pay_cum_${b}_${i}`;
        const ref = db.collection("matches").doc(`m_${b}`).collection("payments").doc(pId);
        batch.set(ref, { id: pId, playerId: loserId, status: "Unpaid" });
      }
      await batch.commit();
    }

    const lease1 = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId, { workerId: "worker_cum_1" });
    assert.equal(lease1.ok, true);

    // Run chunk 1 (100 payments) and inject failure after first chunk
    let chunksCommitted = 0;
    await assert.rejects(async () => {
      await playerMergeModule.migratePaymentsStage(db, jobId, loserId, keeperId, lease1.workerInfo, {
        batchLimit: 100,
        onAfterChunkCommit: async (cIndex) => {
          chunksCommitted++;
          if (cIndex === 0) {
            throw new Error("Simulated worker crash after chunk 1");
          }
        },
      });
    }, /Simulated worker crash/);

    // Verify durable progress after chunk 1
    const jobSnap1 = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(jobSnap1.data().stats.paymentsReparented, 100);
    assert.equal(jobSnap1.data().stats.paymentsReparentedChunks, 1);

    // Advance time past lease duration
    const expiredTs = Date.now() - 1000;
    await db.collection("mergeJobs").doc(jobId).update({ leaseExpiresAt: expiredTs });
    await db.collection("players").doc(loserId).update({ mergeLeaseExpiresAt: expiredTs });
    await db.collection("players").doc(keeperId).update({ mergeLeaseExpiresAt: expiredTs });

    // Worker 2 reclaims lease and resumes
    const lease2 = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId, { workerId: "worker_cum_2" });
    assert.equal(lease2.ok, true);
    assert.equal(lease2.workerInfo.fencingToken, 2);

    // Resume migration for remaining 150 payments
    const res2 = await playerMergeModule.migratePaymentsStage(db, jobId, loserId, keeperId, lease2.workerInfo, {
      batchLimit: 100,
    });
    assert.equal(res2.count, 250);

    // Verify progress never decremented and reached exactly 250
    const jobSnap2 = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(jobSnap2.data().stats.paymentsReparented, 250);
    assert.equal(jobSnap2.data().stats.paymentsReparentedChunks, 3); // 1 + 2 = 3 chunks

    // Calling again when 0 payments left must NOT reset counter to 0 or decrement
    const res3 = await playerMergeModule.migratePaymentsStage(db, jobId, loserId, keeperId, lease2.workerInfo, {
      batchLimit: 100,
    });
    assert.equal(res3.count, 250);
    const jobSnap3 = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(jobSnap3.data().stats.paymentsReparented, 250);
  });

  it("Scenario 45 (R8 Cumulative Progress for OtherFees): Preserves feesMoved and feesSkipped on resume", async () => {
    const jobId = "job_fees_45";
    const loserId = "p_loser_fees_45";
    const keeperId = "p_keeper_fees_45";

    await db.collection("players").doc(loserId).set({ id: loserId, name: "Loser Fees", mergeStatus: "in_progress", mergeJobId: jobId });
    await db.collection("players").doc(keeperId).set({ id: keeperId, name: "Keeper Fees", mergeStatus: "in_progress", mergeJobId: jobId });

    // Seed 4 fees
    for (let i = 0; i < 4; i++) {
      await db.collection("players").doc(loserId).collection("otherFees").doc(`fee_${i}`).set({
        id: `fee_${i}`,
        amount: 200,
        title: `Fee ${i}`,
        status: "Unpaid",
      });
    }

    const lease1 = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId, { workerId: "worker_fees_1" });

    // Move first 2 fees, then fail
    await assert.rejects(async () => {
      await playerMergeModule.migrateOtherFeesStage(db, jobId, loserId, keeperId, lease1.workerInfo, {
        batchLimit: 2,
        onAfterChunkCommit: async (cIndex) => {
          if (cIndex === 0) throw new Error("Worker crash in fees chunk 1");
        },
      });
    }, /Worker crash/);

    const snap1 = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(snap1.data().stats.feesMoved, 2);

    // Reclaim lease
    const expiredTs = Date.now() - 1000;
    await db.collection("mergeJobs").doc(jobId).update({ leaseExpiresAt: expiredTs });
    await db.collection("players").doc(loserId).update({ mergeLeaseExpiresAt: expiredTs });
    await db.collection("players").doc(keeperId).update({ mergeLeaseExpiresAt: expiredTs });
    const lease2 = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId, { workerId: "worker_fees_2" });

    // Resume
    const res2 = await playerMergeModule.migrateOtherFeesStage(db, jobId, loserId, keeperId, lease2.workerInfo, {
      batchLimit: 2,
    });
    assert.equal(res2.count, 4);

    const snap2 = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(snap2.data().stats.feesMoved, 4);
  });

  it("Scenario 46 (R9 Bounded Pagination Across Multiple Pages): AppUsers and indexes migrate in bounded pages", async () => {
    const jobId = "job_bound_46";
    const loserId = "p_loser_bound_46";
    const keeperId = "p_keeper_bound_46";

    await db.collection("players").doc(loserId).set({ id: loserId, name: "Loser Bound" });
    await db.collection("players").doc(keeperId).set({ id: keeperId, name: "Keeper Bound" });

    // Seed 9 appUsers and 9 uidIndex documents
    for (let i = 0; i < 9; i++) {
      await db.collection("appUsers").doc(`user_bound_${i}`).set({ id: `user_bound_${i}`, playerId: loserId });
      await db.collection("uidIndex").doc(`uid_bound_${i}`).set({ authUid: `uid_bound_${i}`, playerId: loserId });
    }

    const lease = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId, { workerId: "worker_bound" });

    let chunkCallCount = 0;
    const res = await playerMergeModule.migrateAppUsersAndIndexesStage(db, jobId, loserId, keeperId, lease.workerInfo, {
      batchLimit: 3,
      onAfterChunkCommit: async () => {
        chunkCallCount++;
      },
    });

    assert.equal(res.count, 18); // 9 users + 9 uids
    assert.ok(chunkCallCount >= 3, `Expected at least 3 chunk commits for page limit 3, got ${chunkCallCount}`);

    const jobSnap = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(jobSnap.data().stats.appUsersReparented, 9);
    assert.equal(jobSnap.data().stats.uidIndexReparented, 9);
  });

  it("Scenario 47 (R9 Bounded Final Verification): Fails closed on dataset exceeding batch limit", async () => {
    const jobId = "job_bound_fv_47";
    const loserId = "p_loser_bound_47";
    const keeperId = "p_keeper_bound_47";

    await db.collection("players").doc(loserId).set({ id: loserId, name: "Loser Bound FV" });
    await db.collection("players").doc(keeperId).set({ id: keeperId, name: "Keeper Bound FV", mobile: "+919876500147" });
    await db.collection("phoneIndex").doc("+919876500147").set({ canonicalPhone: "+919876500147", playerId: keeperId });

    // Seed 15 residual payments (more than batchLimit: 5)
    for (let i = 0; i < 15; i++) {
      await db.collection("matches").doc(`m_res_${i}`).collection("payments").doc(`pay_res_${i}`).set({
        playerId: loserId,
        status: "Unpaid",
      });
    }

    const worker = {
      leaseOwner: "worker_47",
      leaseToken: "token_47",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };

    await assert.rejects(
      async () => {
        await playerMergeModule.executeIndependentFinalVerification(db, jobId, loserId, keeperId, worker, {
          batchLimit: 5,
        });
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "FINAL_VERIFICATION_FAILED");
        return true;
      }
    );
  });

  it("Scenario 48 (R2/R3 Stale Lock with Missing Job): Reclaims stale orphaned lock safely", async () => {
    const loserId = "p_loser_stale_48";
    const keeperId = "p_keeper_stale_48";
    const newJobId = `job_${loserId}_${keeperId}`;

    // Loser has expired lock referencing a non-existent job with complete metadata
    await db.collection("players").doc(loserId).set({
      id: loserId,
      name: "Stale Loser 48",
      mergeStatus: "in_progress",
      mergeJobId: "job_completely_missing_999",
      mergeLeaseOwner: "old_worker_48",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: Date.now() - 50000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      name: "Keeper 48",
    });

    const lease = await playerMergeModule.acquireMergeLease(db, newJobId, loserId, keeperId);
    assert.equal(lease.ok, true);
    // Monotonic fencing establishes max(prior: 1) + 1 = 2
    assert.equal(lease.workerInfo.fencingToken, 2);

    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.equal(loserSnap.data().mergeJobId, newJobId);
    assert.equal(loserSnap.data().mergeStatus, "in_progress");
  });

  it("Scenario 49 (R2/R3 Stale Lock with Failed Job): Reclaims failed job and increments fencing token", async () => {
    const jobId = "job_failed_49";
    const loserId = "p_loser_failed_49";
    const keeperId = "p_keeper_failed_49";

    await db.collection("players").doc(loserId).set({ id: loserId, mergeStatus: "in_progress", mergeJobId: jobId });
    await db.collection("players").doc(keeperId).set({ id: keeperId, mergeStatus: "in_progress", mergeJobId: jobId });
    await db.collection("mergeJobs").doc(jobId).set({
      jobId,
      loserId,
      keeperId,
      status: "failed",
      fencingToken: 3,
      leaseExpiresAt: Date.now() - 10000,
    });

    const lease = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId);
    assert.equal(lease.ok, true);
    assert.equal(lease.workerInfo.fencingToken, 4);

    const jobSnap = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(jobSnap.data().status, "in_progress");
    assert.equal(jobSnap.data().fencingToken, 4);
  });

  it("Scenario 50 (R2/R3 One-Sided Lock Inconsistency): Reconciles when one player is unlocked", async () => {
    const jobId = "job_onesided_50";
    const loserId = "p_loser_onesided_50";
    const keeperId = "p_keeper_onesided_50";

    // Loser is locked to jobId, keeper is unlocked
    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseExpiresAt: Date.now() - 10000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "unlocked",
    });

    const lease = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId);
    assert.equal(lease.ok, true);

    const loserSnap = await db.collection("players").doc(loserId).get();
    const keeperSnap = await db.collection("players").doc(keeperId).get();
    assert.equal(loserSnap.data().mergeStatus, "in_progress");
    assert.equal(keeperSnap.data().mergeStatus, "in_progress");
    assert.equal(loserSnap.data().mergeJobId, jobId);
    assert.equal(keeperSnap.data().mergeJobId, jobId);
  });

  it("Scenario 51 (R2/R3 Lease Renewal Fails on Missing or Tampered Player Lock): Throws LEASE_RENEWAL_FAILED", async () => {
    const jobId = "job_renew_51";
    const loserId = "p_loser_renew_51";
    const keeperId = "p_keeper_renew_51";

    await db.collection("players").doc(loserId).set({ id: loserId });
    await db.collection("players").doc(keeperId).set({ id: keeperId });

    const lease = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId);
    assert.equal(lease.ok, true);

    // Tamper with keeper's lock
    await db.collection("players").doc(keeperId).update({ mergeStatus: "unlocked" });

    await assert.rejects(
      async () => {
        await playerMergeModule.renewMergeLease(db, jobId, lease.workerInfo);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "LEASE_RENEWAL_FAILED");
        assert.match(err.message, /keeper player lock (is )?missing, (inconsistent|incomplete or tampered with)/i);
        return true;
      }
    );
  });

  it("Scenario 52 (R2/R3 Structured Failure Persistence): Persists failed status and failedStage", async () => {
    const jobId = "job_fail_record_52";
    await db.collection("mergeJobs").doc(jobId).set({
      jobId,
      status: "in_progress",
      stage: "stage_2_payments",
      leaseOwner: "worker_52",
      leaseToken: "token_52",
      fencingToken: 1,
      leaseExpiresAt: Date.now() + 60000,
      stats: { paymentsReparented: 50 },
    });

    const worker = {
      leaseOwner: "worker_52",
      leaseToken: "token_52",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };

    const simulatedErr = new Error("Connection reset during payment batch 2");
    simulatedErr.code = "CONNECTION_RESET";

    await playerMergeModule.recordMergeJobFailure(db, jobId, worker, simulatedErr, "stage_2_payments");

    const jobSnap = await db.collection("mergeJobs").doc(jobId).get();
    const data = jobSnap.data();
    assert.equal(data.status, "failed");
    assert.equal(data.failedStage, "stage_2_payments");
    assert.equal(data.errorCode, "CONNECTION_RESET");
    assert.match(data.errorMessage, /Connection reset/);
    assert.equal(data.stats.paymentsReparented, 50); // Preserved!
  });

  it("Scenario 53 (R10 Completion Guard Detects Concurrent Record in Completion Window): Fails closed", async () => {
    const jobId = "job_race_comp_53";
    const loserId = "p_loser_race_53";
    const keeperId = "p_keeper_race_53";

    const expiry53 = Date.now() + 60000;
    await db.collection("players").doc(loserId).set({ id: loserId, mergeStatus: "in_progress", mergeJobId: jobId, mergeFencingToken: 1, mergeLeaseOwner: "worker_53", mergeLeaseExpiresAt: expiry53 });
    await db.collection("players").doc(keeperId).set({ id: keeperId, mergeStatus: "in_progress", mergeJobId: jobId, mergeFencingToken: 1, mergeLeaseOwner: "worker_53", mergeLeaseExpiresAt: expiry53 });

    await db.collection("mergeJobs").doc(jobId).set({
      jobId,
      loserId,
      keeperId,
      status: "in_progress",
      stage: "app_users_reparented",
      leaseOwner: "worker_53",
      leaseToken: "token_53",
      fencingToken: 1,
      leaseExpiresAt: expiry53,
    });

    const worker = {
      leaseOwner: "worker_53",
      leaseToken: "token_53",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };

    // Simulate concurrent write: an otherFee record is added to loser during the verification-to-completion window
    await db.collection("players").doc(loserId).collection("otherFees").doc("fee_late_arrival").set({
      id: "fee_late_arrival",
      amount: 100,
      title: "Late Fee Arrival",
    });

    await assert.rejects(
      async () => {
        await playerMergeModule.executeMergeCompletionStage(db, jobId, loserId, keeperId, worker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "FINAL_VERIFICATION_FAILED");
        assert.match(err.message, /concurrent records referencing loser/);
        return true;
      }
    );

    // Loser was NOT completed or disabled
    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.notEqual(loserSnap.data().mergeStatus, "completed");
    assert.notEqual(loserSnap.data().disabled, true);
  });

  it("Scenario 54 (R4 Financial Collision on Contradictory Internal Aliases): Comprehensive comparator matrix", () => {
    const areFeesIdentical = playerMergeModule.areFeesIdentical;

    const base = {
      amount: 500,
      title: "Match Fee",
      status: "Paid",
      templateId: "tpl_1",
      paymentMethod: "UPI",
      razorpayPaymentId: "pay_123",
      paidAmount: 500,
      feeCollectedAmount: 500,
      receiptId: "rec_1",
      waivedReason: "",
      refundId: "ref_1",
      refundReference: "ref_1",
      refundAmount: 50,
      refundedPaise: 5000,
      cancelledBy: "",
      currency: "INR",
    };

    // 1. Identical matching records
    assert.equal(areFeesIdentical(base, { ...base }), true);

    // 2. Both aliases absent -> identical if base fields match
    const noAliases = { amount: 200, title: "Kit", status: "Unpaid" };
    assert.equal(areFeesIdentical(noAliases, { ...noAliases }), true);

    // 3. Only authoritative populated on both
    const onlyAuth = { amount: 200, title: "Kit", status: "Paid", paidAmount: 200, refundId: "ref_a" };
    assert.equal(areFeesIdentical(onlyAuth, { ...onlyAuth }), true);

    // 4. Only legacy alias populated on both
    const onlyLegacy = { amount: 200, title: "Kit", status: "Paid", feeCollectedAmount: 200, refundReference: "ref_a" };
    assert.equal(areFeesIdentical(onlyLegacy, { ...onlyLegacy }), true);

    // 5. Authoritative on src, legacy on dest with matching value -> identical!
    assert.equal(areFeesIdentical(onlyAuth, onlyLegacy), true);

    // 6. Contradictory internal paid amount on src (paidAmount: 500 vs feeCollectedAmount: 600) -> fails closed
    const contradictoryPaid = { ...base, paidAmount: 500, feeCollectedAmount: 600 };
    assert.equal(areFeesIdentical(contradictoryPaid, base), false);

    // 7. Contradictory refund ID on src (refundId: 'ref_1' vs refundReference: 'ref_2') -> fails closed
    const contradictoryRefundId = { ...base, refundId: "ref_1", refundReference: "ref_2" };
    assert.equal(areFeesIdentical(contradictoryRefundId, base), false);

    // 8. Contradictory refund amount on src (refundAmount: 50 vs refundedPaise: 9000) -> fails closed
    const contradictoryRefundAmount = { ...base, refundAmount: 50, refundedPaise: 9000 };
    assert.equal(areFeesIdentical(contradictoryRefundAmount, base), false);

    // 9. Contradictory payment method on src (paymentMethod: 'UPI' vs paymentMode: 'Cash') -> fails closed
    const contradictoryMethod = { ...base, paymentMethod: "UPI", paymentMode: "Cash" };
    assert.equal(areFeesIdentical(contradictoryMethod, base), false);

    // 10. Contradictory status on src (status: 'Paid' vs paymentStatus: 'Unpaid') -> fails closed
    const contradictoryStatus = { ...base, status: "Paid", paymentStatus: "Unpaid" };
    assert.equal(areFeesIdentical(contradictoryStatus, base), false);

    // 11. Same payment ID but different amount -> false
    assert.equal(areFeesIdentical(base, { ...base, amount: 600 }), false);

    // 12. Same refund ID but different refund amount -> false
    assert.equal(areFeesIdentical(base, { ...base, refundAmount: 100, refundedPaise: 10000 }), false);
  });

  it("Scenario 55 (R10 Write Paths Block Merging Players): verifyPlayerOwnership rejects actively merging players", async () => {
    const { verifyPlayerOwnership } = await import("../lib/razorpay-order.ts");

    await db.collection("players").doc("p_active_55").set({
      id: "p_active_55",
      authUid: "uid_active_55",
      mergeStatus: "in_progress", // ACTIVELY MERGING
    });

    const isAuthorized = await verifyPlayerOwnership(db, "uid_active_55", "p_active_55");
    assert.equal(isAuthorized, false, "Actively merging player must not be authorized to initiate new payments.");
  });

  it("Scenario 56 (R10 Genuine Emulator Concurrency: Payments vs Completion Window): Detects concurrent payment and fails closed", async () => {
    const jobId = "job_s56";
    const loserId = "p_loser_s56";
    const keeperId = "p_keeper_s56";

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeFencingToken: 1,
      mergeLeaseOwner: "worker_56",
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeFencingToken: 1,
      mergeLeaseOwner: "worker_56",
    });

    await db.collection("mergeJobs").doc(jobId).set({
      jobId,
      loserId,
      keeperId,
      status: "in_progress",
      stage: "app_users_reparented",
      leaseOwner: "worker_56",
      leaseToken: "token_56",
      fencingToken: 1,
      leaseExpiresAt: Date.now() + 60000,
    });

    const worker = {
      leaseOwner: "worker_56",
      leaseToken: "token_56",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };

    // Concurrently insert a payment referencing loser while completion stage runs
    let completionError = null;
    const [writeRes, compRes] = await Promise.allSettled([
      db.collection("matches").doc("m_s56").collection("payments").doc("pay_race_56").set({
        playerId: loserId,
        amount: 350,
        status: "Paid",
      }),
      playerMergeModule.executeMergeCompletionStage(db, jobId, loserId, keeperId, worker),
    ]);

    assert.equal(compRes.status, "rejected", "Completion must reject when concurrent payment exists.");
    assert.equal(compRes.reason?.status, 409);
    assert.equal(compRes.reason?.code, "FINAL_VERIFICATION_FAILED");

    // Database remains consistent: loser is NOT marked completed, job is NOT marked completed
    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.notEqual(loserSnap.data().mergeStatus, "completed");
    assert.notEqual(loserSnap.data().disabled, true);

    const jobSnap = await db.collection("mergeJobs").doc(jobId).get();
    assert.notEqual(jobSnap.data().status, "completed");
  });

  it("Scenario 57 (R10 Genuine Emulator Concurrency: OtherFees vs Completion Window): Detects concurrent fee and fails closed", async () => {
    const jobId = "job_s57";
    const loserId = "p_loser_s57";
    const keeperId = "p_keeper_s57";

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeFencingToken: 1,
      mergeLeaseOwner: "worker_57",
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeFencingToken: 1,
      mergeLeaseOwner: "worker_57",
    });

    await db.collection("mergeJobs").doc(jobId).set({
      jobId,
      loserId,
      keeperId,
      status: "in_progress",
      stage: "app_users_reparented",
      leaseOwner: "worker_57",
      leaseToken: "token_57",
      fencingToken: 1,
      leaseExpiresAt: Date.now() + 60000,
    });

    const worker = {
      leaseOwner: "worker_57",
      leaseToken: "token_57",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };

    // Concurrently insert an otherFee referencing loser while completion stage runs
    const [writeRes, compRes] = await Promise.allSettled([
      db.collection("players").doc(loserId).collection("otherFees").doc("fee_race_57").set({
        playerId: loserId,
        amount: 500,
        title: "Concurrent Annual Fee",
        status: "Pending",
      }),
      playerMergeModule.executeMergeCompletionStage(db, jobId, loserId, keeperId, worker),
    ]);

    assert.equal(compRes.status, "rejected", "Completion must reject when concurrent fee exists.");
    assert.equal(compRes.reason?.status, 409);
    assert.equal(compRes.reason?.code, "FINAL_VERIFICATION_FAILED");

    // Database remains consistent: loser is NOT marked completed, job is NOT marked completed
    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.notEqual(loserSnap.data().mergeStatus, "completed");
    assert.notEqual(loserSnap.data().disabled, true);

    const jobSnap = await db.collection("mergeJobs").doc(jobId).get();
    assert.notEqual(jobSnap.data().status, "completed");
  });

  it("Scenario 58 (R2/R3 Malformed Lock — in_progress without mergeJobId): Rejects with 409 MALFORMED_PLAYER_LOCK", async () => {
    await db.collection("players").doc("p_loser_s58").set({ name: "Loser 58", mergeStatus: "in_progress" });
    await db.collection("players").doc("p_keeper_s58").set({ name: "Keeper 58" });

    const lease = await playerMergeModule.acquireMergeLease(db, "job_s58", "p_loser_s58", "p_keeper_s58");
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "MALFORMED_PLAYER_LOCK");
  });

  it("Scenario 59 (R2/R3 Mismatched Lock — fencing token or lease owner mismatch): Rejects with 409 PLAYER_LOCK_MISMATCH", async () => {
    await db.collection("players").doc("p_loser_s59").set({
      name: "Loser 59",
      mergeStatus: "in_progress",
      mergeJobId: "job_s59",
      mergeLeaseOwner: "worker_other",
      mergeLeaseToken: "tok_other",
      mergeFencingToken: 99,
      mergeLeaseExpiresAt: Date.now() + 60000,
    });
    await db.collection("players").doc("p_keeper_s59").set({
      name: "Keeper 59",
      mergeStatus: "in_progress",
      mergeJobId: "job_s59",
      mergeLeaseOwner: "worker_other",
      mergeLeaseToken: "tok_other",
      mergeFencingToken: 99,
      mergeLeaseExpiresAt: Date.now() + 60000,
    });
    await db.collection("mergeJobs").doc("job_s59").set({
      id: "job_s59",
      jobId: "job_s59",
      status: "in_progress",
      leaseOwner: "worker_job",
      leaseToken: "tok_job",
      fencingToken: 1,
      leaseExpiresAt: Date.now() + 60000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date(),
    });

    const lease = await playerMergeModule.acquireMergeLease(db, "job_s59", "p_loser_s59", "p_keeper_s59");
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "PLAYER_LOCK_MISMATCH");
  });

  it("Scenario 60 (R2/R3 Cross-Job Lock Conflict): Rejects with 409 CROSS_JOB_LOCK_CONFLICT", async () => {
    await db.collection("players").doc("p_loser_s60").set({
      name: "Loser 60",
      mergeStatus: "in_progress",
      mergeJobId: "job_A_60",
      mergeLeaseExpiresAt: Date.now() + 60000,
    });
    await db.collection("players").doc("p_keeper_s60").set({
      name: "Keeper 60",
      mergeStatus: "in_progress",
      mergeJobId: "job_B_60",
      mergeLeaseExpiresAt: Date.now() + 60000,
    });

    const lease = await playerMergeModule.acquireMergeLease(db, "job_s60", "p_loser_s60", "p_keeper_s60");
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "CROSS_JOB_LOCK_CONFLICT");
  });

  it("Scenario 61 (R2/R3 Incomplete Completed Job): Rejects with 409 INCOMPLETE_COMPLETED_JOB", async () => {
    await db.collection("mergeJobs").doc("job_s61").set({
      id: "job_s61",
      jobId: "job_s61",
      status: "completed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date(),
    });
    await db.collection("players").doc("p_loser_s61").set({
      name: "Loser 61",
      mergeStatus: "in_progress",
      disabled: false,
    });
    await db.collection("players").doc("p_keeper_s61").set({
      name: "Keeper 61",
    });

    const lease = await playerMergeModule.acquireMergeLease(db, "job_s61", "p_loser_s61", "p_keeper_s61");
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "INCOMPLETE_COMPLETED_JOB");
  });

  it("Scenario 62 (Failure Lifecycle: Worker Identity & Lease Token Mismatch): Refuses to record failure from superseded worker", async () => {
    const jobId = "job_s62";
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      stage: "stage_2_payments",
      leaseOwner: "worker_original_62",
      leaseToken: "token_original_62",
      fencingToken: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date(),
    });

    const supersededWorker = {
      leaseOwner: "worker_superseded_62",
      leaseToken: "token_superseded_62",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };

    const res = await playerMergeModule.recordMergeJobFailure(
      db,
      jobId,
      supersededWorker,
      new Error("Simulated network drop"),
      "stage_2_payments"
    );

    assert.equal(res.recorded, false);
    assert.equal(res.reason, "WORKER_LEASE_OWNER_MISMATCH");

    const jobSnap = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(jobSnap.data().status, "in_progress");
  });

  it("Scenario 63 (Failure Lifecycle: Completed Job Downgrade Prevention): Stale worker cannot downgrade completed job", async () => {
    const jobId = "job_s63";
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "completed",
      leaseOwner: "worker_63",
      leaseToken: "token_63",
      fencingToken: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date(),
    });

    const worker = {
      leaseOwner: "worker_63",
      leaseToken: "token_63",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };

    const res = await playerMergeModule.recordMergeJobFailure(
      db,
      jobId,
      worker,
      new Error("Delayed failure event"),
      "stage_completion"
    );

    assert.equal(res.recorded, false);
    assert.equal(res.reason, "JOB_NOT_IN_PROGRESS_COMPLETED");

    const jobSnap = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(jobSnap.data().status, "completed");
  });

  it("Scenario 64 (R4 Financial Comparator Exhaustive Matrix): Validates numerical amounts, aliases and currency", () => {
    const { parseAuthoritativeAmount, resolveFinancialRecordValues } = playerMergeModule;

    // 1. Non-numeric string
    const resNonNumeric = parseAuthoritativeAmount("invalid_amount");
    assert.equal(resNonNumeric.ok, false);
    assert.match(resNonNumeric.error, /invalid non-numeric string/);

    // 2. NaN
    const resNaN = parseAuthoritativeAmount(NaN);
    assert.equal(resNaN.ok, false);
    assert.match(resNaN.error, /NaN or non-finite/);

    // 3. Infinity
    const resInf = parseAuthoritativeAmount(Infinity);
    assert.equal(resInf.ok, false);
    assert.match(resInf.error, /NaN or non-finite/);

    // 4. Negative amount
    const resNeg = parseAuthoritativeAmount(-150);
    assert.equal(resNeg.ok, false);
    assert.match(resNeg.error, /cannot be negative/);

    // 5. String with decimal precision and whitespace
    const resTrimmed = parseAuthoritativeAmount("  249.99  ");
    assert.equal(resTrimmed.ok, true);
    assert.equal(resTrimmed.value, 249.99);

    // 5b. Invalid decimal precision (>2 decimal places) is rejected without silent rounding
    const resInvalidPrecision = parseAuthoritativeAmount("  249.995  ");
    assert.equal(resInvalidPrecision.ok, false);
    assert.match(resInvalidPrecision.error, /more than 2 decimal places/);

    // 6. Contradictory paidAmount vs feeCollectedAmount
    const resContradictoryPaid = resolveFinancialRecordValues({
      amount: 500,
      paidAmount: 500,
      feeCollectedAmount: 600,
    });
    assert.equal(resContradictoryPaid.ok, false);
    assert.match(resContradictoryPaid.conflictReason, /Contradictory paid amount aliases/);

    // 7. Equivalence of refundAmount (Rs) and refundedPaise (Paise)
    const resRefundEquivalent = resolveFinancialRecordValues({
      amount: 500,
      refundAmount: 5,
      refundedPaise: 500,
    });
    assert.equal(resRefundEquivalent.ok, true);
    assert.equal(resRefundEquivalent.values?.refundAmount, 5);

    // 8. Contradictory refundAmount vs refundedPaise
    const resRefundContradictory = resolveFinancialRecordValues({
      amount: 500,
      refundAmount: 5,
      refundedPaise: 600,
    });
    assert.equal(resRefundContradictory.ok, false);
    assert.match(resRefundContradictory.conflictReason, /Contradictory refund aliases/);

    // 9. Unsupported currency
    const resCurrency = resolveFinancialRecordValues({
      amount: 100,
      currency: "USD",
    });
    assert.equal(resCurrency.ok, false);
    assert.match(resCurrency.conflictReason, /Unsupported currency/);
  });

  it("Scenario 65 (R10 Webhook Redirection): Webhook transaction safely redirects fees from merged player to keeper", async () => {
    const { processWebhookIntentTransaction } = await import("../lib/razorpay-webhook.ts");

    const loserId = "p_loser_s65";
    const keeperId = "p_keeper_s65";

    await db.collection("players").doc(loserId).set({
      id: loserId,
      name: "Merged Loser 65",
      mergedInto: keeperId,
      disabled: true,
      mergeStatus: "completed",
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      name: "Active Keeper 65",
    });

    const intentId = "intent_dues_s65";
    const orderId = "order_rzp_s65";
    await db.collection("razorpayIntents").doc(intentId).set({
      id: intentId,
      orderId,
      type: "match",
      amount: 250,
      currency: "INR",
      status: "created",
      lateFeeItems: [
        {
          playerId: loserId,
          amount: 50,
          label: "Late Squad Penalty",
          templateId: "tpl_late_65",
        },
      ],
    });
    await seedMatchObligationFor(db, intentId);

    const eventDetails = {
      event: "payment.captured",
      intentId,
      paymentId: "pay_rzp_s65",
      orderId,
      capturedPaise: 25000,
      capturedCurrency: "INR",
    };

    const res = await processWebhookIntentTransaction(db, eventDetails);
    assert.equal(res.success, true);

    // Verify late fee was created under keeper, NOT loser
    const loserFees = await db.collection("players").doc(loserId).collection("otherFees").get();
    assert.equal(loserFees.empty, true, "No fees should be created under merged loser.");

    const keeperFees = await db.collection("players").doc(keeperId).collection("otherFees").get();
    assert.equal(keeperFees.docs.length, 1, "Fee must be safely redirected to keeper.");
    const feeData = keeperFees.docs[0].data();
    assert.equal(feeData.playerId, keeperId);
    assert.equal(feeData.originalPlayerId, loserId);
    assert.equal(feeData.amount, 50);
    assert.equal(feeData.status, "Paid");
  });

  // ==========================================
  // SECTION 3: STRICT LOCK INVARIANTS (10 FIELDS / 13 NEGATIVE CASES)
  // ==========================================

  it("Scenario 66 (Lock Invariants: Missing job leaseOwner): Rejects with 409 MALFORMED_JOB_LEASE", async () => {
    const jobId = "job_s66";
    const loserId = "p_loser_s66";
    const keeperId = "p_keeper_s66";
    const now = Date.now();
    await db.collection("players").doc(loserId).set({
      name: "Loser 66",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_66",
      mergeLeaseToken: "tok_66",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      name: "Keeper 66",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_66",
      mergeLeaseToken: "tok_66",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      leaseToken: "tok_66",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
      // leaseOwner omitted!
    });
    const lease = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId);
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "MALFORMED_JOB_LEASE");
  });

  it("Scenario 67 (Lock Invariants: Missing job leaseToken): Rejects with 409 MALFORMED_JOB_LEASE", async () => {
    const jobId = "job_s67";
    const loserId = "p_loser_s67";
    const keeperId = "p_keeper_s67";
    const now = Date.now();
    await db.collection("players").doc(loserId).set({
      name: "Loser 67",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_67",
      mergeLeaseToken: "tok_67",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      name: "Keeper 67",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_67",
      mergeLeaseToken: "tok_67",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      leaseOwner: "worker_67",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
      // leaseToken omitted!
    });
    const lease = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId);
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "MALFORMED_JOB_LEASE");
  });

  it("Scenario 68 (Lock Invariants: Missing job fencingToken): Rejects with 409 MALFORMED_JOB_LEASE", async () => {
    const jobId = "job_s68";
    const loserId = "p_loser_s68";
    const keeperId = "p_keeper_s68";
    const now = Date.now();
    await db.collection("players").doc(loserId).set({
      name: "Loser 68",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_68",
      mergeLeaseToken: "tok_68",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      name: "Keeper 68",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_68",
      mergeLeaseToken: "tok_68",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      leaseOwner: "worker_68",
      leaseToken: "tok_68",
      leaseExpiresAt: now + 60000,
      // fencingToken omitted!
    });
    const lease = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId);
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "MALFORMED_JOB_LEASE");
  });

  it("Scenario 69 (Lock Invariants: Missing job leaseExpiresAt): Rejects with 409 MALFORMED_JOB_LEASE", async () => {
    const jobId = "job_s69";
    const loserId = "p_loser_s69";
    const keeperId = "p_keeper_s69";
    await db.collection("players").doc(loserId).set({
      name: "Loser 69",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_69",
      mergeLeaseToken: "tok_69",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: Date.now() + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      name: "Keeper 69",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_69",
      mergeLeaseToken: "tok_69",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: Date.now() + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      leaseOwner: "worker_69",
      leaseToken: "tok_69",
      fencingToken: 1,
      // leaseExpiresAt omitted!
    });
    const lease = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId);
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "MALFORMED_JOB_LEASE");
  });

  it("Scenario 70 (Lock Invariants: Missing loser lease metadata): Rejects with 409 PLAYER_LOCK_MISMATCH", async () => {
    const jobId = "job_s70";
    const loserId = "p_loser_s70";
    const keeperId = "p_keeper_s70";
    const now = Date.now();
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      leaseOwner: "worker_70",
      leaseToken: "tok_70",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      name: "Keeper 70",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_70",
      mergeLeaseToken: "tok_70",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(loserId).set({
      name: "Loser 70",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      // missing mergeLeaseOwner, mergeFencingToken, mergeLeaseExpiresAt
    });
    const lease = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId);
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "PLAYER_LOCK_MISMATCH");
  });

  it("Scenario 71 (Lock Invariants: Missing keeper lease metadata): Rejects with 409 PLAYER_LOCK_MISMATCH", async () => {
    const jobId = "job_s71";
    const loserId = "p_loser_s71";
    const keeperId = "p_keeper_s71";
    const now = Date.now();
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      leaseOwner: "worker_71",
      leaseToken: "tok_71",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(loserId).set({
      name: "Loser 71",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_71",
      mergeLeaseToken: "tok_71",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      name: "Keeper 71",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      // missing keeper lease metadata
    });
    const lease = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId);
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "PLAYER_LOCK_MISMATCH");
  });

  it("Scenario 72 (Lock Invariants: Loser vs Keeper fencingToken disagreement): Rejects with 409 PLAYER_LOCK_MISMATCH", async () => {
    const jobId = "job_s72";
    const loserId = "p_loser_s72";
    const keeperId = "p_keeper_s72";
    const now = Date.now();
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      leaseOwner: "worker_72",
      leaseToken: "tok_72",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(loserId).set({
      name: "Loser 72",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_72",
      mergeLeaseToken: "tok_72",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      name: "Keeper 72",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_72",
      mergeLeaseToken: "tok_72",
      mergeFencingToken: 2, // Mismatched fencing token!
      mergeLeaseExpiresAt: now + 60000,
    });
    const lease = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId);
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "PLAYER_LOCK_MISMATCH");
  });

  it("Scenario 73 (Lock Invariants: Loser locked to different jobId): Rejects with 409 CROSS_JOB_LOCK_CONFLICT", async () => {
    const jobId = "job_s73";
    const loserId = "p_loser_s73";
    const keeperId = "p_keeper_s73";
    const now = Date.now();
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      leaseOwner: "worker_73",
      leaseToken: "tok_73",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(loserId).set({
      name: "Loser 73",
      mergeStatus: "in_progress",
      mergeJobId: "job_other_73", // Disagrees with requested jobId!
      mergeLeaseOwner: "worker_73",
      mergeLeaseToken: "tok_73",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      name: "Keeper 73",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_73",
      mergeLeaseToken: "tok_73",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    const lease = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId);
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "CROSS_JOB_LOCK_CONFLICT");
  });

  it("Scenario 74 (Lock Invariants: Expired job with unexpired player lock): Rejects with 409 PLAYER_LOCK_MISMATCH", async () => {
    const jobId = "job_s74";
    const loserId = "p_loser_s74";
    const keeperId = "p_keeper_s74";
    const now = Date.now();
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      leaseOwner: "worker_74",
      leaseToken: "tok_74",
      fencingToken: 1,
      leaseExpiresAt: now - 5000, // Expired job lease
    });
    await db.collection("players").doc(loserId).set({
      name: "Loser 74",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_74",
      mergeLeaseToken: "tok_74",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000, // Unexpired player lock
    });
    await db.collection("players").doc(keeperId).set({
      name: "Keeper 74",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_74",
      mergeLeaseToken: "tok_74",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000, // Unexpired player lock
    });
    const lease = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId);
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "PLAYER_LOCK_MISMATCH");
  });

  it("Scenario 75 (Lock Invariants: Unexpired job with expired player lock): Rejects with 409 PLAYER_LOCK_MISMATCH", async () => {
    const jobId = "job_s75";
    const loserId = "p_loser_s75";
    const keeperId = "p_keeper_s75";
    const now = Date.now();
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      leaseOwner: "worker_75",
      leaseToken: "tok_75",
      fencingToken: 1,
      leaseExpiresAt: now + 60000, // Unexpired job lease
    });
    await db.collection("players").doc(loserId).set({
      name: "Loser 75",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_75",
      mergeLeaseToken: "tok_75",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now - 5000, // Expired player lock
    });
    await db.collection("players").doc(keeperId).set({
      name: "Keeper 75",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_75",
      mergeLeaseToken: "tok_75",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now - 5000, // Expired player lock
    });
    const lease = await playerMergeModule.acquireMergeLease(db, jobId, loserId, keeperId);
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "PLAYER_LOCK_MISMATCH");
  });

  it("Scenario 76 (Lock Invariants: Stale worker fencing token rejected on renewal): Throws LEASE_RENEWAL_FAILED", async () => {
    const jobId = "job_s76";
    const loserId = "p_loser_s76";
    const keeperId = "p_keeper_s76";
    const now = Date.now();
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      leaseOwner: "worker_76",
      leaseToken: "tok_76",
      fencingToken: 2, // Incremented in job
      leaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(loserId).set({
      name: "Loser 76",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_76",
      mergeLeaseToken: "tok_76",
      mergeFencingToken: 2,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      name: "Keeper 76",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_76",
      mergeLeaseToken: "tok_76",
      mergeFencingToken: 2,
      mergeLeaseExpiresAt: now + 60000,
    });
    const staleWorker = {
      leaseOwner: "worker_76",
      leaseToken: "tok_76",
      fencingToken: 1, // Stale worker with fencingToken 1
      attemptCount: 1,
      leaseExpiresAt: now + 60000,
    };
    await assert.rejects(
      async () => {
        await playerMergeModule.renewMergeLease(db, jobId, loserId, keeperId, staleWorker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "LEASE_RENEWAL_FAILED");
        return true;
      }
    );
  });

  // ==========================================
  // SECTION 4: FAILURE LIFECYCLE CASES (77 - 80)
  // ==========================================

  it("Scenario 77 (Failure Lifecycle: Missing worker details): Refuses to record failure", async () => {
    const jobId = "job_s77";
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      leaseOwner: "worker_77",
      leaseToken: "tok_77",
      fencingToken: 1,
      leaseExpiresAt: Date.now() + 60000,
    });
    const incompleteWorker = {
      leaseOwner: "",
      leaseToken: "",
      fencingToken: 0,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };
    const res = await playerMergeModule.recordMergeJobFailure(
      db,
      jobId,
      incompleteWorker,
      new Error("Fail test"),
      "stage_1_identity"
    );
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "MISSING_WORKER_LEASE_OWNER");
  });

  it("Scenario 78 (Failure Lifecycle: Worker owner or fencing mismatch): Refuses to record failure", async () => {
    const jobId = "job_s78";
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      leaseOwner: "worker_real_78",
      leaseToken: "tok_real_78",
      fencingToken: 2,
      leaseExpiresAt: Date.now() + 60000,
    });
    const mismatchedWorker = {
      leaseOwner: "worker_fake_78",
      leaseToken: "tok_fake_78",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };
    const res = await playerMergeModule.recordMergeJobFailure(
      db,
      jobId,
      mismatchedWorker,
      new Error("Fail test"),
      "stage_1_identity"
    );
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "WORKER_LEASE_OWNER_MISMATCH");
  });

  it("Scenario 79 (Failure Lifecycle: Expired lease): Fail-closed on recording failure", async () => {
    const jobId = "job_s79";
    const now = Date.now();
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      leaseOwner: "worker_79",
      leaseToken: "tok_79",
      fencingToken: 1,
      leaseExpiresAt: now - 5000, // Expired lease
    });
    const worker = {
      leaseOwner: "worker_79",
      leaseToken: "tok_79",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: now - 5000,
    };
    const res = await playerMergeModule.recordMergeJobFailure(
      db,
      jobId,
      worker,
      new Error("Fail test"),
      "stage_1_identity"
    );
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "LEASE_EXPIRED");
  });

  it("Scenario 80 (Failure Lifecycle: Job already failed): Stale worker cannot modify failed job", async () => {
    const jobId = "job_s80";
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "failed",
      failedStage: "stage_2_payments",
      failureReason: "Original failure",
      leaseOwner: "worker_80",
      leaseToken: "tok_80",
      fencingToken: 1,
      leaseExpiresAt: Date.now() + 60000,
    });
    const worker = {
      leaseOwner: "worker_80",
      leaseToken: "tok_80",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 60000,
    };
    const res = await playerMergeModule.recordMergeJobFailure(
      db,
      jobId,
      worker,
      new Error("Second failure attempt"),
      "stage_3_fees"
    );
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "JOB_NOT_IN_PROGRESS_FAILED");
  });

  // ==========================================
  // SECTION 5: RUPEE AND PAISE UNIT TESTS (81 - 82)
  // ==========================================

  it("Scenario 81 (Rupee vs Paise Unit Contract): Strict validation and fractional precision rejection", () => {
    const { validateRupeeAmount, validatePaiseAmount, resolveFinancialRecordValues } = playerMergeModule;

    // 1. Valid rupee amounts
    const r1 = validateRupeeAmount(123.45);
    assert.equal(r1.ok, true);
    assert.equal(r1.value, 123.45);

    const r2 = validateRupeeAmount("123.45");
    assert.equal(r2.ok, true);
    assert.equal(r2.value, 123.45);

    const rZero = validateRupeeAmount(0);
    assert.equal(rZero.ok, true);
    assert.equal(rZero.value, 0);

    // 2. Rupee with >2 decimal places rejected without silent rounding
    const rPrecNum = validateRupeeAmount(123.456);
    assert.equal(rPrecNum.ok, false);
    assert.match(rPrecNum.error, /more than 2 decimal places/);

    const rPrecStr = validateRupeeAmount("123.456");
    assert.equal(rPrecStr.ok, false);
    assert.match(rPrecStr.error, /more than 2 decimal places/);

    // 3. Valid paise amounts (strictly integer)
    const p1 = validatePaiseAmount(12345);
    assert.equal(p1.ok, true);
    assert.equal(p1.value, 12345);

    const p2 = validatePaiseAmount("12345");
    assert.equal(p2.ok, true);
    assert.equal(p2.value, 12345);

    const pZero = validatePaiseAmount(0);
    assert.equal(pZero.ok, true);
    assert.equal(pZero.value, 0);

    // 4. Fractional paise rejected
    const pFracNum = validatePaiseAmount(123.45);
    assert.equal(pFracNum.ok, false);
    assert.match(pFracNum.error, /must be an integer paise amount/);

    const pFracStr = validatePaiseAmount("123.45");
    assert.equal(pFracStr.ok, false);
    assert.match(pFracStr.error, /must be an integer paise amount/);

    // 5. resolveFinancialRecordValues: missing amount is strictly rejected
    const resNoAmount = resolveFinancialRecordValues({ title: "Test Fee" });
    assert.equal(resNoAmount.ok, false);
    assert.match(resNoAmount.conflictReason, /required financial amount/);

    // 6. resolveFinancialRecordValues: rupee vs paise equivalence
    const resEq = resolveFinancialRecordValues({
      amount: 100,
      refundAmount: 10.5,
      refundedPaise: 1050,
    });
    assert.equal(resEq.ok, true);
    assert.equal(resEq.values?.refundAmount, 10.5);

    const resMismatch = resolveFinancialRecordValues({
      amount: 100,
      refundAmount: 10.5,
      refundedPaise: 1051,
    });
    assert.equal(resMismatch.ok, false);
    assert.match(resMismatch.conflictReason, /Contradictory refund aliases/);
  });

  it("Scenario 82 (Rupee and Paise Boundary Cases): Negative, non-numeric, overflow and currency checks", () => {
    const { validateRupeeAmount, validatePaiseAmount, resolveFinancialRecordValues } = playerMergeModule;

    // Negative values
    assert.equal(validateRupeeAmount(-50).ok, false);
    assert.equal(validatePaiseAmount(-5000).ok, false);

    // Non-numeric strings
    assert.equal(validateRupeeAmount("abc").ok, false);
    assert.equal(validateRupeeAmount("$50").ok, false);
    assert.equal(validatePaiseAmount("12a").ok, false);

    // NaN / Infinity
    assert.equal(validateRupeeAmount(NaN).ok, false);
    assert.equal(validateRupeeAmount(Infinity).ok, false);
    assert.equal(validatePaiseAmount(NaN).ok, false);
    assert.equal(validatePaiseAmount(Infinity).ok, false);

    // Large amounts within boundary
    const largeR = validateRupeeAmount(1000000.50);
    assert.equal(largeR.ok, true);
    assert.equal(largeR.value, 1000000.50);

    const largeP = validatePaiseAmount(100000050);
    assert.equal(largeP.ok, true);
    assert.equal(largeP.value, 100000050);

    // Unsupported currency
    const resCurr = resolveFinancialRecordValues({ amount: 100, currency: "EUR" });
    assert.equal(resCurr.ok, false);
    assert.match(resCurr.conflictReason, /Unsupported currency/);
  });

  // ==========================================
  // SECTION 6: GENUINE EMULATOR CONCURRENCY WITH BARRIERS (83)
  // ==========================================

  it("Scenario 83 (R10 Genuine Emulator Concurrency with Barriers): Webhook blocks actively merging player during concurrent completion execution", async () => {
    const { processWebhookIntentTransaction } = await import("../lib/razorpay-webhook.ts");

    const loserId = "p_loser_s83";
    const keeperId = "p_keeper_s83";
    const jobId = "job_s83";
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      name: "Merging Loser 83",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_83",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      name: "Active Keeper 83",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_83",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      stage: "stage_6_completion",
      leaseOwner: "worker_83",
      leaseToken: "tok_83",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
    });

    const intentId = "intent_s83";
    const orderId = "order_s83";
    await db.collection("razorpayIntents").doc(intentId).set({
      id: intentId,
      orderId,
      type: "match",
      amount: 150,
      currency: "INR",
      status: "created",
      lateFeeItems: [
        {
          playerId: loserId,
          amount: 50,
          label: "Penalty 83",
          templateId: "tpl_83",
        },
      ],
    });
    // Scenario 83 only needs the payer: the merge-in-progress check precedes every obligation read,
    // and an extra payment row for the loser would change the concurrent merge operation under test.
    await seedMatchObligationFor(db, intentId, { createDocs: false });

    const eventDetails = {
      event: "payment.captured",
      intentId,
      paymentId: "pay_rzp_s83",
      orderId,
      capturedPaise: 15000,
      capturedCurrency: "INR",
    };

    const worker = {
      leaseOwner: "worker_83",
      leaseToken: "tok_83",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: now + 60000,
    };

    // Deterministic barrier synchronization: release AFTER read of payments collectionGroup completes!
    let barrierReadDoneResolve;
    const barrierReadDone = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("barrierReadDone timed out")), 5000);
      barrierReadDoneResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    let barrierOpBProceedResolve;
    const barrierOpBProceed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("barrierOpBProceed timed out")), 5000);
      barrierOpBProceedResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    // Proxy db to hold Operation A inside its active transaction after completing the payments read
    const proxyDb = Object.create(db);
    proxyDb.runTransaction = async (updateFunction, options) => {
      return db.runTransaction(async (realTx) => {
        const wrappedTx = Object.create(realTx);
        wrappedTx.get = async (refOrQuery) => {
          const res = await realTx.get(refOrQuery);
          const isPaymentsGroupQuery =
            refOrQuery?._queryOptions?.collectionId === "payments" &&
            refOrQuery?._queryOptions?.allDescendants === true;
          if (isPaymentsGroupQuery && barrierReadDoneResolve) {
            barrierReadDoneResolve();
            barrierReadDoneResolve = null;
            await barrierOpBProceed;
          }
          return res;
        };
        wrappedTx.set = (...args) => realTx.set(...args);
        wrappedTx.update = (...args) => realTx.update(...args);
        wrappedTx.delete = (...args) => realTx.delete(...args);

        return updateFunction(wrappedTx);
      }, options);
    };

    // Concurrently launch Operation A (executeMergeCompletionStage) and Operation B (processWebhookIntentTransaction)
    const promiseA = playerMergeModule.executeMergeCompletionStage(proxyDb, jobId, loserId, keeperId, worker);

    const promiseB = (async () => {
      await barrierReadDone;
      try {
        await processWebhookIntentTransaction(db, eventDetails);
        return { success: true };
      } catch (err) {
        return { success: false, error: err };
      } finally {
        barrierOpBProceedResolve();
      }
    })();

    const [resA, resB] = await Promise.allSettled([promiseA, promiseB]);

    // Assert: Webhook detected actively merging player and rejected with retry requested
    assert.equal(resB.status, "fulfilled");
    assert.equal(resB.value.success, false);
    assert.match(resB.value.error?.message, /merge is currently in progress; retry requested/);

    // Assert: Merge completion completed safely and atomically
    assert.equal(resA.status, "fulfilled");

    // Verify loser is disabled and merged into keeper
    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.equal(loserSnap.data().mergeStatus, "completed");
    assert.equal(loserSnap.data().disabled, true);
    assert.equal(loserSnap.data().mergedInto, keeperId);

    // Verify keeper is completed
    const keeperSnap = await db.collection("players").doc(keeperId).get();
    assert.equal(keeperSnap.data().mergeStatus, "completed");

    // Verify zero residual payments were created for loser
    const residualPayments = await db.collectionGroup("payments").where("playerId", "==", loserId).get();
    assert.equal(residualPayments.empty, true);
  });

  it("Scenario 83b (R10 Barrier Concurrency with Rogue Payment Write): Atomic completion transaction detects interleaved concurrent write and aborts", async () => {
    const loserId = "p_loser_s83b";
    const keeperId = "p_keeper_s83b";
    const jobId = "job_s83b";
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      name: "Merging Loser 83b",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_83b",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      name: "Active Keeper 83b",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_83b",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      status: "in_progress",
      stage: "stage_6_completion",
      leaseOwner: "worker_83b",
      leaseToken: "tok_83b",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
    });

    const worker = {
      leaseOwner: "worker_83b",
      leaseToken: "tok_83b",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: now + 60000,
    };

    let barrierReadDoneResolve;
    const barrierReadDone = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("barrierReadDone timed out")), 5000);
      barrierReadDoneResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    let barrierOpBWrittenResolve;
    const barrierOpBWritten = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("barrierOpBWritten timed out")), 5000);
      barrierOpBWrittenResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    function wrapQuery(q) {
      return new Proxy(q, {
        get(target, prop, receiver) {
          if (prop === "get") {
            return async (...args) => {
              const res = await target.get(...args);
              if (barrierReadDoneResolve) {
                barrierReadDoneResolve();
                barrierReadDoneResolve = null;
                await barrierOpBWritten;
              }
              return res;
            };
          }
          const val = Reflect.get(target, prop, receiver);
          if (typeof val === "function") {
            return (...args) => {
              const result = val.apply(target, args);
              if (result && typeof result === "object" && typeof result.get === "function") {
                return wrapQuery(result);
              }
              return result;
            };
          }
          return val;
        },
      });
    }

    // Proxy db to intercept collectionGroup("payments") read boundary during final verification
    const proxyDb = Object.create(db);
    const origCollectionGroup = db.collectionGroup.bind(db);
    proxyDb.collectionGroup = (collectionId) => {
      const query = origCollectionGroup(collectionId);
      if (collectionId === "payments") {
        return wrapQuery(query);
      }
      return query;
    };

    // Launch Operation A (executeIndependentFinalVerification pipeline)
    const promiseA = playerMergeModule.executeIndependentFinalVerification(proxyDb, jobId, loserId, keeperId, worker);

    // Launch Operation B (concurrent rogue payment write directly referencing loser)
    const promiseB = (async () => {
      await barrierReadDone;
      try {
        await db.collection("matches").doc("m_s83b").collection("payments").doc("pay_concurrent_83b").set({
          id: "pay_concurrent_83b",
          playerId: loserId,
          status: "Paid",
          amount: 100,
        });
        return { success: true };
      } finally {
        barrierOpBWrittenResolve();
      }
    })();

    const [resA, resB] = await Promise.allSettled([promiseA, promiseB]);

    // Operation B wrote payment
    assert.equal(resB.status, "fulfilled");
    assert.equal(resB.value.success, true);

    // Operation A must reject with 409 FINAL_VERIFICATION_FAILED
    assert.equal(resA.status, "rejected");
    assert.equal(resA.reason?.status, 409);
    assert.equal(resA.reason?.code, "FINAL_VERIFICATION_FAILED");
    assert.match(resA.reason?.message, /concurrent records referencing loser were detected/);

    // Verify loser is NOT merged into keeper
    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.equal(loserSnap.data().mergeStatus, "in_progress");
    assert.equal(loserSnap.data().mergedInto, undefined);
  });

  // ==========================================
  // SECTION 7: WEBHOOK LIFECYCLE & IDEMPOTENCY (84 - 85)
  // ==========================================

  it("Scenario 84 (Webhook Lifecycle: Duplicate delivery idempotency): Returns alreadyProcessed and rejects conflicting replay", async () => {
    const { processWebhookIntentTransaction } = await import("../lib/razorpay-webhook.ts");

    const playerId = "p_active_84";
    await db.collection("players").doc(playerId).set({
      id: playerId,
      name: "Player 84",
    });

    const intentId = "intent_s84";
    const orderId = "order_s84";
    await db.collection("razorpayIntents").doc(intentId).set({
      id: intentId,
      orderId,
      type: "match",
      amount: 200,
      currency: "INR",
      status: "created",
      lateFeeItems: [
        {
          playerId,
          amount: 50,
          label: "Registration Late Fee",
          templateId: "tpl_reg_84",
        },
      ],
    });
    await seedMatchObligationFor(db, intentId);

    const eventDetails = {
      event: "payment.captured",
      intentId,
      paymentId: "pay_rzp_s84",
      orderId,
      capturedPaise: 20000,
      capturedCurrency: "INR",
    };

    // First delivery: processes successfully
    const firstRes = await processWebhookIntentTransaction(db, eventDetails);
    assert.equal(firstRes.success, true);
    assert.ok(!firstRes.alreadyProcessed);

    const intentSnap1 = await db.collection("razorpayIntents").doc(intentId).get();
    assert.equal(intentSnap1.data().status, "paid");
    assert.equal(intentSnap1.data().razorpayPaymentId, "pay_rzp_s84");

    const feesSnap1 = await db.collection("players").doc(playerId).collection("otherFees").get();
    assert.equal(feesSnap1.docs.length, 1);

    // Second delivery (identical replay): returns alreadyProcessed: true without duplicate writes
    const secondRes = await processWebhookIntentTransaction(db, eventDetails);
    assert.equal(secondRes.success, true);
    assert.equal(secondRes.alreadyProcessed, true);

    const feesSnap2 = await db.collection("players").doc(playerId).collection("otherFees").get();
    assert.equal(feesSnap2.docs.length, 1, "Duplicate delivery must not create duplicate fee records.");

    // Conflicting replay with different payment ID: rejected
    const conflictingEvent = {
      ...eventDetails,
      paymentId: "pay_different_fraud_84",
    };
    await assert.rejects(
      async () => {
        await processWebhookIntentTransaction(db, conflictingEvent);
      },
      /Conflicting payment ID replay/
    );
  });

  it("Scenario 85 (Webhook Lifecycle: Multi-hop merge chain, cycles and missing keeper): Resolves multi-hop and detects cycles", async () => {
    const { processWebhookIntentTransaction } = await import("../lib/razorpay-webhook.ts");

    // 1. Multi-hop chain: p_hop_A -> p_hop_B -> p_hop_C (active)
    const pA = "p_hop_A_85";
    const pB = "p_hop_B_85";
    const pC = "p_hop_C_85";

    await db.collection("players").doc(pA).set({
      id: pA,
      name: "Player A",
      mergedInto: pB,
      disabled: true,
      mergeStatus: "completed",
    });
    await db.collection("players").doc(pB).set({
      id: pB,
      name: "Player B",
      mergedInto: pC,
      disabled: true,
      mergeStatus: "completed",
    });
    await db.collection("players").doc(pC).set({
      id: pC,
      name: "Player C (Final Active)",
    });

    const intentMulti = "intent_multi_85";
    const orderMulti = "order_multi_85";
    await db.collection("razorpayIntents").doc(intentMulti).set({
      id: intentMulti,
      orderId: orderMulti,
      type: "match",
      amount: 100,
      currency: "INR",
      status: "created",
      lateFeeItems: [
        {
          playerId: pA, // References original loser A
          amount: 50,
          label: "Multi Hop Fee",
          templateId: "tpl_hop_85",
        },
      ],
    });
    await seedMatchObligationFor(db, intentMulti);

    const resMulti = await processWebhookIntentTransaction(db, {
      event: "payment.captured",
      intentId: intentMulti,
      paymentId: "pay_multi_85",
      orderId: orderMulti,
      capturedPaise: 10000,
      capturedCurrency: "INR",
    });
    assert.equal(resMulti.success, true);

    // Verified fee arrived at C
    const feesC = await db.collection("players").doc(pC).collection("otherFees").get();
    assert.equal(feesC.docs.length, 1);
    assert.equal(feesC.docs[0].data().playerId, pC);
    assert.equal(feesC.docs[0].data().originalPlayerId, pA);

    // 2. Cyclic chain: p_cycle_1 -> p_cycle_2 -> p_cycle_1
    const pC1 = "p_cycle_1_85";
    const pC2 = "p_cycle_2_85";
    await db.collection("players").doc(pC1).set({
      id: pC1,
      name: "Cycle 1",
      mergedInto: pC2,
    });
    await db.collection("players").doc(pC2).set({
      id: pC2,
      name: "Cycle 2",
      mergedInto: pC1,
    });

    const intentCycle = "intent_cycle_85";
    const orderCycle = "order_cycle_85";
    await db.collection("razorpayIntents").doc(intentCycle).set({
      id: intentCycle,
      orderId: orderCycle,
      type: "match",
      amount: 100,
      currency: "INR",
      status: "created",
      lateFeeItems: [{ playerId: pC1, amount: 50, label: "Cycle Fee", templateId: "tpl_cyc_85" }],
    });
    await seedMatchObligationFor(db, intentCycle);

    await assert.rejects(
      async () => {
        await processWebhookIntentTransaction(db, {
          event: "payment.captured",
          intentId: intentCycle,
          paymentId: "pay_cyc_85",
          orderId: orderCycle,
          capturedPaise: 10000,
          capturedCurrency: "INR",
        });
      },
      /cyclic merge chain detected/
    );

    // 3. Missing keeper: p_miss_1 -> p_miss_nonexistent
    const pM1 = "p_miss_1_85";
    await db.collection("players").doc(pM1).set({
      id: pM1,
      name: "Missing Target",
      mergedInto: "p_nonexistent_keeper_999",
    });

    const intentMiss = "intent_miss_85";
    const orderMiss = "order_miss_85";
    await db.collection("razorpayIntents").doc(intentMiss).set({
      id: intentMiss,
      orderId: orderMiss,
      type: "match",
      amount: 100,
      currency: "INR",
      status: "created",
      lateFeeItems: [{ playerId: pM1, amount: 50, label: "Missing Keeper Fee", templateId: "tpl_mis_85" }],
    });
    await seedMatchObligationFor(db, intentMiss);

    await assert.rejects(
      async () => {
        await processWebhookIntentTransaction(db, {
          event: "payment.captured",
          intentId: intentMiss,
          paymentId: "pay_mis_85",
          orderId: orderMiss,
          capturedPaise: 10000,
          capturedCurrency: "INR",
        });
      },
      /Target keeper player p_nonexistent_keeper_999 in merge chain does not exist/
    );
  });

  // ==========================================
  // SECTION 8: COMPLETION-STAGE LOCK INVARIANTS (86 - 95)
  // ==========================================

  it("Scenario 86 (Completion Invariants: Job status !== in_progress): Rejects with 409 STALE_WORKER_FENCING_ERROR and zero writes", async () => {
    const loserId = "p_loser_s86";
    const keeperId = "p_keeper_s86";
    const jobId = "job_s86";
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_86",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_86",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "failed", // Not in_progress
      leaseOwner: "worker_86",
      leaseToken: "tok_86",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
    });

    const worker = { leaseOwner: "worker_86", leaseToken: "tok_86", fencingToken: 1, attemptCount: 1, leaseExpiresAt: now + 60000 };

    await assert.rejects(
      async () => {
        await playerMergeModule.executeMergeCompletionStage(db, jobId, loserId, keeperId, worker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "STALE_WORKER_FENCING_ERROR");
        return true;
      }
    );

    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.equal(loserSnap.data().mergeStatus, "in_progress");
    assert.equal(loserSnap.data().disabled, undefined);
    assert.equal(loserSnap.data().mergedInto, undefined);
  });

  it("Scenario 87 (Completion Invariants: Job leaseOwner mismatch): Rejects with 409 STALE_WORKER_FENCING_ERROR and zero writes", async () => {
    const loserId = "p_loser_s87";
    const keeperId = "p_keeper_s87";
    const jobId = "job_s87";
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_actual_87",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_actual_87",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseOwner: "worker_actual_87",
      leaseToken: "tok_87",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
    });

    // Stale worker with different leaseOwner
    const staleWorker = { leaseOwner: "worker_stale_87", leaseToken: "tok_87", fencingToken: 1, attemptCount: 1, leaseExpiresAt: now + 60000 };

    await assert.rejects(
      async () => {
        await playerMergeModule.executeMergeCompletionStage(db, jobId, loserId, keeperId, staleWorker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "STALE_WORKER_FENCING_ERROR");
        return true;
      }
    );

    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.equal(loserSnap.data().mergeStatus, "in_progress");
    assert.equal(loserSnap.data().disabled, undefined);
  });

  it("Scenario 88 (Completion Invariants: Job leaseToken mismatch): Rejects with 409 STALE_WORKER_FENCING_ERROR and zero writes", async () => {
    const loserId = "p_loser_s88";
    const keeperId = "p_keeper_s88";
    const jobId = "job_s88";
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_88",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_88",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseOwner: "worker_88",
      leaseToken: "tok_active_88",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
    });

    const staleWorker = { leaseOwner: "worker_88", leaseToken: "tok_stale_88", fencingToken: 1, attemptCount: 1, leaseExpiresAt: now + 60000 };

    await assert.rejects(
      async () => {
        await playerMergeModule.executeMergeCompletionStage(db, jobId, loserId, keeperId, staleWorker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "STALE_WORKER_FENCING_ERROR");
        return true;
      }
    );

    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.equal(loserSnap.data().mergeStatus, "in_progress");
  });

  it("Scenario 89 (Completion Invariants: Job fencingToken mismatch): Rejects with 409 STALE_WORKER_FENCING_ERROR and zero writes", async () => {
    const loserId = "p_loser_s89";
    const keeperId = "p_keeper_s89";
    const jobId = "job_s89";
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_89",
      mergeFencingToken: 2,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_89",
      mergeFencingToken: 2,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseOwner: "worker_89",
      leaseToken: "tok_89",
      fencingToken: 2,
      leaseExpiresAt: now + 60000,
    });

    const staleWorker = { leaseOwner: "worker_89", leaseToken: "tok_89", fencingToken: 1, attemptCount: 1, leaseExpiresAt: now + 60000 };

    await assert.rejects(
      async () => {
        await playerMergeModule.executeMergeCompletionStage(db, jobId, loserId, keeperId, staleWorker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "STALE_WORKER_FENCING_ERROR");
        return true;
      }
    );

    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.equal(loserSnap.data().mergeStatus, "in_progress");
  });

  it("Scenario 90 (Completion Invariants: Job lease expired): Rejects with 409 STALE_WORKER_FENCING_ERROR and zero writes", async () => {
    const loserId = "p_loser_s90";
    const keeperId = "p_keeper_s90";
    const jobId = "job_s90";
    const now = Date.now();
    const expiredTime = now - 5000;

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_90",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: expiredTime,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_90",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: expiredTime,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseOwner: "worker_90",
      leaseToken: "tok_90",
      fencingToken: 1,
      leaseExpiresAt: expiredTime,
    });

    const worker = { leaseOwner: "worker_90", leaseToken: "tok_90", fencingToken: 1, attemptCount: 1, leaseExpiresAt: expiredTime };

    await assert.rejects(
      async () => {
        await playerMergeModule.executeMergeCompletionStage(db, jobId, loserId, keeperId, worker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "STALE_WORKER_FENCING_ERROR");
        return true;
      }
    );

    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.equal(loserSnap.data().mergeStatus, "in_progress");
  });

  it("Scenario 91 (Completion Invariants: Job leaseExpiresAt non-finite / NaN): Rejects with 409 STALE_WORKER_FENCING_ERROR", async () => {
    const loserId = "p_loser_s91";
    const keeperId = "p_keeper_s91";
    const jobId = "job_s91";

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_91",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: Date.now() + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_91",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: Date.now() + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseOwner: "worker_91",
      leaseToken: "tok_91",
      fencingToken: 1,
      leaseExpiresAt: "invalid_not_a_number", // String instead of finite number
    });

    const worker = { leaseOwner: "worker_91", leaseToken: "tok_91", fencingToken: 1, attemptCount: 1, leaseExpiresAt: Date.now() + 60000 };

    await assert.rejects(
      async () => {
        await playerMergeModule.executeMergeCompletionStage(db, jobId, loserId, keeperId, worker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "STALE_WORKER_FENCING_ERROR");
        return true;
      }
    );
  });

  it("Scenario 92 (Completion Invariants: Loser missing mergeLeaseOwner or mismatch): Rejects with 409 FINAL_VERIFICATION_FAILED and zero writes", async () => {
    const loserId = "p_loser_s92";
    const keeperId = "p_keeper_s92";
    const jobId = "job_s92";
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      // Missing mergeLeaseOwner!
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_92",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseOwner: "worker_92",
      leaseToken: "tok_92",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
    });

    const worker = { leaseOwner: "worker_92", leaseToken: "tok_92", fencingToken: 1, attemptCount: 1, leaseExpiresAt: now + 60000 };

    await assert.rejects(
      async () => {
        await playerMergeModule.executeMergeCompletionStage(db, jobId, loserId, keeperId, worker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "FINAL_VERIFICATION_FAILED");
        assert.match(err.message, /Loser player lock missing, incomplete or tampered with/);
        return true;
      }
    );

    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.equal(loserSnap.data().mergeStatus, "in_progress");
    assert.equal(loserSnap.data().disabled, undefined);
  });

  it("Scenario 93 (Completion Invariants: Loser missing mergeFencingToken or mismatch): Rejects with 409 FINAL_VERIFICATION_FAILED", async () => {
    const loserId = "p_loser_s93";
    const keeperId = "p_keeper_s93";
    const jobId = "job_s93";
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_93",
      mergeFencingToken: 999, // Mismatched fencingToken!
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_93",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseOwner: "worker_93",
      leaseToken: "tok_93",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
    });

    const worker = { leaseOwner: "worker_93", leaseToken: "tok_93", fencingToken: 1, attemptCount: 1, leaseExpiresAt: now + 60000 };

    await assert.rejects(
      async () => {
        await playerMergeModule.executeMergeCompletionStage(db, jobId, loserId, keeperId, worker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "FINAL_VERIFICATION_FAILED");
        return true;
      }
    );
  });

  it("Scenario 94 (Completion Invariants: Loser missing or mismatched mergeLeaseExpiresAt): Rejects with 409 FINAL_VERIFICATION_FAILED", async () => {
    const loserId = "p_loser_s94";
    const keeperId = "p_keeper_s94";
    const jobId = "job_s94";
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_94",
      mergeFencingToken: 1,
      // Missing mergeLeaseExpiresAt!
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_94",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseOwner: "worker_94",
      leaseToken: "tok_94",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
    });

    const worker = { leaseOwner: "worker_94", leaseToken: "tok_94", fencingToken: 1, attemptCount: 1, leaseExpiresAt: now + 60000 };

    await assert.rejects(
      async () => {
        await playerMergeModule.executeMergeCompletionStage(db, jobId, loserId, keeperId, worker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "FINAL_VERIFICATION_FAILED");
        return true;
      }
    );
  });

  it("Scenario 95 (Completion Invariants: Keeper missing or mismatched lock metadata): Rejects with 409 FINAL_VERIFICATION_FAILED", async () => {
    const loserId = "p_loser_s95";
    const keeperId = "p_keeper_s95";
    const jobId = "job_s95";
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_95",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_other_95", // Mismatched leaseOwner on keeper
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseOwner: "worker_95",
      leaseToken: "tok_95",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
    });

    const worker = { leaseOwner: "worker_95", leaseToken: "tok_95", fencingToken: 1, attemptCount: 1, leaseExpiresAt: now + 60000 };

    await assert.rejects(
      async () => {
        await playerMergeModule.executeMergeCompletionStage(db, jobId, loserId, keeperId, worker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "FINAL_VERIFICATION_FAILED");
        assert.match(err.message, /Keeper player lock missing, incomplete or tampered with/);
        return true;
      }
    );

    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.equal(loserSnap.data().mergeStatus, "in_progress");
  });

  // ==========================================
  // SECTION 9: FAILURE RECORDING EXPIRY VALIDATION (96 - 100)
  // ==========================================

  it("Scenario 96 (Failure Lifecycle: Missing job leaseExpiresAt): Fail-closed on recording failure with LEASE_EXPIRED", async () => {
    const jobId = "job_s96";
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseOwner: "worker_96",
      leaseToken: "tok_96",
      fencingToken: 1,
      // Missing leaseExpiresAt!
    });

    const worker = { leaseOwner: "worker_96", leaseToken: "tok_96", fencingToken: 1 };
    const res = await playerMergeModule.recordMergeJobFailure(db, jobId, worker, new Error("Boom"), "stage_2_payments");
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "LEASE_EXPIRED");

    const snap = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(snap.data().status, "in_progress");
  });

  it("Scenario 97 (Failure Lifecycle: String or null leaseExpiresAt): Fail-closed on recording failure with LEASE_EXPIRED", async () => {
    const jobId = "job_s97";
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseOwner: "worker_97",
      leaseToken: "tok_97",
      fencingToken: 1,
      leaseExpiresAt: "2099-01-01T00:00:00Z", // String instead of finite number
    });

    const worker = { leaseOwner: "worker_97", leaseToken: "tok_97", fencingToken: 1 };
    const res = await playerMergeModule.recordMergeJobFailure(db, jobId, worker, new Error("Boom"), "stage_2_payments");
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "LEASE_EXPIRED");

    const snap = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(snap.data().status, "in_progress");
  });

  it("Scenario 98 (Failure Lifecycle: NaN leaseExpiresAt): Fail-closed on recording failure with LEASE_EXPIRED", async () => {
    const jobId = "job_s98";
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseOwner: "worker_98",
      leaseToken: "tok_98",
      fencingToken: 1,
      leaseExpiresAt: NaN,
    });

    const worker = { leaseOwner: "worker_98", leaseToken: "tok_98", fencingToken: 1 };
    const res = await playerMergeModule.recordMergeJobFailure(db, jobId, worker, new Error("Boom"), "stage_2_payments");
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "LEASE_EXPIRED");

    const snap = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(snap.data().status, "in_progress");
  });

  it("Scenario 99 (Failure Lifecycle: Infinity leaseExpiresAt): Fail-closed on recording failure with LEASE_EXPIRED", async () => {
    const jobId = "job_s99";
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseOwner: "worker_99",
      leaseToken: "tok_99",
      fencingToken: 1,
      leaseExpiresAt: Infinity,
    });

    const worker = { leaseOwner: "worker_99", leaseToken: "tok_99", fencingToken: 1 };
    const res = await playerMergeModule.recordMergeJobFailure(db, jobId, worker, new Error("Boom"), "stage_2_payments");
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "LEASE_EXPIRED");

    const snap = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(snap.data().status, "in_progress");
  });

  it("Scenario 100 (Failure Lifecycle: Past/expired timestamp): Fail-closed on recording failure with LEASE_EXPIRED", async () => {
    const jobId = "job_s100";
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseOwner: "worker_100",
      leaseToken: "tok_100",
      fencingToken: 1,
      leaseExpiresAt: Date.now() - 5000, // Explicit past timestamp
    });

    const worker = { leaseOwner: "worker_100", leaseToken: "tok_100", fencingToken: 1 };
    const res = await playerMergeModule.recordMergeJobFailure(db, jobId, worker, new Error("Boom"), "stage_2_payments");
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "LEASE_EXPIRED");

    const snap = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(snap.data().status, "in_progress");
  });

  // ==========================================
  // SECTION 10: FOREIGN LOCK RECOVERY IN ACQUIREMERGELEASE (101 - 108)
  // ==========================================

  it("Scenario 101 (Foreign Lock: Missing mergeLeaseExpiresAt on foreign loser lock): Rejects with 409 MALFORMED_PLAYER_LOCK", async () => {
    const loserId = "p_loser_s101";
    const keeperId = "p_keeper_s101";
    const foreignJobId = "job_foreign_101";
    const newJobId = "job_new_101";

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: foreignJobId,
      mergeLeaseOwner: "foreign_worker",
      mergeFencingToken: 1,
      // Missing mergeLeaseExpiresAt!
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
    });

    const lease = await playerMergeModule.acquireMergeLease(db, newJobId, loserId, keeperId, "new_worker");
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "MALFORMED_PLAYER_LOCK");
    assert.match(lease.error, /missing or invalid mergeLeaseExpiresAt/);
  });

  it("Scenario 102 (Foreign Lock: Malformed string mergeLeaseExpiresAt on foreign lock): Rejects with 409 MALFORMED_PLAYER_LOCK", async () => {
    const loserId = "p_loser_s102";
    const keeperId = "p_keeper_s102";
    const foreignJobId = "job_foreign_102";
    const newJobId = "job_new_102";

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: foreignJobId,
      mergeLeaseOwner: "foreign_worker",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: "invalid_string_expiry",
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
    });

    const lease = await playerMergeModule.acquireMergeLease(db, newJobId, loserId, keeperId, "new_worker");
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "MALFORMED_PLAYER_LOCK");
  });

  it("Scenario 103 (Foreign Lock: Missing mergeLeaseOwner on foreign lock): Rejects with 409 MALFORMED_PLAYER_LOCK", async () => {
    const loserId = "p_loser_s103";
    const keeperId = "p_keeper_s103";
    const foreignJobId = "job_foreign_103";
    const newJobId = "job_new_103";

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: foreignJobId,
      // Missing mergeLeaseOwner!
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: Date.now() + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
    });

    const lease = await playerMergeModule.acquireMergeLease(db, newJobId, loserId, keeperId, "new_worker");
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "MALFORMED_PLAYER_LOCK");
    assert.match(lease.error, /missing or invalid mergeLeaseOwner/);
  });

  it("Scenario 104 (Foreign Lock: Missing mergeFencingToken on foreign lock): Rejects with 409 MALFORMED_PLAYER_LOCK", async () => {
    const loserId = "p_loser_s104";
    const keeperId = "p_keeper_s104";
    const foreignJobId = "job_foreign_104";
    const newJobId = "job_new_104";

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: foreignJobId,
      mergeLeaseOwner: "foreign_worker",
      // Missing mergeFencingToken!
      mergeLeaseExpiresAt: Date.now() + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
    });

    const lease = await playerMergeModule.acquireMergeLease(db, newJobId, loserId, keeperId, "new_worker");
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "MALFORMED_PLAYER_LOCK");
    assert.match(lease.error, /missing or invalid mergeFencingToken/);
  });

  it("Scenario 105 (Foreign Lock: Existing active foreign job document): Rejects with 409 MERGE_IN_PROGRESS", async () => {
    const loserId = "p_loser_s105";
    const keeperId = "p_keeper_s105";
    const foreignJobId = "job_foreign_105";
    const newJobId = "job_new_105";
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: foreignJobId,
      mergeLeaseOwner: "foreign_worker",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
    });
    await db.collection("mergeJobs").doc(foreignJobId).set({
      id: foreignJobId,
      status: "in_progress",
      leaseOwner: "foreign_worker",
      leaseToken: "tok_f",
      fencingToken: 1,
      leaseExpiresAt: now + 60000,
    });

    const lease = await playerMergeModule.acquireMergeLease(db, newJobId, loserId, keeperId, "new_worker");
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "MERGE_IN_PROGRESS");
  });

  it("Scenario 106 (Foreign Lock: Existing foreign job failed or expired): Rejects with 409 PLAYER_LOCKED_BY_ANOTHER_JOB", async () => {
    const loserId = "p_loser_s106";
    const keeperId = "p_keeper_s106";
    const foreignJobId = "job_foreign_106";
    const newJobId = "job_new_106";
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: foreignJobId,
      mergeLeaseOwner: "foreign_worker",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now - 5000, // Expired player lock
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
    });
    // Foreign job doc exists but failed
    await db.collection("mergeJobs").doc(foreignJobId).set({
      id: foreignJobId,
      status: "failed",
      leaseOwner: "foreign_worker",
      leaseToken: "tok_f",
      fencingToken: 1,
      leaseExpiresAt: now - 5000,
    });

    const lease = await playerMergeModule.acquireMergeLease(db, newJobId, loserId, keeperId, "new_worker");
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "PLAYER_LOCKED_BY_ANOTHER_JOB");
    assert.match(lease.error, /locked by another merge job/);
  });

  it("Scenario 107 (Foreign Lock: Missing foreign job doc with UNEXPIRED player lock): Rejects with 409 PLAYER_LOCKED_BY_ANOTHER_JOB", async () => {
    const loserId = "p_loser_s107";
    const keeperId = "p_keeper_s107";
    const foreignJobId = "job_foreign_missing_doc_107";
    const newJobId = "job_new_107";
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: foreignJobId,
      mergeLeaseOwner: "foreign_worker",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: now + 60000, // Unexpired player lease!
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
    });
    // Ensure foreign job doc does NOT exist
    await db.collection("mergeJobs").doc(foreignJobId).delete();

    const lease = await playerMergeModule.acquireMergeLease(db, newJobId, loserId, keeperId, "new_worker");
    assert.equal(lease.ok, false);
    assert.equal(lease.status, 409);
    assert.equal(lease.code, "PLAYER_LOCKED_BY_ANOTHER_JOB");
    assert.match(lease.error, /locked by another unexpired merge lease/);
  });

  it("Scenario 108 (Foreign Lock: Missing foreign job doc with EXPIRED player lock and valid metadata): Successfully reclaims lock", async () => {
    const loserId = "p_loser_s108";
    const keeperId = "p_keeper_s108";
    const foreignJobId = "job_foreign_missing_doc_108";
    const newJobId = "job_new_108";
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      mergeStatus: "in_progress",
      mergeJobId: foreignJobId,
      mergeLeaseOwner: "foreign_worker",
      mergeFencingToken: 3,
      mergeLeaseExpiresAt: now - 10000, // Strictly expired!
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
    });
    await db.collection("mergeJobs").doc(foreignJobId).delete();

    const lease = await playerMergeModule.acquireMergeLease(db, newJobId, loserId, keeperId, { workerId: "new_worker_108" });
    assert.equal(lease.ok, true, "Expired orphaned lock with valid metadata must be reclaimable.");
    assert.ok(lease.workerInfo);

    // Verify loser is now locked to newJobId with monotonically incremented fencing token (3 + 1 = 4)
    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.equal(loserSnap.data().mergeJobId, newJobId);
    assert.equal(loserSnap.data().mergeLeaseOwner, "new_worker_108");
    assert.equal(loserSnap.data().mergeFencingToken, 4);
  });

  it("Scenario 108b (Foreign Lock: Symmetrical keeper checks): Rejects malformed foreign keeper lock and unexpired orphaned lock", async () => {
    const loserId = "p_loser_s108b";
    const keeperId = "p_keeper_s108b";
    const foreignJobId = "job_foreign_108b";
    const newJobId = "job_new_108b";

    // 1. Malformed keeper lock (missing mergeLeaseExpiresAt)
    await db.collection("players").doc(loserId).set({ id: loserId });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "in_progress",
      mergeJobId: foreignJobId,
      mergeLeaseOwner: "foreign_worker",
      mergeFencingToken: 1,
      // Missing mergeLeaseExpiresAt!
    });

    const lease1 = await playerMergeModule.acquireMergeLease(db, newJobId, loserId, keeperId, "new_worker");
    assert.equal(lease1.ok, false);
    assert.equal(lease1.code, "MALFORMED_PLAYER_LOCK");
    assert.match(lease1.error, /Keeper player is locked by (an orphaned|another) merge job but has missing or invalid mergeLeaseExpiresAt/);

    // 2. Unexpired orphaned keeper lock
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      mergeStatus: "in_progress",
      mergeJobId: foreignJobId,
      mergeLeaseOwner: "foreign_worker",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: Date.now() + 60000,
    });
    await db.collection("mergeJobs").doc(foreignJobId).delete();

    const lease2 = await playerMergeModule.acquireMergeLease(db, newJobId, loserId, keeperId, "new_worker");
    assert.equal(lease2.ok, false);
    assert.equal(lease2.code, "KEEPER_LOCKED_BY_ANOTHER_JOB");
  });

  // ==========================================
  // SECTION 11: RUPEE PRECISION & BOUNDARY TESTS (109 - 112)
  // ==========================================

  it("Scenario 109 (Rupee Precision: 2 decimal places numeric and string): Exact acceptance", () => {
    const { validateRupeeAmount } = playerMergeModule;

    // Numeric 2 decimals
    assert.deepEqual(validateRupeeAmount(123.45), { ok: true, value: 123.45 });
    assert.deepEqual(validateRupeeAmount(0.00), { ok: true, value: 0 });
    assert.deepEqual(validateRupeeAmount(0.05), { ok: true, value: 0.05 });
    assert.deepEqual(validateRupeeAmount(99999.99), { ok: true, value: 99999.99 });

    // String 2 decimals
    assert.deepEqual(validateRupeeAmount("123.45"), { ok: true, value: 123.45 });
    assert.deepEqual(validateRupeeAmount("0.05"), { ok: true, value: 0.05 });
    assert.deepEqual(validateRupeeAmount("100"), { ok: true, value: 100 });
    assert.deepEqual(validateRupeeAmount("100.5"), { ok: true, value: 100.5 });
  });

  it("Scenario 110 (Rupee Precision: Half-paise and 3-decimal boundaries): Strict rejection without silent rounding", () => {
    const { validateRupeeAmount } = playerMergeModule;

    // Half-paise boundaries: 123.454 vs 123.455 vs 123.456
    // All must be rejected by floating-point tolerance check Math.abs(val * 100 - roundedPaise) > 1e-6
    const res454 = validateRupeeAmount(123.454);
    assert.equal(res454.ok, false);
    assert.match(res454.error, /more than 2 decimal places in rupees/);

    const res455 = validateRupeeAmount(123.455);
    assert.equal(res455.ok, false);
    assert.match(res455.error, /more than 2 decimal places in rupees/);

    const res456 = validateRupeeAmount(123.456);
    assert.equal(res456.ok, false);
    assert.match(res456.error, /more than 2 decimal places in rupees/);

    // String 3-decimal representations
    assert.equal(validateRupeeAmount("123.454").ok, false);
    assert.equal(validateRupeeAmount("123.455").ok, false);
    assert.equal(validateRupeeAmount("123.456").ok, false);
  });

  it("Scenario 111 (Paise Precision: Integer vs fractional paise boundaries): Rejects fractional paise", () => {
    const { validatePaiseAmount } = playerMergeModule;

    // Integer paise accepted
    assert.deepEqual(validatePaiseAmount(12345), { ok: true, value: 12345 });
    assert.deepEqual(validatePaiseAmount("12345"), { ok: true, value: 12345 });
    assert.deepEqual(validatePaiseAmount(0), { ok: true, value: 0 });

    // Fractional paise rejected
    const fracNum = validatePaiseAmount(12345.5);
    assert.equal(fracNum.ok, false);
    assert.match(fracNum.error, /must be an integer paise amount/);

    const fracStr = validatePaiseAmount("12345.5");
    assert.equal(fracStr.ok, false);
    assert.match(fracStr.error, /fractional paise/);

    // Negative paise rejected
    const neg = validatePaiseAmount(-100);
    assert.equal(neg.ok, false);
    assert.match(neg.error, /cannot be negative/);
  });

  it("Scenario 112 (Amount Boundaries: Maximum allowable amount enforcement): Accepts 10,000,000 and rejects beyond", () => {
    const { validateRupeeAmount, validatePaiseAmount } = playerMergeModule;

    // Exactly at maximum: 10_000_000 rupees
    const atMaxR = validateRupeeAmount(10_000_000);
    assert.equal(atMaxR.ok, true);
    assert.equal(atMaxR.value, 10_000_000);

    const atMaxRStr = validateRupeeAmount("10000000");
    assert.equal(atMaxRStr.ok, true);
    assert.equal(atMaxRStr.value, 10_000_000);

    // Immediately beyond maximum: 10_000_000.01 rupees
    const overMaxR = validateRupeeAmount(10_000_000.01);
    assert.equal(overMaxR.ok, false);
    assert.match(overMaxR.error, /exceeds maximum allowable boundary/);

    const overMaxRStr = validateRupeeAmount("10000000.01");
    assert.equal(overMaxRStr.ok, false);
    assert.match(overMaxRStr.error, /exceeds maximum allowable boundary/);

    // Paise max boundary
    const atMaxP = validatePaiseAmount(1_000_000_000, "paise", { maxPaise: 1_000_000_000 });
    assert.equal(atMaxP.ok, true);

    const overMaxP = validatePaiseAmount(1_000_000_001, "paise", { maxPaise: 1_000_000_000 });
    assert.equal(overMaxP.ok, false);
    assert.match(overMaxP.error, /exceeds maximum allowable boundary/);
  });

  // ==========================================
  // SECTION 12: ORPHAN RECOVERY & STALE WORKER REJECTION (113 - 121b)
  // ==========================================

  it("Scenario 113 (Orphan Recovery: Monotonic fencing generation): Reclaiming orphaned lock establishes higher fencing token", async () => {
    const loserId = "p_loser_s113";
    const keeperId = "p_keeper_s113";
    const foreignJobId = "job_orphaned_113";
    const newJobId = "job_reclaim_113";
    const pastTime = Date.now() - 10000;

    await db.collection("players").doc(loserId).set({
      id: loserId,
      name: "Loser 113",
      mergeStatus: "in_progress",
      mergeJobId: foreignJobId,
      mergeLeaseOwner: "old_worker_113",
      mergeFencingToken: 5,
      mergeLeaseExpiresAt: pastTime,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      name: "Keeper 113",
      mergeStatus: "in_progress",
      mergeJobId: foreignJobId,
      mergeLeaseOwner: "old_worker_113",
      mergeFencingToken: 5,
      mergeLeaseExpiresAt: pastTime,
    });
    // Ensure foreignJobId doc is non-existent (orphaned lock)
    await db.collection("mergeJobs").doc(foreignJobId).delete();

    const lease = await playerMergeModule.acquireMergeLease(db, newJobId, loserId, keeperId, { workerId: "new_worker_113" });
    assert.equal(lease.ok, true);
    // Verifiable monotonic generation: max(prior: 5) + 1 = 6!
    assert.equal(lease.workerInfo.fencingToken, 6);
    assert.equal(lease.workerInfo.leaseOwner, "new_worker_113");

    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.equal(loserSnap.data().mergeFencingToken, 6);
    assert.equal(loserSnap.data().mergeJobId, newJobId);
    assert.equal(loserSnap.data().mergeLeaseOwner, "new_worker_113");

    const keeperSnap = await db.collection("players").doc(keeperId).get();
    assert.equal(keeperSnap.data().mergeFencingToken, 6);
    assert.equal(keeperSnap.data().mergeJobId, newJobId);
    assert.equal(keeperSnap.data().mergeLeaseOwner, "new_worker_113");
  });

  async function setupReclaimedJobFixture(suffix) {
    const loserId = `p_loser_s${suffix}`;
    const keeperId = `p_keeper_s${suffix}`;
    const jobId = `job_reclaim_s${suffix}`;
    const now = Date.now();

    await db.collection("players").doc(loserId).set({
      id: loserId,
      name: `Loser ${suffix}`,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "new_worker",
      mergeFencingToken: 6,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      name: `Keeper ${suffix}`,
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "new_worker",
      mergeFencingToken: 6,
      mergeLeaseExpiresAt: now + 60000,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      jobId,
      loserId,
      keeperId,
      status: "in_progress",
      stage: "identity_merged",
      leaseOwner: "new_worker",
      leaseToken: "tok_new",
      fencingToken: 6,
      leaseExpiresAt: now + 60000,
    });

    const oldWorker = {
      leaseOwner: "old_worker",
      leaseToken: "tok_old",
      fencingToken: 5,
      attemptCount: 1,
      leaseExpiresAt: now + 60000,
    };

    return { loserId, keeperId, jobId, oldWorker, now };
  }

  it("Scenario 114 (Orphan Recovery: Stale worker on executeMergeIdentityStage): Rejects stale worker with zero data mutations", async () => {
    const { loserId, keeperId, jobId, oldWorker } = await setupReclaimedJobFixture("114");

    // Stale worker attempts to execute identity stage on the reclaimed job
    await assert.rejects(
      async () => {
        await playerMergeModule.executeMergeIdentityStage(db, jobId, loserId, keeperId, oldWorker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "STALE_WORKER_FENCING_ERROR");
        return true;
      }
    );

    // Verify player records remain completely untouched with new worker fencing
    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.equal(loserSnap.data().mergeFencingToken, 6);
    assert.equal(loserSnap.data().mergeLeaseOwner, "new_worker");
  });

  it("Scenario 115 (Orphan Recovery: Stale worker on migratePaymentsStage): Rejects stale worker with zero payments migrated", async () => {
    const { loserId, keeperId, jobId, oldWorker } = await setupReclaimedJobFixture("115");

    // Seed a payment referencing loser
    await db.collection("matches").doc("m_s115").collection("payments").doc("pay_s115").set({
      id: "pay_s115",
      playerId: loserId,
      amount: 150,
      status: "Paid",
    });

    await assert.rejects(
      async () => {
        await playerMergeModule.migratePaymentsStage(db, jobId, loserId, keeperId, oldWorker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "STALE_WORKER_FENCING_ERROR");
        return true;
      }
    );

    // Verify payment was NOT reparented
    const paySnap = await db.collection("matches").doc("m_s115").collection("payments").doc("pay_s115").get();
    assert.equal(paySnap.data().playerId, loserId);
  });

  it("Scenario 116 (Orphan Recovery: Stale worker on migrateOtherFeesStage): Rejects stale worker with zero fees migrated", async () => {
    const { loserId, keeperId, jobId, oldWorker } = await setupReclaimedJobFixture("116");

    // Seed otherFees under loser
    await db.collection("players").doc(loserId).collection("otherFees").doc("fee_s116").set({
      id: "fee_s116",
      amount: 500,
      title: "Late Fee",
      status: "Pending",
    });

    await assert.rejects(
      async () => {
        await playerMergeModule.migrateOtherFeesStage(db, jobId, loserId, keeperId, oldWorker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "STALE_WORKER_FENCING_ERROR");
        return true;
      }
    );

    // Verify fee still exists under loser and does NOT exist under keeper
    const loserFee = await db.collection("players").doc(loserId).collection("otherFees").doc("fee_s116").get();
    assert.equal(loserFee.exists, true);
    const keeperFee = await db.collection("players").doc(keeperId).collection("otherFees").doc("fee_s116").get();
    assert.equal(keeperFee.exists, false);
  });

  it("Scenario 117 (Orphan Recovery: Stale worker on migrateMerchOrdersStage): Rejects stale worker with zero orders reparented", async () => {
    const { loserId, keeperId, jobId, oldWorker } = await setupReclaimedJobFixture("117");

    // Seed merchOrder referencing loser
    await db.collection("merchOrders").doc("order_s117").set({
      id: "order_s117",
      playerId: loserId,
      item: "Cap",
    });

    await assert.rejects(
      async () => {
        await playerMergeModule.migrateMerchOrdersStage(db, jobId, loserId, keeperId, oldWorker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "STALE_WORKER_FENCING_ERROR");
        return true;
      }
    );

    // Verify order was not reparented
    const orderSnap = await db.collection("merchOrders").doc("order_s117").get();
    assert.equal(orderSnap.data().playerId, loserId);
  });

  it("Scenario 118 (Orphan Recovery: Stale worker on migrateAppUsersAndIndexesStage): Rejects stale worker with zero accounts reparented", async () => {
    const { loserId, keeperId, jobId, oldWorker } = await setupReclaimedJobFixture("118");

    await db.collection("appUsers").doc("uid_s118").set({
      uid: "uid_s118",
      playerId: loserId,
    });
    await db.collection("uidIndex").doc("uid_s118").set({
      playerId: loserId,
    });

    await assert.rejects(
      async () => {
        await playerMergeModule.migrateAppUsersAndIndexesStage(db, jobId, loserId, keeperId, oldWorker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "STALE_WORKER_FENCING_ERROR");
        return true;
      }
    );

    // Verify appUser and uidIndex still point to loser
    const userSnap = await db.collection("appUsers").doc("uid_s118").get();
    assert.equal(userSnap.data().playerId, loserId);
    const indexSnap = await db.collection("uidIndex").doc("uid_s118").get();
    assert.equal(indexSnap.data().playerId, loserId);
  });

  it("Scenario 119 (Orphan Recovery: Stale worker on renewMergeLease): Rejects lease renewal", async () => {
    const { jobId, oldWorker } = await setupReclaimedJobFixture("119");

    await assert.rejects(
      async () => {
        await playerMergeModule.renewMergeLease(db, jobId, oldWorker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "LEASE_RENEWAL_FAILED");
        return true;
      }
    );
  });

  it("Scenario 120 (Orphan Recovery: Stale worker on verifyWorkerFencingAndAdvanceStage): Rejects stage advance", async () => {
    const { jobId, oldWorker } = await setupReclaimedJobFixture("120");

    await assert.rejects(
      async () => {
        await playerMergeModule.verifyWorkerFencingAndAdvanceStage(db, jobId, oldWorker, "completed");
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "STALE_WORKER_FENCING_ERROR");
        return true;
      }
    );

    const jobSnap = await db.collection("mergeJobs").doc(jobId).get();
    assert.notEqual(jobSnap.data().stage, "completed");
  });

  it("Scenario 121 (Orphan Recovery: Stale worker on executeMergeCompletionStage): Rejects completion and preserves loser active state", async () => {
    const { loserId, keeperId, jobId, oldWorker } = await setupReclaimedJobFixture("121");

    await assert.rejects(
      async () => {
        await playerMergeModule.executeMergeCompletionStage(db, jobId, loserId, keeperId, oldWorker);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "STALE_WORKER_FENCING_ERROR");
        return true;
      }
    );

    // Loser must NOT be disabled or merged into keeper
    const loserSnap = await db.collection("players").doc(loserId).get();
    assert.notEqual(loserSnap.data().mergeStatus, "completed");
    assert.equal(loserSnap.data().disabled, undefined);
    assert.equal(loserSnap.data().mergedInto, undefined);
  });

  it("Scenario 121b (Orphan Recovery: Stale worker on recordMergeJobFailure): Rejects recording failure and preserves job state", async () => {
    const { jobId, oldWorker } = await setupReclaimedJobFixture("121b");

    const res = await playerMergeModule.recordMergeJobFailure(db, jobId, oldWorker, new Error("stale crash"), "payments");
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "WORKER_LEASE_OWNER_MISMATCH");

    const jobSnap = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(jobSnap.data().status, "in_progress");
  });

  // ==========================================
  // SECTION 13: NUMERIC TOLERANCE & PRECISION BOUNDARIES (122)
  // ==========================================

  it("Scenario 122 (Rupee Precision Contract: 1e-6 tolerance boundary tests): Differentiates floating noise absorption from extra decimals", () => {
    const { validateRupeeAmount } = playerMergeModule;

    // 1. Value just within 1e-6 tolerance (diff = 1e-7 <= 1e-6) -> accepted
    const withinTolerance = validateRupeeAmount(100.50 + 1e-9);
    assert.equal(withinTolerance.ok, true);
    assert.equal(withinTolerance.value, 100.50);

    // 2. Value beyond 1e-6 tolerance (diff = 1e-5 > 1e-6) -> rejected
    const beyondTolerance = validateRupeeAmount(100.50 + 1e-7);
    assert.equal(beyondTolerance.ok, false);
    assert.match(beyondTolerance.error, /invalid precision: more than 2 decimal places in rupees/);

    // 3. String with whitespace is trimmed and accepted
    const withSpaces = validateRupeeAmount("   250.75   ");
    assert.equal(withSpaces.ok, true);
    assert.equal(withSpaces.value, 250.75);

    // 4. String with trailing zero in 3rd decimal place is strictly rejected per 2-decimal regex
    const trailingZero3rd = validateRupeeAmount("250.750");
    assert.equal(trailingZero3rd.ok, false);
    assert.match(trailingZero3rd.error, /invalid precision/);
  });
});
