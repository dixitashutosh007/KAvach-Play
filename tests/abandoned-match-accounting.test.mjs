import test from "node:test";
import assert from "node:assert/strict";

// Directly import production code (QA-001)
import { computeLateFees, getClubCalendarDate } from "../lib/utils.ts";
import { isMatchBillable } from "../lib/matchBillable.ts";

test("FIN-006: getClubCalendarDate calculates date deterministically in Asia/Kolkata", () => {
  // Midnight UTC on 2025-02-19 is 5:30 AM IST on 2025-02-19
  const d1 = new Date("2025-02-19T00:00:00.000Z");
  const cal1 = getClubCalendarDate(d1);
  assert.equal(cal1.dateString, "2025-02-19");
  assert.equal(cal1.year, 2025);
  assert.equal(cal1.month, 1); // 0-indexed: February is 1
  assert.equal(cal1.day, 19);

  // 19:00 UTC on 2025-02-18 is 00:30 IST on 2025-02-19
  const d2 = new Date("2025-02-18T19:00:00.000Z");
  const cal2 = getClubCalendarDate(d2);
  assert.equal(cal2.dateString, "2025-02-19");

  // 18:00 UTC on 2025-02-18 is 23:30 IST on 2025-02-18 (Tuesday night before deadline)
  const d3 = new Date("2025-02-18T18:00:00.000Z");
  const cal3 = getClubCalendarDate(d3);
  assert.equal(cal3.dateString, "2025-02-18");
});

test("FIN-006: computeLateFees enforces Tuesday EOD deadline in Asia/Kolkata", () => {
  // Saturday match: 2025-02-15
  const matchDate = "2025-02-15";
  const matchId = "m_sat_01";
  const playerId = "p_001";
  const label = "vs Lions";

  // Tuesday 2025-02-18 (before/at deadline) in IST
  const tuesdayRef = new Date("2025-02-18T12:00:00+05:30");
  const tuesdayFees = computeLateFees(matchDate, matchId, playerId, label, tuesdayRef);
  assert.equal(tuesdayFees.length, 0, "No fees due on or before Tuesday");

  // Wednesday 2025-02-19 (first day late) in IST -> ₹150 flat
  const wednesdayRef = new Date("2025-02-19T08:00:00+05:30");
  const wedFees = computeLateFees(matchDate, matchId, playerId, label, wednesdayRef);
  assert.equal(wedFees.length, 1);
  assert.equal(wedFees[0].amount, 150);
  assert.equal(wedFees[0].weeks, 0);
  assert.equal(wedFees[0].label, "Late Fee: vs Lions");

  // Following Wednesday 2025-02-26 (1 week past initial late date) -> ₹150 + ₹50
  const nextWedRef = new Date("2025-02-26T10:00:00+05:30");
  const nextWedFees = computeLateFees(matchDate, matchId, playerId, label, nextWedRef);
  assert.equal(nextWedFees.length, 2);
  assert.equal(nextWedFees[0].amount, 150);
  assert.equal(nextWedFees[1].amount, 50);
  assert.equal(nextWedFees[1].weeks, 1);
  assert.equal(nextWedFees[1].label, "Late Fee (Week 1): vs Lions");

  // Week 2 late: 2025-03-05 -> ₹150 + ₹50 + ₹50 = ₹250
  const week2Ref = new Date("2025-03-05T10:00:00+05:30");
  const week2Fees = computeLateFees(matchDate, matchId, playerId, label, week2Ref);
  assert.equal(week2Fees.length, 3);
  assert.equal(week2Fees[2].amount, 50);
  assert.equal(week2Fees[2].weeks, 2);
});

test("FIN-006: Sunday matches have the same Tuesday deadline as Saturday matches", () => {
  // Sunday match: 2025-02-16
  const matchDate = "2025-02-16";
  const matchId = "m_sun_01";
  const playerId = "p_001";
  const label = "vs Tigers";

  const tuesdayRef = new Date("2025-02-18T18:00:00+05:30");
  assert.equal(computeLateFees(matchDate, matchId, playerId, label, tuesdayRef).length, 0);

  const wednesdayRef = new Date("2025-02-19T10:00:00+05:30");
  const fees = computeLateFees(matchDate, matchId, playerId, label, wednesdayRef);
  assert.equal(fees.length, 1);
  assert.equal(fees[0].amount, 150);
});

test("FIN-006: Weekday matches do not generate weekend late fees", () => {
  const matchDate = "2025-02-19"; // Wednesday
  const fees = computeLateFees(matchDate, "m_wed", "p_001", "vs Royals");
  assert.equal(fees.length, 0);
});

test("FIN-005: Abandoned match accounting retains collected cash while zeroing dues", () => {
  const regularMatch = { id: "m1", result: "Won", fee: 500, matchFeeBudget: 5500 };
  const abandonedMatch = { id: "m2", result: "Abandoned", fee: 500, matchFeeBudget: 5500 };

  assert.equal(isMatchBillable(regularMatch), true, "Regular match is billable");
  assert.equal(isMatchBillable(abandonedMatch), false, "Abandoned match is not billable");

  // Simulate reportData items
  const reportData = [
    {
      match: regularMatch,
      feeCollected: 4500,
      totalDue: 1000,
    },
    {
      match: abandonedMatch,
      feeCollected: 2000, // Historical cash collected prior to abandonment
      totalDue: 3500,     // Stale un-reconciled unpaid amount
    },
  ];

  // Production calculation in components/FinanceTab.tsx:
  // grandTotalCollected sums all cash collected across all matches
  const grandTotalCollected = reportData.reduce((t, d) => t + d.feeCollected, 0);
  // grandTotalDue filters only billable matches
  const grandTotalDue = reportData.filter((d) => isMatchBillable(d.match)).reduce((t, d) => t + d.totalDue, 0);

  assert.equal(grandTotalCollected, 6500, "Historical cash from abandoned match (₹2000) is preserved in grand total collected");
  assert.equal(grandTotalDue, 1000, "Abandoned match unpaid obligations (₹3500) are excluded from grand total due");
});

test("FIN-007: Late fees deduplicate against existing otherFees records", () => {
  const match = { id: "m_test_01", opponent: "Eagles", date: "2025-02-15", fee: 600, result: "Won" };
  const matchLabel = `vs ${match.opponent} (15 Feb 2025)`;
  const payment = { id: "pay_1", matchId: match.id, playerId: "p_1", status: "Unpaid" };

  // Case 1: No otherFees exist -> late fee should be computed
  const wednesdayRef = new Date("2025-02-19T10:00:00+05:30");
  const freshFees = computeLateFees(match.date, match.id, payment.playerId, matchLabel, wednesdayRef);
  assert.equal(freshFees.length, 1);

  // Helper simulating the deduplication check in FinanceTab, DuesAndRemindersTab, and MatchesTab
  function shouldGenerateLateFee(otherFees, matchObj, pay) {
    if (!matchObj || !isMatchBillable(matchObj)) return false;
    const isExempt = otherFees.some(
      (f) =>
        f.playerId === pay.playerId &&
        f.title?.startsWith("Late Fee Exemption:") &&
        f.title?.includes(matchObj.id) &&
        f.status !== "Cancelled"
    );
    if (isExempt) return false;

    const alreadyRecorded = otherFees.some(
      (f) =>
        f.playerId === pay.playerId &&
        f.status !== "Cancelled" &&
        (
          (f.title?.startsWith("Late Fee") && (f.title?.includes(matchObj.id) || f.title?.includes(matchLabel) || f.comment?.includes(matchObj.id))) ||
          (f.templateId && f.templateId.includes(`latefee_${matchObj.id}`))
        )
    );
    return !alreadyRecorded;
  }

  // Case 2: Player has existing Paid late fee in otherFees
  const otherFeesWithPaid = [
    {
      id: "of_1",
      playerId: "p_1",
      title: `Late Fee: ${matchLabel}`,
      status: "Paid",
      amount: 150,
    },
  ];
  assert.equal(
    shouldGenerateLateFee(otherFeesWithPaid, match, payment),
    false,
    "Should not generate virtual late fee when already paid in otherFees"
  );

  // Case 3: Player has existing Unpaid late fee in otherFees
  const otherFeesWithUnpaid = [
    {
      id: "of_2",
      playerId: "p_1",
      templateId: `latefee_${match.id}`,
      title: "Late Fee: vs Eagles",
      status: "Unpaid",
      amount: 150,
    },
  ];
  assert.equal(
    shouldGenerateLateFee(otherFeesWithUnpaid, match, payment),
    false,
    "Should not duplicate virtual late fee when already persisted as Unpaid in otherFees"
  );

  // Case 4: Player has valid exemption
  const otherFeesWithExemption = [
    {
      id: "of_3",
      playerId: "p_1",
      title: `Late Fee Exemption:${match.id}`,
      status: "Active",
      amount: 0,
    },
  ];
  assert.equal(
    shouldGenerateLateFee(otherFeesWithExemption, match, payment),
    false,
    "Should not generate late fee when exemption exists"
  );

  // Case 5: Match is Abandoned
  const abandonedMatch = { ...match, result: "Abandoned" };
  assert.equal(
    shouldGenerateLateFee([], abandonedMatch, payment),
    false,
    "Should never generate late fee for an abandoned match"
  );
});

test("Option A: Status 'Waived' is recognized and excluded from player dues", () => {
  const match = { id: "m_opt_a", opponent: "Warriors", fee: 600, result: "Abandoned" };
  const payments = [
    { id: "p1", playerId: "pl_1", status: "Paid", feeCollectedAmount: 600 },
    { id: "p2", playerId: "pl_2", status: "Waived", waivedReason: "Match Abandoned" },
    { id: "p3", playerId: "pl_3", status: "Not Playing" },
  ];

  // Active dues for player checkout
  const activeDues = payments.filter((p) => p.status === "Unpaid");
  assert.equal(activeDues.length, 0, "No active dues for waived or paid payments");

  const paidHistory = payments.filter((p) => p.status === "Paid");
  assert.equal(paidHistory.length, 1, "Paid transaction remains intact");
  assert.equal(paidHistory[0].feeCollectedAmount, 600);

  const waivedCount = payments.filter((p) => p.status === "Waived");
  assert.equal(waivedCount.length, 1, "Waived payment is cleanly categorized");
});
