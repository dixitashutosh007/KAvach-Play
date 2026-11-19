import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsePlayerDob,
  getPlayerBirthdayStatus,
  partitionBirthdays,
} from "../lib/birthday-utils.ts";
import { isPlayerEligibleForMatch } from "../lib/match-eligibility.ts";

describe("Phase 2.1 Corrections: Deterministic Birthday Parsing & Match Eligibility", () => {
  // ── 1. Birthday Parsing & Year-Boundary Tests ──────────────────────────────
  describe("1. Deterministic Birthday Parsing (lib/birthday-utils.ts)", () => {
    it("parses valid YYYY-MM-DD format accurately", () => {
      const res = parsePlayerDob("1995-04-12");
      assert.deepEqual(res, { day: 12, month: 4, year: 1995 });
    });

    it("parses valid DD/MM/YYYY format accurately without JS Date ambiguity", () => {
      const res = parsePlayerDob("12/04/1995");
      assert.deepEqual(res, { day: 12, month: 4, year: 1995 });
    });

    it("rejects invalid calendar dates safely (e.g. Feb 31st)", () => {
      assert.equal(parsePlayerDob("1995-02-31"), null);
      assert.equal(parsePlayerDob("31/02/1995"), null);
    });

    it("rejects invalid month numbers (> 12 or < 1)", () => {
      assert.equal(parsePlayerDob("1995-13-10"), null);
      assert.equal(parsePlayerDob("10/13/1995"), null);
    });

    it("handles missing, null, undefined, empty, and garbage strings safely", () => {
      assert.equal(parsePlayerDob(null), null);
      assert.equal(parsePlayerDob(undefined), null);
      assert.equal(parsePlayerDob(""), null);
      assert.equal(parsePlayerDob("   "), null);
      assert.equal(parsePlayerDob("not-a-date"), null);
      assert.equal(parsePlayerDob("99/99/9999"), null);
    });

    it("correctly identifies birthday TODAY", () => {
      const refDate = new Date(2026, 10, 19); // 19 Nov 2026
      const status1 = getPlayerBirthdayStatus("1990-11-19", refDate);
      assert.equal(status1.isToday, true);
      assert.equal(status1.isUpcoming, false);
      assert.equal(status1.daysUntil, 0);

      const status2 = getPlayerBirthdayStatus("19/11/1990", refDate);
      assert.equal(status2.isToday, true);
      assert.equal(status2.isUpcoming, false);
      assert.equal(status2.daysUntil, 0);
    });

    it("correctly identifies birthday within the next 14 days", () => {
      const refDate = new Date(2026, 10, 19); // 19 Nov 2026
      // 4 days from now: 23 Nov
      const status = getPlayerBirthdayStatus("1988-11-23", refDate);
      assert.equal(status.isToday, false);
      assert.equal(status.isUpcoming, true);
      assert.equal(status.daysUntil, 4);
    });

    it("correctly handles year-boundary rollover across December and January", () => {
      // Reference date: 28 Dec 2026
      const refDate = new Date(2026, 11, 28);

      // Birthday on 3 Jan (6 days later in 2027)
      const statusJan = getPlayerBirthdayStatus("1992-01-03", refDate);
      assert.equal(statusJan.isToday, false);
      assert.equal(statusJan.isUpcoming, true);
      assert.equal(statusJan.daysUntil, 6);

      // Birthday on 30 Dec (2 days later in 2026)
      const statusDec = getPlayerBirthdayStatus("1994-12-30", refDate);
      assert.equal(statusDec.isToday, false);
      assert.equal(statusDec.isUpcoming, true);
      assert.equal(statusDec.daysUntil, 2);

      // Birthday on 20 Jan (> 14 days away)
      const statusFar = getPlayerBirthdayStatus("1995-01-20", refDate);
      assert.equal(statusFar.isToday, false);
      assert.equal(statusFar.isUpcoming, false);
    });

    it("partitions and sorts players into today and upcoming groups chronologically", () => {
      const refDate = new Date(2026, 10, 19); // 19 Nov 2026

      const samplePlayers = [
        { id: "p1", name: "Player Today", dob: "19/11/1993", disabled: false },
        { id: "p2", name: "Player in 10 Days", dob: "1991-11-29", disabled: false },
        { id: "p3", name: "Player in 2 Days", dob: "21/11/1990", disabled: false },
        { id: "p4", name: "Player Far Away", dob: "1990-05-15", disabled: false },
        { id: "p5", name: "Player Disabled", dob: "19/11/1993", disabled: true },
        { id: "p6", name: "Player No DOB", disabled: false },
      ];

      const { todayBirthdays, upcomingBirthdays } = partitionBirthdays(
        samplePlayers,
        refDate
      );

      assert.equal(todayBirthdays.length, 1);
      assert.equal(todayBirthdays[0].id, "p1");

      assert.equal(upcomingBirthdays.length, 2);
      // Closest upcoming must be first: p3 (in 2 days), then p2 (in 10 days)
      assert.equal(upcomingBirthdays[0].id, "p3");
      assert.equal(upcomingBirthdays[0].birthdayStatus.daysUntil, 2);
      assert.equal(upcomingBirthdays[1].id, "p2");
      assert.equal(upcomingBirthdays[1].birthdayStatus.daysUntil, 10);
    });
  });

  // ── 2. Player-Match Eligibility & Visibility Tests ─────────────────────────
  describe("2. Player-Match Eligibility & Visibility (lib/match-eligibility.ts)", () => {
    const activePlayer = {
      id: "player-alpha",
      name: "Alpha Player",
      disabled: false,
      inviteStatus: "Accepted",
    };

    const disabledPlayer = {
      id: "player-disabled",
      name: "Disabled Player",
      disabled: true,
      inviteStatus: "Accepted",
    };

    const pendingPlayer = {
      id: "player-pending",
      name: "Pending Player",
      disabled: false,
      inviteStatus: "Pending",
    };

    const standardMatch = {
      id: "match-open-1",
      opponent: "Delhi Warriors",
      date: "2026-11-25",
      isArchived: false,
      isTentative: false,
    };

    it("grants eligibility for active player on open fixture without squad restrictions", () => {
      const eligible = isPlayerEligibleForMatch(activePlayer, standardMatch, [], false);
      assert.equal(eligible, true);
    });

    it("grants eligibility when player is in squadPlayerIds list", () => {
      const squadMatch = {
        ...standardMatch,
        id: "match-squad-1",
        squadPlayerIds: ["player-alpha", "player-beta"],
      };
      const eligible = isPlayerEligibleForMatch(activePlayer, squadMatch, [], false);
      assert.equal(eligible, true);
    });

    it("DENIES eligibility when player is excluded from squadPlayerIds list", () => {
      const squadMatch = {
        ...standardMatch,
        id: "match-squad-exclusive",
        squadPlayerIds: ["player-other-1", "player-other-2"],
      };
      const eligible = isPlayerEligibleForMatch(activePlayer, squadMatch, [], false);
      assert.equal(eligible, false);
    });

    it("grants eligibility if player has an existing payment record even if not in squadPlayerIds", () => {
      const squadMatch = {
        ...standardMatch,
        id: "match-squad-custom",
        squadPlayerIds: ["player-other-1"],
      };
      const payments = [
        {
          id: "pay-1",
          matchId: "match-squad-custom",
          playerId: "player-alpha",
          status: "Unpaid",
          availability: "Confirmed",
        },
      ];
      const eligible = isPlayerEligibleForMatch(activePlayer, squadMatch, payments, false);
      assert.equal(eligible, true);
    });

    it("DENIES eligibility for tentative matches for regular players", () => {
      const tentativeMatch = {
        ...standardMatch,
        id: "match-tentative-1",
        isTentative: true,
      };
      const eligible = isPlayerEligibleForMatch(activePlayer, tentativeMatch, [], false);
      assert.equal(eligible, false);
    });

    it("DENIES eligibility for archived matches for regular players", () => {
      const archivedMatch = {
        ...standardMatch,
        id: "match-archived-1",
        isArchived: true,
      };
      const eligible = isPlayerEligibleForMatch(activePlayer, archivedMatch, [], false);
      assert.equal(eligible, false);
    });

    it("DENIES eligibility for disabled or pending/rejected players", () => {
      assert.equal(isPlayerEligibleForMatch(disabledPlayer, standardMatch, [], false), false);
      assert.equal(isPlayerEligibleForMatch(pendingPlayer, standardMatch, [], false), false);
      assert.equal(isPlayerEligibleForMatch(null, standardMatch, [], false), false);
    });

    it("grants admin legitimate access to view active and tentative matches", () => {
      const tentativeMatch = {
        ...standardMatch,
        id: "match-tentative-admin",
        isTentative: true,
      };
      const squadMatch = {
        ...standardMatch,
        id: "match-squad-exclusive",
        squadPlayerIds: ["player-other-1"],
      };

      // Admin can see standard, squad-exclusive, and tentative matches
      assert.equal(isPlayerEligibleForMatch(null, standardMatch, [], true), true);
      assert.equal(isPlayerEligibleForMatch(null, tentativeMatch, [], true), true);
      assert.equal(isPlayerEligibleForMatch(null, squadMatch, [], true), true);

      // Admin does not see archived matches
      const archivedMatch = { ...standardMatch, isArchived: true };
      assert.equal(isPlayerEligibleForMatch(null, archivedMatch, [], true), false);
    });
  });
});
