import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  partitionMatchFinancePlayers,
  summarizePlayerFinancialProfile,
} from "../lib/match-finance.ts";

const root = process.cwd();

test("partitionMatchFinancePlayers places every player in at most one category (Paid, Unpaid, Sponsored)", () => {
  const match = {
    id: "m1",
    groundId: "g1",
    format: "T20",
    jerseyColor: "Scarlet Red",
    opponent: "Titans",
    matchType: "Practice",
    fee: 500,
    date: "2026-11-28",
    time: "09:00",
    maxSquadSize: 12,
  };
  const players = [
    { id: "p_paid", name: "Paid Player", mobile: "9999900001" },
    { id: "p_unpaid", name: "Unpaid Player", mobile: "9999900002" },
    { id: "p_partial", name: "Partial Player", mobile: "9999900003" },
    { id: "p_sponsored", name: "Sponsored Player", mobile: "9999900004" },
    { id: "p_sub", name: "Sub Player", mobile: "9999900005" },
  ];
  const payments = [
    { id: "pay1", matchId: "m1", playerId: "p_paid", status: "Paid", razorpayPaymentId: "pay_rzp_1" },
    { id: "pay2", matchId: "m1", playerId: "p_unpaid", status: "Unpaid" },
    { id: "pay3", matchId: "m1", playerId: "p_partial", status: "Paid", feeCollectedAmount: 200, feeOverride: 500 },
    { id: "pay4", matchId: "m1", playerId: "p_sponsored", status: "Paid", feeOverride: 0, feeOffsetAmount: 500, planTag: "Youth" },
    { id: "pay5", matchId: "m1", playerId: "p_sub", status: "Paid", manualMethod: "part_of_plan", settledByPeriodId: "per_1", planTag: "Monthly" },
  ];

  const part = partitionMatchFinancePlayers(match, payments, players);
  assert.deepEqual(
    part.paid.map((x) => x.playerId),
    ["p_paid", "p_sub"],
  );
  assert.equal(part.paid[0].reference, "pay_rzp_1");
  assert.deepEqual(
    part.unpaid.map((x) => ({ id: x.playerId, due: x.due, status: x.dueStatus })),
    [
      { id: "p_unpaid", due: 500, status: "Unpaid" },
      { id: "p_partial", due: 300, status: "Partially Paid" },
    ],
  );
  assert.deepEqual(
    part.sponsored.map((x) => ({ id: x.playerId, amount: x.amount })),
    [{ id: "p_sponsored", amount: 500 }],
  );
});

test("summarizePlayerFinancialProfile aggregates match dues, paid, sponsored, sub-covered, and other fees", () => {
  const player = { id: "p1", name: "Arjun", mobile: "9876543210", kavachId: "KAV-2026-0001" };
  const matches = [
    { id: "m1", groundId: "g1", format: "T20", jerseyColor: "Scarlet Red", opponent: "A", matchType: "Practice", fee: 500, date: "2026-11-20", time: "09:00", maxSquadSize: 12 },
    { id: "m2", groundId: "g1", format: "T20", jerseyColor: "Scarlet Red", opponent: "B", matchType: "Practice", fee: 500, date: "2026-11-27", time: "09:00", maxSquadSize: 12 },
  ];
  const payments = [
    { id: "pay1", matchId: "m1", playerId: "p1", status: "Paid", paidAmount: 500 },
    { id: "pay2", matchId: "m2", playerId: "p1", status: "Unpaid" },
  ];
  const otherFees = [
    { id: "f1", playerId: "p1", title: "No Show Fee", amount: 200, status: "Unpaid" },
    { id: "f2", playerId: "p1", title: "Late Fee", templateId: "latefee_m1", amount: 50, status: "Paid" },
  ];

  const prof = summarizePlayerFinancialProfile(player, matches, payments, otherFees);
  assert.equal(prof.matchOutstanding, 500);
  assert.equal(prof.otherFeesOutstanding, 200);
  assert.equal(prof.totalOutstanding, 700);
  assert.equal(prof.totalPaidMatches, 500);
  assert.equal(prof.matchEntries.length, 2);
  assert.equal(prof.otherFeeEntries.length, 2);
});

test("Finance workspace has 7 consolidated sections and DuesAndRemindersTab delegates template editing to Settings", () => {
  const finSrc = fs.readFileSync(path.join(root, "components/FinanceTab.tsx"), "utf8");
  for (const tab of ["overview", "matches", "dues", "razor", "plans", "fee", "activity"]) {
    assert.match(finSrc, new RegExp(`key: "${tab}"`));
  }
  assert.match(finSrc, /finance-overview-section/);
  assert.match(finSrc, /player-financial-profile-lookup/);
  assert.match(finSrc, /finance-studio-plans-section/);

  const duesSrc = fs.readFileSync(path.join(root, "components/DuesAndRemindersTab.tsx"), "utf8");
  assert.doesNotMatch(duesSrc, /handleSaveRemindersConfig/);
  assert.match(duesSrc, /finance-email-templates-shortcut/);
});
