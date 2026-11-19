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
  aggregatePlayerMatchPayment,
  resolvePlayerFeeOverride,
  derivePlayerAvailability,
  groupPlayerMatches,
} from "../lib/personal-match-payment.ts";
import {
  isPlayerEligibleForMatch,
  validateMatchNavigation,
  isSquadAssignedToMatch,
  isPlayerInAssignedSquad,
} from "../lib/match-eligibility.ts";

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
      assert.equal(unpaidRes.label, "WAIVED");
      assert.equal(unpaidRes.amountDue, 0);
      assert.equal(unpaidRes.netPayable, 0);
      assert.equal(unpaidRes.amountPaid, 0);
      assert.equal(unpaidRes.isWaived, true);

      // Paid player on abandoned match -> Obligation status WAIVED, historical amount paid preserved
      const paidRes = getPersonalMatchPaymentStatus(dummyPlayer, abandonedMatch, [
        {
          id: "pay-ab-paid",
          matchId: "match-abandoned",
          playerId: "player-alpha",
          status: "Paid",
          feeCollectedAmount: 600,
        },
      ]);
      assert.equal(paidRes.status, "WAIVED");
      assert.equal(paidRes.label, "WAIVED");
      assert.equal(paidRes.amountDue, 0);
      assert.equal(paidRes.netPayable, 0);
      assert.equal(paidRes.amountPaid, 600);
      assert.equal(paidRes.isWaived, true);
    });

    // Required Matrix Scenarios from Independent Review
    it("Two legitimate partial collections totalling fee aggregates to PAID", () => {
      const payments = [
        {
          id: "pay-part-1",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Unpaid",
          feeCollectedAmount: 300,
        },
        {
          id: "pay-part-2",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Unpaid",
          feeCollectedAmount: 350,
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, standardMatch, payments);
      assert.equal(res.effectiveFee, 650);
      assert.equal(res.totalCollected, 650);
      assert.equal(res.totalOffset, 0);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "PAID");
    });

    it("Multiple legitimate collections below fee aggregates to PARTIALLY PAID", () => {
      const payments = [
        {
          id: "pay-part-a",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Unpaid",
          feeCollectedAmount: 150,
        },
        {
          id: "pay-part-b",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Unpaid",
          feeCollectedAmount: 200,
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, standardMatch, payments);
      assert.equal(res.effectiveFee, 650);
      assert.equal(res.totalCollected, 350);
      assert.equal(res.totalOffset, 0);
      assert.equal(res.netPayable, 300);
      assert.equal(res.status, "PARTIALLY PAID");
    });

    it("Duplicate transaction records (shared razorpayPaymentId or docId) are counted only once", () => {
      const payments = [
        {
          id: "pay-rzp-1",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Paid",
          razorpayPaymentId: "pay_dup_order_123",
          feeCollectedAmount: 650,
        },
        {
          id: "pay-rzp-2",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Paid",
          razorpayPaymentId: "pay_dup_order_123",
          feeCollectedAmount: 650,
        },
        {
          id: "pay-rzp-1",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Paid",
          feeCollectedAmount: 650,
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, standardMatch, payments);
      assert.equal(res.effectiveFee, 650);
      assert.equal(res.totalCollected, 650);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "PAID");
    });

    it("Legacy Paid record without feeCollectedAmount preserves established Paid semantics", () => {
      const payments = [
        {
          id: "pay-legacy-single",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Paid",
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, standardMatch, payments);
      assert.equal(res.effectiveFee, 650);
      assert.equal(res.totalCollected, 650);
      assert.equal(res.totalOffset, 0);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "PAID");
    });

    it("Collections plus offset correctly derives outstanding balance and settles obligation", () => {
      const payments = [
        {
          id: "pay-mix",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Unpaid",
          feeCollectedAmount: 350,
          feeOffsetAmount: 300,
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, standardMatch, payments);
      assert.equal(res.effectiveFee, 650);
      assert.equal(res.totalCollected, 350);
      assert.equal(res.totalOffset, 300);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "PAID");
    });

    it("Malformed, negative, or NaN amounts are safely handled without corrupting balance", () => {
      const payments = [
        {
          id: "pay-bad-1",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Unpaid",
          feeCollectedAmount: -500,
        },
        {
          id: "pay-bad-2",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Unpaid",
          feeCollectedAmount: NaN,
        },
        {
          id: "pay-bad-3",
          matchId: "match-1",
          playerId: "player-alpha",
          status: "Unpaid",
          feeCollectedAmount: "invalid",
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, standardMatch, payments);
      assert.equal(res.effectiveFee, 650);
      assert.equal(res.totalCollected, 0);
      assert.equal(res.totalOffset, 0);
      assert.equal(res.netPayable, 650);
      assert.equal(res.status, "UNPAID");
    });

    it("Different player's and different match's payment records are strictly excluded", () => {
      const payments = [
        {
          id: "pay-other-pl",
          matchId: "match-1",
          playerId: "player-beta",
          status: "Paid",
          feeCollectedAmount: 650,
        },
        {
          id: "pay-other-m",
          matchId: "match-other-xyz",
          playerId: "player-alpha",
          status: "Paid",
          feeCollectedAmount: 650,
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, standardMatch, payments);
      assert.equal(res.effectiveFee, 650);
      assert.equal(res.totalCollected, 0);
      assert.equal(res.totalOffset, 0);
      assert.equal(res.netPayable, 650);
      assert.equal(res.status, "UNPAID");
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

  describe("4. Clarified Abandoned-Match Payment Presentation (Option A Policy)", () => {
    const abandonedMatch = {
      id: "match-ab-1",
      opponent: "Monsoon Warriors",
      date: "2026-11-10",
      time: "07:00",
      fee: 600,
      result: "Abandoned",
    };

    it("Abandoned match with no collection displays WAIVED, amountPaid: 0, netPayable: 0", () => {
      const payments = [
        { id: "p-ab-0", matchId: "match-ab-1", playerId: "player-alpha", status: "Unpaid", feeCollectedAmount: 0 },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, abandonedMatch, payments);
      assert.equal(res.effectiveFee, 600);
      assert.equal(res.totalCollected, 0);
      assert.equal(res.totalOffset, 0);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "WAIVED");
      assert.equal(res.isWaived, true);
    });

    it("Abandoned match with partial historical collection displays WAIVED, preserves amountPaid: 300, netPayable: 0", () => {
      const payments = [
        { id: "p-ab-part", matchId: "match-ab-1", playerId: "player-alpha", status: "Unpaid", feeCollectedAmount: 300 },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, abandonedMatch, payments);
      assert.equal(res.effectiveFee, 600);
      assert.equal(res.totalCollected, 300);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "WAIVED");
      assert.equal(res.isWaived, true);
    });

    it("Abandoned match with full historical collection displays WAIVED, preserves amountPaid: 600, netPayable: 0", () => {
      const payments = [
        { id: "p-ab-full", matchId: "match-ab-1", playerId: "player-alpha", status: "Paid", feeCollectedAmount: 600 },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, abandonedMatch, payments);
      assert.equal(res.effectiveFee, 600);
      assert.equal(res.totalCollected, 600);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "WAIVED");
      assert.equal(res.isWaived, true);
    });

    it("Abandoned match with offsets displays WAIVED with netPayable: 0", () => {
      const payments = [
        { id: "p-ab-off", matchId: "match-ab-1", playerId: "player-alpha", status: "Unpaid", feeCollectedAmount: 100, feeOffsetAmount: 200 },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, abandonedMatch, payments);
      assert.equal(res.effectiveFee, 600);
      assert.equal(res.totalCollected, 100);
      assert.equal(res.totalOffset, 200);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "WAIVED");
      assert.equal(res.isWaived, true);
    });

    it("Non-abandoned match behavior remains completely unchanged (unpaid / partial / paid)", () => {
      const regularMatch = { id: "match-reg", opponent: "Strikers", fee: 600, result: "Pending", date: "2026-11-28" };
      const partialPmt = [{ id: "p-reg-1", matchId: "match-reg", playerId: "player-alpha", status: "Unpaid", feeCollectedAmount: 300 }];
      const res = aggregatePlayerMatchPayment(dummyPlayer, regularMatch, partialPmt);
      assert.equal(res.effectiveFee, 600);
      assert.equal(res.totalCollected, 300);
      assert.equal(res.netPayable, 300);
      assert.equal(res.status, "PARTIALLY PAID");
      assert.equal(res.isWaived, false);
    });
  });

  describe("5. Match-Detail Entry Point & Deep Link Pre-flight Eligibility", () => {
    const openFixture = { id: "match-open", opponent: "Open FC", date: "2026-11-28", time: "07:00", fee: 500 };
    const squadAssignedMatch = { id: "match-squad", opponent: "Elite Club", date: "2026-11-29", time: "07:00", fee: 500 };
    const tentativeMatch = { id: "match-tentative", opponent: "Blocked XI", date: "2026-11-30", time: "07:00", isTentative: true };
    const archivedMatch = { id: "match-archived", opponent: "Old Club", date: "2026-10-01", time: "07:00", isArchived: true };

    const squadPayments = [
      { id: "p-beta", matchId: "match-squad", playerId: "player-beta", availability: "Confirmed", status: "Unpaid" },
    ];

    it("Eligible player can open a match from the list or valid deep link", () => {
      const res = validateMatchNavigation("match-open", [openFixture], dummyPlayer, [], false);
      assert.equal(res.allowed, true);
    });

    it("Eligible assigned squad member can open the assigned match", () => {
      const assignedPayments = [
        ...squadPayments,
        { id: "p-alpha", matchId: "match-squad", playerId: "player-alpha", availability: "Confirmed", status: "Unpaid" },
      ];
      const res = validateMatchNavigation("match-squad", [squadAssignedMatch], dummyPlayer, assignedPayments, false);
      assert.equal(res.allowed, true);
    });

    it("Ineligible player cannot open assigned-squad match through defaultMatchId or deep link", () => {
      // player-alpha has no payment doc in match-squad where squad is assigned to player-beta
      const res = validateMatchNavigation("match-squad", [squadAssignedMatch], dummyPlayer, squadPayments, false);
      assert.equal(res.allowed, false);
      assert.equal(res.error, "INELIGIBLE");
    });

    it("Ineligible player cannot open tentative fixture through defaultAction", () => {
      const res = validateMatchNavigation("match-tentative", [tentativeMatch], dummyPlayer, [], false);
      assert.equal(res.allowed, false);
      assert.equal(res.error, "INELIGIBLE");
    });

    it("Non-existent match deep link fails with MATCH_NOT_FOUND", () => {
      const res = validateMatchNavigation("missing-match-id", [openFixture], dummyPlayer, [], false);
      assert.equal(res.allowed, false);
      assert.equal(res.error, "MATCH_NOT_FOUND");
    });

    it("Eligibility revocation blocks navigation and detail access", () => {
      const disabledPlayer = { ...dummyPlayer, disabled: true };
      const res = validateMatchNavigation("match-open", [openFixture], disabledPlayer, [], false);
      assert.equal(res.allowed, false);
      assert.equal(res.error, "INELIGIBLE");
    });

    it("Player identity change does not retain access from previous identity", () => {
      const unlinkedUser = null;
      const res = validateMatchNavigation("match-open", [openFixture], unlinkedUser, [], false);
      assert.equal(res.allowed, false);
      assert.equal(res.error, "INELIGIBLE");
    });

    it("Loading or unavailable match data fails closed without exposing details", () => {
      const res = validateMatchNavigation("match-open", [], dummyPlayer, [], false);
      assert.equal(res.allowed, false);
      assert.equal(res.error, "MATCH_NOT_FOUND");
    });

    it("Authorized Admin retains legitimate access to restricted and tentative matches", () => {
      const resSquad = validateMatchNavigation("match-squad", [squadAssignedMatch], dummyPlayer, squadPayments, true);
      assert.equal(resSquad.allowed, true);

      const resTentative = validateMatchNavigation("match-tentative", [tentativeMatch], dummyPlayer, [], true);
      assert.equal(resTentative.allowed, true);
    });

    it("Archived matches are blocked for all users including admin", () => {
      const res = validateMatchNavigation("match-archived", [archivedMatch], dummyPlayer, [], true);
      assert.equal(res.allowed, false);
      assert.equal(res.error, "INELIGIBLE");
    });
  });

  describe("6. Assigned-Squad Eligibility Bypass Regression Tests", () => {
    const openFixture = {
      id: "reg-match-open",
      opponent: "Open Tigers",
      date: "2026-11-28",
      time: "08:00",
      fee: 600,
    };

    const squadAssignedMatch = {
      id: "reg-match-squad",
      opponent: "Elite Warriors",
      date: "2026-11-29",
      time: "09:00",
      fee: 700,
    };

    // Squad is assigned to teammatePlayer (player-beta)
    const confirmedSquadPayments = [
      {
        id: "squad-doc-beta",
        matchId: "reg-match-squad",
        playerId: "player-beta",
        status: "Unpaid",
        availability: "Confirmed",
      },
    ];

    it("1. Open fixture with no assigned squad: active verified player is eligible", () => {
      assert.equal(isSquadAssignedToMatch("reg-match-open", []), false);
      assert.equal(isPlayerEligibleForMatch(dummyPlayer, openFixture, [], false), true);
    });

    it("2. Open fixture: player can submit RSVP", () => {
      // In an open fixture, active player can view fixture and submit RSVP
      assert.equal(isPlayerEligibleForMatch(dummyPlayer, openFixture, [], false), true);
      const navRes = validateMatchNavigation("reg-match-open", [openFixture], dummyPlayer, [], false);
      assert.equal(navRes.allowed, true);
    });

    it("3. Player responds Yes before squad assignment, then is excluded: denied", () => {
      // dummyPlayer responded 'Yes' initially (status: 'Not Playing' until assigned)
      const historicalRsvpPayments = [
        ...confirmedSquadPayments,
        {
          id: "rsvp-alpha",
          matchId: "reg-match-squad",
          playerId: "player-alpha",
          status: "Not Playing",
          availability: "Yes",
        },
      ];
      assert.equal(isSquadAssignedToMatch("reg-match-squad", historicalRsvpPayments), true);
      assert.equal(isPlayerInAssignedSquad("player-alpha", "reg-match-squad", historicalRsvpPayments), false);
      assert.equal(isPlayerEligibleForMatch(dummyPlayer, squadAssignedMatch, historicalRsvpPayments, false), false);
    });

    it("4. Player responds No before squad assignment, then is excluded: denied", () => {
      const historicalRsvpPayments = [
        ...confirmedSquadPayments,
        {
          id: "rsvp-alpha-no",
          matchId: "reg-match-squad",
          playerId: "player-alpha",
          status: "Not Playing",
          availability: "No",
        },
      ];
      assert.equal(isPlayerInAssignedSquad("player-alpha", "reg-match-squad", historicalRsvpPayments), false);
      assert.equal(isPlayerEligibleForMatch(dummyPlayer, squadAssignedMatch, historicalRsvpPayments, false), false);
    });

    it("5. Player responds Tentative before squad assignment, then is excluded: denied", () => {
      const historicalRsvpPayments = [
        ...confirmedSquadPayments,
        {
          id: "rsvp-alpha-tentative",
          matchId: "reg-match-squad",
          playerId: "player-alpha",
          status: "Not Playing",
          availability: "Tentative",
        },
      ];
      assert.equal(isPlayerInAssignedSquad("player-alpha", "reg-match-squad", historicalRsvpPayments), false);
      assert.equal(isPlayerEligibleForMatch(dummyPlayer, squadAssignedMatch, historicalRsvpPayments, false), false);
    });

    it("6. Player is explicitly assigned to squad: allowed", () => {
      const assignedPayments = [
        ...confirmedSquadPayments,
        {
          id: "squad-alpha",
          matchId: "reg-match-squad",
          playerId: "player-alpha",
          status: "Unpaid",
          availability: "Confirmed",
        },
      ];
      assert.equal(isPlayerInAssignedSquad("player-alpha", "reg-match-squad", assignedPayments), true);
      assert.equal(isPlayerEligibleForMatch(dummyPlayer, squadAssignedMatch, assignedPayments, false), true);
    });

    it("7. Player is removed from squad (status: 'Not Playing'): denied", () => {
      const removedPayments = [
        ...confirmedSquadPayments,
        {
          id: "squad-alpha-removed",
          matchId: "reg-match-squad",
          playerId: "player-alpha",
          status: "Not Playing",
        },
      ];
      assert.equal(isPlayerInAssignedSquad("player-alpha", "reg-match-squad", removedPayments), false);
      assert.equal(isPlayerEligibleForMatch(dummyPlayer, squadAssignedMatch, removedPayments, false), false);
    });

    it("8. Admin retains access to assigned fixtures", () => {
      // Even when not in the assigned squad, admin retains access
      assert.equal(isPlayerEligibleForMatch(dummyPlayer, squadAssignedMatch, confirmedSquadPayments, true), true);
    });

    it("9. Disabled, rejected, pending, merged players remain ineligible", () => {
      const disabledPlayer = { ...dummyPlayer, disabled: true };
      const pendingPlayer = { ...dummyPlayer, inviteStatus: "Pending" };
      const rejectedPlayer = { ...dummyPlayer, inviteStatus: "Rejected" };
      const mergedPlayer = { ...dummyPlayer, mergedInto: "player-master" };

      assert.equal(isPlayerEligibleForMatch(disabledPlayer, openFixture, [], false), false);
      assert.equal(isPlayerEligibleForMatch(pendingPlayer, openFixture, [], false), false);
      assert.equal(isPlayerEligibleForMatch(rejectedPlayer, openFixture, [], false), false);
      assert.equal(isPlayerEligibleForMatch(mergedPlayer, openFixture, [], false), false);
    });

    it("10. Deep link and direct match selection use corrected validator", () => {
      const excludedRsvpPayments = [
        ...confirmedSquadPayments,
        {
          id: "rsvp-alpha-excluded",
          matchId: "reg-match-squad",
          playerId: "player-alpha",
          status: "Not Playing",
          availability: "Yes",
        },
      ];
      const navRes = validateMatchNavigation("reg-match-squad", [squadAssignedMatch], dummyPlayer, excludedRsvpPayments, false);
      assert.equal(navRes.allowed, false);
      assert.equal(navRes.error, "INELIGIBLE");
    });
  });

  describe("7. Payment Transaction Deduplication Tests", () => {
    const match600 = {
      id: "match-dedup",
      opponent: "Deduplication XI",
      date: "2026-11-26",
      fee: 600,
    };

    it("1. Two docs with same Razorpay payment ID count once", () => {
      const payments = [
        {
          id: "doc-rzp-1",
          matchId: "match-dedup",
          playerId: "player-alpha",
          status: "Paid",
          paymentMethod: "razorpay",
          razorpayPaymentId: "pay_dup_001",
          feeCollectedAmount: 600,
        },
        {
          id: "doc-rzp-2",
          matchId: "match-dedup",
          playerId: "player-alpha",
          status: "Paid",
          paymentMethod: "razorpay",
          razorpayPaymentId: "pay_dup_001",
          feeCollectedAmount: 600,
        },
      ];
      const result = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(result.totalCollected, 600);
      assert.equal(result.totalOffset, 0);
      assert.equal(result.totalRecognized, 600);
      assert.equal(result.netPayable, 0);
      assert.equal(result.status, "PAID");
    });

    it("2. Two different Razorpay payment IDs count independently", () => {
      const payments = [
        {
          id: "doc-rzp-a",
          matchId: "match-dedup",
          playerId: "player-alpha",
          status: "Paid",
          paymentMethod: "razorpay",
          razorpayPaymentId: "pay_diff_1",
          feeCollectedAmount: 300,
        },
        {
          id: "doc-rzp-b",
          matchId: "match-dedup",
          playerId: "player-alpha",
          status: "Paid",
          paymentMethod: "razorpay",
          razorpayPaymentId: "pay_diff_2",
          feeCollectedAmount: 300,
        },
      ];
      const result = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(result.totalCollected, 600);
      assert.equal(result.totalOffset, 0);
      assert.equal(result.totalRecognized, 600);
      assert.equal(result.netPayable, 0);
      assert.equal(result.status, "PAID");
    });

    it("3. Duplicate doc ID counts once", () => {
      const payments = [
        {
          id: "doc-single-id",
          matchId: "match-dedup",
          playerId: "player-alpha",
          status: "Paid",
          feeCollectedAmount: 400,
        },
        {
          id: "doc-single-id",
          matchId: "match-dedup",
          playerId: "player-alpha",
          status: "Paid",
          feeCollectedAmount: 400,
        },
      ];
      const result = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(result.totalCollected, 400);
      assert.equal(result.totalOffset, 0);
      assert.equal(result.totalRecognized, 400);
      assert.equal(result.netPayable, 200);
      assert.equal(result.status, "PARTIALLY PAID");
    });

    it("4. Two legitimate manual collections count independently", () => {
      const payments = [
        {
          id: "doc-man-1",
          matchId: "match-dedup",
          playerId: "player-alpha",
          status: "Paid",
          manualMethod: "cash",
          feeCollectedAmount: 250,
        },
        {
          id: "doc-man-2",
          matchId: "match-dedup",
          playerId: "player-alpha",
          status: "Paid",
          manualMethod: "upi",
          feeCollectedAmount: 250,
        },
      ];
      const result = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(result.totalCollected, 500);
      assert.equal(result.totalOffset, 0);
      assert.equal(result.totalRecognized, 500);
      assert.equal(result.netPayable, 100);
      assert.equal(result.status, "PARTIALLY PAID");
    });

    it("5. Same transaction through legacy and current fields is not counted twice", () => {
      const payments = [
        {
          id: "doc-camel",
          matchId: "match-dedup",
          playerId: "player-alpha",
          status: "Paid",
          razorpayPaymentId: "pay_shared_legacy_1",
          feeCollectedAmount: 600,
        },
        {
          id: "doc-snake",
          matchId: "match-dedup",
          playerId: "player-alpha",
          status: "Paid",
          razorpay_payment_id: "pay_shared_legacy_1",
          feeCollectedAmount: 600,
        },
      ];
      const result = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(result.totalCollected, 600);
      assert.equal(result.totalOffset, 0);
      assert.equal(result.totalRecognized, 600);
      assert.equal(result.netPayable, 0);
      assert.equal(result.status, "PAID");
    });

    it("6. Records for another player or match are excluded", () => {
      const payments = [
        {
          id: "doc-me",
          matchId: "match-dedup",
          playerId: "player-alpha",
          status: "Paid",
          feeCollectedAmount: 300,
        },
        {
          id: "doc-other-player",
          matchId: "match-dedup",
          playerId: "player-beta",
          status: "Paid",
          feeCollectedAmount: 300,
        },
        {
          id: "doc-other-match",
          matchId: "match-other-xyz",
          playerId: "player-alpha",
          status: "Paid",
          feeCollectedAmount: 300,
        },
      ];
      const result = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(result.totalCollected, 300);
      assert.equal(result.totalOffset, 0);
      assert.equal(result.totalRecognized, 300);
      assert.equal(result.netPayable, 300);
      assert.equal(result.status, "PARTIALLY PAID");
    });
  });

  describe("8. Sponsored-Payment Accounting Tests", () => {
    const match600 = {
      id: "match-sponsor-act",
      opponent: "Sponsorship XI",
      date: "2026-11-27",
      fee: 600,
    };

    it("1. Legacy Paid manual payment without explicit amount", () => {
      const payments = [
        {
          id: "doc-leg-cash",
          matchId: "match-sponsor-act",
          playerId: "player-alpha",
          status: "Paid",
          manualMethod: "cash",
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(res.totalCollected, 600);
      assert.equal(res.totalOffset, 0);
      assert.equal(res.totalRecognized, 600);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "PAID");
      assert.equal(res.isWaived, false);
    });

    it("2. Legacy club-sponsored Paid record without explicit amount", () => {
      const payments = [
        {
          id: "doc-leg-spons",
          matchId: "match-sponsor-act",
          playerId: "player-alpha",
          status: "Paid",
          manualMethod: "club_sponsored",
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(res.totalCollected, 0, "No cash collected from player");
      assert.equal(res.totalOffset, 600, "Offset equals effectiveFee");
      assert.equal(res.totalRecognized, 600);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "PAID");
      assert.equal(res.isWaived, false);
    });

    it("3. Club-sponsored record with explicit offset", () => {
      const payments = [
        {
          id: "doc-spons-offset",
          matchId: "match-sponsor-act",
          playerId: "player-alpha",
          status: "Paid",
          manualMethod: "club_sponsored",
          feeOffsetAmount: 600,
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(res.totalCollected, 0);
      assert.equal(res.totalOffset, 600);
      assert.equal(res.totalRecognized, 600);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "PAID");
      assert.equal(res.isWaived, false);
    });

    it("4. Club-sponsored record with explicit collection amount", () => {
      const payments = [
        {
          id: "doc-spons-both",
          matchId: "match-sponsor-act",
          playerId: "player-alpha",
          status: "Paid",
          manualMethod: "club_sponsored",
          feeCollectedAmount: 200,
          feeOffsetAmount: 400,
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(res.totalCollected, 200);
      assert.equal(res.totalOffset, 400);
      assert.equal(res.totalRecognized, 600);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "PAID");
      assert.equal(res.isWaived, false);
    });

    it("5. Cash collection plus sponsorship offset", () => {
      const payments = [
        {
          id: "doc-cash-300",
          matchId: "match-sponsor-act",
          playerId: "player-alpha",
          status: "Paid",
          manualMethod: "cash",
          feeCollectedAmount: 300,
        },
        {
          id: "doc-spons-300",
          matchId: "match-sponsor-act",
          playerId: "player-alpha",
          status: "Paid",
          manualMethod: "club_sponsored",
          feeOffsetAmount: 300,
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(res.totalCollected, 300);
      assert.equal(res.totalOffset, 300);
      assert.equal(res.totalRecognized, 600);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "PAID");
      assert.equal(res.isWaived, false);
    });

    it("6. Partial cash collection plus offset", () => {
      const payments = [
        {
          id: "doc-cash-200",
          matchId: "match-sponsor-act",
          playerId: "player-alpha",
          status: "Paid",
          manualMethod: "cash",
          feeCollectedAmount: 200,
        },
        {
          id: "doc-spons-150",
          matchId: "match-sponsor-act",
          playerId: "player-alpha",
          status: "Paid",
          manualMethod: "club_sponsored",
          feeOffsetAmount: 150,
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(res.totalCollected, 200);
      assert.equal(res.totalOffset, 150);
      assert.equal(res.totalRecognized, 350);
      assert.equal(res.netPayable, 250);
      assert.equal(res.status, "PARTIALLY PAID");
      assert.equal(res.isWaived, false);
    });

    it("7. Full settlement through sponsorship", () => {
      const payments = [
        {
          id: "doc-full-spons",
          matchId: "match-sponsor-act",
          playerId: "player-alpha",
          status: "Paid",
          manualMethod: "club_sponsored",
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(res.totalCollected, 0);
      assert.equal(res.totalOffset, 600);
      assert.equal(res.totalRecognized, 600);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "PAID");
      assert.equal(res.isWaived, false);
    });

    it("8. Non-sponsored manual payment", () => {
      const payments = [
        {
          id: "doc-upi-full",
          matchId: "match-sponsor-act",
          playerId: "player-alpha",
          status: "Paid",
          manualMethod: "upi",
          feeCollectedAmount: 600,
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(res.totalCollected, 600);
      assert.equal(res.totalOffset, 0);
      assert.equal(res.totalRecognized, 600);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "PAID");
      assert.equal(res.isWaived, false);
    });

    it("9. Razorpay collection", () => {
      const payments = [
        {
          id: "doc-rzp-full",
          matchId: "match-sponsor-act",
          playerId: "player-alpha",
          status: "Paid",
          paymentMethod: "razorpay",
          razorpayPaymentId: "pay_rzp_999",
          feeCollectedAmount: 600,
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, match600, payments);
      assert.equal(res.totalCollected, 600);
      assert.equal(res.totalOffset, 0);
      assert.equal(res.totalRecognized, 600);
      assert.equal(res.netPayable, 0);
      assert.equal(res.status, "PAID");
      assert.equal(res.isWaived, false);
    });

    it("10. Abandoned match with historical sponsored or cash transactions", () => {
      const abandonedMatch = {
        ...match600,
        id: "match-abn-hist",
        result: "Abandoned",
      };
      const payments = [
        {
          id: "doc-cash-abn",
          matchId: "match-abn-hist",
          playerId: "player-alpha",
          status: "Paid",
          manualMethod: "cash",
          feeCollectedAmount: 200,
        },
        {
          id: "doc-spons-abn",
          matchId: "match-abn-hist",
          playerId: "player-alpha",
          status: "Paid",
          manualMethod: "club_sponsored",
          feeOffsetAmount: 400,
        },
      ];
      const res = aggregatePlayerMatchPayment(dummyPlayer, abandonedMatch, payments);
      assert.equal(res.totalCollected, 200, "Historical cash is preserved");
      assert.equal(res.totalOffset, 400, "Historical offset is preserved");
      assert.equal(res.totalRecognized, 600);
      assert.equal(res.netPayable, 0, "No outstanding obligation on abandoned match");
      assert.equal(res.status, "WAIVED");
      assert.equal(res.isWaived, true);
    });
  });

  describe("9. Deterministic Fee Override Precedence Tests", () => {
    it("1. Single valid override", () => {
      const payments = [
        {
          id: "doc-ov-1",
          matchId: "match-1",
          playerId: "player-alpha",
          feeOverride: 450,
          updatedAt: 1000,
        },
      ];
      assert.equal(resolvePlayerFeeOverride(payments), 450);
    });

    it("2. Multiple records with same override", () => {
      const payments = [
        {
          id: "doc-ov-a",
          matchId: "match-1",
          playerId: "player-alpha",
          feeOverride: 500,
          updatedAt: 1000,
        },
        {
          id: "doc-ov-b",
          matchId: "match-1",
          playerId: "player-alpha",
          feeOverride: 500,
          updatedAt: 2000,
        },
      ];
      assert.equal(resolvePlayerFeeOverride(payments), 500);
    });

    it("3. Conflicting overrides in different input orders resolve to the same value", () => {
      const docRecent = {
        id: "doc-recent",
        matchId: "match-1",
        playerId: "player-alpha",
        feeOverride: 350,
        updatedAt: 2000,
      };
      const docOlder = {
        id: "doc-older",
        matchId: "match-1",
        playerId: "player-alpha",
        feeOverride: 550,
        updatedAt: 1000,
      };

      // Regardless of array order [recent, older] vs [older, recent], latest timestamp (2000) wins
      const order1 = [docRecent, docOlder];
      const order2 = [docOlder, docRecent];

      assert.equal(resolvePlayerFeeOverride(order1), 350);
      assert.equal(resolvePlayerFeeOverride(order2), 350);

      // If timestamps are identical, doc ID descending tie-breaker ensures determinism
      const docTieZ = { id: "doc-z", matchId: "match-1", playerId: "player-alpha", feeOverride: 300, updatedAt: 5000 };
      const docTieA = { id: "doc-a", matchId: "match-1", playerId: "player-alpha", feeOverride: 400, updatedAt: 5000 };

      assert.equal(resolvePlayerFeeOverride([docTieZ, docTieA]), 300);
      assert.equal(resolvePlayerFeeOverride([docTieA, docTieZ]), 300);
    });

    it("4. Invalid, negative, null, malformed overrides ignored", () => {
      const payments = [
        { id: "inv-1", matchId: "match-1", playerId: "player-alpha", feeOverride: -100 },
        { id: "inv-2", matchId: "match-1", playerId: "player-alpha", feeOverride: NaN },
        { id: "inv-3", matchId: "match-1", playerId: "player-alpha", feeOverride: null },
        { id: "inv-4", matchId: "match-1", playerId: "player-alpha", feeOverride: "500" },
        { id: "valid-1", matchId: "match-1", playerId: "player-alpha", feeOverride: 400, updatedAt: 100 },
      ];
      assert.equal(resolvePlayerFeeOverride(payments), 400);
    });

    it("5. No override: uses match fee", () => {
      const payments = [
        { id: "no-ov", matchId: "match-1", playerId: "player-alpha", status: "Unpaid" },
      ];
      assert.equal(resolvePlayerFeeOverride(payments), undefined);

      const standardMatch = { id: "match-1", fee: 650 };
      const res = aggregatePlayerMatchPayment(dummyPlayer, standardMatch, payments);
      assert.equal(res.effectiveFee, 650);
      assert.equal(res.feeOverride, undefined);
    });
  });
});
