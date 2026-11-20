import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsePlayerDob,
  getPlayerBirthdayStatus,
  partitionBirthdays,
  isLeapYear,
  getDaysInMonth,
} from "../lib/birthday-utils.ts";
import {
  isPlayerEligibleForMatch,
  isSquadAssignedToMatch,
  isPlayerInAssignedSquad,
  validateMatchNavigation,
} from "../lib/match-eligibility.ts";

describe("Phase 2.1 Corrections: Deterministic Birthday Parsing & Real-Model Match Eligibility", () => {
  // ── 1. Birthday Parsing, Leap Year & Recurring Policy Tests ─────────────────
  describe("1. Strict Birthday Parsing & Leap-Day Policy (lib/birthday-utils.ts)", () => {
    it("parses valid YYYY-MM-DD format accurately", () => {
      const res = parsePlayerDob("1995-04-12");
      assert.deepEqual(res, { day: 12, month: 4, year: 1995 });
    });

    it("parses valid DD/MM/YYYY format accurately without JS Date ambiguity", () => {
      const res = parsePlayerDob("12/04/1995");
      assert.deepEqual(res, { day: 12, month: 4, year: 1995 });
    });

    it("strictly rejects malformed inputs with embedded letters, trailing junk, or invalid separators", () => {
      assert.equal(parsePlayerDob("12abc/04/1995"), null);
      assert.equal(parsePlayerDob("1995-04-12junk"), null);
      assert.equal(parsePlayerDob("12-04-1995"), null);
      assert.equal(parsePlayerDob("1995/04/12"), null);
      assert.equal(parsePlayerDob("not-a-date"), null);
      assert.equal(parsePlayerDob("99/99/9999"), null);
    });

    it("strictly rejects unpadded numeric date inputs", () => {
      assert.equal(parsePlayerDob("1/4/1995"), null);
      assert.equal(parsePlayerDob("1995-4-12"), null);
      assert.equal(parsePlayerDob("1995-04-1"), null);
      assert.equal(parsePlayerDob("1/04/1995"), null);
    });

    it("validates leap years accurately (e.g. 29/02/2000 vs 29/02/2001)", () => {
      // 2000 is a leap year (divisible by 400)
      assert.deepEqual(parsePlayerDob("29/02/2000"), { day: 29, month: 2, year: 2000 });
      assert.deepEqual(parsePlayerDob("2000-02-29"), { day: 29, month: 2, year: 2000 });

      // 2004 is a leap year (divisible by 4)
      assert.deepEqual(parsePlayerDob("29/02/2004"), { day: 29, month: 2, year: 2004 });

      // 2001 is NOT a leap year
      assert.equal(parsePlayerDob("29/02/2001"), null);
      assert.equal(parsePlayerDob("2001-02-29"), null);

      // 1900 is NOT a leap year (century not divisible by 400)
      assert.equal(parsePlayerDob("29/02/1900"), null);
    });

    it("rejects invalid calendar dates safely (e.g. Feb 31st or Apr 31st)", () => {
      assert.equal(parsePlayerDob("1995-02-31"), null);
      assert.equal(parsePlayerDob("31/02/1995"), null);
      assert.equal(parsePlayerDob("1995-04-31"), null);
      assert.equal(parsePlayerDob("31/04/1995"), null);
    });

    it("rejects invalid month numbers (> 12 or < 1)", () => {
      assert.equal(parsePlayerDob("1995-13-10"), null);
      assert.equal(parsePlayerDob("10/13/1995"), null);
      assert.equal(parsePlayerDob("1995-00-10"), null);
      assert.equal(parsePlayerDob("00/10/1995"), null);
    });

    it("handles missing, null, undefined, and empty strings safely", () => {
      assert.equal(parsePlayerDob(null), null);
      assert.equal(parsePlayerDob(undefined), null);
      assert.equal(parsePlayerDob(""), null);
      assert.equal(parsePlayerDob("   "), null);
    });

    it("correctly handles recurring Feb 29 leap-day birthdays in non-leap years (celebrated Feb 28)", () => {
      // Reference date: 28 Feb 2026 (non-leap year)
      const refFeb28 = new Date(2026, 1, 28);
      const statusFeb28 = getPlayerBirthdayStatus("2000-02-29", refFeb28);
      assert.equal(statusFeb28.isToday, true);
      assert.equal(statusFeb28.isUpcoming, false);
      assert.equal(statusFeb28.daysUntil, 0);

      // Reference date: 20 Feb 2026 (8 days before Feb 28)
      const refFeb20 = new Date(2026, 1, 20);
      const statusFeb20 = getPlayerBirthdayStatus("2000-02-29", refFeb20);
      assert.equal(statusFeb20.isToday, false);
      assert.equal(statusFeb20.isUpcoming, true);
      assert.equal(statusFeb20.daysUntil, 8);

      // Reference date: 1 Mar 2026 (birthday already passed on Feb 28)
      const refMar1 = new Date(2026, 2, 1);
      const statusMar1 = getPlayerBirthdayStatus("2000-02-29", refMar1);
      assert.equal(statusMar1.isToday, false);
      assert.equal(statusMar1.isUpcoming, false);
    });

    it("correctly handles recurring Feb 29 leap-day birthdays in leap years (celebrated Feb 29)", () => {
      // Reference date: 29 Feb 2028 (leap year)
      const refFeb29 = new Date(2028, 1, 29);
      const statusFeb29 = getPlayerBirthdayStatus("2000-02-29", refFeb29);
      assert.equal(statusFeb29.isToday, true);
      assert.equal(statusFeb29.isUpcoming, false);
      assert.equal(statusFeb29.daysUntil, 0);

      // Reference date: 28 Feb 2028 (1 day before Feb 29 in leap year)
      const refFeb28 = new Date(2028, 1, 28);
      const statusFeb28 = getPlayerBirthdayStatus("2000-02-29", refFeb28);
      assert.equal(statusFeb28.isToday, false);
      assert.equal(statusFeb28.isUpcoming, true);
      assert.equal(statusFeb28.daysUntil, 1);
    });

    it("correctly identifies birthday TODAY for regular dates", () => {
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

  // ── 2. Real Persisted Data Model Match Eligibility Tests (10 Scenarios) ─────
  describe("2. Real-Model Match Eligibility (lib/match-eligibility.ts)", () => {
    const activePlayer = {
      id: "player-alpha",
      name: "Alpha Player",
      disabled: false,
      inviteStatus: "Accepted",
    };

    const teammatePlayer = {
      id: "player-beta",
      name: "Beta Teammate",
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

    const rejectedPlayer = {
      id: "player-rejected",
      name: "Rejected Player",
      disabled: false,
      inviteStatus: "Rejected",
    };

    const mergedPlayer = {
      id: "player-merged",
      name: "Merged Player",
      disabled: false,
      inviteStatus: "Accepted",
      mergedInto: "player-alpha",
    };

    const standardMatch = {
      id: "match-fixture-1",
      opponent: "Delhi Warriors",
      date: "2026-11-25",
      isArchived: false,
      isTentative: false,
    };

    // Scenario 1: Open fixture with NO squad assigned (payments empty)
    it("Scenario 1: grants eligibility for active verified player on open fixture with no squad assigned", () => {
      const payments = [];
      assert.equal(isSquadAssignedToMatch(standardMatch.id, payments), false);
      assert.equal(isPlayerEligibleForMatch(activePlayer, standardMatch, payments, false), true);
    });

    // Scenario 2: Active player included in an assigned squad via MatchPayment
    it("Scenario 2: grants eligibility when player is included in assigned squad via MatchPayment record", () => {
      const payments = [
        {
          id: "pay-1",
          matchId: standardMatch.id,
          playerId: activePlayer.id,
          status: "Unpaid",
          availability: "Confirmed",
        },
        {
          id: "pay-2",
          matchId: standardMatch.id,
          playerId: teammatePlayer.id,
          status: "Unpaid",
          availability: "Confirmed",
        },
      ];
      assert.equal(isSquadAssignedToMatch(standardMatch.id, payments), true);
      assert.equal(isPlayerInAssignedSquad(activePlayer.id, standardMatch.id, payments), true);
      assert.equal(isPlayerEligibleForMatch(activePlayer, standardMatch, payments, false), true);
    });

    // Scenario 3: Active player in assigned squad with waived fee status
    it("Scenario 3: grants eligibility when player is in assigned squad with waived fee status", () => {
      const payments = [
        {
          id: "pay-1",
          matchId: standardMatch.id,
          playerId: activePlayer.id,
          status: "Waived",
          availability: "Confirmed",
        },
        {
          id: "pay-2",
          matchId: standardMatch.id,
          playerId: teammatePlayer.id,
          status: "Unpaid",
          availability: "Confirmed",
        },
      ];
      assert.equal(isSquadAssignedToMatch(standardMatch.id, payments), true);
      assert.equal(isPlayerInAssignedSquad(activePlayer.id, standardMatch.id, payments), true);
      assert.equal(isPlayerEligibleForMatch(activePlayer, standardMatch, payments, false), true);
    });

    // Scenario 4: Active player excluded from assigned squad (no MatchPayment record)
    it("Scenario 4: DENIES eligibility when squad is assigned to other players and player has NO payment doc", () => {
      const payments = [
        {
          id: "pay-2",
          matchId: standardMatch.id,
          playerId: teammatePlayer.id,
          status: "Unpaid",
          availability: "Confirmed",
        },
      ];
      assert.equal(isSquadAssignedToMatch(standardMatch.id, payments), true);
      assert.equal(isPlayerInAssignedSquad(activePlayer.id, standardMatch.id, payments), false);
      assert.equal(isPlayerEligibleForMatch(activePlayer, standardMatch, payments, false), false);
    });

    // Scenario 5: Player has an existing payment record (e.g. Paid) even alongside other squad records
    it("Scenario 5: grants eligibility if player has an existing payment record (Paid/Unpaid/Waived)", () => {
      const payments = [
        {
          id: "pay-1",
          matchId: standardMatch.id,
          playerId: activePlayer.id,
          status: "Paid",
          availability: "Confirmed",
        },
        {
          id: "pay-2",
          matchId: standardMatch.id,
          playerId: teammatePlayer.id,
          status: "Unpaid",
          availability: "Confirmed",
        },
      ];
      assert.equal(isPlayerEligibleForMatch(activePlayer, standardMatch, payments, false), true);
    });

    // Scenario 6: Player self-RSVP on open fixture does NOT lock fixture for other active players
    it("Scenario 6: self-RSVPs on open fixture do NOT lock fixture as assigned squad for other players", () => {
      const payments = [
        {
          id: "pay-rsvp-teammate",
          matchId: standardMatch.id,
          playerId: teammatePlayer.id,
          status: "Not Playing",
          availability: "Yes",
        },
      ];
      // Self-RSVP (status "Not Playing", availability "Yes") does NOT constitute an assigned squad
      assert.equal(isSquadAssignedToMatch(standardMatch.id, payments), false);
      // activePlayer has no record yet, but can still view and RSVP because it is an open fixture
      assert.equal(isPlayerEligibleForMatch(activePlayer, standardMatch, payments, false), true);
    });

    // Scenario 7: Inactive / disabled player
    it("Scenario 7: DENIES eligibility for inactive/disabled players even on open fixtures", () => {
      assert.equal(isPlayerEligibleForMatch(disabledPlayer, standardMatch, [], false), false);
    });

    // Scenario 8: Pending, rejected, or merged player
    it("Scenario 8: DENIES eligibility for pending, rejected, or merged players", () => {
      assert.equal(isPlayerEligibleForMatch(pendingPlayer, standardMatch, [], false), false);
      assert.equal(isPlayerEligibleForMatch(rejectedPlayer, standardMatch, [], false), false);
      assert.equal(isPlayerEligibleForMatch(mergedPlayer, standardMatch, [], false), false);
      assert.equal(isPlayerEligibleForMatch(null, standardMatch, [], false), false);
      assert.equal(isPlayerEligibleForMatch(undefined, standardMatch, [], false), false);
    });

    // Scenario 9: Tentative match
    it("Scenario 9: DENIES eligibility for tentative matches for regular players, grants for admin", () => {
      const tentativeMatch = {
        ...standardMatch,
        id: "match-tentative-1",
        isTentative: true,
      };
      assert.equal(isPlayerEligibleForMatch(activePlayer, tentativeMatch, [], false), false);
      assert.equal(isPlayerEligibleForMatch(null, tentativeMatch, [], true), true);
    });

    // Scenario 10: Archived match
    it("Scenario 10: DENIES eligibility for archived matches for both regular players and admin", () => {
      const archivedMatch = {
        ...standardMatch,
        id: "match-archived-1",
        isArchived: true,
      };
      assert.equal(isPlayerEligibleForMatch(activePlayer, archivedMatch, [], false), false);
      assert.equal(isPlayerEligibleForMatch(null, archivedMatch, [], true), false);
    });
  });

  // ── 3. Centralised Guarded Match Navigation Tests ─────────────────────────
  describe("3. Centralised Guarded Match Navigation (validateMatchNavigation)", () => {
    const activePlayer = {
      id: "player-alpha",
      name: "Alpha Player",
      disabled: false,
      inviteStatus: "Accepted",
    };

    const teammatePlayer = {
      id: "player-beta",
      name: "Beta Teammate",
      disabled: false,
      inviteStatus: "Accepted",
    };

    const openMatch = {
      id: "match-open-1",
      opponent: "Delhi Warriors",
      date: "2026-11-25",
      isArchived: false,
      isTentative: false,
    };

    const squadMatch = {
      id: "match-squad-restricted",
      opponent: "Jaipur Strikers",
      date: "2026-12-08",
      isArchived: false,
      isTentative: false,
    };

    const tentativeMatch = {
      id: "match-tentative-slot",
      opponent: "Tentative Challengers",
      date: "2026-12-10",
      isArchived: false,
      isTentative: true,
    };

    const matchesList = [openMatch, squadMatch, tentativeMatch];

    // Payments assigning squadMatch strictly to teammatePlayer (excludes activePlayer)
    const squadPayments = [
      {
        id: "pay-teammate",
        matchId: squadMatch.id,
        playerId: teammatePlayer.id,
        status: "Unpaid",
        availability: "Confirmed",
      },
    ];

    it("grants navigation for eligible player on open fixture", () => {
      const result = validateMatchNavigation(
        openMatch.id,
        matchesList,
        activePlayer,
        squadPayments,
        false
      );
      assert.deepEqual(result, { allowed: true });
    });

    it("grants navigation for eligible player included in assigned squad", () => {
      const playerSquadPayments = [
        ...squadPayments,
        {
          id: "pay-alpha",
          matchId: squadMatch.id,
          playerId: activePlayer.id,
          status: "Unpaid",
          availability: "Confirmed",
        },
      ];
      const result = validateMatchNavigation(
        squadMatch.id,
        matchesList,
        activePlayer,
        playerSquadPayments,
        false
      );
      assert.deepEqual(result, { allowed: true });
    });

    it("blocks navigation when player is excluded from assigned squad", () => {
      const result = validateMatchNavigation(
        squadMatch.id,
        matchesList,
        activePlayer,
        squadPayments,
        false
      );
      assert.deepEqual(result, {
        allowed: false,
        error: "INELIGIBLE",
        message: "You are not eligible to access this match.",
      });
    });

    it("blocks navigation when player eligibility is revoked (e.g. player disabled or merged)", () => {
      const disabledPlayer = { ...activePlayer, disabled: true };
      const resultDisabled = validateMatchNavigation(
        openMatch.id,
        matchesList,
        disabledPlayer,
        [],
        false
      );
      assert.deepEqual(resultDisabled, {
        allowed: false,
        error: "INELIGIBLE",
        message: "You are not eligible to access this match.",
      });

      const mergedPlayer = { ...activePlayer, mergedInto: "player-other" };
      const resultMerged = validateMatchNavigation(
        openMatch.id,
        matchesList,
        mergedPlayer,
        [],
        false
      );
      assert.deepEqual(resultMerged, {
        allowed: false,
        error: "INELIGIBLE",
        message: "You are not eligible to access this match.",
      });
    });

    it("blocks navigation when target match does not exist in matches collection (missing match)", () => {
      const resultMissing = validateMatchNavigation(
        "non-existent-match-999",
        matchesList,
        activePlayer,
        squadPayments,
        false
      );
      assert.deepEqual(resultMissing, {
        allowed: false,
        error: "MATCH_NOT_FOUND",
        message: "Match not found or no longer available.",
      });
    });

    it("blocks navigation for regular player on tentative match", () => {
      const result = validateMatchNavigation(
        tentativeMatch.id,
        matchesList,
        activePlayer,
        [],
        false
      );
      assert.deepEqual(result, {
        allowed: false,
        error: "INELIGIBLE",
        message: "You are not eligible to access this match.",
      });
    });

    it("grants navigation for administrator to restricted squad and tentative matches", () => {
      const resRestricted = validateMatchNavigation(
        squadMatch.id,
        matchesList,
        null,
        squadPayments,
        true
      );
      assert.deepEqual(resRestricted, { allowed: true });

      const resTentative = validateMatchNavigation(
        tentativeMatch.id,
        matchesList,
        null,
        [],
        true
      );
      assert.deepEqual(resTentative, { allowed: true });
    });

    it("allows generic matches tab navigation when matchId is empty string", () => {
      const result = validateMatchNavigation("", matchesList, activePlayer, [], false);
      assert.deepEqual(result, { allowed: true });
    });
  });
});
