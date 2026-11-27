import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setServerDbForTesting } from "../lib/server-db.ts";
import {
  setAccountRoles,
  reconcileRoleTransition,
  runRoleConsolidation,
} from "../lib/access-control-server.ts";
import { linkPlayerAccount } from "../lib/account-linking.ts";
import {
  PATCH as patchAdminPlayer,
  DELETE as deleteAdminPlayer,
} from "../app/api/admin/players/route.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesContent = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

function createMockAuth(initialUsers = {}) {
  const users = new Map(
    Object.entries(initialUsers).map(([uid, u]) => [
      uid,
      { uid, disabled: false, customClaims: { ...(u.customClaims || {}) } },
    ]),
  );
  const revoked = [];
  let failNextSetClaims = null;
  let failNextRevokeTokens = null;

  const auth = {
    revoked,
    setFailNextSetClaims(err) {
      failNextSetClaims = err;
    },
    setFailNextRevokeTokens(err) {
      failNextRevokeTokens = err;
    },
    async getUser(uid) {
      const u = users.get(uid);
      if (!u) throw new Error(`User ${uid} not found`);
      return { ...u, customClaims: { ...u.customClaims } };
    },
    async getUsers(ids) {
      const found = [];
      for (const { uid } of ids) {
        const u = users.get(uid);
        if (u) found.push({ ...u, customClaims: { ...u.customClaims } });
      }
      return { users: found };
    },
    async setCustomUserClaims(uid, claims) {
      if (failNextSetClaims) {
        const e = failNextSetClaims;
        failNextSetClaims = null;
        throw e;
      }
      const u = users.get(uid);
      if (!u) throw new Error(`User ${uid} not found`);
      u.customClaims = { ...(claims || {}) };
    },
    async revokeRefreshTokens(uid) {
      if (failNextRevokeTokens) {
        const e = failNextRevokeTokens;
        failNextRevokeTokens = null;
        throw e;
      }
      revoked.push(uid);
    },
  };
  return { auth, users };
}

describe(
  "Phase 2 Final Security Corrections: P2-ID-04, P2-DEL-01 & Resumable Role Consolidation",
  { skip: !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (requires local emulator runner)" },
  () => {
    let testEnv;
    let rut;
    let adminDb;
    const prevEnv = {};

    before(async () => {
      if (!emulatorHost) return;
      prevEnv.NODE_ENV = process.env.NODE_ENV;
      prevEnv.KAVACH_TEST_AUTH_BYPASS = process.env.KAVACH_TEST_AUTH_BYPASS;
      process.env.NODE_ENV = "test";
      process.env.KAVACH_TEST_AUTH_BYPASS = "true";

      rut = await import("@firebase/rules-unit-testing");
      testEnv = await rut.initializeTestEnvironment({
        projectId: "kavach-phase2-final-sec",
        firestore: {
          host: emulatorHost.split(":")[0],
          port: parseInt(emulatorHost.split(":")[1], 10),
          rules: rulesContent,
        },
      });
      const app =
        getApps().find((a) => a.name === "final-sec-admin") ||
        initializeApp({ projectId: "kavach-phase2-final-sec" }, "final-sec-admin");
      adminDb = getFirestore(app);
      setServerDbForTesting(adminDb);
    });

    after(async () => {
      setServerDbForTesting(null);
      process.env.NODE_ENV = prevEnv.NODE_ENV;
      process.env.KAVACH_TEST_AUTH_BYPASS = prevEnv.KAVACH_TEST_AUTH_BYPASS;
      if (testEnv) await testEnv.cleanup();
    });

    beforeEach(async () => {
      if (!testEnv) return;
      await testEnv.clearFirestore();
      for (const col of ["appUsers", "players", "accessControl", "roleTransitions", "migrationRuns", "auditLogs", "phoneIndex", "uidIndex", "matches", "badges", "playerStats", "subscriptionHistory", "outOfPlays"]) {
        const snap = await adminDb.collection(col).get();
        if (!snap.empty) {
          const b = adminDb.batch();
          snap.docs.forEach((d) => b.delete(d.ref));
          await b.commit();
        }
      }
      await adminDb.doc("appUsers/uid_club").set({ name: "Club Admin", role: "player", isClubAdmin: true, status: "Active" });
    });

    // ── Finding 1: P2-ID-04 ────────────────────────────────────────────────
    it("P2-ID-04: successful Super Admin grant & revocation with distinct requested/completed audits and token revocation", async () => {
      await adminDb.doc("appUsers/uid_super1").set({ name: "Super 1", role: "player", status: "Active" });
      await adminDb.doc("appUsers/uid_target").set({ name: "Target User", role: "player", status: "Active" });
      const { auth, users } = createMockAuth({
        uid_super1: { customClaims: { admin: true } },
        uid_target: { customClaims: {} },
      });

      const grantRes = await setAccountRoles(adminDb, auth, {
        actorUid: "uid_super1",
        actorName: "Super 1",
        uid: "uid_target",
        roles: ["superAdmin"],
        expected: [],
        idempotencyKey: "grant_op_1",
      });
      assert.equal(grantRes.status, "completed");
      assert.equal(users.get("uid_target").customClaims.admin, true);
      const lockAfterGrant = (await adminDb.doc("accessControl/superAdmins").get()).data();
      assert.ok(lockAfterGrant.uids.includes("uid_target"));
      const transAfterGrant = (await adminDb.doc("roleTransitions/grant_op_1").get()).data();
      assert.equal(transAfterGrant.status, "completed");
      assert.equal((await adminDb.doc("auditLogs/role_req_grant_op_1").get()).exists, true);
      assert.equal((await adminDb.doc("auditLogs/role_done_grant_op_1").get()).exists, true);

      // Idempotent retry on completed grant does not duplicate
      const retryGrant = await setAccountRoles(adminDb, auth, {
        actorUid: "uid_super1",
        actorName: "Super 1",
        uid: "uid_target",
        roles: ["superAdmin"],
        expected: ["superAdmin"],
        idempotencyKey: "grant_op_1",
      });
      assert.equal(retryGrant.alreadyCompleted, true);

      // Revocation
      const revokeRes = await setAccountRoles(adminDb, auth, {
        actorUid: "uid_super1",
        actorName: "Super 1",
        uid: "uid_target",
        roles: [],
        expected: ["superAdmin"],
        idempotencyKey: "revoke_op_1",
      });
      assert.equal(revokeRes.status, "completed");
      assert.equal(users.get("uid_target").customClaims.admin, undefined);
      assert.ok(auth.revoked.includes("uid_target"));
      const lockAfterRevoke = (await adminDb.doc("accessControl/superAdmins").get()).data();
      assert.equal(lockAfterRevoke.uids.includes("uid_target"), false);
    });

    it("P2-ID-04: Auth failure during grant leaves uid out of superAdmins.uids, marks failed, and recovers via reconcileRoleTransition", async () => {
      await adminDb.doc("appUsers/uid_super1").set({ name: "Super 1", role: "player", status: "Active" });
      await adminDb.doc("appUsers/uid_target").set({ name: "Target User", role: "player", status: "Active" });
      const { auth, users } = createMockAuth({
        uid_super1: { customClaims: { admin: true } },
        uid_target: { customClaims: {} },
      });
      auth.setFailNextSetClaims(new Error("AUTH_TIMEOUT"));

      await assert.rejects(
        () =>
          setAccountRoles(adminDb, auth, {
            actorUid: "uid_super1",
            actorName: "Super 1",
            uid: "uid_target",
            roles: ["superAdmin"],
            expected: [],
            idempotencyKey: "grant_fail_1",
          }),
        (err) => err.status === 502 && err.extra.reconciliationRequired === true,
      );

      // Incomplete grant is NOT active in superAdmins.uids or Auth
      const lock = (await adminDb.doc("accessControl/superAdmins").get()).data();
      assert.equal(lock.uids.includes("uid_target"), false);
      assert.equal(users.get("uid_target").customClaims.admin, undefined);
      const trans = (await adminDb.doc("roleTransitions/grant_fail_1").get()).data();
      assert.equal(trans.status, "failed");
      assert.equal((await adminDb.doc("auditLogs/role_fail_grant_fail_1_1").get()).exists, true);

      // Concurrent conflicting change is blocked while failed transition exists
      await assert.rejects(
        () =>
          setAccountRoles(adminDb, auth, {
            actorUid: "uid_super1",
            actorName: "Super 1",
            uid: "uid_target",
            roles: ["clubAdmin"],
            expected: [],
          }),
        (err) => err.status === 409 && err.extra.reconciliationRequired === true,
      );

      // Controlled reconciliation succeeds and is idempotent
      const rec = await reconcileRoleTransition(adminDb, auth, {
        transitionId: "grant_fail_1",
        actorUid: "uid_super1",
        actorName: "Super 1",
      });
      assert.equal(rec.status, "completed");
      assert.equal(users.get("uid_target").customClaims.admin, true);
      assert.equal((await adminDb.doc("accessControl/superAdmins").get()).data().uids.includes("uid_target"), true);

      const recAgain = await reconcileRoleTransition(adminDb, auth, {
        transitionId: "grant_fail_1",
        actorUid: "uid_super1",
        actorName: "Super 1",
      });
      assert.equal(recAgain.alreadyCompleted, true);
    });

    it("P2-ID-04: Auth failure during revocation marks failed + pendingRevokes, blocks concurrent revocation, and recovers cleanly", async () => {
      await adminDb.doc("appUsers/uid_super1").set({ name: "Super 1", role: "player", status: "Active" });
      await adminDb.doc("appUsers/uid_super2").set({ name: "Super 2", role: "player", status: "Active" });
      const { auth, users } = createMockAuth({
        uid_super1: { customClaims: { admin: true } },
        uid_super2: { customClaims: { admin: true } },
      });
      auth.setFailNextRevokeTokens(new Error("REVOKE_FAILED"));

      await assert.rejects(
        () =>
          setAccountRoles(adminDb, auth, {
            actorUid: "uid_super1",
            actorName: "Super 1",
            uid: "uid_super2",
            roles: [],
            expected: ["superAdmin"],
            idempotencyKey: "rev_fail_1",
          }),
        (err) => err.status === 502 && err.extra.reconciliationRequired === true,
      );

      const trans = (await adminDb.doc("roleTransitions/rev_fail_1").get()).data();
      assert.equal(trans.status, "failed");
      assert.equal(trans.claimSynced, true);
      assert.equal(trans.tokensRevoked, false);
      const lock = (await adminDb.doc("accessControl/superAdmins").get()).data();
      assert.ok(lock.pendingRevokes.includes("uid_super2"));

      // Last-Super-Admin protection: uid_super1 cannot now be revoked while uid_super2 is pendingRevoke
      await assert.rejects(
        () =>
          setAccountRoles(adminDb, auth, {
            actorUid: "uid_super2",
            actorName: "Super 2",
            uid: "uid_super1",
            roles: [],
            expected: ["superAdmin"],
          }),
        (err) => err.status === 409,
      );

      // Reconcile completes token revocation and clears pendingRevokes
      const rec = await reconcileRoleTransition(adminDb, auth, {
        transitionId: "rev_fail_1",
        actorUid: "uid_super1",
        actorName: "Super 1",
      });
      assert.equal(rec.status, "completed");
      assert.ok(auth.revoked.includes("uid_super2"));
      assert.equal(users.get("uid_super2").customClaims.admin, undefined);
      const lockDone = (await adminDb.doc("accessControl/superAdmins").get()).data();
      assert.equal(lockDone.uids.includes("uid_super2"), false);
      assert.equal(lockDone.pendingRevokes.includes("uid_super2"), false);
    });

    it("P2-ID-04: Last-Super-Admin protection blocks revoking the sole remaining Super Admin", async () => {
      await adminDb.doc("appUsers/uid_super1").set({ name: "Super 1", role: "player", status: "Active" });
      await adminDb.doc("appUsers/uid_other").set({ name: "Other", role: "player", status: "Active" });
      const { auth } = createMockAuth({
        uid_super1: { customClaims: { admin: true } },
        uid_other: { customClaims: {} },
      });

      await assert.rejects(
        () =>
          setAccountRoles(adminDb, auth, {
            actorUid: "uid_other",
            actorName: "Other",
            uid: "uid_super1",
            roles: [],
            expected: ["superAdmin"],
          }),
        (err) => err.status === 409 && /last active Super Admin/i.test(err.message),
      );
    });

    // ── Finding 2: P2-DEL-01 ───────────────────────────────────────────────
    it("P2-DEL-01: blocks DELETE on historical match/stats/badge/subscription references while keeping PATCH disable/restore working", async () => {
      const headers = { "content-type": "application/json", "x-test-uid": "uid_club", "x-test-role": "clubAdmin" };

      // 1. Historical match participation (captainId / potmId / topPerformerIds)
      await adminDb.doc("players/p_match_hist").set({ id: "p_match_hist", name: "Captain Player", mobile: "9876543210" });
      await adminDb.doc("matches/m_cap_1").set({ id: "m_cap_1", captainId: "p_match_hist", opponent: "Rivals" });

      const delCap = await deleteAdminPlayer(
        new Request("https://play.kavachcricket.com/api/admin/players?playerId=p_match_hist", { method: "DELETE", headers }),
      );
      assert.equal(delCap.status, 409);
      assert.equal((await adminDb.doc("players/p_match_hist").get()).exists, true);

      // PATCH disable & restore still succeed for historical player
      const patchDis = await patchAdminPlayer(
        new Request("https://play.kavachcricket.com/api/admin/players", {
          method: "PATCH",
          headers,
          body: JSON.stringify({ playerId: "p_match_hist", disabled: true }),
        }),
      );
      assert.equal(patchDis.status, 200);
      assert.equal((await adminDb.doc("players/p_match_hist").get()).data().disabled, true);

      // 2. Historical badge / playerStats / subscriptionHistory / outOfPlays
      for (const [idx, [col, docData]] of [
        ["badges", { id: "b1", playerId: "p_hist_ref_0" }],
        ["playerStats", { id: "s1", playerId: "p_hist_ref_1" }],
        ["subscriptionHistory", { id: "sub1", playerId: "p_hist_ref_2" }],
        ["outOfPlays", { id: "oop1", playerId: "p_hist_ref_3" }],
        ["matches", { id: "m_top_1", topPerformerIds: ["p_hist_ref_4"] }],
      ].entries()) {
        const pid = `p_hist_ref_${idx}`;
        await adminDb.doc(`players/${pid}`).set({ id: pid, name: `Hist ${idx}`, mobile: "9876543210" });
        await adminDb.doc(`${col}/${docData.id}`).set(docData);
        const res = await deleteAdminPlayer(
          new Request(`https://play.kavachcricket.com/api/admin/players?playerId=${pid}`, { method: "DELETE", headers }),
        );
        assert.equal(res.status, 409, `Expected 409 for ${col} reference`);
      }
    });

    it("P2-DEL-01: prevents stale phoneIndex/uidIndex on linked player delete; supports validated unlink=true and blocks cross-player conflict", async () => {
      const headers = { "content-type": "application/json", "x-test-uid": "uid_club", "x-test-role": "clubAdmin" };
      await adminDb.doc("players/p_linked_del").set({
        id: "p_linked_del",
        name: "Linked Unplayed",
        mobile: "9876501122",
        inviteStatus: "Accepted",
      });
      const linked = await linkPlayerAccount(adminDb, {
        uid: "uid_linked_del",
        verifiedPhoneNumber: "+919876501122",
        idempotencyKey: "link_for_del",
      });
      assert.equal(linked.ok, true);

      // Default DELETE without unlink=true must refuse (409) and leave indexes intact
      const blocked = await deleteAdminPlayer(
        new Request("https://play.kavachcricket.com/api/admin/players?playerId=p_linked_del", { method: "DELETE", headers }),
      );
      assert.equal(blocked.status, 409);
      assert.equal((await adminDb.doc("phoneIndex/+919876501122").get()).exists, true);
      assert.equal((await adminDb.doc("uidIndex/uid_linked_del").get()).exists, true);

      // Validated unlink=true atomically cleans phoneIndex/uidIndex, clears appUsers.playerId, and deletes player
      const unlinkedDel = await deleteAdminPlayer(
        new Request("https://play.kavachcricket.com/api/admin/players?playerId=p_linked_del&unlink=true", { method: "DELETE", headers }),
      );
      assert.equal(unlinkedDel.status, 200);
      assert.equal((await adminDb.doc("players/p_linked_del").get()).exists, false);
      assert.equal((await adminDb.doc("phoneIndex/+919876501122").get()).exists, false);
      assert.equal((await adminDb.doc("uidIndex/uid_linked_del").get()).exists, false);
      assert.equal((await adminDb.doc("appUsers/uid_linked_del").get()).data().playerId, null);

      // Re-linking a new player with the freed phone number works cleanly (no stale index)
      await adminDb.doc("players/p_reborn").set({ id: "p_reborn", name: "Reborn", mobile: "9876501122", inviteStatus: "Accepted" });
      const relink = await linkPlayerAccount(adminDb, {
        uid: "uid_linked_del",
        verifiedPhoneNumber: "+919876501122",
        idempotencyKey: "relink_after_del",
      });
      assert.equal(relink.ok, true);
    });

    // ── Finding 3: Role consolidation ──────────────────────────────────────
    it("Role consolidation: resumable after partial batch failure, idempotent on re-run, and server-only rules enforced", async () => {
      await adminDb.doc("appUsers/u_mig_1").set({ name: "M1", isMatchAdmin: true, status: "Active" });
      await adminDb.doc("appUsers/u_mig_2").set({ name: "M2", isStudioAdmin: true, status: "Active" });
      await adminDb.doc("appUsers/u_mig_3").set({ name: "M3", isDesigner: true, isFinanceAdmin: true, status: "Active" });

      // Simulate batch 2 failing after batch 1 commits (batchSize: 1)
      await assert.rejects(
        () =>
          runRoleConsolidation(adminDb, {
            execute: true,
            migrationId: "mig_resume_1",
            batchSize: 1,
            onBeforeCommitBatch(batchIndex) {
              if (batchIndex === 2) throw new Error("SIMULATED_BATCH_2_FAILURE");
            },
          }),
        /SIMULATED_BATCH_2_FAILURE/,
      );

      const failedRun = (await adminDb.doc("migrationRuns/mig_resume_1").get()).data();
      assert.equal(failedRun.status, "failed");
      assert.equal(failedRun.batchesCommitted, 1);
      assert.equal(failedRun.migratedCount, 1);
      assert.equal((await adminDb.doc("appUsers/u_mig_1").get()).data().isClubAdmin, true);

      // Resume migration -> completes remaining 2 accounts without duplicating batch 1 audit
      const resumed = await runRoleConsolidation(adminDb, {
        execute: true,
        migrationId: "mig_resume_1",
        batchSize: 1,
      });
      assert.equal(resumed.changed.length, 2);
      const completedRun = (await adminDb.doc("migrationRuns/mig_resume_1").get()).data();
      assert.equal(completedRun.status, "completed");
      assert.equal(completedRun.batchesCommitted, 3);
      assert.equal(completedRun.migratedCount, 3);

      // Re-run again -> idempotent no-op
      const rerun = await runRoleConsolidation(adminDb, {
        execute: true,
        migrationId: "mig_resume_1",
      });
      assert.equal(rerun.changed.length, 0);

      // Firestore rules block client writes to roleTransitions, migrationRuns, and auditLogs
      const supDb = testEnv.authenticatedContext("uid_super", { admin: true }).firestore();
      await rut.assertFails(supDb.doc("roleTransitions/rt_forged").set({ status: "completed" }));
      await rut.assertFails(supDb.doc("migrationRuns/mig_forged").set({ status: "completed" }));
      await rut.assertFails(supDb.doc("auditLogs/aud_forged").set({ action: "updated" }));
    });
  },
);
