/**
 * Phase 6: UI Implementation & Match Display Security Rules Tests
 * (tests/phase6-match-rules.emulator.test.mjs)
 *
 * Exercises Cloud Firestore Security Rules against the live Firebase Emulator for:
 * 1. Public match & ground catalog reads (anonymous and authenticated players)
 * 2. Match scheduling RBAC (ordinary players cannot create/update/delete; Match Admin can)
 * 3. Match Fee tampering prevention (ordinary players cannot alter match fee or budget)
 * 4. Player RSVP & Availability updates (players can update their own availability and tactical notes)
 * 5. Player Payment status integrity (players cannot mark their match payment as Paid - SEC-002)
 * 6. Privilege separation (players cannot alter another player's match payment or availability)
 * 7. Fee override protection (players cannot alter feeOverride, planTag, or sponsored amounts)
 * 8. Match discussion & comment integrity (players can add/delete their own comments, cannot impersonate)
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
  "Phase 6: Match Display & Operations Rules — Emulator Integration Tests",
  { skip: !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (requires local emulator runner)" },
  () => {
    let testEnv;

    before(async () => {
      if (!emulatorHost) return;
      const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
      testEnv = await initializeTestEnvironment({
        projectId: "kavach-phase6-test",
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

      // Seed baseline ground, player, and admin records
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();

        // 1. Seed Ground
        await adminDb.collection("grounds").doc("ground_noida_62").set({
          id: "ground_noida_62",
          name: "Noida Cricket Ground",
          city: "Noida",
          mapUrl: "https://maps.google.com/?q=Noida",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // 2. Seed Match Admin appUser
        await adminDb.collection("appUsers").doc("admin_match_uid").set({
          name: "Match Admin",
          role: "player",
          isMatchAdmin: true,
          status: "Active",
        });

        // 3. Seed Ordinary Player appUser & linked player profile
        await adminDb.collection("appUsers").doc("player_uid_1").set({
          name: "Player One",
          role: "player",
          playerId: "player_doc_1",
          status: "Active",
        });
        await adminDb.collection("players").doc("player_doc_1").set({
          id: "player_doc_1",
          name: "Player One",
          authUid: "player_uid_1",
          status: "Active",
          inviteStatus: "Accepted",
        });

        // 4. Seed Foreign Player
        await adminDb.collection("appUsers").doc("player_uid_2").set({
          name: "Player Two",
          role: "player",
          playerId: "player_doc_2",
          status: "Active",
        });
        await adminDb.collection("players").doc("player_doc_2").set({
          id: "player_doc_2",
          name: "Player Two",
          authUid: "player_uid_2",
          status: "Active",
          inviteStatus: "Accepted",
        });

        // 5. Seed an initial Match
        await adminDb.collection("matches").doc("match_101").set({
          groundId: "ground_noida_62",
          format: "T30",
          jerseyColor: "Scarlet Red",
          opponent: "Spartans Cricket Club",
          matchType: "Practice",
          fee: 650,
          date: "2026-11-25",
          time: "07:30",
          maxSquadSize: 14,
          matchUrl: "https://cricheroes.in/match/101",
          streamingUrl: "",
          result: "Pending",
          resultMarginType: "runs",
          resultMarginAmount: 0,
          playerOfTheMatch: "",
          potmId: "",
          bestBatsman: "",
          bestBowler: "",
          tentativelyBlockedBy: "",
          tournamentId: "",
          googleEventId: "",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // 6. Seed initial match payment for Player One
        await adminDb.collection("matches").doc("match_101").collection("payments").doc("pay_101_p1").set({
          id: "pay_101_p1",
          matchId: "match_101",
          playerId: "player_doc_1",
          status: "Unpaid",
          availability: "Pending",
          tacticalNote: "",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });
    });

    // ── 1. Match & Ground Catalog Read Access ──
    it("allows unauthenticated and authenticated users to read matches and grounds", async () => {
      const { assertSucceeds } = await import("@firebase/rules-unit-testing");
      const unauth = testEnv.unauthenticatedContext().firestore();
      const player = testEnv.authenticatedContext("player_uid_1").firestore();

      await assertSucceeds(unauth.collection("matches").doc("match_101").get());
      await assertSucceeds(unauth.collection("grounds").doc("ground_noida_62").get());
      await assertSucceeds(player.collection("matches").doc("match_101").get());
      await assertSucceeds(player.collection("grounds").doc("ground_noida_62").get());
    });

    // ── 2. Match Creation & Scheduling RBAC ──
    it("rejects match creation by ordinary player; allows Match Admin", async () => {
      const { assertFails, assertSucceeds } = await import("@firebase/rules-unit-testing");
      const { serverTimestamp } = await import("firebase/firestore");
      const player = testEnv.authenticatedContext("player_uid_1").firestore();
      const matchAdmin = testEnv.authenticatedContext("admin_match_uid").firestore();

      const newMatchData = {
        groundId: "ground_noida_62",
        format: "T20",
        jerseyColor: "Whites",
        opponent: "Royal Strikers",
        matchType: "Practice",
        fee: 500,
        date: "2026-11-28",
        time: "08:00",
        maxSquadSize: 12,
        matchUrl: "",
        streamingUrl: "",
        result: "Pending",
        resultMarginType: "runs",
        resultMarginAmount: 0,
        playerOfTheMatch: "",
        potmId: "",
        bestBatsman: "",
        bestBowler: "",
        tentativelyBlockedBy: "",
        tournamentId: "",
        googleEventId: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // Ordinary player cannot create match
      await assertFails(player.collection("matches").doc("match_102").set(newMatchData));

      // Match Admin can create match
      await assertSucceeds(matchAdmin.collection("matches").doc("match_102").set(newMatchData));
    });

    it("accepts the 'Club Match' category for Match Admins and still rejects unknown categories", async () => {
      const { assertFails, assertSucceeds } = await import("@firebase/rules-unit-testing");
      const { serverTimestamp } = await import("firebase/firestore");
      const matchAdmin = testEnv.authenticatedContext("admin_match_uid").firestore();
      const player = testEnv.authenticatedContext("player_uid_1").firestore();

      const base = {
        groundId: "ground_noida_62",
        format: "T30",
        jerseyColor: "Scarlet Red",
        opponent: "Weekend Warriors",
        fee: 550,
        date: "2026-11-29",
        time: "07:00",
        maxSquadSize: 12,
        matchUrl: "",
        streamingUrl: "",
        result: "Pending",
        resultMarginType: "runs",
        resultMarginAmount: 0,
        playerOfTheMatch: "",
        potmId: "",
        bestBatsman: "",
        bestBowler: "",
        tentativelyBlockedBy: "",
        tournamentId: "",
        googleEventId: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await assertSucceeds(
        matchAdmin.collection("matches").doc("match_club_1").set({ ...base, matchType: "Club Match" }),
      );
      await assertFails(
        matchAdmin.collection("matches").doc("match_club_2").set({ ...base, matchType: "Friendly" }),
      );
      // Players still cannot create matches of any category
      await assertFails(
        player.collection("matches").doc("match_club_3").set({ ...base, matchType: "Club Match" }),
      );
    });

    // ── 3. Player Match Availability & RSVP Updates (MOD-02B) ──
    it("allows a player to update their own availability and tacticalNote", async () => {
      const { assertSucceeds } = await import("@firebase/rules-unit-testing");
      const { serverTimestamp } = await import("firebase/firestore");
      const player = testEnv.authenticatedContext("player_uid_1").firestore();

      const payDoc = player
        .collection("matches")
        .doc("match_101")
        .collection("payments")
        .doc("pay_101_p1");

      // Player confirms availability to "Confirmed" with tactical note
      await assertSucceeds(
        payDoc.update({
          availability: "Confirmed",
          tacticalNote: "Arriving 15m early / bat top order",
          updatedAt: serverTimestamp(),
        }),
      );
    });

    // ── 4. SEC-002: Player Payment Status Manipulation Prevention ──
    it("rejects player attempt to mark payment status as Paid (SEC-002)", async () => {
      const { assertFails } = await import("@firebase/rules-unit-testing");
      const { serverTimestamp } = await import("firebase/firestore");
      const player = testEnv.authenticatedContext("player_uid_1").firestore();

      const payDoc = player
        .collection("matches")
        .doc("match_101")
        .collection("payments")
        .doc("pay_101_p1");

      // Player attempts to mark status as Paid
      await assertFails(
        payDoc.update({
          status: "Paid",
          updatedAt: serverTimestamp(),
        }),
      );
    });

    // ── 5. Financial Tampering: feeOverride & offsets ──
    it("rejects player attempt to alter feeOverride or fee offsets", async () => {
      const { assertFails } = await import("@firebase/rules-unit-testing");
      const { serverTimestamp } = await import("firebase/firestore");
      const player = testEnv.authenticatedContext("player_uid_1").firestore();

      const payDoc = player
        .collection("matches")
        .doc("match_101")
        .collection("payments")
        .doc("pay_101_p1");

      // Tampering with feeOverride
      await assertFails(
        payDoc.update({
          feeOverride: 0,
          updatedAt: serverTimestamp(),
        }),
      );

      // Tampering with planTag or manualMethod
      await assertFails(
        payDoc.update({
          planTag: "100% Sponsored",
          updatedAt: serverTimestamp(),
        }),
      );
    });

    // ── 6. Resource Ownership: Cross-Player Tampering ──
    it("rejects player attempting to update another player's match payment", async () => {
      const { assertFails } = await import("@firebase/rules-unit-testing");
      const { serverTimestamp } = await import("firebase/firestore");
      const playerTwo = testEnv.authenticatedContext("player_uid_2").firestore();

      const foreignPayDoc = playerTwo
        .collection("matches")
        .doc("match_101")
        .collection("payments")
        .doc("pay_101_p1"); // Owned by player_doc_1

      await assertFails(
        foreignPayDoc.update({
          availability: "No",
          updatedAt: serverTimestamp(),
        }),
      );
    });

    // ── 7. Scope B: Strict Field Allowlists & Malformed Payload Rejection ──
    it("rejects player update containing unexpected, malformed, or admin-only fields", async () => {
      const { assertFails } = await import("@firebase/rules-unit-testing");
      const { serverTimestamp } = await import("firebase/firestore");
      const player = testEnv.authenticatedContext("player_uid_1").firestore();

      const payDoc = player
        .collection("matches")
        .doc("match_101")
        .collection("payments")
        .doc("pay_101_p1");

      // 1. Malformed / unexpected field
      await assertFails(
        payDoc.update({
          availability: "Confirmed",
          unexpectedField: "malicious_injection",
          updatedAt: serverTimestamp(),
        }),
      );

      // 2. Admin-only field included with tactical note
      await assertFails(
        payDoc.update({
          tacticalNote: "Ready to bat",
          manualMethod: "cash",
          updatedAt: serverTimestamp(),
        }),
      );

      // 3. Attempting to modify immutable playerId
      await assertFails(
        payDoc.update({
          playerId: "player_doc_2",
          updatedAt: serverTimestamp(),
        }),
      );

      // 4. Over-length tactical note (> 500 characters)
      await assertFails(
        payDoc.update({
          tacticalNote: "X".repeat(501),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    // ── 8. Scope D: Match Display Data Privacy (Permitted and Denied Reads) ──
    it("enforces match payment data privacy: players read own payments; non-admins denied foreign payments; admins permitted", async () => {
      const { assertSucceeds, assertFails } = await import("@firebase/rules-unit-testing");
      const playerOne = testEnv.authenticatedContext("player_uid_1").firestore();
      const playerTwo = testEnv.authenticatedContext("player_uid_2").firestore();
      const matchAdmin = testEnv.authenticatedContext("admin_match_uid").firestore();

      const p1PayDocRef = (dbInstance) =>
        dbInstance
          .collection("matches")
          .doc("match_101")
          .collection("payments")
          .doc("pay_101_p1");

      // Player One can read their own payment record
      await assertSucceeds(p1PayDocRef(playerOne).get());

      // Player Two (non-admin) CANNOT read Player One's payment record (Scope D data privacy)
      await assertFails(p1PayDocRef(playerTwo).get());

      // Match Admin CAN read Player One's payment record for match management
      await assertSucceeds(p1PayDocRef(matchAdmin).get());
    });

    // ── 9. Match Discussion & Comments ──
    it("allows players to post comments on matches; rejects impersonation", async () => {
      const { assertSucceeds, assertFails } = await import("@firebase/rules-unit-testing");
      const { serverTimestamp } = await import("firebase/firestore");
      const player = testEnv.authenticatedContext("player_uid_1").firestore();

      const validComment = {
        id: "comm_1",
        matchId: "match_101",
        playerId: "player_doc_1",
        playerName: "Player One",
        text: "Looking forward to opening bowling Saturday morning!",
        createdAt: serverTimestamp(),
      };

      // Player posts legitimate comment
      await assertSucceeds(
        player
          .collection("matches")
          .doc("match_101")
          .collection("comments")
          .doc("comm_1")
          .set(validComment),
      );

      // Player attempts to impersonate Player Two
      const spoofedComment = {
        id: "comm_2",
        matchId: "match_101",
        playerId: "player_doc_2", // Spoofed
        playerName: "Player Two",
        text: "I cannot make it",
        createdAt: serverTimestamp(),
      };

      await assertFails(
        player
          .collection("matches")
          .doc("match_101")
          .collection("comments")
          .doc("comm_2")
          .set(spoofedComment),
      );
    });
  },
);
