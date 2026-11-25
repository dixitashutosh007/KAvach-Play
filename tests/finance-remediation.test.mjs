import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildMatchFinancialStatement,
  classifyMatchPayment,
  collectedMoney,
  paymentShare,
  summarizeClubFinanceOverview,
  summarizeMatchFinance,
} from "../lib/match-finance.ts";
import { buildSponsorshipReport } from "../lib/subscription-periods.ts";
import { isMatchBillable } from "../lib/matchBillable.ts";
import { buildTransactionsLedger } from "../lib/transactions-ledger.ts";
import { calculatePlayerDues } from "../lib/player-dues.ts";
import { authorizeEmailRequest } from "../lib/email-auth.ts";

const root = process.cwd();

const players = [
  { id: "p-razor", name: "Razor Player" },
  { id: "p-cash", name: "Cash Player" },
  { id: "p-sub", name: "Sub Player" },
  { id: "p-club", name: "Club Sponsored Player" },
  { id: "p-sponsor-a", name: "Sponsor A" },
  { id: "p-beneficiary-b", name: "Beneficiary B" },
  { id: "p-partial", name: "Partial Player" },
  { id: "p-waived", name: "Waived Player" },
  { id: "p-not-playing", name: "Not Playing Player" },
  { id: "p-cancelled", name: "Cancelled Player" },
  { id: "p-refunded", name: "Refunded Player" },
  { id: "p-unpaid", name: "Unpaid Player" },
];

const match = {
  id: "m-1",
  date: "2026-11-21",
  opponent: "Titans",
  fee: 500,
  groundFeePaidAmount: 4000,
  result: "KAvach Won",
};

const payments = [
  { id: "pay-razor", matchId: "m-1", playerId: "p-razor", status: "Paid", paymentMethod: "razorpay", razorpayPaymentId: "pay_123" },
  { id: "pay-cash", matchId: "m-1", playerId: "p-cash", status: "Paid", paymentMethod: "manual", manualMethod: "cash_collected" },
  { id: "pay-sub", matchId: "m-1", playerId: "p-sub", status: "Paid", paymentMethod: "manual", manualMethod: "part_of_plan", planTag: "Monthly" },
  { id: "pay-club", matchId: "m-1", playerId: "p-club", status: "Paid", paymentMethod: "manual", manualMethod: "club_sponsored" },
  // Player A pays 1000 covering A (500) + B (500)
  { id: "pay-a", matchId: "m-1", playerId: "p-sponsor-a", status: "Paid", paymentMethod: "razorpay", razorpayPaymentId: "pay_a", feeOverride: 1000, feeCollectedAmount: 1000 },
  { id: "pay-b", matchId: "m-1", playerId: "p-beneficiary-b", status: "Paid", paymentMethod: "manual", sponsoredBy: "p-sponsor-a" },
  // Partial payment: 200 paid of 500 -> 300 outstanding
  { id: "pay-partial", matchId: "m-1", playerId: "p-partial", status: "Unpaid", feeCollectedAmount: 200 },
  // Excluded statuses
  { id: "pay-waived", matchId: "m-1", playerId: "p-waived", status: "Waived" },
  { id: "pay-np", matchId: "m-1", playerId: "p-not-playing", status: "Not Playing" },
  { id: "pay-cancel", matchId: "m-1", playerId: "p-cancelled", status: "Cancelled" },
  { id: "pay-refund", matchId: "m-1", playerId: "p-refunded", status: "Refunded", feeCollectedAmount: 500 },
  // Standard unpaid
  { id: "pay-unpaid", matchId: "m-1", playerId: "p-unpaid", status: "Unpaid" },
];

test("F1: canonical financial classification separates cash, subscription, sponsorship, and outstanding", () => {
  const stmt = buildMatchFinancialStatement(match, payments);
  const summary = summarizeMatchFinance(match, payments, players);

  // Actual Cash Received: 500 (razor) + 500 (cash) + 1000 (A) + 200 (partial) = 2200
  assert.equal(stmt.actualCashReceived, 2200);
  assert.equal(summary.feeCollected, 2200);

  // Subscription Covered (non-cash): 500
  assert.equal(stmt.subscriptionCovered, 500);
  assert.equal(summary.subscriptionCovered, 500);

  // Club Sponsored: 500; Player Sponsored (B): 500
  assert.equal(stmt.clubSponsored, 500);
  assert.equal(stmt.playerSponsored, 500);

  // Outstanding: 300 (partial) + 500 (unpaid) = 800
  assert.equal(stmt.outstanding, 800);
  assert.equal(summary.totalDue, 800);

  // Expected Player Contribution: 500 + 500 + 500 + 1000 + 500 + 500 = 3500
  assert.equal(stmt.expectedPlayerContribution, 3500);
  assert.equal(summary.matchFeeTotal, 3500);

  // Settlement %: (2200 + 500) / 3500 = 77.14%
  assert.equal(stmt.settlementPct, 77.14);
  // Cash Collection %: 2200 / 3500 = 62.86%
  assert.equal(stmt.cashCollectionPct, 62.86);

  // Reconciles: cash + sub + outstanding === expectedPlayerContribution
  assert.equal(stmt.actualCashReceived + stmt.subscriptionCovered + stmt.outstanding, stmt.expectedPlayerContribution);

  // Beneficiary B has 0 outstanding and 0 cash received
  const clsB = classifyMatchPayment(payments.find((p) => p.id === "pay-b"), 500);
  assert.equal(clsB.outstanding, 0);
  assert.equal(clsB.cashReceived, 0);
  assert.equal(clsB.playerSponsored, 500);

  // Refunded payment returns 0 cash
  assert.equal(collectedMoney(payments.find((p) => p.id === "pay-refund"), 500), 0);
});

test("F1: zero expected contribution returns null percentages (never NaN or Infinity)", () => {
  const emptyStmt = buildMatchFinancialStatement(
    { id: "m-empty", fee: 500, result: "Pending" },
    [{ id: "w1", matchId: "m-empty", playerId: "p-waived", status: "Waived" }],
  );
  assert.equal(emptyStmt.expectedPlayerContribution, 0);
  assert.equal(emptyStmt.settlementPct, null);
  assert.equal(emptyStmt.cashCollectionPct, null);
});

test("F2: transactions ledger classifies subscriptions & sponsorships as non-cash and excludes cancelled/refunded", () => {
  const ledger = buildTransactionsLedger({
    payments,
    otherFees: [
      { id: "of-paid", playerId: "p-cash", title: "Fine", amount: 150, status: "Paid" },
      { id: "of-cancel", playerId: "p-cash", title: "Cancelled Fine", amount: 999, status: "Cancelled" },
    ],
    subscriptionHistory: [
      { id: "sh-1", playerId: "p-sub", planId: "pl-1", planName: "Monthly", paidAmount: 2000, adminId: "a1", adminName: "Admin", durationMonths: 1, startDate: "2026-11-01", endDate: "2026-11-30" },
    ],
    merchOrders: [],
    matches: [match],
    players,
  });

  // Match cash (2200) + paid otherFee (150) + studio subscription cash (2000) = 4350
  assert.equal(ledger.actualCashTotal, 4350);
  // Subscription covered is tracked separately and NOT in actualCashTotal
  assert.equal(ledger.subscriptionCoveredTotal, 500);
  assert.equal(ledger.clubSponsoredTotal, 500);
  assert.equal(ledger.playerSponsoredTotal, 500);
  // Cancelled otherFee is excluded
  assert.equal(ledger.transactions.some((t) => t.id === "other_fee_of-cancel"), false);
  // Refunded match payment is excluded from cash
  assert.equal(ledger.transactions.some((t) => t.id === "match_pay_pay-refund"), false);
});

test("F4: calculatePlayerDues and summarizeMatchFinance unpaid lists agree on eligible unpaid dues", () => {
  const summary = summarizeMatchFinance(match, payments, players);
  assert.equal(summary.unpaidCount, 2);
  assert.deepEqual(summary.unpaidPlayers, ["Partial Player", "Unpaid Player"]);

  // Player-level dues match match-level outstanding (300 + 500 = 800)
  let playerLevelSum = 0;
  for (const pl of players) {
    const d = calculatePlayerDues([pl], payments, [match], []);
    playerLevelSum += d.totalDue;
  }
  assert.equal(playerLevelSum, summary.totalDue);
  assert.equal(playerLevelSum, 800);

  // Beneficiary, waived, club-sponsored, and subscription-covered players have 0 dues
  for (const id of ["p-beneficiary-b", "p-waived", "p-club", "p-sub", "p-not-playing", "p-cancelled"]) {
    const pl = players.find((x) => x.id === id);
    const d = calculatePlayerDues([pl], payments, [match], []);
    assert.equal(d.hasDues, false, `${id} should have no dues`);
    assert.equal(d.totalDue, 0);
  }
});

test("F3: reminder authorization enforces action=due_reminder and server-side dues resolution", () => {
  const finOnly = { superAdmin: false, clubAdmin: false, financeAdmin: true };
  assert.equal(authorizeEmailRequest(finOnly, { action: "due_reminder", playerId: "p-1" }).ok, true);
  assert.equal(authorizeEmailRequest(finOnly, { playerId: "p-1", to: ["x@y.com"], subject: "Hi", text: "Test" }).ok, false);

  const emailRoute = fs.readFileSync(path.join(root, "app/api/email/send/route.ts"), "utf8");
  assert.match(emailRoute, /resolveAuthorizedDueReminder/);
  assert.match(emailRoute, /channel:\s*"email"/);

  const waRoute = fs.readFileSync(path.join(root, "app/api/whatsapp/send/route.ts"), "utf8");
  assert.match(waRoute, /resolveAuthorizedDueReminder/);
  assert.match(waRoute, /channel:\s*"whatsapp"/);
  assert.match(waRoute, /isDueReminder = body\?\.action === "due_reminder"/);

  const duesTab = fs.readFileSync(path.join(root, "components/DuesAndRemindersTab.tsx"), "utf8");
  // Individual & bulk reminders both supply action: "due_reminder" and playerId
  const dueReminderMatches = duesTab.match(/action:\s*"due_reminder"/g) || [];
  assert.equal(dueReminderMatches.length, 4);
  const playerIdMatches = duesTab.match(/playerId:\s*(?:data|item)\.player\.id/g) || [];
  assert.equal(playerIdMatches.length, 4);
});

test("F5: Finance navigation consolidation, Settings shortcut, and D-22 role isolation", () => {
  const financeTab = fs.readFileSync(path.join(root, "components/FinanceTab.tsx"), "utf8");
  assert.match(financeTab, /data-testid="club-finance-overview"/);
  assert.match(financeTab, /data-testid="overview-to-player-dues"/);
  assert.match(financeTab, /persona === "admin" && isFinanceAdmin !== false/);

  const duesTab = fs.readFileSync(path.join(root, "components/DuesAndRemindersTab.tsx"), "utf8");
  // Duplicate email_template subtab removed from Finance
  assert.doesNotMatch(duesTab, /key:\s*"email_template"/);
  // Settings shortcut is gated on isSuperAdmin
  assert.match(duesTab, /isSuperAdmin && onNavigateToSettings/);

  const pageSrc = fs.readFileSync(path.join(root, "app/page.tsx"), "utf8");
  assert.match(pageSrc, /onNavigateToSettings=\{isSuperAdmin \? \(\) => setActiveTab\("settings"\) : undefined\}/);
  assert.match(pageSrc, /activeTab === "settings" && \(\s*isSuperAdmin \?/);
});

test("FND-01: Club overview includes unpaid-only and sub-only matches, excludes waived-only matches", () => {
  const mUnpaidOnly = { id: "m-unpaid", date: "2026-11-22", opponent: "A", fee: 500, result: "Pending" };
  const mWaivedOnly = { id: "m-waived", date: "2026-11-23", opponent: "B", fee: 500, result: "Pending" };
  const mMixed = { id: "m-mixed", date: "2026-11-24", opponent: "C", fee: 500, result: "Pending" };
  const mSubOnly = { id: "m-sub", date: "2026-11-25", opponent: "D", fee: 500, result: "Pending" };
  const mEmpty = { id: "m-empty", date: "2026-11-26", opponent: "E", fee: 500, result: "Pending" };

  const allMatches = [mUnpaidOnly, mWaivedOnly, mMixed, mSubOnly, mEmpty];
  const pList = [
    { id: "p1", name: "P1" },
    { id: "p2", name: "P2" },
  ];
  const payList = [
    { id: "x1", matchId: "m-unpaid", playerId: "p1", status: "Unpaid" },
    { id: "x2", matchId: "m-unpaid", playerId: "p2", status: "Unpaid" },
    { id: "x3", matchId: "m-waived", playerId: "p1", status: "Waived" },
    { id: "x4", matchId: "m-mixed", playerId: "p1", status: "Paid" },
    { id: "x5", matchId: "m-mixed", playerId: "p2", status: "Unpaid" },
    { id: "x6", matchId: "m-sub", playerId: "p1", status: "Paid", manualMethod: "part_of_plan" },
  ];

  const reportData = allMatches.map((m) => summarizeMatchFinance(m, payList.filter((p) => p.matchId === m.id), pList));
  const overview = summarizeClubFinanceOverview(reportData, isMatchBillable);

  // mUnpaidOnly (1000 expected), mMixed (1000 expected), mSubOnly (500 expected) included; mWaivedOnly & mEmpty excluded
  assert.deepEqual(
    overview.includedMatches.map((d) => d.match.id),
    ["m-unpaid", "m-mixed", "m-sub"],
  );
  assert.equal(overview.totalExpected, 2500);
  assert.equal(overview.actualCashReceived, 500);
  assert.equal(overview.subscriptionCovered, 500);
  assert.equal(overview.outstanding, 1500);
  assert.equal(overview.actualCashReceived + overview.subscriptionCovered + overview.outstanding, overview.totalExpected);
});

test("FND-02: Assigned Fees Ledger uses authorized due_reminder endpoints without wa.me bypass", () => {
  const financeTab = fs.readFileSync(path.join(root, "components/FinanceTab.tsx"), "utf8");
  assert.doesNotMatch(financeTab, /wa\.me/);
  assert.match(financeTab, /\/api\/whatsapp\/send/);
  assert.match(financeTab, /fee\.status === "Unpaid" && p\?\.mobile/);
  assert.match(financeTab, /fee\.status === "Unpaid" && p\?\.email/);

  const duesTab = fs.readFileSync(path.join(root, "components/DuesAndRemindersTab.tsx"), "utf8");
  assert.match(duesTab, /\{isSuperAdmin && \(\s*<button[\s\S]*?WA \(Manual\)/);
});

test("FND-04 & FND-05: Paid partial receipts retain unpaid balance and feeOffsetAmount reconciles cleanly", () => {
  // FND-04: Paid record with explicit feeCollectedAmount < expected and no feeOffsetAmount retains remaining balance
  const partialPaid = classifyMatchPayment(
    { id: "pp1", matchId: "m1", playerId: "p1", status: "Paid", feeCollectedAmount: 200 },
    500,
  );
  assert.equal(partialPaid.expectedContribution, 500);
  assert.equal(partialPaid.cashReceived, 200);
  assert.equal(partialPaid.outstanding, 300);
  assert.equal(partialPaid.isSettled, false);

  // FND-05: Partial club sponsorship via feeOffsetAmount (no feeOverride)
  const partialClubOffset = classifyMatchPayment(
    { id: "co1", matchId: "m1", playerId: "p1", status: "Paid", feeOffsetAmount: 200, feeCollectedAmount: 300 },
    500,
  );
  assert.equal(partialClubOffset.clubSponsored, 200);
  assert.equal(partialClubOffset.expectedContribution, 300);
  assert.equal(partialClubOffset.cashReceived, 300);
  assert.equal(partialClubOffset.outstanding, 0);
  assert.equal(partialClubOffset.isSettled, true);

  // FND-05: Full club sponsorship
  const fullClub = classifyMatchPayment(
    { id: "co2", matchId: "m1", playerId: "p2", status: "Paid", manualMethod: "club_sponsored" },
    500,
  );
  assert.equal(fullClub.clubSponsored, 500);
  assert.equal(fullClub.expectedContribution, 0);
  assert.equal(fullClub.cashReceived, 0);
  assert.equal(fullClub.outstanding, 0);
});

test("FND-05-R1: paymentShare, collectedMoney, buildMatchFinancialStatement, and buildSponsorshipReport agree on ₹500 fee with ₹200 offset and no feeOverride", () => {
  const m = { id: "m-unify", date: "2026-11-24", opponent: "Unify", fee: 500, result: "KAvach Won" };
  const p = { id: "pay-unify", matchId: "m-unify", playerId: "p1", status: "Paid", feeOffsetAmount: 200 };

  // Even without explicit feeCollectedAmount, Paid with 200 club offset must report 300 cash & 200 sponsorship
  assert.equal(collectedMoney(p, 500), 300);
  const share = paymentShare(p, 500);
  assert.equal(share?.contribution, 300);
  assert.equal(share?.sponsorship, 200);
  assert.equal(share?.collectedAmount, 300);

  const stmt = buildMatchFinancialStatement(m, [p]);
  assert.equal(stmt.expectedPlayerContribution, 300);
  assert.equal(stmt.clubSponsored, 200);
  assert.equal(stmt.actualCashReceived, 300);
  assert.equal(stmt.systemFee, 500);

  const report = buildSponsorshipReport({
    from: "2026-11-01",
    to: "2026-11-30",
    matches: [m],
    payments: [{ ...p, playerName: "P1" }],
    periods: [],
  });
  assert.equal(report.totals.playerShare, 300);
  assert.equal(report.totals.clubSponsored, 200);
  assert.equal(report.totals.matchFees, 500);
});

test("FND-01-R1: Abandoned matches preserve historical cash without inflating billable Expected or Outstanding", () => {
  const mAbandNoCash = { id: "m-ab-0", date: "2026-11-20", opponent: "X", fee: 500, result: "Abandoned" };
  const mAbandWithCash = { id: "m-ab-cash", date: "2026-11-21", opponent: "Y", fee: 500, result: "Abandoned" };
  const mBillableUnpaid = { id: "m-bill-unpaid", date: "2026-11-22", opponent: "Z", fee: 500, result: "Pending" };
  const mWaived = { id: "m-waived-only", date: "2026-11-23", opponent: "W", fee: 500, result: "Pending" };

  const allMatches = [mAbandNoCash, mAbandWithCash, mBillableUnpaid, mWaived];
  const pList = [{ id: "p1", name: "P1" }];
  const payList = [
    { id: "a1", matchId: "m-ab-0", playerId: "p1", status: "Waived" },
    { id: "a2", matchId: "m-ab-cash", playerId: "p1", status: "Paid", paymentMethod: "razorpay", razorpayPaymentId: "r1" },
    { id: "a3", matchId: "m-bill-unpaid", playerId: "p1", status: "Unpaid" },
    { id: "a4", matchId: "m-waived-only", playerId: "p1", status: "Waived" },
  ];

  const reportData = allMatches.map((m) => summarizeMatchFinance(m, payList.filter((p) => p.matchId === m.id), pList));
  const overview = summarizeClubFinanceOverview(reportData, isMatchBillable);

  // Abandoned with no cash & waived-only match are excluded; abandoned with historical cash + billable unpaid are included
  assert.deepEqual(
    overview.includedMatches.map((d) => d.match.id),
    ["m-ab-cash", "m-bill-unpaid"],
  );
  assert.equal(overview.totalExpected, 500);
  assert.equal(overview.actualCashReceived, 500);
  assert.equal(overview.billableCashReceived, 0);
  assert.equal(overview.historicalAbandonedCash, 500);
  assert.equal(overview.outstanding, 500);
  assert.equal(overview.cashCollectionPct, 0);
});
