/**
 * Security Remediation 1C: Bidirectional Identity Uniqueness & Legacy Collision Protection
 * (tests/remediation1c-bidirectional-identity.emulator.test.mjs)
 *
 * Verifies live Firestore Emulator behavior for:
 * 1. SEC-1B-01: Exhaustive duplicate phone detection across formatted variants (e.g. "9876500001" vs "+91 98765-00001").
 * 2. SEC-1B-02: Authoritative bidirectional UID reservation (uidIndex/{uid}) preventing same-UID races across phones.
 * 3. SEC-1B-03: Strict Indian mobile starting-digit constraint [6-9]\d{9} across canonical and legacy formats.
 * 4. SEC-1B-04: Genuine Firestore transaction abort test verifying rollback of all 4 staged writes.
 * 5. Full 7-state historical identity conflict detection (rejecting incomplete, corrupt, or uncoordinated mappings).
 * 6. Four-record identity model atomic consistency (phoneIndex, uidIndex, players, appUsers).
 * 7. Firestore Security Rules lockdown of uidIndex (reads and writes strictly denied for client SDK).
 */

import { describe, it, before, after, beforeEach } from "node:test";
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

describe("Security Remediation 1C: Bidirectional Identity & Collision Protection Suite", { skip: skipReason }, () => {
  let testEnv;
  let db;
  let linkPlayerAccount;
  let executeLinkingTransaction;
  let parseStrictIndianMobile;
  let isCanonicalIndianMobile;
  let setAuthDbForTesting;

  before(async () => {
    if (!emulatorHost) return;
    const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
    const [host, portStr] = emulatorHost.split(":");
    testEnv = await initializeTestEnvironment({
      projectId: "kavach-remediation1c-test",
      firestore: {
        host,
        port: parseInt(portStr, 10),
        rules: rulesContent,
      },
    });

    const { getApps, initializeApp } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = !getApps().some((a) => a.name === "remediation1c-test")
      ? initializeApp({ projectId: "kavach-remediation1c-test" }, "remediation1c-test")
      : getApps().find((a) => a.name === "remediation1c-test");
    db = getFirestore(app);

    const linkingModule = await import("../lib/account-linking.ts");
    linkPlayerAccount = linkingModule.linkPlayerAccount;
    executeLinkingTransaction = linkingModule.executeLinkingTransaction;
    parseStrictIndianMobile = linkingModule.parseStrictIndianMobile;
    isCanonicalIndianMobile = linkingModule.isCanonicalIndianMobile;

    const serverAuthModule = await import("../lib/server-auth.ts");
    setAuthDbForTesting = serverAuthModule.setAuthDbForTesting;
    setAuthDbForTesting(db);
  });

  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    if (testEnv) await testEnv.clearFirestore();

    // Baseline Seed Fixtures
    // Eligible player 1
    await db.collection("players").doc("p_clean_1").set({
      name: "Clean Player 1",
      mobile: "9876500001",
      status: "Active",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Eligible player 2
    await db.collection("players").doc("p_clean_2").set({
      name: "Clean Player 2",
      mobile: "9876500002",
      status: "Active",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  // ── 1. SEC-1B-01: Exhaustive Duplicate Phone Detection ────────────────────

  it("SEC-1B-01: rejects ambiguous mapping when two historical records share number across different formats", async () => {
    // Record A has bare digits: "9876511111"
    await db.collection("players").doc("p_fmt_a").set({
      name: "Format A",
      mobile: "9876511111",
      status: "Active",
      disabled: false,
    });

    // Record B has spaces and hyphens: "+91 98765-11111"
    await db.collection("players").doc("p_fmt_b").set({
      name: "Format B",
      mobile: "+91 98765-11111",
      status: "Active",
      disabled: false,
    });

    // Caller attempts to link p_fmt_a
    const res = await linkPlayerAccount(db, {
      uid: "uid_fmt_tester",
      verifiedPhoneNumber: "+919876511111",
      requestedPlayerId: "p_fmt_a",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Multiple player records found with this phone number\. Ambiguous identity requires manual administrator resolution/);

    // Verify neither record was linked
    const snapA = await db.collection("players").doc("p_fmt_a").get();
    const snapB = await db.collection("players").doc("p_fmt_b").get();
    assert.equal(snapA.data().authUid, undefined);
    assert.equal(snapB.data().authUid, undefined);
  });

  // ── 2. SEC-1B-02: Authoritative Bidirectional UID Reservation (uidIndex) ─

  it("SEC-1B-02: establishes all 4 records atomically on successful link", async () => {
    const res = await linkPlayerAccount(db, {
      uid: "uid_4way_user",
      verifiedPhoneNumber: "+919876500001",
      requestedPlayerId: "p_clean_1",
    });

    assert.equal(res.ok, true);
    assert.equal(res.playerId, "p_clean_1");
    assert.equal(res.alreadyLinked, false);

    // Verify all 4 documents exist and agree
    const phoneIndexSnap = await db.collection("phoneIndex").doc("+919876500001").get();
    assert.equal(phoneIndexSnap.exists, true);
    assert.equal(phoneIndexSnap.data().authUid, "uid_4way_user");
    assert.equal(phoneIndexSnap.data().playerId, "p_clean_1");

    const uidIndexSnap = await db.collection("uidIndex").doc("uid_4way_user").get();
    assert.equal(uidIndexSnap.exists, true);
    assert.equal(uidIndexSnap.data().authUid, "uid_4way_user");
    assert.equal(uidIndexSnap.data().playerId, "p_clean_1");
    assert.equal(uidIndexSnap.data().canonicalPhone, "+919876500001");

    const playerSnap = await db.collection("players").doc("p_clean_1").get();
    assert.equal(playerSnap.data().authUid, "uid_4way_user");

    const userSnap = await db.collection("appUsers").doc("uid_4way_user").get();
    assert.equal(userSnap.data().playerId, "p_clean_1");
  });

  it("SEC-1B-02: two concurrent requests for the same UID across different phones conflict on uidIndex", async () => {
    const [res1, res2] = await Promise.all([
      linkPlayerAccount(db, {
        uid: "uid_race_claimant",
        verifiedPhoneNumber: "+919876500001",
        requestedPlayerId: "p_clean_1",
      }),
      linkPlayerAccount(db, {
        uid: "uid_race_claimant",
        verifiedPhoneNumber: "+919876500002",
        requestedPlayerId: "p_clean_2",
      }),
    ]);

    const successes = [res1, res2].filter((r) => r.ok && r.status === 200);
    const conflicts = [res1, res2].filter((r) => !r.ok && r.status === 409);

    assert.equal(successes.length, 1, "Exactly one link can succeed for a single UID");
    assert.equal(conflicts.length, 1, "Compete on uidIndex must be rejected with 409");

    // uidIndex must exist and point to the winning player
    const uidSnap = await db.collection("uidIndex").doc("uid_race_claimant").get();
    assert.equal(uidSnap.exists, true);
    assert.equal(uidSnap.data().playerId, successes[0].playerId);
  });

  // ── 3. SEC-1B-03: Strict Starting-Digit Enforcement [6-9]\d{9} ────────────

  it("SEC-1B-03: enforces Indian mobile starting digit [6-9] across all formats", () => {
    // Valid numbers starting with 6, 7, 8, 9
    assert.equal(parseStrictIndianMobile("+919876543210").ok, true);
    assert.equal(parseStrictIndianMobile("918876543210").ok, true);
    assert.equal(parseStrictIndianMobile("07876543210").ok, true);
    assert.equal(parseStrictIndianMobile("6876543210").ok, true);

    // Invalid starting digits (0-5)
    assert.equal(parseStrictIndianMobile("+910123456789").ok, false);
    assert.equal(parseStrictIndianMobile("+911234567890").ok, false);
    assert.equal(parseStrictIndianMobile("+912345678901").ok, false);
    assert.equal(parseStrictIndianMobile("+913456789012").ok, false);
    assert.equal(parseStrictIndianMobile("+914567890123").ok, false);
    assert.equal(parseStrictIndianMobile("+915678901234").ok, false);
    assert.equal(parseStrictIndianMobile("0123456789").ok, false);
    assert.equal(parseStrictIndianMobile("1234567890").ok, false);
    assert.equal(parseStrictIndianMobile("5999999999").ok, false);

    // Canonical check
    assert.equal(isCanonicalIndianMobile("+919876543210"), true);
    assert.equal(isCanonicalIndianMobile("+916876543210"), true);
    assert.equal(isCanonicalIndianMobile("+910000000000"), false);
    assert.equal(isCanonicalIndianMobile("+911234567890"), false);
    assert.equal(isCanonicalIndianMobile("+915999999999"), false);
  });

  // ── 4. SEC-1B-04: Genuine Transaction Abort Test ──────────────────────────

  it("SEC-1B-04: real transaction abort rolls back all 4 staged writes completely", async () => {
    // Stage all 4 transactional reads and writes, then intentionally throw inside the transaction
    await assert.rejects(async () => {
      await db.runTransaction(async (transaction) => {
        await executeLinkingTransaction(db, transaction, {
          uid: "uid_abort_tester",
          canonicalAuthPhone: "+919876500001",
          resolvedPlayerId: "p_clean_1",
        });
        throw new Error("Simulated intentional abort in test harness to trigger Firestore transaction rollback.");
      });
    }, /Simulated intentional abort in test harness/);

    // Verify ZERO writes occurred in the database across all 4 documents
    const phoneSnap = await db.collection("phoneIndex").doc("+919876500001").get();
    assert.equal(phoneSnap.exists, false, "phoneIndex must not be written on abort");

    const uidSnap = await db.collection("uidIndex").doc("uid_abort_tester").get();
    assert.equal(uidSnap.exists, false, "uidIndex must not be written on abort");

    const playerSnap = await db.collection("players").doc("p_clean_1").get();
    assert.equal(playerSnap.data().authUid, undefined, "player authUid must remain unwritten on abort");

    const userSnap = await db.collection("appUsers").doc("uid_abort_tester").get();
    assert.equal(userSnap.exists, false, "appUsers doc must not exist on abort");
  });

  // ── 5. Historical Identity Conflict States (Failing Closed) ────────────────

  it("Conflict State 1: players.authUid = uid, but appUsers has no playerId -> Rejected 409", async () => {
    await db.collection("players").doc("p_clean_1").update({ authUid: "uid_inconsistent_1" });
    await db.collection("appUsers").doc("uid_inconsistent_1").set({ name: "User 1", role: "player", status: "Active" });

    const res = await linkPlayerAccount(db, {
      uid: "uid_inconsistent_1",
      verifiedPhoneNumber: "+919876500001",
      requestedPlayerId: "p_clean_1",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Inconsistent identity mapping detected/);
  });

  it("Conflict State 2: players.authUid = uid, while appUsers points to another player -> Rejected 409", async () => {
    await db.collection("players").doc("p_clean_1").update({ authUid: "uid_inconsistent_2" });
    await db.collection("appUsers").doc("uid_inconsistent_2").set({ name: "User 2", role: "player", playerId: "p_clean_2", status: "Active" });

    const res = await linkPlayerAccount(db, {
      uid: "uid_inconsistent_2",
      verifiedPhoneNumber: "+919876500001",
      requestedPlayerId: "p_clean_1",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /User account is already linked to another player profile|Inconsistent identity mapping/);
  });

  it("Conflict State 3: uidIndex exists but target player is unlinked -> Rejected 409", async () => {
    await db.collection("uidIndex").doc("uid_inconsistent_3").set({
      playerId: "p_clean_1",
      authUid: "uid_inconsistent_3",
      canonicalPhone: "+919876500001",
    });

    const res = await linkPlayerAccount(db, {
      uid: "uid_inconsistent_3",
      verifiedPhoneNumber: "+919876500001",
      requestedPlayerId: "p_clean_1",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Inconsistent identity mapping detected/);
  });

  it("Conflict State 4: phoneIndex exists but player differs -> Rejected 409 or 403", async () => {
    await db.collection("phoneIndex").doc("+919876500001").set({
      playerId: "p_clean_2",
      authUid: "uid_other",
      phone: "+919876500001",
    });

    const res = await linkPlayerAccount(db, {
      uid: "uid_inconsistent_4",
      verifiedPhoneNumber: "+919876500001",
      requestedPlayerId: "p_clean_1",
    });

    assert.equal(res.ok, false);
    assert.ok(res.status === 403 || res.status === 409);
    assert.match(res.error, /Requested player does not match authoritatively resolved player identity|Phone number is already associated with another player profile/);
  });

  it("Conflict State 5: phoneIndex and uidIndex disagree on player -> Rejected 409", async () => {
    await db.collection("phoneIndex").doc("+919876500001").set({
      playerId: "p_clean_1",
      authUid: "uid_inconsistent_5",
      phone: "+919876500001",
    });
    await db.collection("uidIndex").doc("uid_inconsistent_5").set({
      playerId: "p_clean_2", // Disagrees with phoneIndex!
      authUid: "uid_inconsistent_5",
      canonicalPhone: "+919876500001",
    });

    const res = await linkPlayerAccount(db, {
      uid: "uid_inconsistent_5",
      verifiedPhoneNumber: "+919876500001",
      requestedPlayerId: "p_clean_1",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /User account is already linked to another player profile|Inconsistent identity mapping/);
  });

  it("Conflict State 6: player is linked but neither index exists -> Rejected 409", async () => {
    await db.collection("players").doc("p_clean_1").update({ authUid: "uid_inconsistent_6" });
    await db.collection("appUsers").doc("uid_inconsistent_6").set({ name: "User 6", role: "player", playerId: "p_clean_1", status: "Active" });

    const res = await linkPlayerAccount(db, {
      uid: "uid_inconsistent_6",
      verifiedPhoneNumber: "+919876500001",
      requestedPlayerId: "p_clean_1",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Inconsistent identity mapping detected/);
  });

  it("Conflict State 7: appUsers is linked but uidIndex is absent -> Rejected 409", async () => {
    await db.collection("appUsers").doc("uid_inconsistent_7").set({ name: "User 7", role: "player", playerId: "p_clean_1", status: "Active" });

    const res = await linkPlayerAccount(db, {
      uid: "uid_inconsistent_7",
      verifiedPhoneNumber: "+919876500001",
      requestedPlayerId: "p_clean_1",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Inconsistent identity mapping detected|User account is already linked/);
  });

  // ── 6. Firestore Rules: Lockdown of uidIndex ──────────────────────────────

  it("firestore.rules: strictly denies direct client SDK reads and writes on /uidIndex/{uid}", async () => {
    const { assertFails } = await import("@firebase/rules-unit-testing");

    const clientDb = testEnv.authenticatedContext("uid_client_attacker").firestore();

    // Client write attempt to uidIndex
    await assertFails(
      clientDb.collection("uidIndex").doc("uid_client_attacker").set({
        playerId: "p_clean_1",
        authUid: "uid_client_attacker",
        canonicalPhone: "+919876500001",
      }),
      "Direct client write to uidIndex must be denied by firestore.rules",
    );

    // Client read attempt to uidIndex
    await assertFails(
      clientDb.collection("uidIndex").doc("uid_client_attacker").get(),
      "Direct client read to uidIndex must be denied by firestore.rules",
    );
  });
});
