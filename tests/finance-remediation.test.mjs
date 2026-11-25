import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildMatchFinancialStatement,
  classifyMatchPayment,
  collectedMoney,
  summarizeMatchFinance,
} from "../lib/match-finance.ts";
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
  assert.match(waRoute, /body\?\.action !== "due_reminder"/);

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
