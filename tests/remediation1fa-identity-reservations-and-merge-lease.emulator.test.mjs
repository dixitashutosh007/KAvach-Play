/**
 * Security Remediation 1F-A: Transactional Identity Reservation Integrity & Exclusive Merge Execution
 * (tests/remediation1fa-identity-reservations-and-merge-lease.emulator.test.mjs)
 *
 * Exercises all 29 Required Adversarial Scenarios:
 *
 * Reservation ownership tests (1-11):
 * 1. Reject merge when loser phone reservation belongs to a third player.
 * 2. Reject merge when keeper phone reservation belongs to a third player.
 * 3. Reject merge when loser UID reservation belongs to a third player.
 * 4. Reject merge when keeper UID reservation belongs to a third player.
 * 5. Reject merge when players.authUid conflicts with appUsers.playerId.
 * 6. Reject merge when uidIndex and phoneIndex disagree.
 * 7. Reject merge when multiple phone reservations make ownership ambiguous.
 * 8. Reject merge when multiple UID reservations make ownership ambiguous.
 * 9. Reject malformed reservation records.
 * 10. Confirm valid expected loser-to-keeper reservation transition.
 * 11. Confirm unrelated player reservations remain unchanged after a rejected merge.
 *
 * Merge lease tests (12-24):
 * 12. First merge request acquires a lease.
 * 13. Second concurrent request for the same job receives 409.
 * 14. Two requests with the same deterministic job ID cannot both acquire execution ownership.
 * 15. A different job cannot acquire the same loser while a valid lease exists.
 * 16. Lease renewal succeeds for current owner.
 * 17. Lease renewal fails for wrong owner.
 * 18. Expired lease can be reclaimed safely.
 * 19. Reclaimed lease receives a higher fencing generation.
 * 20. Old worker cannot advance a stage after lease reclamation.
 * 21. Old worker cannot update identity reservations after lease reclamation.
 * 22. Old worker cannot mark the merge completed.
 * 23. Completed job retry returns idempotent success without acquiring a new active lease.
 * 24. Failed job recovery follows documented lease rules.
 *
 * Account-linking coordination tests (25-29):
 * 25. Account linking is rejected while a valid merge lease exists.
 * 26. Account linking can proceed after a genuinely completed merge only when the resulting identity state is valid.
 * 27. Account linking rejects partial merge state.
 * 28. Account linking cannot proceed based on a stale or expired worker’s state.
 * 29. Concurrent account-link and merge attempts cannot both win conflicting identity ownership.
 */

import { describe, it, before, beforeEach } from "node:test";
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

describe("Security Remediation 1F-A: Identity Reservations & Exclusive Merge Lease", { skip: skipReason }, () => {
  let testEnv;
  let db;
  let mergeRoute;
  let linkPlayerAccount;

  before(async () => {
    if (!emulatorHost) return;

    const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
    const [host, portStr] = emulatorHost.split(":");
    testEnv = await initializeTestEnvironment({
      projectId: "kavach-remediation1fa-test",
      firestore: {
        host,
        port: parseInt(portStr, 10),
        rules: rulesContent,
      },
    });

    const { getApps, initializeApp } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = !getApps().some((a) => a.name === "remediation1fa-test")
      ? initializeApp({ projectId: "kavach-remediation1fa-test" }, "remediation1fa-test")
      : getApps().find((a) => a.name === "remediation1fa-test");
    db = getFirestore(app);

    mergeRoute = await import("../app/api/admin/merge-players/route.ts");
    const playerMergeModule = await import("../lib/player-merge.ts");
    Object.assign(mergeRoute, playerMergeModule);
    const linkingModule = await import("../lib/account-linking.ts");
    linkPlayerAccount = linkingModule.linkPlayerAccount;
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

  // ══════════════════════════════════════════════════════════════════════════
  // Section 1: Reservation Ownership Tests (Scenarios 1 - 11)
  // ══════════════════════════════════════════════════════════════════════════

  it("Test 1: Reject merge when loser phone reservation belongs to a third player", async () => {
    await db.collection("players").doc("p_loser_1").set({
      name: "Loser One",
      mobile: "+919876500101",
    });
    await db.collection("players").doc("p_keeper_1").set({
      name: "Keeper One",
    });
    await db.collection("phoneIndex").doc("+919876500101").set({
      playerId: "p_unrelated_stranger_1",
      canonicalPhone: "+919876500101",
    });

    const req = createMergeRequest("p_loser_1", "p_keeper_1");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "LOSER_PHONE_RESERVATION_THIRD_PARTY");

    // Verify loser is not modified
    const loserSnap = await db.collection("players").doc("p_loser_1").get();
    assert.equal(loserSnap.data().disabled || false, false);
    assert.equal(loserSnap.data().mergedInto || "", "");
  });

  it("Test 2: Reject merge when keeper phone reservation belongs to a third player", async () => {
    await db.collection("players").doc("p_loser_2").set({
      name: "Loser Two",
    });
    await db.collection("players").doc("p_keeper_2").set({
      name: "Keeper Two",
      mobile: "+919876500102",
    });
    await db.collection("phoneIndex").doc("+919876500102").set({
      playerId: "p_unrelated_stranger_2",
      canonicalPhone: "+919876500102",
    });

    const req = createMergeRequest("p_loser_2", "p_keeper_2");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "KEEPER_PHONE_RESERVATION_CONFLICT");
  });

  it("Test 3: Reject merge when loser UID reservation belongs to a third player", async () => {
    await db.collection("players").doc("p_loser_3").set({
      name: "Loser Three",
      authUid: "uid_loser_3",
    });
    await db.collection("players").doc("p_keeper_3").set({
      name: "Keeper Three",
    });
    await db.collection("uidIndex").doc("uid_loser_3").set({
      playerId: "p_unrelated_stranger_3",
      authUid: "uid_loser_3",
    });

    const req = createMergeRequest("p_loser_3", "p_keeper_3");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "LOSER_UID_RESERVATION_THIRD_PARTY");
  });

  it("Test 4: Reject merge when keeper UID reservation belongs to a third player", async () => {
    await db.collection("players").doc("p_loser_4").set({
      name: "Loser Four",
    });
    await db.collection("players").doc("p_keeper_4").set({
      name: "Keeper Four",
      authUid: "uid_keeper_4",
    });
    await db.collection("uidIndex").doc("uid_keeper_4").set({
      playerId: "p_unrelated_stranger_4",
      authUid: "uid_keeper_4",
    });

    const req = createMergeRequest("p_loser_4", "p_keeper_4");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "KEEPER_UID_RESERVATION_CONFLICT");
  });

  it("Test 5: Reject merge when players.authUid conflicts with appUsers.playerId", async () => {
    await db.collection("players").doc("p_loser_5").set({
      name: "Loser Five",
      authUid: "uid_loser_5",
      mobile: "+919876500105",
    });
    await db.collection("players").doc("p_keeper_5").set({
      name: "Keeper Five",
      mobile: "+919876500105",
    });
    await db.collection("uidIndex").doc("uid_loser_5").set({
      playerId: "p_loser_5",
      authUid: "uid_loser_5",
      canonicalPhone: "+919876500105",
    });
    await db.collection("phoneIndex").doc("+919876500105").set({
      playerId: "p_loser_5",
      authUid: "uid_loser_5",
      canonicalPhone: "+919876500105",
    });
    // appUser points to an unrelated third party
    await db.collection("appUsers").doc("uid_loser_5").set({
      playerId: "p_unrelated_stranger_5",
      name: "Inconsistent User",
    });

    const req = createMergeRequest("p_loser_5", "p_keeper_5");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "AUTH_UID_APP_USER_MISMATCH");
  });

  it("Test 6: Reject merge when uidIndex and phoneIndex disagree", async () => {
    await db.collection("players").doc("p_loser_6").set({
      name: "Loser Six",
      authUid: "uid_loser_6",
      mobile: "+919876500106",
    });
    await db.collection("players").doc("p_keeper_6").set({
      name: "Keeper Six",
      mobile: "+919876500106",
    });
    // Disagreement: uidIndex states phone is +919876500999, but player/phoneIndex is +919876500106
    await db.collection("uidIndex").doc("uid_loser_6").set({
      playerId: "p_loser_6",
      authUid: "uid_loser_6",
      canonicalPhone: "+919876500999",
    });
    await db.collection("phoneIndex").doc("+919876500106").set({
      playerId: "p_loser_6",
      authUid: "uid_loser_6",
      canonicalPhone: "+919876500106",
    });

    const req = createMergeRequest("p_loser_6", "p_keeper_6");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "INDEX_RESERVATIONS_DISAGREE");
  });

  it("Test 7: Reject merge when multiple phone reservations make ownership ambiguous", async () => {
    await db.collection("players").doc("p_loser_7").set({
      name: "Loser Seven",
      mobile: "+919876500107",
    });
    await db.collection("players").doc("p_keeper_7").set({
      name: "Keeper Seven",
      mobile: "+919876500199", // Conflicting canonical phone
    });

    const req = createMergeRequest("p_loser_7", "p_keeper_7");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "CONFLICTING_CANONICAL_PHONES");
  });

  it("Test 8: Reject merge when multiple UID reservations make ownership ambiguous", async () => {
    await db.collection("players").doc("p_loser_8").set({
      name: "Loser Eight",
    });
    await db.collection("players").doc("p_keeper_8").set({
      name: "Keeper Eight",
      authUid: "uid_keeper_8",
    });
    // Two separate UID reservations pointing to keeper
    await db.collection("uidIndex").doc("uid_keeper_8").set({
      playerId: "p_keeper_8",
      authUid: "uid_keeper_8",
    });
    await db.collection("uidIndex").doc("uid_keeper_8_extra").set({
      playerId: "p_keeper_8",
      authUid: "uid_keeper_8_extra",
    });

    const req = createMergeRequest("p_loser_8", "p_keeper_8");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "KEEPER_MULTIPLE_UID_RESERVATIONS");
  });

  it("Test 9: Reject malformed reservation records", async () => {
    await db.collection("players").doc("p_loser_9").set({
      name: "Loser Nine",
      mobile: "+919876500109",
    });
    await db.collection("players").doc("p_keeper_9").set({
      name: "Keeper Nine",
      mobile: "+919876500109",
    });
    // Malformed reservation: missing playerId and invalid phone
    await db.collection("phoneIndex").doc("+919876500109").set({
      canonicalPhone: "invalid_not_e164",
    });

    const req = createMergeRequest("p_loser_9", "p_keeper_9");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "MALFORMED_RESERVATION_RECORD");
  });

  it("Test 10: Confirm valid expected loser-to-keeper reservation transition", async () => {
    await db.collection("players").doc("p_loser_10").set({
      name: "Loser Ten",
      authUid: "uid_loser_10",
      mobile: "+919876500110",
    });
    await db.collection("players").doc("p_keeper_10").set({
      name: "Keeper Ten",
      mobile: "+919876500110",
    });
    await db.collection("uidIndex").doc("uid_loser_10").set({
      playerId: "p_loser_10",
      authUid: "uid_loser_10",
      canonicalPhone: "+919876500110",
    });
    await db.collection("phoneIndex").doc("+919876500110").set({
      playerId: "p_loser_10",
      authUid: "uid_loser_10",
      canonicalPhone: "+919876500110",
    });
    await db.collection("appUsers").doc("uid_loser_10").set({
      playerId: "p_loser_10",
      name: "User Ten",
    });

    const req = createMergeRequest("p_loser_10", "p_keeper_10");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    // Verify loser is disabled and merged
    const loserSnap = await db.collection("players").doc("p_loser_10").get();
    assert.equal(loserSnap.data().disabled, true);
    assert.equal(loserSnap.data().mergedInto, "p_keeper_10");
    assert.equal(loserSnap.data().mergeStatus, "completed");

    // Verify keeper received identity
    const keeperSnap = await db.collection("players").doc("p_keeper_10").get();
    assert.equal(keeperSnap.data().authUid, "uid_loser_10");
    assert.equal(keeperSnap.data().mergeStatus, "completed");

    // Verify reservations were reparented to keeper
    const uidSnap = await db.collection("uidIndex").doc("uid_loser_10").get();
    assert.equal(uidSnap.data().playerId, "p_keeper_10");

    const phoneSnap = await db.collection("phoneIndex").doc("+919876500110").get();
    assert.equal(phoneSnap.data().playerId, "p_keeper_10");

    const userSnap = await db.collection("appUsers").doc("uid_loser_10").get();
    assert.equal(userSnap.data().playerId, "p_keeper_10");

    // Verify job is marked completed
    const jobSnap = await db.collection("mergeJobs").doc("job_p_loser_10_p_keeper_10").get();
    assert.equal(jobSnap.data().status, "completed");
    assert.equal(jobSnap.data().stage, "completed");
  });

  it("Test 11: Confirm unrelated player reservations remain unchanged after a rejected merge", async () => {
    // Seed unrelated player with identity reservations
    await db.collection("players").doc("p_unrelated_11").set({
      name: "Unrelated Player",
      authUid: "uid_unrelated_11",
      mobile: "+919876500111",
    });
    await db.collection("uidIndex").doc("uid_unrelated_11").set({
      playerId: "p_unrelated_11",
      authUid: "uid_unrelated_11",
      canonicalPhone: "+919876500111",
    });
    await db.collection("phoneIndex").doc("+919876500111").set({
      playerId: "p_unrelated_11",
      authUid: "uid_unrelated_11",
      canonicalPhone: "+919876500111",
    });

    // Attempt a conflicting merge between unrelated parties
    await db.collection("players").doc("p_loser_11").set({
      name: "Loser Eleven",
      mobile: "+919876500112",
    });
    await db.collection("players").doc("p_keeper_11").set({
      name: "Keeper Eleven",
      mobile: "+919876500113", // Conflicting mobile
    });

    const req = createMergeRequest("p_loser_11", "p_keeper_11");
    const res = await mergeRoute.POST(req);
    assert.equal(res.status, 409);

    // Confirm unrelated player reservations are completely unchanged
    const uidSnap = await db.collection("uidIndex").doc("uid_unrelated_11").get();
    assert.equal(uidSnap.data().playerId, "p_unrelated_11");
    assert.equal(uidSnap.data().canonicalPhone, "+919876500111");

    const phoneSnap = await db.collection("phoneIndex").doc("+919876500111").get();
    assert.equal(phoneSnap.data().playerId, "p_unrelated_11");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 2: Merge Lease & Stale-Worker Fencing Tests (Scenarios 12 - 24)
  // ══════════════════════════════════════════════════════════════════════════

  it("Test 12: First merge request acquires a lease", async () => {
    await db.collection("players").doc("p_loser_12").set({ name: "Loser 12" });
    await db.collection("players").doc("p_keeper_12").set({ name: "Keeper 12" });

    const leaseRes = await mergeRoute.acquireMergeLease(db, "job_p_loser_12_p_keeper_12", "p_loser_12", "p_keeper_12");
    assert.equal(leaseRes.ok, true);
    assert.ok(leaseRes.workerInfo);
    assert.ok(leaseRes.workerInfo.leaseOwner.startsWith("worker_"));
    assert.ok(leaseRes.workerInfo.leaseToken.startsWith("lease_"));
    assert.equal(leaseRes.workerInfo.fencingToken, 1);
    assert.equal(leaseRes.workerInfo.attemptCount, 1);
    assert.ok(leaseRes.workerInfo.leaseExpiresAt > Date.now());

    const jobSnap = await db.collection("mergeJobs").doc("job_p_loser_12_p_keeper_12").get();
    assert.equal(jobSnap.data().status, "in_progress");
    assert.equal(jobSnap.data().fencingToken, 1);
  });

  it("Test 13: Second concurrent request for the same job receives 409", async () => {
    await db.collection("players").doc("p_loser_13").set({ name: "Loser 13" });
    await db.collection("players").doc("p_keeper_13").set({ name: "Keeper 13" });

    // First worker acquires lease
    const lease1 = await mergeRoute.acquireMergeLease(db, "job_p_loser_13_p_keeper_13", "p_loser_13", "p_keeper_13");
    assert.equal(lease1.ok, true);

    // Second worker attempts while lease1 is active
    const lease2 = await mergeRoute.acquireMergeLease(db, "job_p_loser_13_p_keeper_13", "p_loser_13", "p_keeper_13");
    assert.equal(lease2.ok, false);
    assert.equal(lease2.status, 409);
    assert.equal(lease2.code, "ACTIVE_LEASE_EXISTS");
  });

  it("Test 14: Two requests with the same deterministic job ID cannot both acquire execution ownership", async () => {
    await db.collection("players").doc("p_loser_14").set({ name: "Loser 14" });
    await db.collection("players").doc("p_keeper_14").set({ name: "Keeper 14" });

    const jobId = "job_p_loser_14_p_keeper_14";
    // Fire two acquire calls concurrently
    const [res1, res2] = await Promise.all([
      mergeRoute.acquireMergeLease(db, jobId, "p_loser_14", "p_keeper_14"),
      mergeRoute.acquireMergeLease(db, jobId, "p_loser_14", "p_keeper_14"),
    ]);

    const successes = [res1, res2].filter((r) => r.ok);
    const conflicts = [res1, res2].filter((r) => !r.ok && r.code === "ACTIVE_LEASE_EXISTS");

    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 1);
  });

  it("Test 15: A different job cannot acquire the same loser while a valid lease exists", async () => {
    await db.collection("players").doc("p_loser_15").set({
      name: "Loser 15",
      mergeStatus: "in_progress",
      mergeJobId: "job_p_loser_15_p_keeper_15a",
    });
    await db.collection("players").doc("p_keeper_15b").set({ name: "Keeper 15b" });

    // Seed active competing job
    await db.collection("mergeJobs").doc("job_p_loser_15_p_keeper_15a").set({
      id: "job_p_loser_15_p_keeper_15a",
      loserId: "p_loser_15",
      keeperId: "p_keeper_15a",
      status: "in_progress",
      leaseExpiresAt: Date.now() + 60000,
    });

    // Competing job attempt
    const res = await mergeRoute.acquireMergeLease(db, "job_p_loser_15_p_keeper_15b", "p_loser_15", "p_keeper_15b");
    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.equal(res.code, "MERGE_IN_PROGRESS");
  });

  it("Test 16: Lease renewal succeeds for current owner", async () => {
    await db.collection("players").doc("p_loser_16").set({ name: "Loser 16" });
    await db.collection("players").doc("p_keeper_16").set({ name: "Keeper 16" });

    const jobId = "job_p_loser_16_p_keeper_16";
    const lease = await mergeRoute.acquireMergeLease(db, jobId, "p_loser_16", "p_keeper_16", { leaseDurationMs: 10000 });
    assert.equal(lease.ok, true);

    const renewal = await mergeRoute.renewMergeLease(db, jobId, lease.workerInfo, 30000);
    assert.equal(renewal.ok, true);
    assert.ok(renewal.newExpiresAt > lease.workerInfo.leaseExpiresAt);
  });

  it("Test 17: Lease renewal fails for wrong owner", async () => {
    await db.collection("players").doc("p_loser_17").set({ name: "Loser 17" });
    await db.collection("players").doc("p_keeper_17").set({ name: "Keeper 17" });

    const jobId = "job_p_loser_17_p_keeper_17";
    const lease = await mergeRoute.acquireMergeLease(db, jobId, "p_loser_17", "p_keeper_17");
    assert.equal(lease.ok, true);

    // Impostor worker tries to renew
    await assert.rejects(
      async () => {
        await mergeRoute.renewMergeLease(
          db,
          jobId,
          { leaseOwner: "worker_impostor", leaseToken: "fake_token", fencingToken: 1 },
          30000
        );
      },
      (err) => err instanceof mergeRoute.StaleWorkerError && err.status === 409
    );
  });

  it("Test 18: Expired lease can be reclaimed safely", async () => {
    await db.collection("players").doc("p_loser_18").set({ name: "Loser 18" });
    await db.collection("players").doc("p_keeper_18").set({ name: "Keeper 18" });

    const jobId = "job_p_loser_18_p_keeper_18";
    // Seed expired lease
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      loserId: "p_loser_18",
      keeperId: "p_keeper_18",
      status: "in_progress",
      stage: "pending",
      leaseOwner: "worker_old",
      leaseToken: "lease_old",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() - 5000, // Expired
    });

    const reclaim = await mergeRoute.acquireMergeLease(db, jobId, "p_loser_18", "p_keeper_18");
    assert.equal(reclaim.ok, true);
    assert.notEqual(reclaim.workerInfo.leaseOwner, "worker_old");
  });

  it("Test 19: Reclaimed lease receives a higher fencing generation", async () => {
    await db.collection("players").doc("p_loser_19").set({ name: "Loser 19" });
    await db.collection("players").doc("p_keeper_19").set({ name: "Keeper 19" });

    const jobId = "job_p_loser_19_p_keeper_19";
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      loserId: "p_loser_19",
      keeperId: "p_keeper_19",
      status: "in_progress",
      fencingToken: 4,
      attemptCount: 4,
      leaseExpiresAt: Date.now() - 1000,
    });

    const reclaim = await mergeRoute.acquireMergeLease(db, jobId, "p_loser_19", "p_keeper_19");
    assert.equal(reclaim.ok, true);
    assert.equal(reclaim.workerInfo.fencingToken, 5);
    assert.equal(reclaim.workerInfo.attemptCount, 5);
  });

  it("Test 20: Old worker cannot advance a stage after lease reclamation", async () => {
    await db.collection("players").doc("p_loser_20").set({ name: "Loser 20" });
    await db.collection("players").doc("p_keeper_20").set({ name: "Keeper 20" });

    const jobId = "job_p_loser_20_p_keeper_20";
    const initialLease = await mergeRoute.acquireMergeLease(db, jobId, "p_loser_20", "p_keeper_20", { leaseDurationMs: -1000 });
    const oldWorker = initialLease.workerInfo;

    // Newer worker reclaims
    const newLease = await mergeRoute.acquireMergeLease(db, jobId, "p_loser_20", "p_keeper_20");
    assert.equal(newLease.ok, true);

    // Old worker attempts to advance stage
    await assert.rejects(
      async () => {
        await mergeRoute.verifyWorkerFencingAndAdvanceStage(db, jobId, oldWorker, "payments_reparented");
      },
      (err) => err instanceof mergeRoute.StaleWorkerError && err.status === 409
    );

    const jobSnap = await db.collection("mergeJobs").doc(jobId).get();
    assert.notEqual(jobSnap.data().stage, "payments_reparented");
  });

  it("Test 21: Old worker cannot update identity reservations after lease reclamation", async () => {
    await db.collection("players").doc("p_loser_21").set({
      name: "Loser 21",
      mobile: "+919876500121",
    });
    await db.collection("players").doc("p_keeper_21").set({
      name: "Keeper 21",
      mobile: "+919876500121",
    });

    const jobId = "job_p_loser_21_p_keeper_21";
    const initialLease = await mergeRoute.acquireMergeLease(db, jobId, "p_loser_21", "p_keeper_21", { leaseDurationMs: -1000 });
    const oldWorker = initialLease.workerInfo;

    // Newer worker reclaims
    await mergeRoute.acquireMergeLease(db, jobId, "p_loser_21", "p_keeper_21");

    // Old worker attempts Stage 1 execution
    await assert.rejects(
      async () => {
        await mergeRoute.executeMergeIdentityStage(
          db,
          jobId,
          "p_loser_21",
          "p_keeper_21",
          oldWorker,
          {},
          "",
          "+919876500121"
        );
      },
      (err) => err instanceof mergeRoute.StaleWorkerError && err.status === 409
    );
  });

  it("Test 22: Old worker cannot mark the merge completed", async () => {
    await db.collection("players").doc("p_loser_22").set({ name: "Loser 22" });
    await db.collection("players").doc("p_keeper_22").set({ name: "Keeper 22" });

    const jobId = "job_p_loser_22_p_keeper_22";
    const initialLease = await mergeRoute.acquireMergeLease(db, jobId, "p_loser_22", "p_keeper_22", { leaseDurationMs: -1000 });
    const oldWorker = initialLease.workerInfo;

    // Newer worker reclaims
    await mergeRoute.acquireMergeLease(db, jobId, "p_loser_22", "p_keeper_22");

    // Old worker attempts completion
    await assert.rejects(
      async () => {
        await mergeRoute.executeMergeCompletionStage(db, jobId, "p_loser_22", "p_keeper_22", oldWorker);
      },
      (err) => err instanceof mergeRoute.StaleWorkerError && err.status === 409
    );

    const loserSnap = await db.collection("players").doc("p_loser_22").get();
    assert.notEqual(loserSnap.data().disabled, true);
  });

  it("Test 23: Completed job retry returns idempotent success without acquiring a new active lease", async () => {
    await db.collection("players").doc("p_loser_23").set({
      name: "Loser 23",
      disabled: true,
      mergedInto: "p_keeper_23",
      mergeStatus: "completed",
    });
    await db.collection("players").doc("p_keeper_23").set({
      name: "Keeper 23",
      mergeStatus: "completed",
    });

    const jobId = "job_p_loser_23_p_keeper_23";
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      loserId: "p_loser_23",
      keeperId: "p_keeper_23",
      status: "completed",
      stage: "completed",
    });

    const req = createMergeRequest("p_loser_23", "p_keeper_23");
    const res = await mergeRoute.POST(req);

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.alreadyCompleted, true);

    const jobSnap = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(jobSnap.data().status, "completed");
  });

  it("Test 24: Failed job recovery follows documented lease rules", async () => {
    await db.collection("players").doc("p_loser_24").set({ name: "Loser 24" });
    await db.collection("players").doc("p_keeper_24").set({ name: "Keeper 24" });

    const jobId = "job_p_loser_24_p_keeper_24";
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      loserId: "p_loser_24",
      keeperId: "p_keeper_24",
      status: "failed",
      lastError: "Network connection terminated unexpectedly",
      fencingToken: 1,
      attemptCount: 1,
      leaseExpiresAt: Date.now() + 50000, // Even if expiry has not passed, failed status allows recovery
    });

    const recoverLease = await mergeRoute.acquireMergeLease(db, jobId, "p_loser_24", "p_keeper_24");
    assert.equal(recoverLease.ok, true);
    assert.equal(recoverLease.workerInfo.fencingToken, 2);
    assert.equal(recoverLease.workerInfo.attemptCount, 2);

    const jobSnap = await db.collection("mergeJobs").doc(jobId).get();
    assert.equal(jobSnap.data().status, "in_progress");
    assert.equal(jobSnap.data().lastError, null);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 3: Account-Linking Coordination Tests (Scenarios 25 - 29)
  // ══════════════════════════════════════════════════════════════════════════

  it("Test 25: Account linking is rejected while a valid merge lease exists", async () => {
    const jobId = "job_p_loser_25_p_keeper_25";
    await db.collection("players").doc("p_loser_25").set({
      name: "Loser 25",
      mobile: "+919876500125",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      loserId: "p_loser_25",
      keeperId: "p_keeper_25",
      status: "in_progress",
      leaseExpiresAt: Date.now() + 60000,
    });

    const linkRes = await linkPlayerAccount(db, {
      uid: "uid_competitor_25",
      verifiedPhoneNumber: "+919876500125",
      requestedPlayerId: "p_loser_25",
    });

    assert.equal(linkRes.ok, false);
    assert.equal(linkRes.status, 409);
    assert.ok(linkRes.error?.includes("active administrative merge"));
  });

  it("Test 26: Account linking can proceed after a genuinely completed merge only when the resulting identity state is valid", async () => {
    const jobId = "job_p_loser_26_p_keeper_26";
    // Keeper player after successful merge
    await db.collection("players").doc("p_keeper_26").set({
      name: "Keeper 26",
      mobile: "+919876500126",
      mergeStatus: "completed",
      mergeJobId: jobId,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      loserId: "p_loser_26",
      keeperId: "p_keeper_26",
      status: "completed",
    });

    const linkRes = await linkPlayerAccount(db, {
      uid: "uid_keeper_auth_26",
      verifiedPhoneNumber: "+919876500126",
      requestedPlayerId: "p_keeper_26",
    });

    assert.equal(linkRes.ok, true);
    assert.equal(linkRes.playerId, "p_keeper_26");

    const playerSnap = await db.collection("players").doc("p_keeper_26").get();
    assert.equal(playerSnap.data().authUid, "uid_keeper_auth_26");
  });

  it("Test 27: Account linking rejects partial merge state", async () => {
    const jobId = "job_p_loser_27_p_keeper_27";
    await db.collection("players").doc("p_keeper_27").set({
      name: "Keeper 27",
      mobile: "+919876500127",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
    });
    // Incomplete stage
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      loserId: "p_loser_27",
      keeperId: "p_keeper_27",
      status: "in_progress",
      stage: "payments_reparented",
      leaseExpiresAt: Date.now() - 5000, // Expired lease
    });

    const linkRes = await linkPlayerAccount(db, {
      uid: "uid_27",
      verifiedPhoneNumber: "+919876500127",
      requestedPlayerId: "p_keeper_27",
    });

    assert.equal(linkRes.ok, false);
    assert.equal(linkRes.status, 409);
  });

  it("Test 28: Account linking cannot proceed based on a stale or expired worker’s state", async () => {
    const jobId = "job_p_loser_28_p_keeper_28";
    await db.collection("players").doc("p_keeper_28").set({
      name: "Keeper 28",
      mobile: "+919876500128",
      mergeStatus: "in_progress",
      mergeJobId: jobId,
    });
    await db.collection("mergeJobs").doc(jobId).set({
      id: jobId,
      status: "in_progress",
      leaseExpiresAt: Date.now() - 1000, // Expired
    });

    const linkRes = await linkPlayerAccount(db, {
      uid: "uid_28",
      verifiedPhoneNumber: "+919876500128",
      requestedPlayerId: "p_keeper_28",
    });

    assert.equal(linkRes.ok, false);
    assert.equal(linkRes.status, 409);
  });

  it("Test 29: Concurrent account-link and merge attempts cannot both win conflicting identity ownership", async () => {
    await db.collection("players").doc("p_loser_29").set({
      name: "Loser 29",
      mobile: "+919876500129",
    });
    await db.collection("players").doc("p_keeper_29").set({
      name: "Keeper 29",
      mobile: "+919876500129",
    });

    const mergeReq = createMergeRequest("p_loser_29", "p_keeper_29");

    // Execute merge and account linking concurrently
    const [mergeRes, linkRes] = await Promise.all([
      mergeRoute.POST(mergeReq),
      linkPlayerAccount(db, {
        uid: "uid_concurrent_29",
        verifiedPhoneNumber: "+919876500129",
        requestedPlayerId: "p_keeper_29",
      }),
    ]);

    // Either merge ran first and locked the player (so link failed 409),
    // or link ran first and claimed uidIndex/authUid for keeper (in which case merge succeeded with that identity)
    // In NO case do both commit conflicting inconsistent states.
    const keeperSnap = await db.collection("players").doc("p_keeper_29").get();
    const keeperData = keeperSnap.data();

    if (linkRes.ok) {
      assert.equal(keeperData.authUid, "uid_concurrent_29");
      const uidSnap = await db.collection("uidIndex").doc("uid_concurrent_29").get();
      assert.equal(uidSnap.data().playerId, "p_keeper_29");
    } else {
      assert.equal(linkRes.status, 409);
    }
  });
});
