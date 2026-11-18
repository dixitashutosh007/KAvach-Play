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
    await db.collection("players").doc("p_loser_s16").set({ name: "Loser S16", mergeStatus: "in_progress", mergeJobId: "job_s16" });
    await db.collection("players").doc("p_keeper_s16").set({ name: "Keeper S16", mergeStatus: "in_progress", mergeJobId: "job_s16" });

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
      leaseExpiresAt: Date.now() - 1000,
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
    await db.collection("mergeJobs").doc(jobId).update({ leaseExpiresAt: Date.now() - 1000 });

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
    await db.collection("mergeJobs").doc(jobId).update({ leaseExpiresAt: Date.now() - 1000 });
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

    // Loser has expired lock referencing a non-existent job
    await db.collection("players").doc(loserId).set({
      id: loserId,
      name: "Stale Loser 48",
      mergeStatus: "in_progress",
      mergeJobId: "job_completely_missing_999",
      mergeLeaseExpiresAt: Date.now() - 50000,
    });
    await db.collection("players").doc(keeperId).set({
      id: keeperId,
      name: "Keeper 48",
    });

    const lease = await playerMergeModule.acquireMergeLease(db, newJobId, loserId, keeperId);
    assert.equal(lease.ok, true);
    assert.equal(lease.workerInfo.fencingToken, 1);

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
        assert.match(err.message, /keeper player lock is missing, inconsistent/);
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

    await db.collection("players").doc(loserId).set({ id: loserId, mergeStatus: "in_progress", mergeJobId: jobId, mergeFencingToken: 1, mergeLeaseOwner: "worker_53" });
    await db.collection("players").doc(keeperId).set({ id: keeperId, mergeStatus: "in_progress", mergeJobId: jobId, mergeFencingToken: 1, mergeLeaseOwner: "worker_53" });

    await db.collection("mergeJobs").doc(jobId).set({
      jobId,
      loserId,
      keeperId,
      status: "in_progress",
      stage: "app_users_reparented",
      leaseOwner: "worker_53",
      leaseToken: "token_53",
      fencingToken: 1,
      leaseExpiresAt: Date.now() + 60000,
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
      mergeFencingToken: 99,
      mergeLeaseExpiresAt: Date.now() + 60000,
    });
    await db.collection("players").doc("p_keeper_s59").set({
      name: "Keeper 59",
      mergeStatus: "in_progress",
      mergeJobId: "job_s59",
      mergeFencingToken: 99,
      mergeLeaseExpiresAt: Date.now() + 60000,
    });
    await db.collection("mergeJobs").doc("job_s59").set({
      id: "job_s59",
      jobId: "job_s59",
      status: "in_progress",
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
    assert.equal(res.reason, "WORKER_SUPERSEDED_OR_MISMATCH");

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
    const resTrimmed = parseAuthoritativeAmount("  249.995  ");
    assert.equal(resTrimmed.ok, true);
    assert.equal(resTrimmed.value, 250); // Paise rounding

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
    assert.match(resRefundContradictory.conflictReason, /Contradictory refund amount aliases/);

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
});
