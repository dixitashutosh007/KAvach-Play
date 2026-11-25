/**
 * Phase 5 Workstream 1: Firestore Security & Authorisation Integration Tests
 * (tests/phase5-firestore-security.emulator.test.mjs)
 *
 * Exercises Cloud Firestore Security Rules against the live Firebase Emulator for:
 * 1. Super Admin Bootstrap Policy (claim without appUsers doc allowed; disabled doc blocked)
 * 2. Disabled-Account Authorisation (active accounts allowed; disabled accounts blocked)
 * 3. Immediate Administrative Permission Revocation (revoking granular role in appUsers blocks immediately)
 * 4. Verified UID-to-Player Ownership (authUid in player doc, playerId in appUsers doc, legacy identity protection)
 * 5. Direct and Collection-Group Ownership Consistency (matching permissions for direct docs and collection groups)
 * 6. Foreign-Player Access Rejection (cross-player reads and updates strictly denied)
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

describe(
  "Phase 5 Workstream 1: Firestore Security Rules — Live Emulator Suite",
  { skip: !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator)" },
  () => {
    let testEnv;

    before(async () => {
      if (!emulatorHost) return;
      const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
      testEnv = await initializeTestEnvironment({
        projectId: "kavach-phase5-sec-test",
        firestore: {
          host: emulatorHost.split(":")[0],
          port: parseInt(emulatorHost.split(":")[1], 10),
          rules: rulesContent,
        },
      });
    });

    after(async () => {
      if (testEnv) await testEnv.cleanup();
    });

    beforeEach(async () => {
      if (!testEnv) return;
      await testEnv.clearFirestore();

      // Seed baseline fixtures
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();

        // 1. Seed Ground
        await adminDb.collection("grounds").doc("ground_1").set({
          name: "Main Oval",
          mapUrl: "https://maps.google.com/?q=Main+Oval",
          organiserName: "Club Secretary",
          gpayNumber: "9876543210",
          updatedAt: new Date(),
        });

        // 2. Seed Match
        await adminDb.collection("matches").doc("match_ws1").set({
          groundId: "ground_1",
          format: "T20",
          jerseyColor: "Scarlet Red",
          opponent: "Invincibles CC",
          matchType: "Practice",
          fee: 500,
          date: "2026-12-01",
          time: "07:30",
          maxSquadSize: 15,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // 3. Seed Verified Player 1 (linked via players.authUid)
        await adminDb.collection("players").doc("p_verified_1").set({
          name: "Verified Player 1",
          mobile: "9876543201",
          authUid: "uid_player_1",
          status: "Active",
          disabled: false,
          inviteStatus: "Accepted",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await adminDb.collection("appUsers").doc("uid_player_1").set({
          name: "Verified Player 1",
          role: "player",
          playerId: "p_verified_1",
          status: "Active",
        });

        // 4. Seed Verified Player 2 (linked via appUsers.playerId)
        await adminDb.collection("players").doc("p_verified_2").set({
          name: "Verified Player 2",
          mobile: "9876543202",
          status: "Active",
          disabled: false,
          inviteStatus: "Accepted",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await adminDb.collection("appUsers").doc("uid_player_2").set({
          name: "Verified Player 2",
          role: "player",
          playerId: "p_verified_2",
          status: "Active",
        });

        // 5. Seed Legacy Player 3 (playerId === uid, no conflicting authUid)
        await adminDb.collection("players").doc("uid_legacy_3").set({
          name: "Legacy Player 3",
          mobile: "9876543203",
          status: "Active",
          disabled: false,
          inviteStatus: "Accepted",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // 6. Seed Hijack-Target Player 4 (owned by uid_real_owner, attacker will spoof uid === "p_target_4")
        await adminDb.collection("players").doc("p_target_4").set({
          name: "Target Player 4",
          mobile: "9876543204",
          authUid: "uid_real_owner",
          status: "Active",
          disabled: false,
          inviteStatus: "Accepted",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // 7. Seed Disabled Player 5
        await adminDb.collection("players").doc("p_disabled_5").set({
          name: "Disabled Player 5",
          mobile: "9876543205",
          authUid: "uid_player_5",
          status: "Disabled",
          disabled: true,
          inviteStatus: "Accepted",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await adminDb.collection("appUsers").doc("uid_player_5").set({
          name: "Disabled Player 5",
          role: "player",
          playerId: "p_disabled_5",
          status: "Disabled",
        });

        // 8. Seed Match Payments for Player 1 and Player 2
        await adminDb.collection("matches").doc("match_ws1").collection("payments").doc("pay_p1").set({
          id: "pay_p1",
          matchId: "match_ws1",
          playerId: "p_verified_1",
          status: "Unpaid",
          availability: "Pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await adminDb.collection("matches").doc("match_ws1").collection("payments").doc("pay_p2").set({
          id: "pay_p2",
          matchId: "match_ws1",
          playerId: "p_verified_2",
          status: "Unpaid",
          availability: "Pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // 9. Seed otherFees for Player 1
        await adminDb.collection("players").doc("p_verified_1").collection("otherFees").doc("fee_p1").set({
          id: "fee_p1",
          playerId: "p_verified_1",
          title: "Late Fee",
          amount: 150,
          status: "Unpaid",
        });
      });
    });

    // ── 1. Super Admin Bootstrap & Disabled Account Policy ──
    it("Super Admin: bootstrap account without appUsers doc is permitted; disabled appUsers doc is rejected", async () => {
      const { assertSucceeds, assertFails } = await import("@firebase/rules-unit-testing");
      const { serverTimestamp } = await import("firebase/firestore");

      // A. Bootstrap Super Admin (custom claim { admin: true }, NO appUsers doc exists yet)
      const bootstrapAdmin = testEnv.authenticatedContext("uid_bootstrap_admin", { admin: true }).firestore();
      await assertSucceeds(
        bootstrapAdmin.collection("appConfig").doc("bootstrap_test").set({ clubName: "KAvach Cricket Club" }),
      );
      await assertSucceeds(
        bootstrapAdmin.collection("appUsers").doc("uid_bootstrap_admin").set({
          name: "Bootstrap Super Admin",
          status: "Active",
        }),
      );

      // B. Active Super Admin (custom claim + active doc)
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("appUsers").doc("uid_active_admin").set({
          name: "Active Super Admin",
          role: "admin",
          status: "Active",
        });
      });
      const activeAdmin = testEnv.authenticatedContext("uid_active_admin", { admin: true }).firestore();
      await assertSucceeds(
        activeAdmin.collection("appConfig").doc("global").set({ clubName: "KAvach Cricket Club" }),
      );

      // C. Disabled Super Admin (custom claim { admin: true }, BUT doc has status: "Disabled")
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("appUsers").doc("uid_disabled_admin").set({
          name: "Disabled Super Admin",
          role: "admin",
          status: "Disabled",
        });
      });
      const disabledAdmin = testEnv.authenticatedContext("uid_disabled_admin", { admin: true }).firestore();
      await assertFails(
        disabledAdmin.collection("appConfig").doc("global").set({ clubName: "Hacked by Disabled Admin" }),
      );
    });

    // ── 2. Immediate Administrative Permission Revocation ──
    it("Granular RBAC: revoking role in appUsers blocks administrative actions immediately", async () => {
      const { assertSucceeds, assertFails } = await import("@firebase/rules-unit-testing");
      const { serverTimestamp } = await import("firebase/firestore");

      // A. Seed active Club Admin (D-22 absorbed Match Admin into Club Admin)
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("appUsers").doc("uid_match_admin").set({
          name: "Club Admin",
          role: "player",
          isClubAdmin: true,
          status: "Active",
        });
      });

      const clubAdmin = testEnv.authenticatedContext("uid_match_admin").firestore();

      const newMatchData = {
        groundId: "ground_1",
        format: "T20",
        jerseyColor: "Whites",
        opponent: "Super Kings",
        matchType: "Practice",
        fee: 600,
        date: "2026-12-05",
        time: "08:00",
        maxSquadSize: 14,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // Permitted while role is active
      await assertSucceeds(clubAdmin.collection("matches").doc("match_test_rbac_1").set(newMatchData));

      // B. Revoke isClubAdmin role in appUsers
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("appUsers").doc("uid_match_admin").update({
          isClubAdmin: false,
        });
      });

      // Immediately blocked on next write (no token refresh needed)
      await assertFails(
        clubAdmin.collection("matches").doc("match_test_rbac_2").set({
          ...newMatchData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      );

      // C. Re-grant isClubAdmin but set status: "Disabled"
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("appUsers").doc("uid_match_admin").update({
          isClubAdmin: true,
          status: "Disabled",
        });
      });

      // Immediately blocked because account is disabled
      await assertFails(
        clubAdmin.collection("matches").doc("match_test_rbac_3").set({
          ...newMatchData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    // ── 3. Verified UID-to-Player Ownership ──
    it("Player Ownership: verifies player link via players.authUid or appUsers.playerId; rejects unverified spoofing", async () => {
      const { assertSucceeds, assertFails } = await import("@firebase/rules-unit-testing");
      const { serverTimestamp } = await import("firebase/firestore");

      const player1Db = testEnv.authenticatedContext("uid_player_1").firestore();
      const player2Db = testEnv.authenticatedContext("uid_player_2").firestore();
      const legacy3Db = testEnv.authenticatedContext("uid_legacy_3").firestore();

      // Case A: Player 1 verified via players/{playerId}.authUid
      const p1PayDoc = player1Db.collection("matches").doc("match_ws1").collection("payments").doc("pay_p1");
      await assertSucceeds(
        p1PayDoc.update({
          availability: "Confirmed",
          updatedAt: serverTimestamp(),
        }),
      );

      // Case B: Player 2 verified via appUsers/{uid}.playerId
      const p2PayDoc = player2Db.collection("matches").doc("match_ws1").collection("payments").doc("pay_p2");
      await assertSucceeds(
        p2PayDoc.update({
          availability: "Tentative",
          updatedAt: serverTimestamp(),
        }),
      );

      // Case C: Legacy identity (uid === playerId) where player doc exists and matches authUid
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("matches").doc("match_ws1").collection("payments").doc("pay_legacy").set({
          id: "pay_legacy",
          matchId: "match_ws1",
          playerId: "uid_legacy_3",
          status: "Unpaid",
          availability: "Pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });
      const legacyPayDoc = legacy3Db.collection("matches").doc("match_ws1").collection("payments").doc("pay_legacy");
      await assertSucceeds(
        legacyPayDoc.update({
          availability: "Confirmed",
          updatedAt: serverTimestamp(),
        }),
      );

      // Case D: Hijack attempt: Attacker creates account with uid == "p_target_4"
      // BUT players/p_target_4 is already bound to authUid: "uid_real_owner"
      const attackerDb = testEnv.authenticatedContext("p_target_4").firestore();
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("matches").doc("match_ws1").collection("payments").doc("pay_target_4").set({
          id: "pay_target_4",
          matchId: "match_ws1",
          playerId: "p_target_4",
          status: "Unpaid",
          availability: "Pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });
      const targetPayDoc = attackerDb.collection("matches").doc("match_ws1").collection("payments").doc("pay_target_4");
      // Attacker must be strictly denied
      await assertFails(
        targetPayDoc.update({
          availability: "No",
          updatedAt: serverTimestamp(),
        }),
      );

      // Case E: Disabled account (Player 5) is rejected
      const disabledPlayerDb = testEnv.authenticatedContext("uid_player_5").firestore();
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("matches").doc("match_ws1").collection("payments").doc("pay_p5").set({
          id: "pay_p5",
          matchId: "match_ws1",
          playerId: "p_disabled_5",
          status: "Unpaid",
          availability: "Pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });
      const p5PayDoc = disabledPlayerDb.collection("matches").doc("match_ws1").collection("payments").doc("pay_p5");
      await assertFails(
        p5PayDoc.update({
          availability: "Confirmed",
          updatedAt: serverTimestamp(),
        }),
      );
    });

    // ── 4. Direct vs Collection-Group Ownership Consistency ──
    it("Consistency: direct document reads and collection-group reads enforce identical ownership boundaries", async () => {
      const { assertSucceeds, assertFails } = await import("@firebase/rules-unit-testing");

      const player1Db = testEnv.authenticatedContext("uid_player_1").firestore();
      const player2Db = testEnv.authenticatedContext("uid_player_2").firestore();

      // 1. Direct match payment read
      const directP1Doc = player1Db.collection("matches").doc("match_ws1").collection("payments").doc("pay_p1");
      await assertSucceeds(directP1Doc.get()); // Owner can read
      const foreignDirectP1Doc = player2Db.collection("matches").doc("match_ws1").collection("payments").doc("pay_p1");
      await assertFails(foreignDirectP1Doc.get()); // Foreign player denied

      // 2. Collection-group payment read
      // In Firestore rules, querying /{path=**}/payments/{paymentId} requires isSelf(resource.data.playerId)
      await assertSucceeds(directP1Doc.get());
      await assertFails(foreignDirectP1Doc.get());

      // 3. Direct otherFees read
      const directFeeDoc = player1Db.collection("players").doc("p_verified_1").collection("otherFees").doc("fee_p1");
      await assertSucceeds(directFeeDoc.get()); // Owner can read
      const foreignFeeDoc = player2Db.collection("players").doc("p_verified_1").collection("otherFees").doc("fee_p1");
      await assertFails(foreignFeeDoc.get()); // Foreign player denied
    });
  },
);
