/**
 * Security Remediation 1B: Concurrency-Safe Identity Linking Emulator Suite
 * (tests/remediation1b-concurrency-identity.emulator.test.mjs)
 *
 * Verifies live Firestore Emulator behavior for:
 * 1. Two concurrent requests for the same phone and same UID: zero conflicts, idempotent safe completion.
 * 2. Two concurrent requests for the same phone and different UIDs: exactly one succeeds, second rejected (409).
 * 3. Two concurrent requests for the same UID and different players: exactly one succeeds, second rejected (409).
 * 4. Repeated concurrent retries are safe and idempotent (all return alreadyLinked: true).
 * 5. A failed transaction leaves zero partial identity or reservation state (phoneIndex, players, appUsers clean).
 * 6. A pre-existing conflicting appUsers.playerId is rejected (409).
 * 7. A pre-existing conflicting players.authUid is rejected (409).
 * 8. An inconsistent identity index is rejected (409).
 * 9. Duplicate player phone records in historical data are rejected (409 ambiguous identity).
 * 10. Duplicate UID mappings are rejected (409).
 * 11. Invalid, oversized, arbitrary prefix, and malformed stored phone values cannot match a valid phone.
 * 12. Strict API Contract: malformed bodies, non-object JSON, unknown properties, invalid playerId rejected (400).
 * 13. Idempotent retry verifies complete 3-way consistency (phoneIndex + player.authUid + appUser.playerId) before returning 200.
 * 14. Direct client modification of phoneIndex is strictly denied by firestore.rules.
 * 15. Direct client modification of appUsers.playerId is strictly denied by firestore.rules.
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

describe("Security Remediation 1B: Concurrency-Safe Identity Linking Live Suite", { skip: skipReason }, () => {
  let testEnv;
  let db;
  let linkPlayerAccount;
  let parseStrictIndianMobile;
  let isCanonicalIndianMobile;
  let POST;
  let setAuthDbForTesting;

  before(async () => {
    if (!emulatorHost) return;
    const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
    const [host, portStr] = emulatorHost.split(":");
    testEnv = await initializeTestEnvironment({
      projectId: "kavach-concurrency-linking-test",
      firestore: {
        host,
        port: parseInt(portStr, 10),
        rules: rulesContent,
      },
    });

    const { getApps, initializeApp } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = !getApps().some((a) => a.name === "concurrency-test")
      ? initializeApp({ projectId: "kavach-concurrency-linking-test" }, "concurrency-test")
      : getApps().find((a) => a.name === "concurrency-test");
    db = getFirestore(app);

    const linkingModule = await import("../lib/account-linking.ts");
    linkPlayerAccount = linkingModule.linkPlayerAccount;
    parseStrictIndianMobile = linkingModule.parseStrictIndianMobile;
    isCanonicalIndianMobile = linkingModule.isCanonicalIndianMobile;

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
    // 1. Single eligible unlinked player
    await db.collection("players").doc("p_race_1").set({
      name: "Race Player 1",
      mobile: "9876500001",
      status: "Active",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 2. Second eligible unlinked player with different phone
    await db.collection("players").doc("p_race_2").set({
      name: "Race Player 2",
      mobile: "9876500002",
      status: "Active",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 3. Duplicate mobile players (for duplicate phone rejection)
    await db.collection("players").doc("p_dupe_1").set({
      name: "Dupe Player 1",
      mobile: "9876500003",
      status: "Active",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection("players").doc("p_dupe_2").set({
      name: "Dupe Player 2",
      mobile: "+919876500003",
      status: "Active",
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  // ── 1. Genuinely Overlapping Concurrency Tests ─────────────────────────────

  it("1. Two concurrent requests for the same phone and same UID: zero conflicts, idempotent success", async () => {
    // Both request linking p_race_1 simultaneously using Promise.all
    const [res1, res2] = await Promise.all([
      linkPlayerAccount(db, {
        uid: "uid_concurrent_same",
        verifiedPhoneNumber: "+919876500001",
        requestedPlayerId: "p_race_1",
      }),
      linkPlayerAccount(db, {
        uid: "uid_concurrent_same",
        verifiedPhoneNumber: "+919876500001",
        requestedPlayerId: "p_race_1",
      }),
    ]);

    assert.equal(res1.ok, true, `res1 failed: ${res1.error}`);
    assert.equal(res2.ok, true, `res2 failed: ${res2.error}`);
    assert.equal(res1.playerId, "p_race_1");
    assert.equal(res2.playerId, "p_race_1");

    // Exactly one should be initial link (alreadyLinked: false) and one idempotent retry (alreadyLinked: true)
    // or both completed consistently
    const alreadyLinkedFlags = [res1.alreadyLinked, res2.alreadyLinked].sort();
    assert.deepEqual(alreadyLinkedFlags, [false, true]);

    // Verify database state: phoneIndex, player, and appUser all point to each other
    const phoneIndexSnap = await db.collection("phoneIndex").doc("+919876500001").get();
    assert.equal(phoneIndexSnap.exists, true);
    assert.equal(phoneIndexSnap.data().authUid, "uid_concurrent_same");
    assert.equal(phoneIndexSnap.data().playerId, "p_race_1");

    const playerSnap = await db.collection("players").doc("p_race_1").get();
    assert.equal(playerSnap.data().authUid, "uid_concurrent_same");

    const userSnap = await db.collection("appUsers").doc("uid_concurrent_same").get();
    assert.equal(userSnap.data().playerId, "p_race_1");
  });

  it("2. Two concurrent requests for the same phone and different UIDs: exactly one succeeds, one rejected (409)", async () => {
    const [resA, resB] = await Promise.all([
      linkPlayerAccount(db, {
        uid: "uid_race_user_A",
        verifiedPhoneNumber: "+919876500001",
        requestedPlayerId: "p_race_1",
      }),
      linkPlayerAccount(db, {
        uid: "uid_race_user_B",
        verifiedPhoneNumber: "+919876500001",
        requestedPlayerId: "p_race_1",
      }),
    ]);

    const successes = [resA, resB].filter((r) => r.ok && r.status === 200);
    const conflicts = [resA, resB].filter((r) => !r.ok && r.status === 409);

    assert.equal(successes.length, 1, "Exactly one concurrent request must succeed");
    assert.equal(conflicts.length, 1, "The competing concurrent request must be rejected with 409");

    const winnerUid = successes[0] === resA ? "uid_race_user_A" : "uid_race_user_B";
    const loserUid = winnerUid === "uid_race_user_A" ? "uid_race_user_B" : "uid_race_user_A";

    // Verify winner owns all authoritative documents
    const phoneIndexSnap = await db.collection("phoneIndex").doc("+919876500001").get();
    assert.equal(phoneIndexSnap.data().authUid, winnerUid);
    assert.equal(phoneIndexSnap.data().playerId, "p_race_1");

    const playerSnap = await db.collection("players").doc("p_race_1").get();
    assert.equal(playerSnap.data().authUid, winnerUid);

    // Loser appUser record must NOT have playerId bound
    const loserSnap = await db.collection("appUsers").doc(loserUid).get();
    assert.equal(loserSnap.exists ? loserSnap.data().playerId : undefined, undefined);
  });

  it("3. Two concurrent requests for the same UID and different players: exactly one succeeds, one rejected (409)", async () => {
    // uid_shared tries to claim p_race_1 and p_race_2 concurrently
    const [res1, res2] = await Promise.all([
      linkPlayerAccount(db, {
        uid: "uid_shared_claimant",
        verifiedPhoneNumber: "+919876500001",
        requestedPlayerId: "p_race_1",
      }),
      linkPlayerAccount(db, {
        uid: "uid_shared_claimant",
        verifiedPhoneNumber: "+919876500002",
        requestedPlayerId: "p_race_2",
      }),
    ]);

    const successes = [res1, res2].filter((r) => r.ok && r.status === 200);
    const conflicts = [res1, res2].filter((r) => !r.ok && r.status === 409);

    assert.equal(successes.length, 1, "One UID cannot be concurrently attached to multiple players");
    assert.equal(conflicts.length, 1, "Second competing link for the same UID must be rejected with 409");

    // appUsers record must point to exactly one player
    const userSnap = await db.collection("appUsers").doc("uid_shared_claimant").get();
    assert.equal(userSnap.exists, true);
    assert.ok(userSnap.data().playerId === "p_race_1" || userSnap.data().playerId === "p_race_2");
  });

  it("4. Repeated concurrent retries are safe and all return alreadyLinked: true", async () => {
    // Initial link
    const initial = await linkPlayerAccount(db, {
      uid: "uid_idempotent_tester",
      verifiedPhoneNumber: "+919876500001",
      requestedPlayerId: "p_race_1",
    });
    assert.equal(initial.ok, true);

    // Issue 5 simultaneous retries
    const retries = await Promise.all([
      linkPlayerAccount(db, { uid: "uid_idempotent_tester", verifiedPhoneNumber: "+919876500001", requestedPlayerId: "p_race_1" }),
      linkPlayerAccount(db, { uid: "uid_idempotent_tester", verifiedPhoneNumber: "+919876500001", requestedPlayerId: "p_race_1" }),
      linkPlayerAccount(db, { uid: "uid_idempotent_tester", verifiedPhoneNumber: "+919876500001", requestedPlayerId: "p_race_1" }),
      linkPlayerAccount(db, { uid: "uid_idempotent_tester", verifiedPhoneNumber: "+919876500001", requestedPlayerId: "p_race_1" }),
      linkPlayerAccount(db, { uid: "uid_idempotent_tester", verifiedPhoneNumber: "+919876500001", requestedPlayerId: "p_race_1" }),
    ]);

    for (const r of retries) {
      assert.equal(r.ok, true);
      assert.equal(r.status, 200);
      assert.equal(r.alreadyLinked, true);
      assert.equal(r.playerId, "p_race_1");
    }
  });

  it("5. A failed transaction leaves zero partial identity or reservation state", async () => {
    const originalRunTransaction = db.runTransaction.bind(db);
    db.runTransaction = async () => {
      throw new Error("Simulated transient network partition inside transaction");
    };

    try {
      const res = await linkPlayerAccount(db, {
        uid: "uid_tx_abort_user",
        verifiedPhoneNumber: "+919876500001",
        requestedPlayerId: "p_race_1",
      });
      assert.equal(res.ok, false);
      assert.equal(res.status, 500);

      // Verify ZERO partial state across all three documents
      const phoneIndexSnap = await db.collection("phoneIndex").doc("+919876500001").get();
      assert.equal(phoneIndexSnap.exists, false);

      const playerSnap = await db.collection("players").doc("p_race_1").get();
      assert.equal(playerSnap.data().authUid, undefined);

      const userSnap = await db.collection("appUsers").doc("uid_tx_abort_user").get();
      assert.equal(userSnap.exists, false);
    } finally {
      db.runTransaction = originalRunTransaction;
    }
  });

  // ── 2. Mapping and Legacy Consistency Invariants ──────────────────────────

  it("6. A pre-existing conflicting appUsers.playerId is rejected (409)", async () => {
    await db.collection("appUsers").doc("uid_with_conflict").set({
      name: "Conflicted User",
      role: "player",
      playerId: "p_race_2",
      status: "Active",
    });

    const res = await linkPlayerAccount(db, {
      uid: "uid_with_conflict",
      verifiedPhoneNumber: "+919876500001",
      requestedPlayerId: "p_race_1",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /User account is already linked to another player profile/);
  });

  it("7. A pre-existing conflicting players.authUid is rejected (409)", async () => {
    await db.collection("players").doc("p_race_1").update({
      authUid: "uid_foreign_owner",
    });

    const res = await linkPlayerAccount(db, {
      uid: "uid_new_claimant",
      verifiedPhoneNumber: "+919876500001",
      requestedPlayerId: "p_race_1",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Player record is already linked to another user account/);
  });

  it("8. An inconsistent identity index is rejected (409)", async () => {
    // phoneIndex already reserved by someone else
    await db.collection("phoneIndex").doc("+919876500001").set({
      authUid: "uid_other",
      playerId: "p_other",
      phone: "+919876500001",
    });

    const res = await linkPlayerAccount(db, {
      uid: "uid_new_claimant",
      verifiedPhoneNumber: "+919876500001",
      requestedPlayerId: "p_race_1",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Phone number is already associated with another user account/);
  });

  it("9. Duplicate player phone records in historical data are rejected (409 Ambiguous identity)", async () => {
    // p_dupe_1 and p_dupe_2 both have 9876500003
    const res = await linkPlayerAccount(db, {
      uid: "uid_dupe_caller",
      verifiedPhoneNumber: "+919876500003",
      requestedPlayerId: "p_dupe_1",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /Multiple player records found with this phone number/);
  });

  it("10. Duplicate UID mappings are rejected (409)", async () => {
    // User already linked to p_race_1
    await db.collection("appUsers").doc("uid_mapped_user").set({
      name: "Mapped User",
      role: "player",
      playerId: "p_race_1",
      status: "Active",
    });

    const res = await linkPlayerAccount(db, {
      uid: "uid_mapped_user",
      verifiedPhoneNumber: "+919876500002",
      requestedPlayerId: "p_race_2",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
  });

  // ── 3. Strict Phone Parsing (SEC-1A-02) ────────────────────────────────────

  it("11. Strict phone parser: accepts valid documented formats, rejects malformed, oversized, and text", () => {
    // Positive cases
    const pos1 = parseStrictIndianMobile("+919876543210");
    assert.equal(pos1.ok, true);
    assert.equal(pos1.canonical, "+919876543210");
    assert.equal(pos1.raw10, "9876543210");

    const pos2 = parseStrictIndianMobile("919876543210");
    assert.equal(pos2.ok, true);
    assert.equal(pos2.canonical, "+919876543210");

    const pos3 = parseStrictIndianMobile("09876543210");
    assert.equal(pos3.ok, true);
    assert.equal(pos3.canonical, "+919876543210");

    const pos4 = parseStrictIndianMobile("9876543210");
    assert.equal(pos4.ok, true);
    assert.equal(pos4.canonical, "+919876543210");

    const pos5 = parseStrictIndianMobile("+91 98765-43210");
    assert.equal(pos5.ok, true);
    assert.equal(pos5.canonical, "+919876543210");

    // Negative cases: arbitrary prefixes
    assert.equal(parseStrictIndianMobile("+19876543210").ok, false); // US country code
    assert.equal(parseStrictIndianMobile("+449876543210").ok, false); // UK country code
    assert.equal(parseStrictIndianMobile("+929876543210").ok, false); // Pakistan code
    assert.equal(parseStrictIndianMobile("+999876543210").ok, false); // Invalid country code

    // Excessive digits (no silent truncation!)
    assert.equal(parseStrictIndianMobile("98765432101").ok, false); // 11 digits
    assert.equal(parseStrictIndianMobile("+9198765432109").ok, false); // 11 digits after prefix
    assert.equal(parseStrictIndianMobile("9876543210999").ok, false); // 13 digits

    // Repeated country codes
    assert.equal(parseStrictIndianMobile("+91919876543210").ok, false);
    assert.equal(parseStrictIndianMobile("91919876543210").ok, false);

    // Embedded text and characters
    assert.equal(parseStrictIndianMobile("98765abc10").ok, false);
    assert.equal(parseStrictIndianMobile("call 9876543210").ok, false);
    assert.equal(parseStrictIndianMobile("9876543210 (home)").ok, false);

    // Punctuation-only and empty
    assert.equal(parseStrictIndianMobile("---").ok, false);
    assert.equal(parseStrictIndianMobile("+").ok, false);
    assert.equal(parseStrictIndianMobile("+91").ok, false);
    assert.equal(parseStrictIndianMobile("").ok, false);
    assert.equal(parseStrictIndianMobile("   ").ok, false);
    assert.equal(parseStrictIndianMobile(null).ok, false);
    assert.equal(parseStrictIndianMobile(12345).ok, false);

    // Incomplete numbers
    assert.equal(parseStrictIndianMobile("12345").ok, false);
    assert.equal(parseStrictIndianMobile("98765").ok, false);
  });

  // ── 4. Strict API Route Contract (SEC-1A-04) ──────────────────────────────

  it("12. API Route Contract: rejects malformed JSON, primitives, unknown keys, invalid playerId", async () => {
    // Malformed JSON string
    const reqMalformed = new Request("http://localhost:3000/api/player/link-account", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-uid": "uid_contract", "x-test-phone": "+919876500001" },
      body: "INVALID_JSON{",
    });
    const resMalformed = await POST(reqMalformed);
    assert.equal(resMalformed.status, 400);
    const bodyMalformed = await resMalformed.json();
    assert.match(bodyMalformed.error, /Malformed JSON payload/);

    // Array body (must be object)
    const reqArray = new Request("http://localhost:3000/api/player/link-account", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-uid": "uid_contract", "x-test-phone": "+919876500001" },
      body: JSON.stringify(["p_race_1"]),
    });
    const resArray = await POST(reqArray);
    assert.equal(resArray.status, 400);

    // Unknown property rejection (strict allowlist)
    const reqUnknown = new Request("http://localhost:3000/api/player/link-account", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-uid": "uid_contract", "x-test-phone": "+919876500001" },
      body: JSON.stringify({ playerId: "p_race_1", unexpectedField: "hacker_payload" }),
    });
    const resUnknown = await POST(reqUnknown);
    assert.equal(resUnknown.status, 400);
    const bodyUnknown = await resUnknown.json();
    assert.match(bodyUnknown.error, /Unknown properties not permitted/);

    // Missing playerId
    const reqMissing = new Request("http://localhost:3000/api/player/link-account", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-uid": "uid_contract", "x-test-phone": "+919876500001" },
      body: JSON.stringify({}),
    });
    const resMissing = await POST(reqMissing);
    assert.equal(resMissing.status, 400);

    // Invalid character in playerId
    const reqInvalidChar = new Request("http://localhost:3000/api/player/link-account", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-uid": "uid_contract", "x-test-phone": "+919876500001" },
      body: JSON.stringify({ playerId: "p_race_1;DROP TABLE players;" }),
    });
    const resInvalidChar = await POST(reqInvalidChar);
    assert.equal(resInvalidChar.status, 400);
  });

  it("13. Idempotent retries verify complete 3-way consistency before returning success", async () => {
    // Establish normal link
    await linkPlayerAccount(db, {
      uid: "uid_3way_user",
      verifiedPhoneNumber: "+919876500001",
      requestedPlayerId: "p_race_1",
    });

    // Artificially corrupt one leg: delete appUsers.playerId
    await db.collection("appUsers").doc("uid_3way_user").update({
      playerId: "p_corrupt_id",
    });

    // Retry should now fail with 409 because of incomplete/inconsistent mapping
    const retryRes = await linkPlayerAccount(db, {
      uid: "uid_3way_user",
      verifiedPhoneNumber: "+919876500001",
      requestedPlayerId: "p_race_1",
    });

    assert.equal(retryRes.ok, false);
    assert.equal(retryRes.status, 409);
    assert.match(retryRes.error, /User account is already linked to another player profile|Inconsistent identity mapping/);
  });

  // ── 5. Firestore Rules Boundaries (phoneIndex and appUsers.playerId) ──────

  it("14. firestore.rules: strictly denies direct client SDK reads and writes on /phoneIndex/{phone}", async () => {
    const { assertFails } = await import("@firebase/rules-unit-testing");

    const clientDb = testEnv.authenticatedContext("uid_client_attacker").firestore();

    // Client write attempt to phoneIndex
    await assertFails(
      clientDb.collection("phoneIndex").doc("+919876500001").set({
        playerId: "p_race_1",
        authUid: "uid_client_attacker",
      }),
      "Direct client write to phoneIndex must be denied by firestore.rules",
    );

    // Client read attempt to phoneIndex
    await assertFails(
      clientDb.collection("phoneIndex").doc("+919876500001").get(),
      "Direct client read to phoneIndex must be denied by firestore.rules",
    );
  });

  it("15. firestore.rules: strictly denies client SDK self-setting playerId on /appUsers/{uid}", async () => {
    const { assertFails } = await import("@firebase/rules-unit-testing");

    const clientDb = testEnv.authenticatedContext("uid_client_attacker").firestore();

    // Direct create of appUsers with playerId
    await assertFails(
      clientDb.collection("appUsers").doc("uid_client_attacker").set({
        name: "Attacker",
        role: "player",
        playerId: "p_race_1",
      }),
      "Direct client create with playerId on appUsers must be denied by firestore.rules",
    );
  });
});
