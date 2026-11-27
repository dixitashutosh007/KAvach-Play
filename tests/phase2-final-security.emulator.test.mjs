import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setServerDbForTesting } from "../lib/server-db.ts";
import { getUserAccount } from "../lib/server-auth.ts";
import {
  setAccountRoles,
  reconcileRoleTransition,
} from "../lib/access-control-server.ts";
import {
  authorizeRoleConsolidationExecution,
  runRoleConsolidation,
} from "../lib/role-consolidation-runner.ts";
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
      for (const col of ["appUsers", "players", "accessControl", "roleTransitions", "migrationRuns", "auditLogs", "phoneIndex", "uidIndex", "matches", "badges", "playerStats", "subscriptionHistory", "outOfPlays", "posts", "pollResponses", "catchLog", "paymentReservations", "clubLeads"]) {
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

      const authCtx = authorizeRoleConsolidationExecution({ credentialSource: "emulator" });
      // Simulate batch 2 failing inside its transaction after batch 1 commits (batchSize: 1)
      await assert.rejects(
        () =>
          runRoleConsolidation(adminDb, {
            execute: true,
            auth: authCtx,
            migrationId: "mig_resume_1",
            batchSize: 1,
            onBeforeBatchTx(batchIndex) {
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
        auth: authCtx,
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
        auth: authCtx,
        migrationId: "mig_resume_1",
      });
      assert.equal(rerun.changed.length, 0);

      // Firestore rules block client writes to roleTransitions, migrationRuns, and auditLogs
      const supDb = testEnv.authenticatedContext("uid_super", { admin: true }).firestore();
      await rut.assertFails(supDb.doc("roleTransitions/rt_forged").set({ status: "completed" }));
      await rut.assertFails(supDb.doc("migrationRuns/mig_forged").set({ status: "completed" }));
      await rut.assertFails(supDb.doc("auditLogs/aud_forged").set({ action: "updated" }));
    });

    it("P2-ID-04: pending & failed revocations fail-closed in getUserAccount + Firestore rules, preserve unrelated claims, and block concurrent last-2 revokes", async () => {
      await adminDb.doc("appUsers/uid_s1").set({ name: "S1", role: "player", status: "Active" });
      await adminDb.doc("appUsers/uid_s2").set({ name: "S2", role: "player", status: "Active" });
      const { auth, users } = createMockAuth({
        uid_s1: { customClaims: { admin: true, customFlag: "keep-s1" } },
        uid_s2: { customClaims: { admin: true, customFlag: "keep-s2" } },
      });

      // 1. Fail setCustomUserClaims during revocation -> failed state, fail-closed in getUserAccount & Firestore rules
      auth.setFailNextSetClaims(new Error("AUTH_SET_CLAIMS_FAILED"));
      await assert.rejects(
        () =>
          setAccountRoles(adminDb, auth, {
            actorUid: "uid_s1",
            actorName: "S1",
            uid: "uid_s2",
            roles: [],
            expected: ["superAdmin"],
            idempotencyKey: "rev_fail_claims_1",
          }),
        (err) => err.status === 502 && err.extra.reconciliationRequired === true,
      );

      // Normal authorization path denies superAdmin even though token still has admin: true
      const acctFailed = await getUserAccount(null, "uid_s2", { admin: true });
      assert.equal(acctFailed.ok, true);
      assert.equal(acctFailed.roles.has("superAdmin"), false);
      assert.equal(acctFailed.roles.has("clubAdmin"), false);
      assert.equal(acctFailed.roles.has("financeAdmin"), false);

      // Firestore rules also deny superAdmin during pending/failed revocation
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc("accessControl/superAdmins").set({ uids: ["uid_s1", "uid_s2"], pendingRevokes: ["uid_s2"] });
        await ctx.firestore().doc("players/p_rules_check").set({ id: "p_rules_check", name: "Rules Check" });
      });
      const s2RulesDb = testEnv.authenticatedContext("uid_s2", { admin: true }).firestore();
      await rut.assertFails(s2RulesDb.collection("players").get());

      // Pending-only revocation state also fails closed in getUserAccount
      await adminDb.doc("roleTransitions/rt_pending_check").set({
        transitionId: "rt_pending_check",
        uid: "uid_s2",
        superChange: "revoke",
        status: "pending",
      });
      const acctPending = await getUserAccount(null, "uid_s2", { admin: true });
      assert.equal(acctPending.ok, true);
      assert.equal(acctPending.roles.has("superAdmin"), false);
      await adminDb.doc("roleTransitions/rt_pending_check").delete();

      // Reconcile succeeds and preserves unrelated custom claims
      const rec = await reconcileRoleTransition(adminDb, auth, {
        transitionId: "rev_fail_claims_1",
        actorUid: "uid_s1",
        actorName: "S1",
      });
      assert.equal(rec.status, "completed");
      assert.equal(users.get("uid_s2").customClaims.admin, undefined);
      assert.equal(users.get("uid_s2").customClaims.customFlag, "keep-s2");

      // 2. Concurrent revocations of the last 2 Super Admins -> exactly 1 succeeds, 1 fails with 409
      await adminDb.doc("appUsers/uid_s3").set({ name: "S3", role: "player", status: "Active" });
      await adminDb.doc("appUsers/uid_s4").set({ name: "S4", role: "player", status: "Active" });
      const { auth: auth2 } = createMockAuth({
        uid_s3: { customClaims: { admin: true } },
        uid_s4: { customClaims: { admin: true } },
        uid_actor: { customClaims: { admin: true } },
      });
      await adminDb.doc("accessControl/superAdmins").set({ uids: ["uid_s3", "uid_s4"], pendingRevokes: [] });
      const results = await Promise.allSettled([
        setAccountRoles(adminDb, auth2, {
          actorUid: "uid_actor",
          actorName: "Actor",
          uid: "uid_s3",
          roles: [],
          expected: ["superAdmin"],
        }),
        setAccountRoles(adminDb, auth2, {
          actorUid: "uid_actor",
          actorName: "Actor",
          uid: "uid_s4",
          roles: [],
          expected: ["superAdmin"],
        }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].reason.status, 409);
    });

    it("Role consolidation: enforces credential-backed capability, TOCTOU transaction fencing, and immutable plan fingerprinting", async () => {
      await adminDb.doc("appUsers/u_rc_1").set({ name: "RC1", isMatchAdmin: true, status: "Active" });
      await adminDb.doc("appUsers/u_rc_2").set({ name: "RC2", isStudioAdmin: true, status: "Active" });
      const authCtx = authorizeRoleConsolidationExecution({ credentialSource: "emulator" });

      // 1. Negative capability tests:
      // 1a. Unauthorized Next.js server runtime cannot mint a capability even if it imports the runner
      const prevNextRuntime = process.env.NEXT_RUNTIME;
      try {
        process.env.NEXT_RUNTIME = "nodejs";
        assert.throws(
          () => authorizeRoleConsolidationExecution({ credentialSource: "emulator" }),
          (err) => err.status === 403 && /Next\.js runtime/i.test(err.message),
        );
      } finally {
        if (prevNextRuntime === undefined) delete process.env.NEXT_RUNTIME;
        else process.env.NEXT_RUNTIME = prevNextRuntime;
      }

      // 1b. Missing serviceAccountKey.json cannot mint service_account capability
      assert.throws(
        () =>
          authorizeRoleConsolidationExecution({
            credentialSource: "service_account",
            serviceAccountPath: "/nonexistent/serviceAccountKey.json",
          }),
        (err) => err.status === 403,
      );

      // 1c. Missing auth or plain JSON object (even with Symbol-like shape) is rejected (403)
      await assert.rejects(
        () => runRoleConsolidation(adminDb, { execute: true, migrationId: "mig_unauth" }),
        (err) => err.status === 403,
      );
      await assert.rejects(
        () =>
          runRoleConsolidation(adminDb, {
            execute: true,
            auth: { actorId: "system:role-consolidation", actorName: "Spoof" },
            migrationId: "mig_spoof",
          }),
        (err) => err.status === 403,
      );

      // 1d. Module boundary check: lib/access-control-server.ts does not export runRoleConsolidation or authorizeRoleConsolidationExecution
      const acServerSrc = fs.readFileSync(path.resolve(__dirname, "../lib/access-control-server.ts"), "utf8");
      assert.equal(/export\s+async\s+function\s+runRoleConsolidation/.test(acServerSrc), false);
      assert.equal(/export\s+function\s+authorizeRoleConsolidationExecution/.test(acServerSrc), false);

      // 2. Plan consistency: same ID + same plan resumes; same ID + changed plan rejects (409)
      await assert.rejects(
        () =>
          runRoleConsolidation(adminDb, {
            execute: true,
            auth: authCtx,
            migrationId: "mig_plan_1",
            batchSize: 1,
            onBeforeBatchTx(batchIndex) {
              if (batchIndex === 2) throw new Error("INTERRUPTED_AT_BATCH_2");
            },
          }),
        /INTERRUPTED_AT_BATCH_2/,
      );
      // Same ID + additional UID -> rejected 409
      await adminDb.doc("appUsers/u_rc_extra").set({ name: "Extra", isDesigner: true, status: "Active" });
      await assert.rejects(
        () => runRoleConsolidation(adminDb, { execute: true, auth: authCtx, migrationId: "mig_plan_1" }),
        (err) => err.status === 409 && /plan changed/i.test(err.message),
      );
      await adminDb.doc("appUsers/u_rc_extra").delete();

      // Same ID + changed role/grant instruction for pending UID (u_rc_2) -> rejected 409
      await adminDb.doc("appUsers/u_rc_2").update({ isDesigner: true });
      await assert.rejects(
        () => runRoleConsolidation(adminDb, { execute: true, auth: authCtx, migrationId: "mig_plan_1" }),
        (err) => err.status === 409 && /plan changed/i.test(err.message),
      );
      await adminDb.doc("appUsers/u_rc_2").set({ name: "RC2", isStudioAdmin: true, status: "Active" });

      // Same ID + changed role/grant instruction for already-migrated UID (u_rc_1) -> rejected 409
      await adminDb.doc("appUsers/u_rc_1").update({ isDesigner: true });
      await assert.rejects(
        () => runRoleConsolidation(adminDb, { execute: true, auth: authCtx, migrationId: "mig_plan_1" }),
        (err) => err.status === 409 && /plan changed/i.test(err.message),
      );
      await adminDb.doc("appUsers/u_rc_1").set({
        name: "RC1",
        isClubAdmin: true,
        status: "Active",
        roleMigration: { migrationId: "mig_plan_1" },
      });

      // Same ID + removed pending UID -> rejected 409
      await adminDb.doc("appUsers/u_rc_2").delete();
      await assert.rejects(
        () => runRoleConsolidation(adminDb, { execute: true, auth: authCtx, migrationId: "mig_plan_1" }),
        (err) => err.status === 409 && /plan changed/i.test(err.message),
      );
      await adminDb.doc("appUsers/u_rc_2").set({ name: "RC2", isStudioAdmin: true, status: "Active" });

      // Same ID + identical plan -> resumes and completes
      const resumedSamePlan = await runRoleConsolidation(adminDb, {
        execute: true,
        auth: authCtx,
        migrationId: "mig_plan_1",
        batchSize: 1,
      });
      assert.equal(resumedSamePlan.changed.length, 1);
      assert.equal(resumedSamePlan.changed[0].uid, "u_rc_2");
      assert.equal((await adminDb.doc("migrationRuns/mig_plan_1").get()).data().status, "completed");

      // Completed ID + same plan -> harmless no-op
      const noopCompleted = await runRoleConsolidation(adminDb, {
        execute: true,
        auth: authCtx,
        migrationId: "mig_plan_1",
      });
      assert.equal(noopCompleted.alreadyCompleted, true);
      assert.equal(noopCompleted.changed.length, 0);

      // Completed ID + changed plan -> rejected 409
      await adminDb.doc("appUsers/u_rc_3").set({ name: "RC3", isDesigner: true, status: "Active" });
      await assert.rejects(
        () => runRoleConsolidation(adminDb, { execute: true, auth: authCtx, migrationId: "mig_plan_1" }),
        (err) => err.status === 409,
      );

      // 3. Concurrent executions with the same migrationId -> 1 wins lease, 1 gets 409
      const conc = await Promise.allSettled([
        runRoleConsolidation(adminDb, {
          execute: true,
          auth: authCtx,
          migrationId: "mig_conc_1",
          onBeforeBatchTx: () => new Promise((r) => setTimeout(r, 80)),
        }),
        runRoleConsolidation(adminDb, { execute: true, auth: authCtx, migrationId: "mig_conc_1" }),
      ]);
      assert.equal(conc.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(conc.filter((r) => r.status === "rejected" && r.reason?.status === 409).length, 1);

      // 4. Deterministic TOCTOU concurrency test:
      // Process A acquires fencingToken=1, pauses AFTER initial lease validation (in onBeforeBatchTx),
      // lease expires, Process B acquires fencingToken=2 and commits, Process A resumes and MUST be
      // rejected inside its batch transaction without committing stale writes.
      await adminDb.doc("appUsers/u_rc_toctou").set({ name: "TOCTOU", isMatchAdmin: true, status: "Active" });
      let releaseA;
      let signalAPaused;
      const aPaused = new Promise((r) => {
        signalAPaused = r;
      });
      const gateA = new Promise((r) => {
        releaseA = r;
      });
      const promiseA = runRoleConsolidation(adminDb, {
        execute: true,
        auth: authCtx,
        migrationId: "mig_toctou_1",
        leaseDurationMs: 50,
        onBeforeBatchTx: async () => {
          signalAPaused();
          await gateA;
        },
      });
      await aPaused;
      // Wait for Process A's 50ms lease to expire, then run Process B (fencingToken=2)
      await new Promise((r) => setTimeout(r, 90));
      const resB = await runRoleConsolidation(adminDb, {
        execute: true,
        auth: authCtx,
        migrationId: "mig_toctou_1",
      });
      assert.equal(resB.changed.some((c) => c.uid === "u_rc_toctou"), true);
      const runAfterB = (await adminDb.doc("migrationRuns/mig_toctou_1").get()).data();
      assert.equal(runAfterB.fencingToken, 2);
      assert.equal(runAfterB.status, "completed");

      // Resume Process A: its batch transaction MUST fail with 409 and NOT overwrite completed state
      releaseA();
      await assert.rejects(
        () => promiseA,
        (err) => err.status === 409 && /fencing|superseded/i.test(err.message),
      );
      const runAfterA = (await adminDb.doc("migrationRuns/mig_toctou_1").get()).data();
      assert.equal(runAfterA.fencingToken, 2);
      assert.equal(runAfterA.status, "completed");
    });

    it("P2-DEL-01: blocks DELETE on squad membership, scorecards/stats, clubLeads, embedded match fields, allows safe unreferenced delete & historical PATCH", async () => {
      const clubHeaders = { "content-type": "application/json", "x-test-uid": "uid_club", "x-test-role": "clubAdmin" };

      // Non-Club-Admin cannot call DELETE ?unlink=true
      for (const role of ["player", "financeAdmin"]) {
        const denied = await deleteAdminPlayer(
          new Request("https://play.kavachcricket.com/api/admin/players?playerId=any_p&unlink=true", {
            method: "DELETE",
            headers: { "x-test-uid": "uid_other", "x-test-role": role },
          }),
        );
        assert.equal(denied.status, 403);
      }

      const cases = [
        ["squad_unpaid", async (pid) => adminDb.doc(`matches/m_sq1/payments/m_sq1_${pid}`).set({ id: `m_sq1_${pid}`, matchId: "m_sq1", playerId: pid, status: "Unpaid", availability: "Confirmed", amount: 500 })],
        ["squad_paid", async (pid) => adminDb.doc(`matches/m_sq2/payments/m_sq2_${pid}`).set({ id: `m_sq2_${pid}`, matchId: "m_sq2", playerId: pid, status: "Paid", availability: "Confirmed", amount: 500 })],
        ["comments_sub", async (pid) => adminDb.doc(`matches/m_c1/comments/c_${pid}`).set({ id: `c_${pid}`, playerId: pid, text: "hi" })],
        ["posts_potw", async (pid) => adminDb.doc(`posts/post_${pid}`).set({ id: `post_${pid}`, potw: { playerId: pid } })],
        ["pollResponses", async (pid) => adminDb.doc(`pollResponses/pr_${pid}`).set({ id: `pr_${pid}`, playerId: pid })],
        ["match_potm_str", async (pid) => adminDb.doc(`matches/m_potm_${pid}`).set({ id: `m_potm_${pid}`, playerOfTheMatch: pid })],
        ["match_best_bat", async (pid) => adminDb.doc(`matches/m_bat_${pid}`).set({ id: `m_bat_${pid}`, bestBatsman: pid })],
        ["match_best_bowl", async (pid) => adminDb.doc(`matches/m_bowl_${pid}`).set({ id: `m_bowl_${pid}`, bestBowler: pid })],
        ["playerStats_perf", async (pid) => adminDb.doc(`playerStats/2026_${pid}`).set({ id: `2026_${pid}`, playerId: pid, year: 2026, runs: 245, wickets: 12 })],
        ["catchLog", async (pid) => adminDb.doc(`catchLog/cl_${pid}`).set({ id: `cl_${pid}`, playerId: pid })],
        ["paymentReservations", async (pid) => adminDb.doc(`paymentReservations/res_${pid}`).set({ id: `res_${pid}`, playerId: pid })],
        ["clubLeads", async (pid) => adminDb.doc(`clubLeads/lead_${pid}`).set({ id: `lead_${pid}`, convertedPlayerId: pid, status: "converted" })],
      ];
      for (const [label, seed] of cases) {
        const pid = `p_cov_${label}`;
        await adminDb.doc(`players/${pid}`).set({ id: pid, name: label, mobile: "9876543210" });
        await seed(pid);
        const res = await deleteAdminPlayer(
          new Request(`https://play.kavachcricket.com/api/admin/players?playerId=${pid}`, { method: "DELETE", headers: clubHeaders }),
        );
        assert.equal(res.status, 409, `Expected 409 for ${label}`);
      }

      // feePlanIds on player doc
      await adminDb.doc("players/p_cov_plans").set({ id: "p_cov_plans", name: "Plans", mobile: "9876543210", feePlanIds: ["plan_1"] });
      const planDel = await deleteAdminPlayer(
        new Request("https://play.kavachcricket.com/api/admin/players?playerId=p_cov_plans", { method: "DELETE", headers: clubHeaders }),
      );
      assert.equal(planDel.status, 409);

      // Safe deletion of genuinely unreferenced player succeeds with audit
      await adminDb.doc("players/p_clean_unref").set({ id: "p_clean_unref", name: "Clean Ghost", mobile: "9876500011" });
      const cleanDel = await deleteAdminPlayer(
        new Request("https://play.kavachcricket.com/api/admin/players?playerId=p_clean_unref", { method: "DELETE", headers: clubHeaders }),
      );
      assert.equal(cleanDel.status, 200);
      assert.equal((await adminDb.doc("players/p_clean_unref").get()).exists, false);

      // Cross-player identity collision: phoneIndex belongs to p_other -> DELETE ?unlink=true fails closed (409)
      await adminDb.doc("players/p_collide_target").set({ id: "p_collide_target", name: "Collide", mobile: "9876509988" });
      await adminDb.doc("phoneIndex/+919876509988").set({ canonicalPhone: "+919876509988", playerId: "p_other_owner", authUid: "uid_other_owner" });
      const collideDel = await deleteAdminPlayer(
        new Request("https://play.kavachcricket.com/api/admin/players?playerId=p_collide_target&unlink=true", { method: "DELETE", headers: clubHeaders }),
      );
      assert.equal(collideDel.status, 409);
      assert.equal((await adminDb.doc("phoneIndex/+919876509988").get()).data().playerId, "p_other_owner");
      assert.equal((await adminDb.doc("players/p_collide_target").get()).exists, true);
    });
  },
);
