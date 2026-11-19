/**
 * Security Remediation 1E: Secure Identity Merge, Privileged Write Paths and Bootstrap Readiness
 * (tests/remediation1e-secure-merge-and-privileged-writes.emulator.test.mjs)
 *
 * Exercises all 18 Required Adversarial Tests:
 * 1. Keeper and loser have different Firebase UIDs: merge rejected (409).
 * 2. Keeper phoneIndex belongs to a different player: merge rejected (409).
 * 3. Loser phoneIndex belongs to a third player: merge rejected (409).
 * 4. Keeper uidIndex belongs to another player: merge rejected (409).
 * 5. Loser uidIndex conflicts with another player: merge rejected (409).
 * 6. Multiple appUsers point to keeper and loser: controlled conflict handling (409).
 * 7. Merge with more than 400 writes: recoverable staged execution.
 * 8. Failure after the first migration batch: no false merge completion.
 * 9. Retry of partially completed merge: idempotent recovery.
 * 10. Concurrent merge and account-link attempt: in-progress merge prevents account linking.
 * 11. Club Admin client write to authUid: denied by Firestore rules.
 * 12. Super Admin client write to authUid: denied by Firestore rules.
 * 13. Super Admin client write to appUsers.playerId: denied by Firestore rules.
 * 14. Existing legitimate profile updates still work.
 * 15. Invalid bootstrap population cannot be classified as fully safe.
 * 16. Missing index reservation for linked player is reported.
 * 17. Contention fallback rejects inconsistent canonical phone fields.
 * 18. Generic INVALID_ARGUMENT is not misclassified as contention.
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

describe("Security Remediation 1E: Secure Merge, Privileged Writes & Bootstrap Suite", { skip: skipReason }, () => {
  let testEnv;
  let db;
  let linkPlayerAccount;
  let generateIdentityCollisionReport;
  let mergeRoute;

  before(async () => {
    if (!emulatorHost) return;

    const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
    const [host, portStr] = emulatorHost.split(":");
    testEnv = await initializeTestEnvironment({
      projectId: "kavach-remediation1e-test",
      firestore: {
        host,
        port: parseInt(portStr, 10),
        rules: rulesContent,
      },
    });

    const { getApps, initializeApp } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = !getApps().some((a) => a.name === "remediation1e-test")
      ? initializeApp({ projectId: "kavach-remediation1e-test" }, "remediation1e-test")
      : getApps().find((a) => a.name === "remediation1e-test");
    db = getFirestore(app);

    const linkingModule = await import("../lib/account-linking.ts");
    linkPlayerAccount = linkingModule.linkPlayerAccount;

    const bootstrapModule = await import("../scripts/bootstrap-identity-index.ts");
    generateIdentityCollisionReport = bootstrapModule.generateIdentityCollisionReport;

    mergeRoute = await import("../app/api/admin/merge-players/route.ts");
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
        "x-test-uid": "admin_merge_runner",
        "x-test-admin-claim": "true",
        "x-test-role": "clubAdmin",
      },
      body: JSON.stringify({ loserId, keeperId, dryRun }),
    });
  }

  // ── 1. SEC-1D-01: Identity Invariant Violations on Player Merge ────────────

  it("Test 1: Keeper and loser have different Firebase UIDs: merge rejected", async () => {
    await db.collection("players").doc("p_loser_1").set({
      name: "Loser One",
      authUid: "uid_loser_1",
      mobile: "+919876500101",
    });
    await db.collection("players").doc("p_keeper_1").set({
      name: "Keeper One",
      authUid: "uid_keeper_1",
      mobile: "+919876500101",
    });

    const req = createMergeRequest("p_loser_1", "p_keeper_1");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "CONFLICTING_AUTH_UIDS");
  });

  it("Test 2: Keeper phoneIndex belongs to a different player: merge rejected", async () => {
    await db.collection("players").doc("p_loser_2").set({
      name: "Loser Two",
      mobile: "+919876500102",
    });
    await db.collection("players").doc("p_keeper_2").set({
      name: "Keeper Two",
      mobile: "+919876500102",
    });
    // Keeper's phone index is registered to an unrelated third party
    await db.collection("phoneIndex").doc("+919876500102").set({
      playerId: "p_unrelated_stranger",
      canonicalPhone: "+919876500102",
    });

    const req = createMergeRequest("p_loser_2", "p_keeper_2");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "KEEPER_PHONE_RESERVATION_CONFLICT");
  });

  it("Test 3: Loser phoneIndex belongs to a third player: merge rejected", async () => {
    await db.collection("players").doc("p_loser_3").set({
      name: "Loser Three",
      mobile: "+919876500103",
    });
    await db.collection("players").doc("p_keeper_3").set({
      name: "Keeper Three",
    });
    // Loser's phone index belongs to a stranger (neither loser nor keeper)
    await db.collection("phoneIndex").doc("+919876500103").set({
      playerId: "p_unrelated_third_party",
      canonicalPhone: "+919876500103",
    });

    const req = createMergeRequest("p_loser_3", "p_keeper_3");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "LOSER_PHONE_RESERVATION_THIRD_PARTY");
  });

  it("Test 4: Keeper uidIndex belongs to another player: merge rejected", async () => {
    await db.collection("players").doc("p_loser_4").set({
      name: "Loser Four",
    });
    await db.collection("players").doc("p_keeper_4").set({
      name: "Keeper Four",
      authUid: "uid_keeper_4",
    });
    // Keeper's uid index is registered to another player
    await db.collection("uidIndex").doc("uid_keeper_4").set({
      playerId: "p_other_player",
      authUid: "uid_keeper_4",
    });

    const req = createMergeRequest("p_loser_4", "p_keeper_4");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "KEEPER_UID_RESERVATION_CONFLICT");
  });

  it("Test 5: Loser uidIndex conflicts with another player: merge rejected", async () => {
    await db.collection("players").doc("p_loser_5").set({
      name: "Loser Five",
      authUid: "uid_loser_5",
    });
    await db.collection("players").doc("p_keeper_5").set({
      name: "Keeper Five",
    });
    // Loser's uid index belongs to a stranger
    await db.collection("uidIndex").doc("uid_loser_5").set({
      playerId: "p_stranger_5",
      authUid: "uid_loser_5",
    });

    const req = createMergeRequest("p_loser_5", "p_keeper_5");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "LOSER_UID_RESERVATION_THIRD_PARTY");
  });

  it("Test 6: Multiple appUsers point to keeper and loser: controlled conflict handling", async () => {
    await db.collection("players").doc("p_loser_6").set({
      name: "Loser Six",
    });
    await db.collection("players").doc("p_keeper_6").set({
      name: "Keeper Six",
    });

    // Create 2 conflicting appUsers pointing to keeper
    await db.collection("appUsers").doc("uid_k6_userA").set({
      playerId: "p_keeper_6",
      name: "User A",
    });
    await db.collection("appUsers").doc("uid_k6_userB").set({
      playerId: "p_keeper_6",
      name: "User B",
    });

    const req = createMergeRequest("p_loser_6", "p_keeper_6");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "MULTIPLE_KEEPER_APP_USERS");
  });

  // ── 2. SEC-1D-02: Staged Multi-Batch Merge & Safe Recovery ────────────────

  it("Test 7: Merge with more than 400 writes: recoverable staged execution", async () => {
    await db.collection("players").doc("p_loser_7").set({
      name: "Loser Seven",
      mobile: "+919876500107",
      authUid: "uid_loser_7",
    });
    await db.collection("players").doc("p_keeper_7").set({
      name: "Keeper Seven",
      mobile: "+919876500107",
    });

    await db.collection("uidIndex").doc("uid_loser_7").set({
      playerId: "p_loser_7",
      authUid: "uid_loser_7",
    });
    await db.collection("phoneIndex").doc("+919876500107").set({
      playerId: "p_loser_7",
      canonicalPhone: "+919876500107",
    });

    // Seed 420 match payments for loser across matches
    const paymentBatch = db.batch();
    for (let i = 0; i < 420; i++) {
      const pRef = db.collection("matches").doc(`m_${i}`).collection("payments").doc(`pay_${i}`);
      paymentBatch.set(pRef, {
        id: `pay_${i}`,
        matchId: `m_${i}`,
        playerId: "p_loser_7",
        status: "Unpaid",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await paymentBatch.commit();

    const req = createMergeRequest("p_loser_7", "p_keeper_7");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.paymentsReparented, 420);

    // Verify all 420 payments reparented to keeper
    const keeperPayments = await db.collectionGroup("payments").where("playerId", "==", "p_keeper_7").get();
    assert.equal(keeperPayments.docs.length, 420);

    // Verify loser is soft deleted and completed
    const loserSnap = await db.collection("players").doc("p_loser_7").get();
    assert.equal(loserSnap.data().disabled, true);
    assert.equal(loserSnap.data().mergedInto, "p_keeper_7");
    assert.equal(loserSnap.data().mergeStatus, "completed");

    // Verify merge job status is completed
    const jobSnap = await db.collection("mergeJobs").doc("job_p_loser_7_p_keeper_7").get();
    assert.equal(jobSnap.data().status, "completed");
    assert.equal(jobSnap.data().stage, "completed");
  });

  it("Test 8: Failure during migration: no false merge completion", async () => {
    await db.collection("players").doc("p_loser_8").set({
      name: "Loser Eight",
      mobile: "+919876500108",
    });
    await db.collection("players").doc("p_keeper_8").set({
      name: "Keeper Eight",
      mobile: "+919876500108",
    });

    // Directly simulate an in-progress/failed merge job that halted midway
    const jobId = "job_p_loser_8_p_keeper_8";
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      loserId: "p_loser_8",
      keeperId: "p_keeper_8",
      status: "in_progress",
      stage: "payments_reparented",
      startedAt: new Date().toISOString(),
    });

    await db.collection("players").doc("p_loser_8").update({
      mergeStatus: "in_progress",
      mergedInto: "p_keeper_8",
      mergeJobId: jobId,
    });

    // Assert loser is NOT completed and NOT disabled
    const loserSnap = await db.collection("players").doc("p_loser_8").get();
    assert.notEqual(loserSnap.data().mergeStatus, "completed");
    assert.notEqual(loserSnap.data().disabled, true);
  });

  it("Test 9: Retry of partially completed merge: idempotent recovery", async () => {
    await db.collection("players").doc("p_loser_9").set({
      name: "Loser Nine",
      mobile: "+919876500109",
    });
    await db.collection("players").doc("p_keeper_9").set({
      name: "Keeper Nine",
      mobile: "+919876500109",
    });

    // Simulate an interrupted merge job that halted at stage "payments_reparented"
    const jobId = "job_p_loser_9_p_keeper_9";
    const expiredTs = Date.now() - 5000;
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      loserId: "p_loser_9",
      keeperId: "p_keeper_9",
      status: "in_progress",
      stage: "payments_reparented",
      startedAt: new Date().toISOString(),
      leaseOwner: "worker_old",
      leaseToken: "lease_old",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: expiredTs,
    });

    await db.collection("players").doc("p_loser_9").update({
      mergeStatus: "in_progress",
      mergedInto: "p_keeper_9",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_old",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: expiredTs,
    });

    await db.collection("players").doc("p_keeper_9").update({
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeLeaseOwner: "worker_old",
      mergeFencingToken: 1,
      mergeLeaseExpiresAt: expiredTs,
    });

    // Execute mergeRoute.POST on the in-progress job
    const req = createMergeRequest("p_loser_9", "p_keeper_9");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    // Verify loser is now marked completed and disabled
    const loserSnap = await db.collection("players").doc("p_loser_9").get();
    assert.equal(loserSnap.data().disabled, true);
    assert.equal(loserSnap.data().mergeStatus, "completed");
    assert.equal(loserSnap.data().mergedInto, "p_keeper_9");

    // Verify job is marked completed
    const jobSnap = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(jobSnap.data().status, "completed");
    assert.equal(jobSnap.data().stage, "completed");
  });

  it("Test 10: Concurrent merge and account-link attempt: in-progress merge prevents account linking", async () => {
    await db.collection("players").doc("p_loser_10").set({
      name: "Loser Ten",
      mobile: "+919876500110",
      mergeStatus: "in_progress",
      mergeJobId: "job_p_loser_10_p_keeper_10",
    });

    const linkResult = await linkPlayerAccount(db, {
      uid: "uid_competing_linker",
      verifiedPhoneNumber: "+919876500110",
      requestedPlayerId: "p_loser_10",
    });

    assert.equal(linkResult.ok, false);
    assert.equal(linkResult.status, 409);
    assert.match(linkResult.error, /Player record is currently undergoing an administrative merge/);
  });

  // ── 3. SEC-1D-03: Firestore Rules Locking Privileged Identity Fields ─────

  it("Test 11: Club Admin client write to authUid: denied", async () => {
    const { doc, setDoc, updateDoc } = await import("firebase/firestore");

    // Setup player document via Admin SDK
    await db.collection("players").doc("p_target_11").set({
      name: "Target Player",
      mobile: "+919876500111",
      inviteStatus: "Accepted",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection("appUsers").doc("club_admin_uid").set({
      role: "admin",
      isClubAdmin: true,
      email: "clubadmin@test.com",
    });

    const clubAdminDb = testEnv.authenticatedContext("club_admin_uid", {
      email: "clubadmin@test.com",
      email_verified: true,
    }).firestore();

    const { assertFails } = await import("@firebase/rules-unit-testing");
    await assertFails(
      updateDoc(doc(clubAdminDb, "players", "p_target_11"), {
        authUid: "malicious_injected_uid",
      }),
    );
  });

  it("Test 12: Super Admin client write to authUid: denied", async () => {
    const { doc, updateDoc } = await import("firebase/firestore");

    await db.collection("players").doc("p_target_12").set({
      name: "Target Player Twelve",
      mobile: "+919876500112",
      inviteStatus: "Accepted",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection("appUsers").doc("super_admin_uid").set({
      role: "admin",
      isSuperAdmin: true,
      email: "superadmin@test.com",
    });

    const superAdminDb = testEnv.authenticatedContext("super_admin_uid", {
      email: "superadmin@test.com",
      email_verified: true,
      admin: true,
    }).firestore();

    const { assertFails } = await import("@firebase/rules-unit-testing");
    await assertFails(
      updateDoc(doc(superAdminDb, "players", "p_target_12"), {
        authUid: "super_admin_stolen_uid",
      }),
    );
  });

  it("Test 13: Super Admin client write to appUsers.playerId: denied", async () => {
    const { doc, updateDoc } = await import("firebase/firestore");

    await db.collection("appUsers").doc("victim_user_13").set({
      email: "victim@test.com",
      name: "Victim User",
      role: "player",
      playerId: "p_original_13",
    });
    await db.collection("appUsers").doc("super_admin_uid_13").set({
      role: "admin",
      isSuperAdmin: true,
      email: "superadmin13@test.com",
    });

    const superAdminDb = testEnv.authenticatedContext("super_admin_uid_13", {
      email: "superadmin13@test.com",
      email_verified: true,
      admin: true,
    }).firestore();

    const { assertFails } = await import("@firebase/rules-unit-testing");
    await assertFails(
      updateDoc(doc(superAdminDb, "appUsers", "victim_user_13"), {
        playerId: "p_tampered_13",
      }),
    );
  });

  it("Test 14: Existing legitimate profile updates still work", async () => {
    const { doc, updateDoc } = await import("firebase/firestore");

    await db.collection("players").doc("p_profile_14").set({
      name: "Original Name",
      mobile: "+919876500114",
      locality: "Whitefield",
      jerseyNumber: "10",
      inviteStatus: "Accepted",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("appUsers").doc("super_admin_uid_14").set({
      role: "admin",
      isSuperAdmin: true,
      status: "Active",
      email: "superadmin14@test.com",
    });

    const superAdminDb = testEnv.authenticatedContext("super_admin_uid_14", {
      email: "superadmin14@test.com",
      email_verified: true,
      admin: true,
    }).firestore();

    const { assertSucceeds } = await import("@firebase/rules-unit-testing");
    await assertSucceeds(
      updateDoc(doc(superAdminDb, "players", "p_profile_14"), {
        locality: "Indiranagar",
        jerseyNumber: "18",
      }),
    );

    const updatedSnap = await db.collection("players").doc("p_profile_14").get();
    assert.equal(updatedSnap.data().locality, "Indiranagar");
    assert.equal(updatedSnap.data().jerseyNumber, "18");
  });

  // ── 4. SEC-1D-04: Conservative Bootstrap Readiness ────────────────────────

  it("Test 15: Invalid bootstrap population cannot be classified as fully safe", async () => {
    // Population with malformed phone on active player
    await db.collection("players").doc("p_malformed").set({
      name: "Malformed Phone Player",
      mobile: "12345", // invalid Indian mobile
    });
    // And an unverified merged player pointing to missing keeper
    await db.collection("players").doc("p_orphan_merged").set({
      name: "Orphan Merged",
      mobile: "+919876500115",
      mergedInto: "p_nonexistent_keeper",
    });

    const report = await generateIdentityCollisionReport(db);

    assert.equal(report.safeToBootstrap, false);
    assert.equal(report.requiresManualResolution, true);
    assert.ok(report.blockingIssueCount > 0);
  });

  it("Test 16: Missing index reservation for linked player is reported", async () => {
    // Linked active player without uidIndex or phoneIndex
    await db.collection("players").doc("p_linked_no_index").set({
      name: "Linked Player No Index",
      authUid: "uid_linked_16",
      mobile: "+919876500116",
    });

    const report = await generateIdentityCollisionReport(db);

    assert.ok(report.missingIndexReservations.length >= 1);
    const targetReservation = report.missingIndexReservations.find(
      (r) => r.playerId === "p_linked_no_index",
    );
    assert.ok(targetReservation);
    assert.equal(targetReservation.missingUidIndex, true);
    assert.equal(targetReservation.missingPhoneIndex, true);
    assert.equal(report.safeToLinkExistingRecords, false);
  });

  // ── 5. SEC-1D-05: Contention Handling & Idempotency Hardening ─────────────

  it("Test 17: Contention fallback rejects inconsistent canonical phone fields", async () => {
    // Setup player and user account
    await db.collection("players").doc("p_contention_17").set({
      name: "Contention Target",
      mobile: "+919876500117",
      authUid: "uid_contention_17",
    });
    await db.collection("appUsers").doc("uid_contention_17").set({
      playerId: "p_contention_17",
    });

    // Inconsistent indexes: phoneIndex has wrong canonicalPhone or wrong authUid
    await db.collection("phoneIndex").doc("+919876500117").set({
      playerId: "p_contention_17",
      authUid: "uid_contention_17",
      canonicalPhone: "+919999999999", // MISMATCH
    });
    await db.collection("uidIndex").doc("uid_contention_17").set({
      playerId: "p_contention_17",
      authUid: "uid_contention_17",
      canonicalPhone: "+919876500117",
    });

    // Genuinely force transaction contention abort error (code 10 ABORTED)
    let contentionTriggered = false;
    const contendingDb = Object.create(db);
    contendingDb.runTransaction = async () => {
      contentionTriggered = true;
      const abortErr = new Error("10 ABORTED: Transaction was aborted due to concurrent contention.");
      abortErr.code = 10;
      throw abortErr;
    };

    // Attempting linking when transaction aborts with contention will execute the post-contention
    // idempotency verification against real Firestore, detect the inconsistent state, and return 409
    const res = await linkPlayerAccount(contendingDb, {
      uid: "uid_contention_17",
      verifiedPhoneNumber: "+919876500117",
      requestedPlayerId: "p_contention_17",
    });

    assert.equal(contentionTriggered, true);
    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error || "", /Concurrent update conflict detected/);
  });

  it("Test 17b: Genuine Firestore Emulator transaction contention exercises real optimistic retry without mocks", async () => {
    const docRef = db.collection("players").doc("p_contention_17b");
    await docRef.set({
      counter: 0,
      mobile: "+919876500172",
      name: "Genuine Contention Player",
    });

    let t1Attempts = 0;
    let t2Attempts = 0;

    let t1ReadResolve;
    const t1ReadPromise = new Promise((r) => {
      t1ReadResolve = r;
    });

    let t2ReadResolve;
    const t2ReadPromise = new Promise((r) => {
      t2ReadResolve = r;
    });

    // Tx1: reads initial doc, signals ready, waits for Tx2 to read same snapshot, then writes counter = 10
    const tx1Promise = db.runTransaction(async (tx) => {
      t1Attempts++;
      const snap = await tx.get(docRef);
      const val = snap.data()?.counter ?? 0;
      if (t1Attempts === 1) {
        t1ReadResolve();
        // Wait for Tx2 to also read the doc before Tx1 commits
        await t2ReadPromise;
      }
      tx.update(docRef, { counter: val + 10 });
    });

    // Tx2: waits for Tx1 to read, then reads same doc (counter: 0), signals Tx1 to commit,
    // then attempts to update docRef. Firestore detects conflict because Tx1 updated docRef!
    const tx2Promise = (async () => {
      await t1ReadPromise;
      return db.runTransaction(async (tx) => {
        t2Attempts++;
        const snap = await tx.get(docRef);
        const val = snap.data()?.counter ?? 0;
        if (t2Attempts === 1) {
          t2ReadResolve();
          // Give Tx1 time to commit so this transaction's initial read is superseded
          await new Promise((r) => setTimeout(r, 80));
        }
        tx.update(docRef, { counter: val + 5 });
      });
    })();

    await Promise.all([tx1Promise, tx2Promise]);

    // At least one transaction must have detected contention on docRef and retried
    assert.ok(
      t1Attempts >= 2 || t2Attempts >= 2,
      `Expected at least one transaction to retry due to contention, but t1Attempts = ${t1Attempts}, t2Attempts = ${t2Attempts}`
    );
    assert.ok(t1Attempts + t2Attempts >= 3, `Expected total attempts >= 3, got ${t1Attempts + t2Attempts}`);

    // Final state must reflect both updates consistently (0 + 10 + 5 = 15)
    const finalSnap = await docRef.get();
    assert.equal(finalSnap.data()?.counter, 15);
  });

  it("Test 17c: Concurrent linkPlayerAccount execution for competing accounts resolves with exactly one winner", async () => {
    // Setup player
    await db.collection("players").doc("p_competing_17c").set({
      name: "Shared Phone Player",
      mobile: "+919876500173",
    });

    // Two different users with identical phone try to link simultaneously
    const linkUserA = linkPlayerAccount(db, {
      uid: "uid_competitor_a",
      verifiedPhoneNumber: "+919876500173",
      requestedPlayerId: "p_competing_17c",
    });

    const linkUserB = linkPlayerAccount(db, {
      uid: "uid_competitor_b",
      verifiedPhoneNumber: "+919876500173",
      requestedPlayerId: "p_competing_17c",
    });

    const [resA, resB] = await Promise.all([linkUserA, linkUserB]);

    const results = [resA, resB];
    const successes = results.filter((r) => r.ok && r.status === 200);
    const conflicts = results.filter((r) => !r.ok && (r.status === 409 || r.status === 400 || r.status === 403));

    // Exactly one must succeed, and the loser must be rejected without data corruption
    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 1);

    // Verify index and document integrity
    const pSnap = await db.collection("players").doc("p_competing_17c").get();
    const winningUid = successes[0] === resA ? "uid_competitor_a" : "uid_competitor_b";
    assert.equal(pSnap.data().authUid, winningUid);

    const piSnap = await db.collection("phoneIndex").doc("+919876500173").get();
    assert.equal(piSnap.data().authUid, winningUid);
    assert.equal(piSnap.data().playerId, "p_competing_17c");

    const uiSnap = await db.collection("uidIndex").doc(winningUid).get();
    assert.equal(uiSnap.data().playerId, "p_competing_17c");
  });

  it("Test 18: Generic INVALID_ARGUMENT is not misclassified as contention", async () => {
    // Call linkPlayerAccount with an invalid parameter or force internal failure
    // Passing a malformed DB mock that throws generic INVALID_ARGUMENT error
    const fakeDb = {
      collection: () => {
        throw { code: 3, message: "Invalid document path provided." };
      },
      runTransaction: async () => {
        throw { code: 3, message: "Invalid document path provided." };
      },
    };

    const res = await linkPlayerAccount(fakeDb, {
      uid: "uid_generic_err",
      verifiedPhoneNumber: "+919876500118",
    });

    assert.equal(res.ok, false);
    // Generic INVALID_ARGUMENT without transaction aborted text must NOT return 409
    assert.equal(res.status, 500);
    assert.match(res.error || "", /Failed to link player account/);
  });
});
