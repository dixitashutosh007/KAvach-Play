/**
 * Phase 2.2 — Player Match Center Unit Tests (`tests/phase2.2-player-match-center.test.mjs`)
 *
 * Verifies:
 * 1. Match visibility and grouping (Upcoming, Recent, Previous, Unsettled older matches).
 * 2. Personal match payment status derivation (PAID, UNPAID, PARTIALLY PAID, WAIVED).
 * 3. Option A policy for abandoned matches.
 * 4. Deduplication of multiple payment records and privacy isolation.
 * 5. Availability state derivation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseMatchDateTime,
  getPersonalMatchPaymentStatus,
  derivePlayerAvailability,
  groupPlayerMatches,
} from "../lib/personal-match-payment.ts";

describe("Phase 2.2 Player Match Center: Payment Derivation & Match Grouping", () => {
  const dummyPlayer = {
    id: "player-alpha",
    name: "Virat Kohli",
    inviteStatus: "Accepted",
    disabled: false,
  };

  const teammatePlayer = {
    id: "player-beta",
    name: "Rohit Sharma",
    inviteStatus: "Accepted",
    disabled: false,
  };

  const refDate = new Date(2026, 10, 19, 12, 0, 0); // 19 Nov 2026

  describe("1. Personal Match Payment Status Derivation", () => {
    const standardMatch = {
      id: "match-1",
      opponent: "Delhi Challengers",
      date: "2026-11-25",
      time: "07:30",
      fee: 650,
      format: "T20",
    };

    it("11. Fully paid obligation displays PAID", () => {
      const payments = [
        {
          id: "pay-1",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Paid",
          feeCollectedAmount: 650,
        },
      ];
      const res = getPersonalMatchPaymentStatus(dummyPlayer, standardMatch, payments);
      assert.equal(res.status, "PAID");
      assert.equal(res.label, "PAID");
      assert.equal(res.amountDue, 0);
      assert.equal(res.amountPaid, 650);
      assert.equal(res.isWaived, false);
    });

    it("12. Unpaid obligation displays UNPAID", () => {
      const payments = [
        {
          id: "pay-2",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Unpaid",
          feeCollectedAmount: 0,
        },
      ];
      const res = getPersonalMatchPaymentStatus(dummyPlayer, standardMatch, payments);
      assert.equal(res.status, "UNPAID");
      assert.equal(res.label, "UNPAID");
      assert.equal(res.amountDue, 650);
      assert.equal(res.amountPaid, 0);
      assert.equal(res.isWaived, false);
    });

    it("13. Partially settled obligation displays PARTIALLY PAID", () => {
      const payments = [
        {
          id: "pay-3",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Unpaid",
          feeCollectedAmount: 300,
        },
      ];
      const res = getPersonalMatchPaymentStatus(dummyPlayer, standardMatch, payments);
      assert.equal(res.status, "PARTIALLY PAID");
      assert.equal(res.label, "PARTIALLY PAID");
      assert.equal(res.amountPaid, 300);
      assert.equal(res.amountDue, 350);
      assert.equal(res.isWaived, false);
    });

    it("14. Waived/non-billable obligations are not falsely shown as unpaid", () => {
      const payments = [
        {
          id: "pay-4",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Waived",
        },
      ];
      const res = getPersonalMatchPaymentStatus(dummyPlayer, standardMatch, payments);
      assert.equal(res.status, "WAIVED");
      assert.equal(res.label, "WAIVED");
      assert.equal(res.amountDue, 0);
      assert.equal(res.isWaived, true);
    });

    it("15. Fee overrides and offsets are correctly accounted for", () => {
      // Overridden fee of ₹800 with ₹500 collected
      const payments = [
        {
          id: "pay-5",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Unpaid",
          feeOverride: 800,
          feeCollectedAmount: 500,
        },
      ];
      const res = getPersonalMatchPaymentStatus(dummyPlayer, standardMatch, payments);
      assert.equal(res.status, "PARTIALLY PAID");
      assert.equal(res.totalFee, 800);
      assert.equal(res.amountPaid, 500);
      assert.equal(res.amountDue, 300);
    });

    it("15b. Offsets with monthly plan or club sponsored cover the fee", () => {
      const payments = [
        {
          id: "pay-6",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Paid",
          feeCollectedAmount: 200,
          feeOffsetAmount: 450,
        },
      ];
      const res = getPersonalMatchPaymentStatus(dummyPlayer, standardMatch, payments);
      assert.equal(res.status, "PAID");
      assert.equal(res.amountDue, 0);
    });

    it("16. Multiple payment records do not cause double counting", () => {
      // Duplicate payment records in legacy data: 1 Paid, 1 duplicate Unpaid
      const payments = [
        {
          id: "pay-dup-1",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Paid",
          feeCollectedAmount: 650,
        },
        {
          id: "pay-dup-2",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Unpaid",
          feeCollectedAmount: 0,
        },
      ];
      const res = getPersonalMatchPaymentStatus(dummyPlayer, standardMatch, payments);
      assert.equal(res.status, "PAID");
      assert.equal(res.amountDue, 0);
      assert.equal(res.amountPaid, 650);
    });

    it("17. One player's payment information is never exposed to another player", () => {
      // Teammate has paid, current player has unpaid
      const payments = [
        {
          id: "pay-teammate",
          matchId: "match-1",
          playerId: "player-beta",
          status: "Paid",
          feeCollectedAmount: 650,
        },
        {
          id: "pay-alpha",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Unpaid",
          feeCollectedAmount: 0,
        },
      ];
      const res = getPersonalMatchPaymentStatus(dummyPlayer, standardMatch, payments);
      assert.equal(res.status, "UNPAID");
      assert.equal(res.amountDue, 650);
      assert.equal(res.amountPaid, 0);
    });

    it("10. Abandoned matches follow approved Option A policy (unpaid waived, historical paid preserved)", () => {
      const abandonedMatch = {
        id: "match-abandoned",
        opponent: "Rain Strikers",
        date: "2026-11-05",
        time: "07:00",
        fee: 600,
        result: "Abandoned",
      };

      // Unpaid player on abandoned match -> Waived
      const unpaidRes = getPersonalMatchPaymentStatus(dummyPlayer, abandonedMatch, [
        {
          id: "pay-ab-unpaid",
          matchId: "match-abandoned",
          playerId: "player-alpha",
          status: "Unpaid",
          feeCollectedAmount: 0,
        },
      ]);
      assert.equal(unpaidRes.status, "WAIVED");
      assert.equal(unpaidRes.amountDue, 0);
      assert.equal(unpaidRes.isWaived, true);

      // Paid player on abandoned match -> Historical PAID preserved
      const paidRes = getPersonalMatchPaymentStatus(dummyPlayer, abandonedMatch, [
        {
          id: "pay-ab-paid",
          matchId: "match-abandoned",
          playerId: "player-alpha",
          status: "Paid",
          feeCollectedAmount: 600,
        },
      ]);
      assert.equal(paidRes.status, "PAID");
      assert.equal(paidRes.amountDue, 0);
      assert.equal(paidRes.amountPaid, 600);
    });
  });

  describe("2. Match Grouping and Visibility Rules", () => {
    const matches = [
      // 1. Upcoming match within next 2 weeks (25 Nov 2026)
      {
        id: "match-upcoming-near",
        opponent: "Delhi Challengers",
        date: "2026-11-25",
        time: "07:30",
        fee: 650,
        result: "Pending",
      },
      // 2. Upcoming match beyond 2 weeks (15 Dec 2026)
      {
        id: "match-upcoming-far",
        opponent: "Winter Warriors",
        date: "2026-12-15",
        time: "08:00",
        fee: 650,
        result: "Pending",
      },
      // 3. Upcoming match next month (20 Dec 2026)
      {
        id: "match-upcoming-farther",
        opponent: "Jaipur Royals",
        date: "2026-12-20",
        time: "08:00",
        fee: 650,
        result: "Pending",
      },
      // 4. Recent past match within 30 days (10 Nov 2026) - Result Won
      {
        id: "match-recent-1",
        opponent: "NCR Tigers",
        date: "2026-11-10",
        time: "08:00",
        fee: 600,
        result: "KAvach Won",
      },
      // 5. Older past match > 30 days ago (15 Sep 2026) - Result Won, PAID
      {
        id: "match-older-paid",
        opponent: "Noida Strikers",
        date: "2026-09-15",
        time: "07:00",
        fee: 550,
        result: "KAvach Won",
      },
      // 6. Older past match > 30 days ago (10 Sep 2026) - Result Lost, UNPAID
      {
        id: "match-older-unpaid",
        opponent: "Gurgaon Gladiators",
        date: "2026-09-10",
        time: "07:00",
        fee: 550,
        result: "KAvach Lost",
      },
      // 7. Older past match > 30 days ago (01 Sep 2026) - Result Won, PARTIALLY PAID
      {
        id: "match-older-partial",
        opponent: "Faridabad Fighters",
        date: "2026-09-01",
        time: "07:00",
        fee: 550,
        result: "KAvach Won",
      },
    ];

    const payments = [
      {
        id: "p1",
        matchId: "match-upcoming-near",
        playerId: "player-alpha",
        status: "Unpaid",
        availability: "Confirmed",
      },
      {
        id: "p2",
        matchId: "match-upcoming-far",
        playerId: "player-alpha",
        status: "Unpaid",
        availability: "Tentative",
      },
      {
        id: "p3",
        matchId: "match-recent-1",
        playerId: "player-alpha",
        status: "Paid",
      },
      {
        id: "p4",
        matchId: "match-older-paid",
        playerId: "player-alpha",
        status: "Paid",
      },
      {
        id: "p5",
        matchId: "match-older-unpaid",
        playerId: "player-alpha",
        status: "Unpaid",
        feeCollectedAmount: 0,
      },
      {
        id: "p6",
        matchId: "match-older-partial",
        playerId: "player-alpha",
        status: "Unpaid",
        feeCollectedAmount: 250,
      },
    ];

    it("1. Upcoming match within the next two weeks is visible", () => {
      const groups = groupPlayerMatches(matches, dummyPlayer, payments, false, { referenceDate: refDate });
      assert.ok(groups.upcoming.some((m) => m.id === "match-upcoming-near"));
    });

    it("2. Upcoming match beyond two weeks is also visible", () => {
      const groups = groupPlayerMatches(matches, dummyPlayer, payments, false, { referenceDate: refDate });
      assert.ok(groups.upcoming.some((m) => m.id === "match-upcoming-far"));
      assert.ok(groups.upcoming.some((m) => m.id === "match-upcoming-farther"));
      assert.equal(groups.upcoming.length, 3);
    });

    it("3. Upcoming matches are sorted chronologically (nearest first) and nextMatch is identified", () => {
      const groups = groupPlayerMatches(matches, dummyPlayer, payments, false, { referenceDate: refDate });
      assert.equal(groups.upcoming[0].id, "match-upcoming-near"); // Nov 25
      assert.equal(groups.upcoming[1].id, "match-upcoming-far");  // Dec 15
      assert.equal(groups.upcoming[2].id, "match-upcoming-farther"); // Dec 20
      assert.equal(groups.nextMatch?.id, "match-upcoming-near");
    });

    it("4. Recent past matches are visible in Recent Matches", () => {
      const groups = groupPlayerMatches(matches, dummyPlayer, payments, false, { referenceDate: refDate });
      assert.ok(groups.recent.some((m) => m.id === "match-recent-1"));
    });

    it("5. Older paid matches are accessible under Previous Matches", () => {
      const groups = groupPlayerMatches(matches, dummyPlayer, payments, false, { referenceDate: refDate });
      assert.ok(groups.previous.some((m) => m.id === "match-older-paid"));
    });

    it("6. Older unpaid matches remain visible in active/recent until settled", () => {
      const groups = groupPlayerMatches(matches, dummyPlayer, payments, false, { referenceDate: refDate });
      // Per Rule 2: Older matches with unpaid obligations remain visible and discoverable until settled
      assert.ok(groups.recent.some((m) => m.id === "match-older-unpaid"));
      assert.ok(groups.unsettledOlder.some((m) => m.id === "match-older-unpaid"));
    });

    it("7. Older partially paid matches remain visible until fully settled", () => {
      const groups = groupPlayerMatches(matches, dummyPlayer, payments, false, { referenceDate: refDate });
      // Per Rule 3: Older matches with partially paid obligations remain visible until fully settled
      assert.ok(groups.recent.some((m) => m.id === "match-older-partial"));
      assert.ok(groups.unsettledOlder.some((m) => m.id === "match-older-partial"));
    });

    it("8. A match does not disappear when its date crosses a section boundary", () => {
      // If reference date moves to 26 Nov 2026, match-upcoming-near moves from upcoming to recent
      const laterDate = new Date(2026, 10, 26, 12, 0, 0);
      const groups = groupPlayerMatches(matches, dummyPlayer, payments, false, { referenceDate: laterDate });
      assert.ok(!groups.upcoming.some((m) => m.id === "match-upcoming-near"));
      assert.ok(groups.recent.some((m) => m.id === "match-upcoming-near"));
    });

    it("9. No unintended duplicate matches across sections", () => {
      const groups = groupPlayerMatches(matches, dummyPlayer, payments, false, { referenceDate: refDate });
      const upcomingIds = new Set(groups.upcoming.map((m) => m.id));
      const previousIds = new Set(groups.previous.map((m) => m.id));
      
      // No match should be in both upcoming and previous
      for (const id of upcomingIds) {
        assert.ok(!previousIds.has(id), `Match ${id} duplicated in upcoming and previous`);
      }
      
      // Settled older match should NOT be duplicated in recent
      assert.ok(!groups.recent.some((m) => m.id === "match-older-paid"));
    });
  });

  describe("3. Availability State Derivation", () => {
    const fixture = {
      id: "match-fixture",
      date: "2026-11-28",
      time: "07:30",
      fee: 600,
    };

    it("18. Existing availability is displayed accurately", () => {
      // Confirmed
      const avConfirmed = derivePlayerAvailability(dummyPlayer, fixture, [
        { id: "p1", matchId: "match-fixture", playerId: "player-alpha", availability: "Confirmed" },
      ]);
      assert.equal(avConfirmed.status, "Playing");
      assert.equal(avConfirmed.badgeLabel, "Playing");
      assert.equal(avConfirmed.isConfirmed, true);

      // Tentative
      const avTentative = derivePlayerAvailability(dummyPlayer, fixture, [
        { id: "p2", matchId: "match-fixture", playerId: "player-alpha", availability: "Tentative" },
      ]);
      assert.equal(avTentative.status, "Maybe");
      assert.equal(avTentative.badgeLabel, "Maybe");
      assert.equal(avTentative.isMaybe, true);

      // Not Playing
      const avOut = derivePlayerAvailability(dummyPlayer, fixture, [
        { id: "p3", matchId: "match-fixture", playerId: "player-alpha", availability: "No" },
      ]);
      assert.equal(avOut.status, "Not Playing");
      assert.equal(avOut.badgeLabel, "Not Playing");
      assert.equal(avOut.isOut, true);

      // Unassigned / Pending
      const avPending = derivePlayerAvailability(dummyPlayer, fixture, []);
      assert.equal(avPending.status, "Pending");
      assert.equal(avPending.badgeLabel, "Awaiting Response");
      assert.equal(avPending.isPending, true);
    });
  });
});
