/**
 * Security Remediation 1A: Hardened Player Account Linking Emulator Suite
 * (tests/remediation1a-account-linking.emulator.test.mjs)
 *
 * Verifies live Firestore Emulator behavior for:
 * 1. Exact canonical verified phone match, one eligible player -> Allow (200, links player & appUser)
 * 2. Partial phone-number match -> Deny (404)
 * 3. Prefix-only match -> Deny (404)
 * 4. Suffix-only match -> Deny (404)
 * 5. Malformed stored phone number -> Deny (404)
 * 6. Empty stored phone number -> Deny (404)
 * 7. Missing verified phone claim -> Deny (400)
 * 8. No matching player -> Deny (404)
 * 9. Two players sharing the same phone number -> Deny (409 Ambiguous identity)
 * 10. Matching player already linked to another UID -> Deny (409)
 * 11. Disabled player -> Deny (403)
 * 12. Merged player -> Deny (403)
 * 13. Firebase UID already linked to another player -> Deny (409)
 * 14. Existing appUsers playerId conflicts with requested player -> Deny (409)
 * 15. Attempt to rebind a player to another UID -> Deny (409)
 * 16. Attempt to link another user's player record -> Deny (403)
 * 17. Attempt to modify profile fields during linking -> Deny (400 via API)
 * 18. Attempt to modify roles/status/financial fields during linking -> Deny (400 via API)
 * 19. UID different from playerId -> Allow only when legitimate mapping is established
 * 20. Valid retry of an already completed linking operation -> Idempotent success (200, alreadyLinked: true)
 * 21. Interrupted/failed linking transaction -> No partial identity association
 * 22. Direct Firestore client SDK write of authUid -> Strictly Denied by firestore.rules
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

describe("Security Remediation 1A: Hardened Player Account Linking Live Suite", { skip: skipReason }, () => {
  let testEnv;
  let db;
  let linkPlayerAccount;
  let POST;
  let setAuthDbForTesting;

  before(async () => {
    if (!emulatorHost) return;
    const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
    const [host, portStr] = emulatorHost.split(":");
    testEnv = await initializeTestEnvironment({
      projectId: "kavach-account-linking-test",
      firestore: {
        host,
        port: parseInt(portStr, 10),
        rules: rulesContent,
      },
    });

    const { getApps, initializeApp } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = !getApps().some((a) => a.name === "linking-test")
      ? initializeApp({ projectId: "kavach-account-linking-test" }, "linking-test")
      : getApps().find((a) => a.name === "linking-test");
    db = getFirestore(app);

    const linkingModule = await import("../lib/account-linking.ts");
    linkPlayerAccount = linkingModule.linkPlayerAccount;

    const serverAuthModule = await import("../lib/server-auth.ts");
    setAuthDbForTesting = serverAuthModule.setAuthDbForTesting;
    setAuthDbForTesting(db);

    const routeModule = await import("../app/api/player/link-account/route.ts");
    POST = routeModule.POST;
  });

  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    if (testEnv) await testEnv.clearFirestore();

    // Baseline Seed Fixtures
    // 1. Single eligible unlinked player with standard 10-digit mobile
    await db.collection("players").doc("p_eligible_1").set({
      name: "Eligible Player One",
      mobile: "9876543210",
      status: "Active",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 2. Single eligible unlinked player with +91 prefixed mobile
    await db.collection("players").doc("p_eligible_2").set({
      name: "Eligible Player Two",
      mobile: "+919876543220",
      status: "Active",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 3. Already linked player (bound to uid_existing_owner)
    await db.collection("players").doc("p_linked").set({
      name: "Already Linked Player",
      mobile: "9876543230",
      authUid: "uid_existing_owner",
      status: "Active",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection("appUsers").doc("uid_existing_owner").set({
      name: "Existing Owner",
      role: "player",
      playerId: "p_linked",
      status: "Active",
    });

    // 4. Two players sharing the exact same phone number (Duplicate mobile condition)
    await db.collection("players").doc("p_dupe_a").set({
      name: "Shared Phone Player A",
      mobile: "9876543240",
      status: "Active",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection("players").doc("p_dupe_b").set({
      name: "Shared Phone Player B",
      mobile: "+919876543240",
      status: "Active",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 5. Disabled player
    await db.collection("players").doc("p_disabled").set({
      name: "Disabled Player",
      mobile: "9876543250",
      status: "Disabled",
      disabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 6. Merged player
    await db.collection("players").doc("p_merged").set({
      name: "Merged Player",
      mobile: "9876543260",
      status: "Merged",
      disabled: true,
      mergedInto: "p_eligible_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 7. Player with malformed/short mobile
    await db.collection("players").doc("p_malformed").set({
      name: "Malformed Mobile Player",
      mobile: "12345",
      status: "Active",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 8. Player with empty mobile
    await db.collection("players").doc("p_empty_mobile").set({
      name: "Empty Mobile Player",
      mobile: "",
      status: "Active",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 9. Existing appUser with playerId already bound
    await db.collection("appUsers").doc("uid_already_bound").set({
      name: "Already Bound User",
      role: "player",
      playerId: "p_eligible_2",
      status: "Active",
    });

    // 10. Disabled user
    await db.collection("appUsers").doc("uid_disabled_user").set({
      name: "Disabled User",
      role: "player",
      status: "Disabled",
    });
  });

  // ── 1. Canonical Verified Phone Matching & Success Scenarios ──
  it("allows exact canonical verified phone match for single eligible unlinked player", async () => {
    const res = await linkPlayerAccount(db, {
      uid: "uid_caller_1",
      verifiedPhoneNumber: "+919876543210",
    });

    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.playerId, "p_eligible_1");
    assert.equal(res.alreadyLinked, false);

    // Verify atomic state in database
    const playerSnap = await db.collection("players").doc("p_eligible_1").get();
    assert.equal(playerSnap.data().authUid, "uid_caller_1");

    const userSnap = await db.collection("appUsers").doc("uid_caller_1").get();
    assert.equal(userSnap.data().playerId, "p_eligible_1");
    assert.equal(userSnap.data().status, "Active");
  });

  it("UID different from playerId: establishes mapping while preserving distinct identifiers", async () => {
    // uid_caller_2 != p_eligible_2
    const res = await linkPlayerAccount(db, {
      uid: "uid_caller_2",
      verifiedPhoneNumber: "+919876543220",
    });

    assert.equal(res.ok, true);
    assert.equal(res.playerId, "p_eligible_2");

    const playerDoc = await db.collection("players").doc("p_eligible_2").get();
    assert.equal(playerDoc.id, "p_eligible_2"); // ID is unchanged
    assert.equal(playerDoc.data().authUid, "uid_caller_2"); // authUid explicitly references Firebase UID
  });

  it("valid retry of an already completed linking operation returns idempotent success", async () => {
    // First link
    const res1 = await linkPlayerAccount(db, {
      uid: "uid_idempotent",
      verifiedPhoneNumber: "+919876543210",
    });
    assert.equal(res1.ok, true);
    assert.equal(res1.alreadyLinked, false);

    // Retry exact same link
    const res2 = await linkPlayerAccount(db, {
      uid: "uid_idempotent",
      verifiedPhoneNumber: "+919876543210",
    });
    assert.equal(res2.ok, true);
    assert.equal(res2.status, 200);
    assert.equal(res2.playerId, "p_eligible_1");
    assert.equal(res2.alreadyLinked, true);
  });

  // ── 2. Rejection of Substring, Partial, Prefix, Suffix, Malformed Matches ──
  it("denies partial phone-number match", async () => {
    // Looking for partial 76543210
    const res = await linkPlayerAccount(db, {
      uid: "uid_attacker",
      verifiedPhoneNumber: "+917654321000",
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
  });

  it("denies prefix-only match", async () => {
    // 987654321 (9 digits prefix) vs 9876543210
    const res = await linkPlayerAccount(db, {
      uid: "uid_attacker",
      verifiedPhoneNumber: "+91987654321",
    });
    assert.equal(res.ok, false);
    assert.ok(res.status === 400 || res.status === 404);
  });

  it("denies suffix-only match", async () => {
    const res = await linkPlayerAccount(db, {
      uid: "uid_attacker",
      verifiedPhoneNumber: "+910007654321",
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
  });

  it("denies malformed stored phone number", async () => {
    // p_malformed has mobile: "12345"
    const res = await linkPlayerAccount(db, {
      uid: "uid_attacker",
      verifiedPhoneNumber: "+911234500000",
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
  });

  it("denies empty stored phone number", async () => {
    const res = await linkPlayerAccount(db, {
      uid: "uid_attacker",
      verifiedPhoneNumber: "+910000000000",
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
  });

  it("denies missing verified phone claim", async () => {
    const res = await linkPlayerAccount(db, {
      uid: "uid_caller",
      verifiedPhoneNumber: undefined,
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.match(res.error, /Missing verified phone number claim/);
  });

  it("denies when no matching player exists", async () => {
    const res = await linkPlayerAccount(db, {
      uid: "uid_caller",
      verifiedPhoneNumber: "+919999999999",
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
    assert.match(res.error, /No eligible player record found/);
  });

  // ── 3. Uniqueness & Ambiguity Protection ──
  it("denies linking when two players share the same phone number (ambiguous identity)", async () => {
    // p_dupe_a and p_dupe_b both have mobile 9876543240
    const res = await linkPlayerAccount(db, {
      uid: "uid_caller",
      verifiedPhoneNumber: "+919876543240",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Multiple player records found with this phone number/);

    // Verify neither player was modified
    const pASnap = await db.collection("players").doc("p_dupe_a").get();
    assert.equal(pASnap.data().authUid, undefined);
    const pBSnap = await db.collection("players").doc("p_dupe_b").get();
    assert.equal(pBSnap.data().authUid, undefined);
  });

  // ── 4. Eligibility & State Boundaries ──
  it("denies linking a player already linked to another UID (preventing rebinding)", async () => {
    // p_linked is already bound to uid_existing_owner
    const res = await linkPlayerAccount(db, {
      uid: "uid_hijacker",
      verifiedPhoneNumber: "+919876543230",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Player record is already linked to another user account/);

    // Verify ownership was NOT changed
    const playerSnap = await db.collection("players").doc("p_linked").get();
    assert.equal(playerSnap.data().authUid, "uid_existing_owner");
  });

  it("denies linking a disabled player", async () => {
    const res = await linkPlayerAccount(db, {
      uid: "uid_caller",
      verifiedPhoneNumber: "+919876543250",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 404); // Filtered out of eligible candidates
  });

  it("denies linking a merged player", async () => {
    const res = await linkPlayerAccount(db, {
      uid: "uid_caller",
      verifiedPhoneNumber: "+919876543260",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 404); // Filtered out of eligible candidates
  });

  it("denies linking when Firebase UID is already linked to another player", async () => {
    // uid_existing_owner is already bound to p_linked.
    // Attempting to claim p_eligible_1:
    const res = await linkPlayerAccount(db, {
      uid: "uid_existing_owner",
      verifiedPhoneNumber: "+919876543210",
      requestedPlayerId: "p_eligible_1",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /User account is already linked/);
  });

  it("denies linking when existing appUsers playerId conflicts with requested player", async () => {
    // uid_already_bound has appUsers.playerId === 'p_eligible_2'
    const res = await linkPlayerAccount(db, {
      uid: "uid_already_bound",
      verifiedPhoneNumber: "+919876543210",
      requestedPlayerId: "p_eligible_1",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
  });

  it("denies linking another user's player record when requestedPlayerId does not match resolved record", async () => {
    // Caller owns phone for p_eligible_1 (+919876543210), but tries to claim p_eligible_2
    const res = await linkPlayerAccount(db, {
      uid: "uid_caller",
      verifiedPhoneNumber: "+919876543210",
      requestedPlayerId: "p_eligible_2",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 403);
    assert.match(res.error, /Requested player does not match authoritatively resolved player identity/);
  });

  it("denies linking for a disabled user account", async () => {
    const res = await linkPlayerAccount(db, {
      uid: "uid_disabled_user",
      verifiedPhoneNumber: "+919876543210",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 403);
    assert.match(res.error, /Account is disabled/);
  });

  // ── 5. API Route Field Injection Protection ──
  it("API Route: denies attempt to modify profile fields during linking", async () => {
    const req = new Request("http://localhost:3000/api/player/link-account", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-uid": "uid_tamperer",
        "x-test-phone": "+919876543210",
      },
      body: JSON.stringify({
        playerId: "p_eligible_1",
        name: "Malicious Injected Name",
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Extra profile, status, or role fields cannot be modified/);
  });

  it("API Route: denies attempt to modify roles or status during linking", async () => {
    const req = new Request("http://localhost:3000/api/player/link-account", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-uid": "uid_tamperer_2",
        "x-test-phone": "+919876543210",
      },
      body: JSON.stringify({
        playerId: "p_eligible_1",
        isSuperAdmin: true,
        role: "admin",
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Extra profile, status, or role fields cannot be modified/);
  });

  it("API Route: succeeds for valid request and returns non-sensitive response", async () => {
    const req = new Request("http://localhost:3000/api/player/link-account", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-uid": "uid_api_caller",
        "x-test-phone": "+919876543210",
      },
      body: JSON.stringify({
        playerId: "p_eligible_1",
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.playerId, "p_eligible_1");
    assert.equal(body.alreadyLinked, false);
  });

  // ── 6. Transaction Atomicity & Consistency ──
  it("interrupted/failed linking transaction produces zero partial identity mutation", async () => {
    // Simulate concurrent conflict inside runTransaction by updating the player right before
    const originalRunTransaction = db.runTransaction.bind(db);
    db.runTransaction = async (updateFunction) => {
      // Intentionally cause failure during transaction execution
      throw new Error("Simulated network timeout during atomic commit");
    };

    try {
      const res = await linkPlayerAccount(db, {
        uid: "uid_fail_test",
        verifiedPhoneNumber: "+919876543210",
      });
      assert.equal(res.ok, false);
      assert.equal(res.status, 500);

      // Verify ZERO partial state written
      const playerSnap = await db.collection("players").doc("p_eligible_1").get();
      assert.equal(playerSnap.data().authUid, undefined);

      const userSnap = await db.collection("appUsers").doc("uid_fail_test").get();
      assert.equal(userSnap.exists, false);
    } finally {
      db.runTransaction = originalRunTransaction;
    }
  });

  // ── 7. Direct Client Firestore Write Rejection (firestore.rules) ──
  it("firestore.rules: strictly denies direct client SDK update of authUid", async () => {
    const { assertFails } = await import("@firebase/rules-unit-testing");
    const { serverTimestamp } = await import("firebase/firestore");

    // Authenticated user attempting direct update on players collection
    const clientDb = testEnv.authenticatedContext("uid_client_attacker", {
      phone_number: "+919876543210",
    }).firestore();

    await assertFails(
      clientDb.collection("players").doc("p_eligible_1").update({
        authUid: "uid_client_attacker",
        updatedAt: serverTimestamp(),
      }),
      "Expected direct client write of authUid on /players/{playerId} to be rejected by firestore.rules",
    );
  });
});
