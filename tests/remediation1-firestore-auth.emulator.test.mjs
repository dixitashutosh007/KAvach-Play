/**
 * Security Remediation 1: Firestore Authorization & Player Identity Protection Integration Suite
 * (tests/remediation1-firestore-auth.emulator.test.mjs)
 *
 * Verifies live Cloud Firestore Security Rules against the Firebase Emulator for:
 * 1. otherFees Collection-Group Read Matrix (Least-Privilege Enforcement):
 *    - Unauthenticated: Deny direct & collection-group.
 *    - Player (authenticated, active): Read own fee allowed; foreign fee denied (direct & collection-group).
 *    - Finance Admin: Read any player fee allowed (direct & collection-group).
 *    - Super Admin: Read any player fee allowed (direct & collection-group).
 *    - Club Admin: Direct read of foreign fee denied; collection-group read denied.
 *    - Match Admin: Direct read of foreign fee denied; collection-group read denied.
 *    - Studio Admin: Direct read of foreign fee denied; collection-group read denied.
 *    - Disabled Finance Admin: All access denied.
 *
 * 2. players/{playerId} Self-Service Update Field Allowlist & Validation:
 *    - Permitted fields: name, email, mobile, dob, locality, bloodGroup, emergencyContact,
 *      battingStyle, bowlingStyle, isWicketKeeper, chestSize, waistSize, jerseyNumber,
 *      jerseyName, photoURL, inviteStatus (Pending/Unchanged), updatedAt.
 *    - Tampering protection: Rejection of authUid, id, disabled, disabledAt, mergedInto,
 *      role/permission flags, status, kavachId, studio fields, financial/stats fields, createdAt.
 *    - Privilege escalation protection: Cannot escalate inviteStatus to Verified, Accepted, or Rejected.
 *    - Bounds checking: String lengths and type validations enforced.
 *    - Cross-player update rejection: Cannot update other players' profiles.
 *
 * 3. Secure Account Linking:
 *    - Matching phone token + unlinked player: Allow authUid + updatedAt link.
 *    - Non-matching phone token: Deny link.
 *    - Spoofed authUid: Deny link.
 *    - Tampered extra fields (e.g. name or role): Deny link.
 *    - Already-linked player: Deny rebinding.
 *    - Disabled or merged player: Deny linking.
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
  "Security Remediation 1: Firestore Authorization & Player Protection — Live Emulator Suite",
  { skip: !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator)" },
  () => {
    let testEnv;

    before(async () => {
      if (!emulatorHost) return;
      const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
      testEnv = await initializeTestEnvironment({
        projectId: "kavach-remediation1-sec-test",
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

      // Seed baseline fixtures with admin privileges
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();

        // 1. Player 1 (Active, Verified, linked via authUid)
        await adminDb.collection("players").doc("p_player_1").set({
          name: "Player One",
          mobile: "9876543201",
          authUid: "uid_player_1",
          status: "Active",
          disabled: false,
          inviteStatus: "Accepted",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await adminDb.collection("appUsers").doc("uid_player_1").set({
          name: "Player One",
          role: "player",
          playerId: "p_player_1",
          status: "Active",
        });

        // Seed otherFees for Player 1
        await adminDb.collection("players").doc("p_player_1").collection("otherFees").doc("fee_p1").set({
          id: "fee_p1",
          playerId: "p_player_1",
          title: "Player 1 Tournament Fee",
          amount: 500,
          status: "Unpaid",
        });

        // 2. Player 2 (Active, Verified, linked via authUid)
        await adminDb.collection("players").doc("p_player_2").set({
          name: "Player Two",
          mobile: "9876543202",
          authUid: "uid_player_2",
          status: "Active",
          disabled: false,
          inviteStatus: "Accepted",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await adminDb.collection("appUsers").doc("uid_player_2").set({
          name: "Player Two",
          role: "player",
          playerId: "p_player_2",
          status: "Active",
        });

        // Seed otherFees for Player 2
        await adminDb.collection("players").doc("p_player_2").collection("otherFees").doc("fee_p2").set({
          id: "fee_p2",
          playerId: "p_player_2",
          title: "Player 2 Late Fee",
          amount: 150,
          status: "Unpaid",
        });

        // 3. Finance Admin
        await adminDb.collection("appUsers").doc("uid_fin_admin").set({
          name: "Finance Administrator",
          role: "admin",
          isFinanceAdmin: true,
          status: "Active",
        });

        // 4. Super Admin (with appUsers doc)
        await adminDb.collection("appUsers").doc("uid_super_admin").set({
          name: "Super Administrator",
          role: "admin",
          isSuperAdmin: true,
          status: "Active",
        });

        // 5. Club Admin (not finance admin)
        await adminDb.collection("appUsers").doc("uid_club_admin").set({
          name: "Club Administrator",
          role: "admin",
          isClubAdmin: true,
          status: "Active",
        });

        // 6. Match Admin (not finance admin)
        await adminDb.collection("appUsers").doc("uid_match_admin").set({
          name: "Match Administrator",
          role: "admin",
          isMatchAdmin: true,
          status: "Active",
        });

        // 7. Studio Admin (not finance admin)
        await adminDb.collection("appUsers").doc("uid_studio_admin").set({
          name: "Studio Administrator",
          role: "admin",
          isStudioAdmin: true,
          status: "Active",
        });

        // 8. Disabled Finance Admin
        await adminDb.collection("appUsers").doc("uid_disabled_fin").set({
          name: "Disabled Finance Admin",
          role: "admin",
          isFinanceAdmin: true,
          status: "Disabled",
        });

        // 9. Unlinked Player available for phone linking
        await adminDb.collection("players").doc("p_unlinked").set({
          name: "Unlinked Roster Player",
          mobile: "9876543299",
          status: "Active",
          disabled: false,
          inviteStatus: "Unverified",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // 10. Disabled Player for linking test
        await adminDb.collection("players").doc("p_disabled").set({
          name: "Disabled Roster Player",
          mobile: "9876543288",
          status: "Disabled",
          disabled: true,
          inviteStatus: "Unverified",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // 11. Merged Player for linking test
        await adminDb.collection("players").doc("p_merged").set({
          name: "Merged Roster Player",
          mobile: "9876543277",
          status: "Merged",
          disabled: true,
          mergedInto: "p_player_1",
          inviteStatus: "Unverified",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // 12. Unverified Player for inviteStatus transition test
        await adminDb.collection("players").doc("p_unverified").set({
          name: "Unverified Player",
          mobile: "9876543266",
          authUid: "uid_unverified",
          status: "Active",
          disabled: false,
          inviteStatus: "Unverified",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await adminDb.collection("appUsers").doc("uid_unverified").set({
          name: "Unverified Player",
          role: "player",
          playerId: "p_unverified",
          status: "Active",
        });
      });
    });

    // ─────────────────────────────────────────────────────────────
    // 1. otherFees Collection-Group Read Least-Privilege Matrix
    // ─────────────────────────────────────────────────────────────
    describe("1. otherFees Least Privilege & Collection-Group Protection", () => {
      it("denies unauthenticated read on direct doc and collection-group", async () => {
        const { assertFails } = await import("@firebase/rules-unit-testing");
        const unauthDb = testEnv.unauthenticatedContext().firestore();

        // Direct read
        await assertFails(
          unauthDb.collection("players").doc("p_player_1").collection("otherFees").doc("fee_p1").get(),
        );
        // Collection-group query
        await assertFails(unauthDb.collectionGroup("otherFees").get());
      });

      it("allows player to read own otherFees directly and via self collection-group query; denies foreign fee", async () => {
        const { assertSucceeds, assertFails } = await import("@firebase/rules-unit-testing");
        const p1Db = testEnv.authenticatedContext("uid_player_1").firestore();

        // Direct read own fee: ALLOW
        await assertSucceeds(
          p1Db.collection("players").doc("p_player_1").collection("otherFees").doc("fee_p1").get(),
        );

        // Direct read foreign fee: DENY
        await assertFails(
          p1Db.collection("players").doc("p_player_2").collection("otherFees").doc("fee_p2").get(),
        );

        // Collection-group scoped to self: ALLOW
        await assertSucceeds(
          p1Db.collectionGroup("otherFees").where("playerId", "==", "p_player_1").get(),
        );

        // Collection-group scoped to foreign player: DENY
        await assertFails(
          p1Db.collectionGroup("otherFees").where("playerId", "==", "p_player_2").get(),
        );

        // Unscoped collection-group query: DENY
        await assertFails(p1Db.collectionGroup("otherFees").get());
      });

      it("allows Finance Admin and Super Admin to read all otherFees directly and via collection-group", async () => {
        const { assertSucceeds } = await import("@firebase/rules-unit-testing");
        const finDb = testEnv.authenticatedContext("uid_fin_admin").firestore();
        const superDb = testEnv.authenticatedContext("uid_super_admin", { admin: true }).firestore();

        // Finance Admin direct reads
        await assertSucceeds(
          finDb.collection("players").doc("p_player_1").collection("otherFees").doc("fee_p1").get(),
        );
        await assertSucceeds(
          finDb.collection("players").doc("p_player_2").collection("otherFees").doc("fee_p2").get(),
        );
        // Finance Admin collection-group query
        await assertSucceeds(finDb.collectionGroup("otherFees").get());

        // Super Admin direct reads
        await assertSucceeds(
          superDb.collection("players").doc("p_player_1").collection("otherFees").doc("fee_p1").get(),
        );
        await assertSucceeds(
          superDb.collection("players").doc("p_player_2").collection("otherFees").doc("fee_p2").get(),
        );
        // Super Admin collection-group query
        await assertSucceeds(superDb.collectionGroup("otherFees").get());
      });

      it("denies Club Admin, Match Admin, and Studio Admin from reading foreign otherFees or querying collection-group", async () => {
        const { assertFails } = await import("@firebase/rules-unit-testing");
        const clubDb = testEnv.authenticatedContext("uid_club_admin").firestore();
        const matchDb = testEnv.authenticatedContext("uid_match_admin").firestore();
        const studioDb = testEnv.authenticatedContext("uid_studio_admin").firestore();

        // Club Admin denied
        await assertFails(
          clubDb.collection("players").doc("p_player_1").collection("otherFees").doc("fee_p1").get(),
        );
        await assertFails(clubDb.collectionGroup("otherFees").get());

        // Match Admin denied
        await assertFails(
          matchDb.collection("players").doc("p_player_1").collection("otherFees").doc("fee_p1").get(),
        );
        await assertFails(matchDb.collectionGroup("otherFees").get());

        // Studio Admin denied
        await assertFails(
          studioDb.collection("players").doc("p_player_1").collection("otherFees").doc("fee_p1").get(),
        );
        await assertFails(studioDb.collectionGroup("otherFees").get());
      });

      it("denies disabled Finance Admin from reading any otherFees", async () => {
        const { assertFails } = await import("@firebase/rules-unit-testing");
        const disabledFinDb = testEnv.authenticatedContext("uid_disabled_fin").firestore();

        await assertFails(
          disabledFinDb.collection("players").doc("p_player_1").collection("otherFees").doc("fee_p1").get(),
        );
        await assertFails(disabledFinDb.collectionGroup("otherFees").get());
      });
    });

    // ─────────────────────────────────────────────────────────────
    // 2. players/{playerId} Self-Service Update Field Allowlist & Bounds
    // ─────────────────────────────────────────────────────────────
    describe("2. players/{playerId} Self-Service Allowlist & Tamper Resistance", () => {
      it("allows authenticated player to update legitimate profile fields with valid types and lengths", async () => {
        const { assertSucceeds } = await import("@firebase/rules-unit-testing");
        const { serverTimestamp } = await import("firebase/firestore");
        const p1Db = testEnv.authenticatedContext("uid_player_1").firestore();

        const validUpdates = {
          name: "Player One Updated",
          email: "player1.new@kavachcricket.com",
          mobile: "9876543299",
          dob: "1994-08-20",
          locality: "South Mumbai",
          bloodGroup: "O+",
          emergencyContact: "9876543200",
          battingStyle: "Right-hand bat",
          bowlingStyle: "Right-arm medium fast",
          isWicketKeeper: true,
          chestSize: "42",
          waistSize: "34",
          jerseyNumber: "18",
          jerseyName: "KAvach 18",
          photoURL: "https://example.com/photos/p1_updated.jpg",
          updatedAt: serverTimestamp(),
        };

        await assertSucceeds(
          p1Db.collection("players").doc("p_player_1").update(validUpdates),
        );
      });

      it("allows player to update inviteStatus only to Pending, or retain existing status", async () => {
        const { assertSucceeds, assertFails } = await import("@firebase/rules-unit-testing");
        const { serverTimestamp } = await import("firebase/firestore");
        const p1Db = testEnv.authenticatedContext("uid_player_1").firestore();
        const unverifiedDb = testEnv.authenticatedContext("uid_unverified").firestore();

        // Player 1 existing inviteStatus is "Accepted".
        // Keeping it Accepted: ALLOW
        await assertSucceeds(
          p1Db.collection("players").doc("p_player_1").update({
            inviteStatus: "Accepted",
            updatedAt: serverTimestamp(),
          }),
        );

        // Escalating to Verified: DENY
        await assertFails(
          p1Db.collection("players").doc("p_player_1").update({
            inviteStatus: "Verified",
            updatedAt: serverTimestamp(),
          }),
        );

        // Unverified player transitioning to Pending: ALLOW
        await assertSucceeds(
          unverifiedDb.collection("players").doc("p_unverified").update({
            inviteStatus: "Pending",
            updatedAt: serverTimestamp(),
          }),
        );

        // Unverified player escalating to Verified: DENY
        await assertFails(
          unverifiedDb.collection("players").doc("p_unverified").update({
            inviteStatus: "Verified",
            updatedAt: serverTimestamp(),
          }),
        );

        // Unverified player escalating to Rejected: DENY
        await assertFails(
          unverifiedDb.collection("players").doc("p_unverified").update({
            inviteStatus: "Rejected",
            updatedAt: serverTimestamp(),
          }),
        );
      });

      it("strictly denies player from modifying protected identity, security, role, and financial fields", async () => {
        const { assertFails } = await import("@firebase/rules-unit-testing");
        const { serverTimestamp } = await import("firebase/firestore");
        const p1Db = testEnv.authenticatedContext("uid_player_1").firestore();

        const protectedFieldAttacks = [
          { authUid: "uid_attacker" },
          { id: "p_hacked" },
          { disabled: true },
          { disabledAt: new Date().toISOString() },
          { mergedInto: "p_player_2" },
          { role: "admin" },
          { isSuperAdmin: true },
          { isClubAdmin: true },
          { isMatchAdmin: true },
          { isFinanceAdmin: true },
          { isStudioAdmin: true },
          { status: "Suspended" },
          { kavachId: "KCC999" },
          { isStudioMember: true },
          { studioStartDate: "2026-01-01" },
          { studioEndDate: "2026-12-31" },
          { studioPlan: "12M" },
          { studioExpiryDate: "2026-12-31" },
          { lastPaidDate: "2026-01-01" },
          { lastPaidAmount: 5000 },
          { rejectedAt: "2026-01-01" },
          { feePlanIds: ["plan_vip"] },
          { monthlyPlan: { planId: "p1", amount: 1000, startDate: "2026-01-01", endDate: "2026-02-01", paidStatus: "Paid" } },
          { kavachJoining: "2026-01-01" },
          { totalRuns: 10000 },
          { totalWickets: 500 },
          { droppedCatches: 0 },
          { stunningCatches: 50 },
          { createdAt: serverTimestamp() },
          { unapprovedArbitraryField: "malicious_payload" },
        ];

        for (const attack of protectedFieldAttacks) {
          const fieldName = Object.keys(attack)[0];
          await assertFails(
            p1Db.collection("players").doc("p_player_1").update({
              ...attack,
              updatedAt: serverTimestamp(),
            }),
            `Expected player self-update containing forbidden field '${fieldName}' to be denied`,
          );
        }
      });

      it("enforces validation bounds on self-service fields (string length, non-empty name, boolean isWicketKeeper)", async () => {
        const { assertFails } = await import("@firebase/rules-unit-testing");
        const { serverTimestamp } = await import("firebase/firestore");
        const p1Db = testEnv.authenticatedContext("uid_player_1").firestore();

        // Empty name: DENY
        await assertFails(
          p1Db.collection("players").doc("p_player_1").update({
            name: "",
            updatedAt: serverTimestamp(),
          }),
        );

        // Name exceeding 100 chars: DENY
        await assertFails(
          p1Db.collection("players").doc("p_player_1").update({
            name: "A".repeat(101),
            updatedAt: serverTimestamp(),
          }),
        );

        // Mobile exceeding 20 chars: DENY
        await assertFails(
          p1Db.collection("players").doc("p_player_1").update({
            mobile: "9".repeat(21),
            updatedAt: serverTimestamp(),
          }),
        );

        // isWicketKeeper as non-bool: DENY
        await assertFails(
          p1Db.collection("players").doc("p_player_1").update({
            isWicketKeeper: "true",
            updatedAt: serverTimestamp(),
          }),
        );
      });

      it("denies player from updating another player's profile", async () => {
        const { assertFails } = await import("@firebase/rules-unit-testing");
        const { serverTimestamp } = await import("firebase/firestore");
        const p1Db = testEnv.authenticatedContext("uid_player_1").firestore();

        await assertFails(
          p1Db.collection("players").doc("p_player_2").update({
            name: "Tampered Player Two",
            updatedAt: serverTimestamp(),
          }),
        );
      });

      it("allows Admin to update any player document including administrative and status fields", async () => {
        const { assertSucceeds } = await import("@firebase/rules-unit-testing");
        const { serverTimestamp } = await import("firebase/firestore");
        const clubDb = testEnv.authenticatedContext("uid_club_admin").firestore();

        await assertSucceeds(
          clubDb.collection("players").doc("p_player_1").update({
            kavachId: "KCC042",
            isStudioMember: true,
            inviteStatus: "Verified",
            updatedAt: serverTimestamp(),
          }),
        );
      });
    });

    // ─────────────────────────────────────────────────────────────
    // 3. Secure Account Linking
    // ─────────────────────────────────────────────────────────────
    describe("3. Secure Account Linking & Identity Protection", () => {
      it("allows authenticated user with matching phone token to link unlinked player profile", async () => {
        const { assertSucceeds } = await import("@firebase/rules-unit-testing");
        const { serverTimestamp } = await import("firebase/firestore");
        // User with phone number matching p_unlinked ("9876543299")
        const linkingDb = testEnv.authenticatedContext("uid_new_user", {
          phone_number: "+919876543299",
        }).firestore();

        await assertSucceeds(
          linkingDb.collection("players").doc("p_unlinked").update({
            authUid: "uid_new_user",
            updatedAt: serverTimestamp(),
          }),
        );
      });

      it("denies account linking when phone token does not match player mobile", async () => {
        const { assertFails } = await import("@firebase/rules-unit-testing");
        const { serverTimestamp } = await import("firebase/firestore");
        const wrongPhoneDb = testEnv.authenticatedContext("uid_wrong_phone", {
          phone_number: "+911111111111",
        }).firestore();

        await assertFails(
          wrongPhoneDb.collection("players").doc("p_unlinked").update({
            authUid: "uid_wrong_phone",
            updatedAt: serverTimestamp(),
          }),
        );
      });

      it("denies account linking when attempting to set a foreign authUid (spoofing)", async () => {
        const { assertFails } = await import("@firebase/rules-unit-testing");
        const { serverTimestamp } = await import("firebase/firestore");
        const callerDb = testEnv.authenticatedContext("uid_caller", {
          phone_number: "+919876543299",
        }).firestore();

        await assertFails(
          callerDb.collection("players").doc("p_unlinked").update({
            authUid: "uid_victim_user",
            updatedAt: serverTimestamp(),
          }),
        );
      });

      it("denies account linking when extra fields (e.g. name or role) are modified in the same request", async () => {
        const { assertFails } = await import("@firebase/rules-unit-testing");
        const { serverTimestamp } = await import("firebase/firestore");
        const callerDb = testEnv.authenticatedContext("uid_new_user_2", {
          phone_number: "+919876543299",
        }).firestore();

        await assertFails(
          callerDb.collection("players").doc("p_unlinked").update({
            authUid: "uid_new_user_2",
            name: "Tampered Name During Linking",
            updatedAt: serverTimestamp(),
          }),
        );
      });

      it("denies account linking on an already-linked player (preventing account takeover)", async () => {
        const { assertFails } = await import("@firebase/rules-unit-testing");
        const { serverTimestamp } = await import("firebase/firestore");
        // p_player_1 is already linked to uid_player_1.
        const hijackDb = testEnv.authenticatedContext("uid_hijacker", {
          phone_number: "+919876543201",
        }).firestore();

        await assertFails(
          hijackDb.collection("players").doc("p_player_1").update({
            authUid: "uid_hijacker",
            updatedAt: serverTimestamp(),
          }),
        );
      });

      it("denies account linking on a disabled or merged player profile", async () => {
        const { assertFails } = await import("@firebase/rules-unit-testing");
        const { serverTimestamp } = await import("firebase/firestore");

        // Disabled player p_disabled
        const disabledLinkDb = testEnv.authenticatedContext("uid_user_dis", {
          phone_number: "+919876543288",
        }).firestore();
        await assertFails(
          disabledLinkDb.collection("players").doc("p_disabled").update({
            authUid: "uid_user_dis",
            updatedAt: serverTimestamp(),
          }),
        );

        // Merged player p_merged
        const mergedLinkDb = testEnv.authenticatedContext("uid_user_merg", {
          phone_number: "+919876543277",
        }).firestore();
        await assertFails(
          mergedLinkDb.collection("players").doc("p_merged").update({
            authUid: "uid_user_merg",
            updatedAt: serverTimestamp(),
          }),
        );
      });
    });
  },
);
