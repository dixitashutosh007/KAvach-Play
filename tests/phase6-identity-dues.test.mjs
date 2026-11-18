/**
 * Phase 6 Remediation Tests: Verified Identity Resolution and Deterministic Dues
 *
 * Tests:
 * 1. Ambiguous links & duplicate mobile numbers: Strict rejection of mobile-based identity matching
 * 2. Verified UID-to-player ownership & legacy guard against UID hijacking
 * 3. Canonical player pointer resolution for merged profiles
 * 4. Missing player mappings & guest/unlinked workflows
 * 5. Deterministic dues calculation: Consistent exclusion of abandoned matches (Option A policy)
 *
 * Uses only Node.js built-in test runner (node:test + node:assert).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolvePlayerForUser,
  resolveMyPlayers,
  resolveCanonicalPlayer,
} from "../lib/player-identity.ts";
import { calculatePlayerDues } from "../lib/player-dues.ts";
import { isMatchBillable } from "../lib/matchBillable.ts";

describe("Phase 6 Identity Resolution and Deterministic Dues", () => {
  // ── 1. Ambiguous Links & Mobile Separation ─────────────────────────────────
  describe("1. Ambiguous Links & Elimination of Mobile-Based Identity", () => {
    const duplicatePhonePlayers = [
      {
        id: "player-alpha",
        name: "Alpha Player",
        mobile: "+919876543210",
        authUid: "uid-alpha",
      },
      {
        id: "player-beta",
        name: "Beta Player",
        mobile: "+919876543210", // identical phone number (shared phone / ambiguous)
        authUid: "uid-beta",
      },
      {
        id: "player-gamma",
        name: "Gamma Player (Unlinked)",
        mobile: "+919876543210", // same phone, but unlinked
      },
    ];

    it("resolves strictly by verified authUid when mobile numbers are identical", () => {
      const resolvedAlpha = resolvePlayerForUser(
        duplicatePhonePlayers,
        "uid-alpha",
        { id: "uid-alpha", role: "player" },
      );
      assert.ok(resolvedAlpha);
      assert.equal(resolvedAlpha.id, "player-alpha");

      const resolvedBeta = resolvePlayerForUser(
        duplicatePhonePlayers,
        "uid-beta",
        { id: "uid-beta", role: "player" },
      );
      assert.ok(resolvedBeta);
      assert.equal(resolvedBeta.id, "player-beta");
    });

    it("rejects mobile-based identity match when a new user logs in with the same mobile", () => {
      // User with uid-stranger signs in with +919876543210.
      // They must NOT inherit player-alpha, player-beta, or player-gamma!
      const strangerAppUser = {
        id: "uid-stranger",
        mobile: "+919876543210",
        role: "player",
      };

      const resolved = resolvePlayerForUser(
        duplicatePhonePlayers,
        "uid-stranger",
        strangerAppUser,
      );
      assert.equal(resolved, null, "Must return null for unlinked user regardless of matching phone");

      const myPlayers = resolveMyPlayers(
        duplicatePhonePlayers,
        "uid-stranger",
        strangerAppUser,
      );
      assert.deepEqual(myPlayers, [], "Must return empty array for unlinked user");
    });

    it("resolves via appUser.playerId pointer even if mobile is absent or different", () => {
      const appUserWithPointer = {
        id: "uid-custom",
        playerId: "player-gamma",
        role: "player",
      };
      const resolved = resolvePlayerForUser(
        duplicatePhonePlayers,
        "uid-custom",
        appUserWithPointer,
      );
      assert.ok(resolved);
      assert.equal(resolved.id, "player-gamma");
    });
  });

  // ── 2. UID/Player-ID Separation & Legacy Guards ────────────────────────────
  describe("2. UID/Player-ID Separation & Legacy Matching Guard", () => {
    it("allows legacy player where player.id === uid only when authUid is matching or unset", () => {
      const players = [
        {
          id: "uid-legacy-1",
          name: "Legacy Player 1",
          mobile: "+919111111111",
          // no authUid field in legacy record
        },
        {
          id: "uid-legacy-2",
          name: "Legacy Player 2",
          mobile: "+919222222222",
          authUid: "uid-legacy-2",
        },
      ];

      const res1 = resolvePlayerForUser(players, "uid-legacy-1", null);
      assert.ok(res1);
      assert.equal(res1.id, "uid-legacy-1");

      const res2 = resolvePlayerForUser(players, "uid-legacy-2", null);
      assert.ok(res2);
      assert.equal(res2.id, "uid-legacy-2");
    });

    it("rejects legacy player match if player doc is bound to a different authUid (prevents hijacking)", () => {
      const players = [
        {
          id: "uid-victim",
          name: "Victim Player",
          mobile: "+919333333333",
          authUid: "uid-attacker", // bound to someone else
        },
      ];

      // If user with UID "uid-victim" tries to claim this doc by ID alone:
      const res = resolvePlayerForUser(players, "uid-victim", null);
      assert.equal(res, null, "Must NOT resolve player whose authUid belongs to another user");
    });

    it("preserves disabled flag on player for AccountDisabledScreen while excluding from active myPlayers", () => {
      const players = [
        {
          id: "player-disabled",
          name: "Disabled Player",
          mobile: "+919444444444",
          authUid: "uid-disabled",
          disabled: true,
        },
      ];

      const resolved = resolvePlayerForUser(players, "uid-disabled", null);
      assert.ok(resolved);
      assert.equal(resolved.disabled, true, "Player doc must retain disabled: true for AccountDisabledScreen");

      const myActivePlayers = resolveMyPlayers(players, "uid-disabled", null);
      assert.deepEqual(myActivePlayers, [], "Active player roster (myPlayers) must exclude disabled players");
    });
  });

  // ── 3. Merged Player Profile Pointer Resolution ────────────────────────────
  describe("3. Canonical Player Resolution for Merged Profiles", () => {
    const players = [
      {
        id: "p-merged-1",
        name: "Duplicate Old Profile",
        mobile: "+919555555555",
        authUid: "uid-merged",
        mergedInto: "p-merged-2",
      },
      {
        id: "p-merged-2",
        name: "Intermediate Profile",
        mobile: "+919555555555",
        mergedInto: "p-canonical",
      },
      {
        id: "p-canonical",
        name: "Keeper Profile",
        mobile: "+919555555555",
      },
    ];

    it("follows mergedInto pointers to the canonical keeper", () => {
      const canonical = resolveCanonicalPlayer(players[0], players);
      assert.ok(canonical);
      assert.equal(canonical.id, "p-canonical");
      assert.equal(canonical.name, "Keeper Profile");
    });

    it("resolves canonical player when user authUid was linked to the old merged profile", () => {
      const resolved = resolvePlayerForUser(players, "uid-merged", null);
      assert.ok(resolved);
      assert.equal(resolved.id, "p-canonical");
    });

    it("terminates safely if a cyclic mergedInto reference exists", () => {
      const cyclic = [
        { id: "c1", name: "Cycle 1", mobile: "+919000000001", mergedInto: "c2" },
        { id: "c2", name: "Cycle 2", mobile: "+919000000002", mergedInto: "c1" },
      ];
      // Should terminate after max depth without infinite loop
      const result = resolveCanonicalPlayer(cyclic[0], cyclic);
      assert.ok(result);
    });
  });

  // ── 4. Missing Player Mappings & Guest/Unlinked Workflows ───────────────────
  describe("4. Missing Player Mappings & Guest/Unlinked Workflows", () => {
    it("returns null and empty dues for unlinked guest account", () => {
      const players = [
        { id: "p1", name: "Player 1", mobile: "+919111111111", authUid: "uid-1" },
      ];
      const matches = [
        { id: "m1", fee: 500, result: "Completed" },
      ];
      const payments = [
        { id: "pay1", playerId: "p1", matchId: "m1", status: "Unpaid" },
      ];

      const guestUid = "uid-guest";
      const resolved = resolvePlayerForUser(players, guestUid, null);
      assert.equal(resolved, null);

      const myPlayers = resolveMyPlayers(players, guestUid, null);
      assert.deepEqual(myPlayers, []);

      const dues = calculatePlayerDues(myPlayers, payments, matches, []);
      assert.equal(dues.totalDue, 0);
      assert.equal(dues.dueCount, 0);
      assert.equal(dues.hasDues, false);
      assert.deepEqual(dues.billableMatchPayments, []);
      assert.deepEqual(dues.unpaidOtherFees, []);
    });
  });

  // ── 5. Deterministic Dues & Abandoned Match Exclusion ───────────────────────
  describe("5. Deterministic Dues & Abandoned Match Exclusion (Option A)", () => {
    const testPlayer = {
      id: "p-finance",
      name: "Finance Test Player",
      mobile: "+919888888888",
      authUid: "uid-finance",
    };
    const myPlayers = [testPlayer];

    it("consistently excludes abandoned matches from dues amount, count, and indicator", () => {
      const matches = [
        {
          id: "match-abandoned",
          format: "T20",
          fee: 500,
          result: "Abandoned", // ABANDONED MATCH
        },
        {
          id: "match-completed",
          format: "T20",
          fee: 600,
          result: "Won", // BILLABLE MATCH
        },
      ];

      // Both matches have unpaid records in the database
      const payments = [
        {
          id: "pay-abandoned",
          playerId: "p-finance",
          matchId: "match-abandoned",
          status: "Unpaid",
        },
        {
          id: "pay-completed",
          playerId: "p-finance",
          matchId: "match-completed",
          status: "Unpaid",
        },
      ];

      const otherFees = [
        {
          id: "fee-late",
          playerId: "p-finance",
          amount: 150,
          status: "Unpaid",
        },
      ];

      // Verify isMatchBillable behavior
      assert.equal(isMatchBillable(matches[0]), false, "Abandoned match must NOT be billable");
      assert.equal(isMatchBillable(matches[1]), true, "Completed match must be billable");

      const summary = calculatePlayerDues(myPlayers, payments, matches, otherFees);

      // Abandoned match fee (500) must be EXCLUDED
      // Only Completed match (600) + Other Fee (150) = 750
      assert.equal(summary.matchDue, 600, "Match due should only include billable match");
      assert.equal(summary.otherFeeDue, 150, "Other fee due should be 150");
      assert.equal(summary.totalDue, 750, "Total due must exclude abandoned match");
      assert.equal(summary.dueCount, 2, "Due count must count only billable match + other fee");
      assert.equal(summary.hasDues, true);
      assert.equal(summary.billableMatchPayments.length, 1);
      assert.equal(summary.billableMatchPayments[0].match.id, "match-completed");
    });

    it("returns hasDues = false when only an abandoned match has an unpaid record", () => {
      const matches = [
        {
          id: "match-rain-out",
          format: "T30",
          fee: 550,
          result: "Abandoned",
        },
      ];

      const payments = [
        {
          id: "pay-rain-out",
          playerId: "p-finance",
          matchId: "match-rain-out",
          status: "Unpaid",
        },
      ];

      const summary = calculatePlayerDues(myPlayers, payments, matches, []);
      assert.equal(summary.totalDue, 0);
      assert.equal(summary.dueCount, 0);
      assert.equal(summary.hasDues, false, "Must not flag hasDues when only abandoned matches are unpaid");
    });

    it("respects feeOverride on billable match payments", () => {
      const matches = [
        { id: "m-regular", fee: 500, result: "Won" },
      ];
      const payments = [
        {
          id: "pay-discount",
          playerId: "p-finance",
          matchId: "m-regular",
          feeOverride: 350, // discount override
          status: "Unpaid",
        },
      ];

      const summary = calculatePlayerDues(myPlayers, payments, matches, []);
      assert.equal(summary.totalDue, 350, "Must use feeOverride instead of match.fee");
      assert.equal(summary.dueCount, 1);
      assert.equal(summary.hasDues, true);
    });

    it("excludes paid otherFees and non-myPlayers payments", () => {
      const matches = [
        { id: "m1", fee: 400, result: "Completed" },
      ];
      const payments = [
        {
          id: "pay-other-player",
          playerId: "foreign-player",
          matchId: "m1",
          status: "Unpaid",
        },
      ];
      const otherFees = [
        {
          id: "fee-paid",
          playerId: "p-finance",
          amount: 200,
          status: "Paid", // PAID fee
        },
      ];

      const summary = calculatePlayerDues(myPlayers, payments, matches, otherFees);
      assert.equal(summary.totalDue, 0);
      assert.equal(summary.dueCount, 0);
      assert.equal(summary.hasDues, false);
    });
  });
});
