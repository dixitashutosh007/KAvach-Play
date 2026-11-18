/**
 * Security Remediation 1D: Identity Lifecycle, Conflict Resolution & Population Audit
 * (tests/remediation1d-identity-lifecycle.emulator.test.mjs)
 *
 * Verifies:
 * - SEC-1C-01: Detects existing player.authUid mappings across ALL players; fails closed with 409.
 * - SEC-1C-02: Enforces index lifecycle guarantees across player mobile changes, unlinked duplicates,
 *              orphaned indexes, and index disagreements.
 * - SEC-1C-03: Verifies genuine Firestore transaction rollback using executeLinkingTransaction without test hooks in production params.
 * - SEC-1C-04: Full-population bootstrap collision audit across players, appUsers, phoneIndex, and uidIndex.
 * - Player merge reparents uidIndex and phoneIndex records atomically.
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

describe("Security Remediation 1D: Identity Lifecycle & Population Audit Suite", { skip: skipReason }, () => {
  let testEnv;
  let db;
  let linkPlayerAccount;
  let executeLinkingTransaction;
  let parseStrictIndianMobile;
  let generateIdentityCollisionReport;

  before(async () => {
    if (!emulatorHost) return;

    const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
    const [host, portStr] = emulatorHost.split(":");
    testEnv = await initializeTestEnvironment({
      projectId: "kavach-remediation1d-test",
      firestore: {
        host,
        port: parseInt(portStr, 10),
        rules: rulesContent,
      },
    });

    const { getApps, initializeApp } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = !getApps().some((a) => a.name === "remediation1d-test")
      ? initializeApp({ projectId: "kavach-remediation1d-test" }, "remediation1d-test")
      : getApps().find((a) => a.name === "remediation1d-test");
    db = getFirestore(app);

    const linkingModule = await import("../lib/account-linking.ts");
    linkPlayerAccount = linkingModule.linkPlayerAccount;
    executeLinkingTransaction = linkingModule.executeLinkingTransaction;
    parseStrictIndianMobile = linkingModule.parseStrictIndianMobile;

    const serverAuthModule = await import("../lib/server-auth.ts");
    serverAuthModule.setAuthDbForTesting(db);

    const bootstrapModule = await import("../scripts/bootstrap-identity-index.ts");
    generateIdentityCollisionReport = bootstrapModule.generateIdentityCollisionReport;
  });

  beforeEach(async () => {
    if (!testEnv) return;
    await testEnv.clearFirestore();
  });

  // ── 1. SEC-1C-01: Detect Existing player.authUid Mappings ──────────────────

  it("Test 1: Existing players.authUid = uid with missing appUsers.playerId -> Rejected 409", async () => {
    // Player A already has authUid set to user_1, but appUsers/user_1 has NO playerId
    await db.collection("players").doc("p_existing_auth").set({
      name: "Existing Auth Player",
      mobile: "+919876500001",
      authUid: "user_incomplete_1",
    });

    await db.collection("appUsers").doc("user_incomplete_1").set({
      name: "Existing Auth User",
      email: "incomplete@example.com",
      status: "Active",
      // missing playerId
    });

    const res = await linkPlayerAccount(db, {
      uid: "user_incomplete_1",
      verifiedPhoneNumber: "+919876500001",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Inconsistent identity mapping/);
  });

  it("Test 2: Existing players.authUid = uid pointing to different player -> Rejected 409", async () => {
    // Player A has authUid = user_claimed
    await db.collection("players").doc("p_claimed_a").set({
      name: "Player A",
      mobile: "+919876500001",
      authUid: "user_claimed",
    });

    // Player B has mobile +919876500002
    await db.collection("players").doc("p_target_b").set({
      name: "Player B",
      mobile: "+919876500002",
    });

    // User attempts to link to Player B via Player B's phone
    const res = await linkPlayerAccount(db, {
      uid: "user_claimed",
      verifiedPhoneNumber: "+919876500002",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /User account is already linked to another player record/);
  });

  it("Test 3: Two player documents with same authUid -> Rejected 409", async () => {
    // Two historical player documents both have authUid = user_duplicate_auth
    await db.collection("players").doc("p_dup_1").set({
      name: "Player Dup 1",
      mobile: "+919876500001",
      authUid: "user_duplicate_auth",
    });
    await db.collection("players").doc("p_dup_2").set({
      name: "Player Dup 2",
      mobile: "+919876500001",
      authUid: "user_duplicate_auth",
    });

    const res = await linkPlayerAccount(db, {
      uid: "user_duplicate_auth",
      verifiedPhoneNumber: "+919876500001",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Multiple player records found|Ambiguous identity/);
  });

  // ── 2. SEC-1C-02: Duplicate Phone & Index Lifecycle Guarantees ─────────────

  it("Test 4: Linked/unlinked duplicate phone numbers -> Rejected 409", async () => {
    // One player linked, one player unlinked, both sharing identical mobile
    await db.collection("players").doc("p_linked").set({
      name: "Linked Player",
      mobile: "+919876500010",
      authUid: "uid_linked",
    });
    await db.collection("players").doc("p_unlinked").set({
      name: "Unlinked Player",
      mobile: "+919876500010",
    });

    const res = await linkPlayerAccount(db, {
      uid: "new_claimant",
      verifiedPhoneNumber: "+919876500010",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Multiple player records found with this phone number/);
  });

  it("Test 5: Duplicate phone numbers with different formatting -> Rejected 409", async () => {
    // Two players with same 10-digit number in different format representations
    await db.collection("players").doc("p_fmt_1").set({
      name: "Player Format 1",
      mobile: "9876500020",
    });
    await db.collection("players").doc("p_fmt_2").set({
      name: "Player Format 2",
      mobile: "+91 98765-00020",
    });

    const res = await linkPlayerAccount(db, {
      uid: "claimant_fmt",
      verifiedPhoneNumber: "+919876500020",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Multiple player records found with this phone number/);
  });

  it("Test 6: Existing phoneIndex with additional unindexed duplicate player -> Rejected 409", async () => {
    // phoneIndex exists for +919876500030 -> p_indexed
    await db.collection("phoneIndex").doc("+919876500030").set({
      playerId: "p_indexed",
      phone: "+919876500030",
    });
    await db.collection("players").doc("p_indexed").set({
      name: "Indexed Player",
      mobile: "+919876500030",
    });

    // Unindexed second player with same number
    await db.collection("players").doc("p_unindexed_duplicate").set({
      name: "Duplicate Unindexed Player",
      mobile: "09876500030",
    });

    const res = await linkPlayerAccount(db, {
      uid: "claimant_indexed_dup",
      verifiedPhoneNumber: "+919876500030",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Multiple player records found with this phone number/);
  });

  it("Test 7: Existing uidIndex with orphaned player reference -> Rejected 409", async () => {
    // uidIndex points to nonexistent player
    await db.collection("uidIndex").doc("uid_orphan_owner").set({
      playerId: "nonexistent_player_123",
      canonicalPhone: "+919876500040",
    });

    // Target candidate exists
    await db.collection("players").doc("p_actual_target").set({
      name: "Actual Target",
      mobile: "+919876500040",
    });

    const res = await linkPlayerAccount(db, {
      uid: "uid_orphan_owner",
      verifiedPhoneNumber: "+919876500040",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Existing user reservation references non-existent player record|already linked to another player profile/);
  });

  it("Test 8: phoneIndex and uidIndex disagreement -> Rejected 409", async () => {
    await db.collection("players").doc("p_target_alpha").set({
      name: "Alpha Player",
      mobile: "+919876500050",
    });
    await db.collection("players").doc("p_target_beta").set({
      name: "Beta Player",
      mobile: "+919876500050",
    });

    // phoneIndex points to alpha, uidIndex points to beta
    await db.collection("phoneIndex").doc("+919876500050").set({
      playerId: "p_target_alpha",
      phone: "+919876500050",
    });
    await db.collection("uidIndex").doc("uid_disagree").set({
      playerId: "p_target_beta",
      canonicalPhone: "+919876500050",
    });

    const res = await linkPlayerAccount(db, {
      uid: "uid_disagree",
      verifiedPhoneNumber: "+919876500050",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
  });

  // ── 3. AppUsers Boundary Validations ──────────────────────────────────────

  it("Test 9: appUsers pointing to missing player is rejected", async () => {
    await db.collection("players").doc("p_valid_player").set({
      name: "Valid Player",
      mobile: "+919876500060",
    });

    // User document already exists but points to a phantom player
    await db.collection("appUsers").doc("uid_phantom_link").set({
      name: "Phantom User",
      playerId: "p_phantom_never_existed",
      status: "Active",
    });

    const res = await linkPlayerAccount(db, {
      uid: "uid_phantom_link",
      verifiedPhoneNumber: "+919876500060",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /User account is already linked to another player profile/);
  });

  it("Test 10: Multiple appUsers pointing to same player -> Rejected 409 and flagged in audit", async () => {
    await db.collection("players").doc("p_target_player_10").set({
      name: "Shared Target Player",
      mobile: "+919876500070",
      authUid: "user_already_has_player",
    });

    // User A already points to this player
    await db.collection("appUsers").doc("user_already_has_player").set({
      name: "First User",
      playerId: "p_target_player_10",
      status: "Active",
    });

    // User B also points to this player (legacy collision)
    await db.collection("appUsers").doc("user_legacy_second").set({
      name: "Second User",
      playerId: "p_target_player_10",
      status: "Active",
    });

    // User C tries to link to the same player -> Rejected 409
    const res = await linkPlayerAccount(db, {
      uid: "user_third_claimant",
      verifiedPhoneNumber: "+919876500070",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Player record is already linked to another user account/);

    // Audit report independently flags MULTIPLE_USERS_PER_PLAYER
    const report = await generateIdentityCollisionReport(db);
    assert.equal(report.safeToBootstrap, false);
    const multipleUserIssue = report.appUserInconsistencies.find((i) =>
      i.issue.includes("Multiple appUsers"),
    );
    assert.ok(multipleUserIssue, "Audit report must flag multiple appUsers referencing same player");
  });

  // ── 4. SEC-1C-03: Real Transaction Abort (No Production Test Hook) ────────

  it("Test 11: Real transaction abort without test-only production flags", async () => {
    await db.collection("players").doc("p_rollback_target").set({
      name: "Rollback Target",
      mobile: "+919876500080",
    });

    // Public linkPlayerAccount contract does NOT accept _simulateAbortBeforeCommit
    // Rollback is tested directly against executeLinkingTransaction inside a real Firestore transaction
    await assert.rejects(async () => {
      await db.runTransaction(async (transaction) => {
        await executeLinkingTransaction(db, transaction, {
          uid: "uid_genuine_rollback",
          canonicalAuthPhone: "+919876500080",
          resolvedPlayerId: "p_rollback_target",
        });
        throw new Error("Deliberate abort in test transaction wrapper.");
      });
    }, /Deliberate abort in test transaction wrapper/);

    // Assert that NONE of the 4 staged writes committed to the emulator
    const phoneSnap = await db.collection("phoneIndex").doc("+919876500080").get();
    assert.equal(phoneSnap.exists, false);

    const uidSnap = await db.collection("uidIndex").doc("uid_genuine_rollback").get();
    assert.equal(uidSnap.exists, false);

    const playerSnap = await db.collection("players").doc("p_rollback_target").get();
    assert.equal(playerSnap.data().authUid, undefined);

    const userSnap = await db.collection("appUsers").doc("uid_genuine_rollback").get();
    assert.equal(userSnap.exists, false);
  });

  // ── 5. Player Merge Reparenting uidIndex and phoneIndex ────────────────────

  it("Test 12: Player merge reparents uidIndex and phoneIndex", async () => {
    // Setup loser and keeper player records
    await db.collection("players").doc("p_merge_loser").set({
      name: "Loser Player",
      mobile: "+919876500091",
      authUid: "uid_loser_account",
    });
    await db.collection("players").doc("p_merge_keeper").set({
      name: "Keeper Player",
      mobile: "+919876500092",
    });

    // Associated indexes for loser
    await db.collection("uidIndex").doc("uid_loser_account").set({
      playerId: "p_merge_loser",
      canonicalPhone: "+919876500091",
    });
    await db.collection("phoneIndex").doc("+919876500091").set({
      playerId: "p_merge_loser",
      authUid: "uid_loser_account",
    });
    await db.collection("appUsers").doc("uid_loser_account").set({
      playerId: "p_merge_loser",
      status: "Active",
    });

    // Execute merge route handler
    const mergeRoute = await import("../app/api/admin/merge-players/route.ts");
    const fakeReq = new Request("http://localhost:3000/api/admin/merge-players", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-uid": "admin_merge_runner",
        "x-test-admin-claim": "true",
        "x-test-role": "clubAdmin",
      },
      body: JSON.stringify({
        loserId: "p_merge_loser",
        keeperId: "p_merge_keeper",
      }),
    });

    const res = await mergeRoute.POST(fakeReq);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.uidIndexReparented, 1);
    assert.equal(json.phoneIndexReparented, 1);
    assert.equal(json.appUsersReparented, 1);

    // Verify uidIndex now points to keeperId
    const updatedUidSnap = await db.collection("uidIndex").doc("uid_loser_account").get();
    assert.equal(updatedUidSnap.data().playerId, "p_merge_keeper");

    // Verify phoneIndex now points to keeperId
    const updatedPhoneSnap = await db.collection("phoneIndex").doc("+919876500091").get();
    assert.equal(updatedPhoneSnap.data().playerId, "p_merge_keeper");

    // Verify appUsers now points to keeperId
    const updatedUserSnap = await db.collection("appUsers").doc("uid_loser_account").get();
    assert.equal(updatedUserSnap.data().playerId, "p_merge_keeper");

    // Verify keeper inherited authUid
    const keeperSnap = await db.collection("players").doc("p_merge_keeper").get();
    assert.equal(keeperSnap.data().authUid, "uid_loser_account");

    // Verify loser is soft deleted
    const loserSnap = await db.collection("players").doc("p_merge_loser").get();
    assert.equal(loserSnap.data().disabled, true);
    assert.equal(loserSnap.data().mergedInto, "p_merge_keeper");
  });

  // ── 6. SEC-1C-04: Full Population Bootstrap Audit ─────────────────────────

  it("Test 13: Bootstrap collision audit inspects full population and emits safeToBootstrap", async () => {
    // 1. Setup clean baseline
    await db.collection("players").doc("p_audit_clean_1").set({
      name: "Clean Player 1",
      mobile: "+919876510001",
      authUid: "uid_audit_1",
    });
    await db.collection("appUsers").doc("uid_audit_1").set({
      playerId: "p_audit_clean_1",
      status: "Active",
    });
    await db.collection("phoneIndex").doc("+919876510001").set({
      playerId: "p_audit_clean_1",
      phone: "+919876510001",
    });
    await db.collection("uidIndex").doc("uid_audit_1").set({
      playerId: "p_audit_clean_1",
      canonicalPhone: "+919876510001",
    });

    const cleanReport = await generateIdentityCollisionReport(db);
    assert.equal(cleanReport.safeToBootstrap, true);
    assert.equal(cleanReport.blockingIssueCount, 0);
    assert.equal(cleanReport.summary.players.total, 1);
    assert.equal(cleanReport.summary.players.linked, 1);

    // 2. Introduce collisions into population:
    // a. Duplicate active player phone with format variation
    await db.collection("players").doc("p_audit_dup_2").set({
      name: "Duplicate Player 2",
      mobile: "9876510001", // Collides with p_audit_clean_1
    });

    // b. Orphaned appUser referencing non-existent player
    await db.collection("appUsers").doc("uid_orphan_audit").set({
      playerId: "ghost_player_999",
      status: "Active",
    });

    // c. Orphaned uidIndex
    await db.collection("uidIndex").doc("uid_ghost").set({
      playerId: "ghost_player_888",
    });

    const dirtyReport = await generateIdentityCollisionReport(db);
    assert.equal(dirtyReport.safeToBootstrap, false);
    assert.ok(dirtyReport.blockingIssueCount >= 3);
    assert.ok(dirtyReport.phoneCollisions.length >= 1);
    assert.ok(dirtyReport.appUserInconsistencies.length >= 1);
    assert.ok(dirtyReport.orphanIndexes.length >= 1);
    assert.ok(dirtyReport.remediationSuggestions.length >= 2);
  });
});