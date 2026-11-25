/**
 * Per-match collection summary (`lib/match-finance.ts`). Pure.
 *
 * Canonical financial classification layer used by FinanceTab, MatchPaymentPanel,
 * MatchFinanceTab, MatchFinancials, and `/api/finance/match-ledger`.
 *
 * Canonical classifications:
 *  - Actual Cash Received: Razorpay or verified manual cash/bank/UPI receipts.
 *    Excludes subscription allocations, club sponsorship, player sponsorship,
 *    waived, cancelled, and reversed/refunded entries.
 *  - Subscription Covered: non-cash match settlement via subscription allocation.
 *  - Club Sponsored: non-cash amount absorbed by the club.
 *  - Player Sponsored: non-cash settlement carried by another player's payment.
 *  - Outstanding: only valid, unsettled player contributions.
 */
import type { Match, MatchPayment, Player } from "@/lib/types";

/** The Finance report's inclusion rule: not "Not Playing" and a known player. */
export function financeReportPayments(match: Pick<Match, "id">, payments: MatchPayment[], players: Player[]): MatchPayment[] {
  return payments.filter(
    (p) => p.matchId === match.id && p.status !== "Not Playing" && players.some((pl) => pl.id === p.playerId),
  );
}

export type CanonicalPaymentCategory =
  | "cash"
  | "razorpay"
  | "subscription_covered"
  | "club_sponsored"
  | "player_sponsored"
  | "outstanding"
  | "excluded";

export interface CanonicalPaymentClassification {
  category: CanonicalPaymentCategory;
  expectedContribution: number;
  cashReceived: number;
  subscriptionCovered: number;
  clubSponsored: number;
  playerSponsored: number;
  outstanding: number;
  isSettled: boolean;
}

const EXCLUDED_STATUSES = new Set(["Not Playing", "Waived", "Cancelled", "Failed", "Refunded", "Reversed"]);

export function classifyMatchPayment(
  p: MatchPayment,
  matchFee: number,
): CanonicalPaymentClassification {
  const status = String(p.status || "");
  if (EXCLUDED_STATUSES.has(status)) {
    return {
      category: "excluded",
      expectedContribution: 0,
      cashReceived: 0,
      subscriptionCovered: 0,
      clubSponsored: 0,
      playerSponsored: 0,
      outstanding: 0,
      isSettled: false,
    };
  }

  const fee = Math.max(0, Math.round(Number(matchFee) || 0));
  const snap = (p as MatchPayment & { financeSnapshot?: { pendingAllocation?: boolean; source?: string; planType?: string } }).financeSnapshot;

  // Player-sponsored beneficiary: fee is carried by the sponsoring player's payment.
  if (p.sponsoredBy) {
    const sponsoredAmt = p.feeOverride !== undefined ? Math.max(0, Math.round(Number(p.feeOverride) || 0)) : fee;
    return {
      category: "player_sponsored",
      expectedContribution: 0,
      cashReceived: 0,
      subscriptionCovered: 0,
      clubSponsored: 0,
      playerSponsored: sponsoredAmt,
      outstanding: 0,
      isSettled: true,
    };
  }

  // Club-sponsored: non-cash coverage absorbed by the club.
  if (p.manualMethod === "club_sponsored") {
    const clubAmt =
      p.feeOffsetAmount !== undefined
        ? Math.max(0, Math.round(Number(p.feeOffsetAmount) || 0))
        : p.feeOverride !== undefined && p.feeOverride > 0
          ? Math.max(0, Math.round(Number(p.feeOverride) || 0))
          : fee;
    return {
      category: "club_sponsored",
      expectedContribution: 0,
      cashReceived: 0,
      subscriptionCovered: 0,
      clubSponsored: clubAmt,
      playerSponsored: 0,
      outstanding: 0,
      isSettled: true,
    };
  }

  // Subscription allocation: non-cash settlement at match level.
  if (p.manualMethod === "part_of_plan") {
    const expected = p.feeOverride !== undefined ? Math.max(0, Math.round(Number(p.feeOverride) || 0)) : fee;
    if (snap?.pendingAllocation) {
      return {
        category: "outstanding",
        expectedContribution: expected,
        cashReceived: 0,
        subscriptionCovered: 0,
        clubSponsored: 0,
        playerSponsored: 0,
        outstanding: expected,
        isSettled: false,
      };
    }
    const clubOffset = Math.max(0, Math.round(Number(p.feeOffsetAmount) || 0));
    const subAmt =
      p.feeCollectedAmount !== undefined
        ? Math.max(0, Math.round(Number(p.feeCollectedAmount) || 0))
        : Math.max(0, fee - clubOffset);
    const settled = status === "Paid";
    return {
      category: settled ? "subscription_covered" : "outstanding",
      expectedContribution: subAmt,
      cashReceived: 0,
      subscriptionCovered: settled ? subAmt : 0,
      clubSponsored: clubOffset,
      playerSponsored: 0,
      outstanding: settled ? 0 : subAmt,
      isSettled: settled,
    };
  }

  // Standard cash / Razorpay / partial / unpaid obligation.
  // FND-05: feeOffsetAmount is club-funded sponsorship; when feeOverride is absent,
  // the player's billable contribution is (fee - clubOffset).
  const hasExplicitOffset = p.feeOffsetAmount !== undefined && Number(p.feeOffsetAmount) > 0;
  const clubOffset =
    p.feeOffsetAmount !== undefined
      ? Math.max(0, Math.round(Number(p.feeOffsetAmount) || 0))
      : p.feeOverride !== undefined && Number(p.feeOverride) < fee
        ? Math.max(0, fee - Math.max(0, Math.round(Number(p.feeOverride) || 0)))
        : 0;
  const expected =
    p.feeOverride !== undefined
      ? Math.max(0, Math.round(Number(p.feeOverride) || 0))
      : hasExplicitOffset
        ? Math.max(0, fee - clubOffset)
        : fee;

  let cashReceived = 0;
  if (status === "Paid") {
    cashReceived =
      p.feeCollectedAmount !== undefined
        ? Math.max(0, Math.round(Number(p.feeCollectedAmount) || 0))
        : expected;
  } else if (status === "Unpaid" && p.feeCollectedAmount !== undefined && p.feeCollectedAmount > 0) {
    // Partial payment: only remaining valid balance is outstanding.
    cashReceived = Math.min(expected, Math.max(0, Math.round(Number(p.feeCollectedAmount) || 0)));
  }

  // FND-04: A Paid record with explicit feeCollectedAmount < expected must NOT
  // silently clear the remaining unpaid balance.
  const outstanding = Math.max(0, expected - cashReceived);
  const isRazorpay =
    p.paymentMethod === "razorpay" &&
    (Boolean(p.razorpayPaymentId) || (!p.manualMethod && !p.manualBy));

  return {
    category: outstanding > 0 ? "outstanding" : isRazorpay ? "razorpay" : "cash",
    expectedContribution: expected,
    cashReceived,
    subscriptionCovered: 0,
    clubSponsored: clubOffset,
    playerSponsored: 0,
    outstanding,
    isSettled: outstanding === 0,
  };
}

export function summarizeMatchFinance(match: Match, paymentsForMatch: MatchPayment[], players: Player[]) {
  const statement = buildMatchFinancialStatement(match, paymentsForMatch);
  const playingCount = paymentsForMatch.length;

  let paidCount = 0;
  let unpaidCount = 0;
  let razorpayPaidCount = 0;
  let manualPaidCount = 0;
  let razorpayCollected = 0;
  let manualCollected = 0;
  let feeCollectedCount = 0;
  let feeOffsetCount = 0;

  const sponsoredDetails: { playerName: string; amount: number; reason: string }[] = [];
  const paidPlayers: string[] = [];
  const unpaidPlayers: string[] = [];
  const paidPlayerDetails: { name: string; amount: number; method: string }[] = [];
  const unpaidPlayerDetails: { name: string; due: number; planTag?: string }[] = [];

  for (const p of paymentsForMatch) {
    const cls = classifyMatchPayment(p, match.fee || 0);
    if (cls.category === "excluded") continue;

    const player = players.find((x) => x.id === p.playerId);
    const playerName = p.guestName ? `${p.guestName} (Guest)` : (player?.name || "Player");

    if (cls.isSettled) {
      paidCount++;
      paidPlayers.push(playerName);
      if (cls.cashReceived > 0) {
        feeCollectedCount++;
        if (cls.category === "razorpay") {
          razorpayPaidCount++;
          razorpayCollected += cls.cashReceived;
        } else {
          manualPaidCount++;
          manualCollected += cls.cashReceived;
        }
      }
      const methodLabel =
        cls.category === "razorpay"
          ? "Razorpay"
          : cls.category === "club_sponsored"
            ? "Club Sponsored"
            : cls.category === "player_sponsored"
              ? "Player Sponsored"
              : cls.category === "subscription_covered"
                ? "Subscription Covered"
                : "Cash";
      paidPlayerDetails.push({
        name: playerName,
        amount: cls.cashReceived > 0 ? cls.cashReceived : (cls.subscriptionCovered || cls.clubSponsored || cls.playerSponsored),
        method: methodLabel,
      });
    } else if (cls.outstanding > 0) {
      unpaidCount++;
      unpaidPlayers.push(playerName);
      unpaidPlayerDetails.push({
        name: playerName,
        due: cls.outstanding,
        planTag: p.planTag,
      });
    }

    if (cls.clubSponsored > 0) {
      feeOffsetCount++;
      sponsoredDetails.push({
        playerName,
        amount: cls.clubSponsored,
        reason: p.planTag || (p.manualMethod === "club_sponsored" ? "Club Sponsored" : "Plan Offset"),
      });
    }
    if (cls.playerSponsored > 0) {
      feeOffsetCount++;
      const sponsor = p.sponsoredBy ? players.find((x) => x.id === p.sponsoredBy) : null;
      sponsoredDetails.push({
        playerName,
        amount: cls.playerSponsored,
        reason: `Sponsored by ${sponsor?.name || "Member"}`,
      });
    }
  }

  const feeCollected = statement.actualCashReceived;
  const feeOffset = statement.clubSponsored + statement.playerSponsored;
  const matchFeeTotal = statement.expectedPlayerContribution;
  const percentRecovered = statement.cashCollectionPct !== null ? Math.round(statement.cashCollectionPct) : null;

  return {
    match,
    payments: paymentsForMatch,
    playingCount,
    paidCount,
    unpaidCount,
    paidPlayers,
    unpaidPlayers,
    paidPlayerDetails,
    unpaidPlayerDetails,
    razorpayPaidCount,
    manualPaidCount,
    totalCollected: feeCollected,
    razorpayCollected,
    manualCollected,
    totalDue: statement.outstanding,
    feeCollected,
    subscriptionCovered: statement.subscriptionCovered,
    clubSponsored: statement.clubSponsored,
    playerSponsored: statement.playerSponsored,
    feeCollectedCount,
    feeOffset,
    feeOffsetCount,
    sponsoredDetails,
    matchFeeTotal,
    percentRecovered,
    settlementPct: statement.settlementPct,
    cashCollectionPct: statement.cashCollectionPct,
    actualFeePaid: statement.actualFeePaid,
    netResult: statement.netResult,
    hasResults: playingCount > 0,
  };
}

export type MatchFinanceSummary = ReturnType<typeof summarizeMatchFinance>;

// ── Match financial statement (Match Management redesign) ───────────────────
// One pure calculation used by the squad rows, the Match Financials summary,
// the Finance tab and the server (close snapshot). See
// docs/implementation/MATCH_FINANCE_LIFECYCLE.md §4.

export type ShareKind = "regular" | "plan" | "override" | "sponsored" | "subscription" | "pending" | "paid_by_other";

export interface PaymentShare {
  /** Player's match contribution (₹). */
  contribution: number;
  /** Club-sponsored part (₹). */
  sponsorship: number;
  paid: boolean;
  /** Real money collected for this payment (refund workflow applies). */
  realMoney: boolean;
  /** Amount actually collected in money (Paid rows only; 0 for non-cash settlements). */
  collectedAmount: number;
  kind: ShareKind;
}

const rupees = (n: unknown) => Math.max(0, Math.round(Number(n) || 0));

/** Collected amount recorded on a payment (real money only), or 0. */
export function collectedMoney(p: Pick<MatchPayment, "status" | "manualMethod" | "sponsoredBy" | "feeCollectedAmount" | "feeOverride" | "feeOffsetAmount">, matchFee: number): number {
  return classifyMatchPayment(p as MatchPayment, matchFee).cashReceived;
}

/** Is real money held on this payment (only these may be refunded / reversed)? */
export function isRealMoneyPayment(p: Pick<MatchPayment, "status" | "manualMethod" | "sponsoredBy" | "feeCollectedAmount" | "feeOverride" | "feeOffsetAmount" | "guestName">, matchFee: number): boolean {
  return collectedMoney(p, matchFee) > 0;
}

/** Player / club shares for one payment; null when it is not part of the match finances. */
export function paymentShare(p: MatchPayment, matchFee: number): PaymentShare | null {
  const cls = classifyMatchPayment(p, matchFee);
  if (cls.category === "excluded") return null;

  const snap = (p as MatchPayment & { financeSnapshot?: { pendingAllocation?: boolean; source?: string; planType?: string } }).financeSnapshot;
  let kind: ShareKind = "regular";
  if (cls.category === "player_sponsored") {
    kind = "paid_by_other";
  } else if (cls.category === "club_sponsored") {
    kind = "sponsored";
  } else if (p.manualMethod === "part_of_plan") {
    kind = snap?.pendingAllocation ? "pending" : "subscription";
  } else if (snap?.source === "override") {
    kind = "override";
  } else if ((snap && snap.planType && snap.planType !== "regular") || p.feeOverride !== undefined || p.planTag || cls.clubSponsored > 0) {
    kind = "plan";
  }

  return {
    contribution: cls.expectedContribution,
    sponsorship: cls.clubSponsored,
    paid: cls.isSettled,
    realMoney: cls.cashReceived > 0,
    collectedAmount: cls.cashReceived,
    kind,
  };
}

export interface MatchFinancialStatement {
  systemFee: number;
  clubSponsored: number;
  playerSponsored: number;
  expectedPlayerContribution: number;
  maxPlayerCollection: number;
  actualCashReceived: number;
  collected: number;
  /** Part of `collected` covered by subscriptions (not match-level cash). */
  subscriptionCovered: number;
  collectedViaSubscription: number;
  outstanding: number;
  /** Settlement %: (Cash settled + Subscription covered) / Expected player contribution × 100 (2 dp); null when 0. */
  settlementPct: number | null;
  /** Cash collection %: Actual cash received / Expected player contribution × 100 (2 dp); null when 0. */
  cashCollectionPct: number | null;
  /** Alias for settlementPct for backward compatibility. */
  collectionPct: number | null;
  paidCount: number;
  unpaidCount: number;
  pendingAllocationCount: number;
  /** Squad size counted (Not Playing / Waived / Cancelled excluded). */
  players: number;
  /** null = not recorded (never invented). */
  actualFeePaid: number | null;
  /** maxPlayerCollection − actualFeePaid; null when the actual fee is not recorded. */
  netResult: number | null;
  /** actualCashReceived − actualFeePaid (secondary). */
  cashPosition: number | null;
  financeClosed: boolean;
  abandoned: boolean;
}

export function buildMatchFinancialStatement(
  match: Pick<Match, "id" | "fee" | "result" | "groundFeePaidAmount" | "isGroundFeePaid"> & { financeStatus?: string },
  payments: MatchPayment[],
): MatchFinancialStatement {
  const fee = rupees(match.fee);
  const s: MatchFinancialStatement = {
    systemFee: 0,
    clubSponsored: 0,
    playerSponsored: 0,
    expectedPlayerContribution: 0,
    maxPlayerCollection: 0,
    actualCashReceived: 0,
    collected: 0,
    subscriptionCovered: 0,
    collectedViaSubscription: 0,
    outstanding: 0,
    settlementPct: null,
    cashCollectionPct: null,
    collectionPct: null,
    paidCount: 0,
    unpaidCount: 0,
    pendingAllocationCount: 0,
    players: 0,
    actualFeePaid: null,
    netResult: null,
    cashPosition: null,
    financeClosed: match.financeStatus === "closed",
    abandoned: match.result === "Abandoned",
  };
  for (const p of payments) {
    if (p.matchId !== match.id) continue;
    const cls = classifyMatchPayment(p, fee);
    if (cls.category === "excluded") continue;
    s.players += 1;
    s.clubSponsored += cls.clubSponsored;
    s.playerSponsored += cls.playerSponsored;
    s.expectedPlayerContribution += cls.expectedContribution;
    s.maxPlayerCollection += cls.expectedContribution;
    s.actualCashReceived += cls.cashReceived;
    s.subscriptionCovered += cls.subscriptionCovered;
    s.collectedViaSubscription += cls.subscriptionCovered;
    s.outstanding += cls.outstanding;
    if ((p as MatchPayment & { financeSnapshot?: { pendingAllocation?: boolean } }).financeSnapshot?.pendingAllocation) {
      s.pendingAllocationCount += 1;
    }
    if (cls.isSettled) {
      s.paidCount += 1;
    } else {
      s.unpaidCount += 1;
    }
  }
  s.collected = s.actualCashReceived + s.subscriptionCovered;
  s.systemFee = s.expectedPlayerContribution + s.clubSponsored;
  if (s.expectedPlayerContribution > 0) {
    s.settlementPct = Math.round(((s.actualCashReceived + s.subscriptionCovered) * 10000) / s.expectedPlayerContribution) / 100;
    s.cashCollectionPct = Math.round((s.actualCashReceived * 10000) / s.expectedPlayerContribution) / 100;
    s.collectionPct = s.settlementPct;
  }
  const actual = match.groundFeePaidAmount;
  if (typeof actual === "number" && Number.isFinite(actual) && actual >= 0) {
    s.actualFeePaid = Math.round(actual);
    s.netResult = s.expectedPlayerContribution - s.actualFeePaid;
    s.cashPosition = s.actualCashReceived - s.actualFeePaid;
  }
  return s;
}

/** "Net Surplus" / "Net Loss" / "Break-even" for a net result. */
export function netResultLabel(net: number | null): { label: string; tone: "surplus" | "loss" | "even" | "unknown" } {
  if (net === null) return { label: "Actual fee not recorded", tone: "unknown" };
  if (net > 0) return { label: "Net Surplus", tone: "surplus" };
  if (net < 0) return { label: "Net Loss", tone: "loss" };
  return { label: "Break-even", tone: "even" };
}

/**
 * Canonical Club Finance Overview aggregation (FND-01).
 * Includes every billable match with eligible obligations (including 100%-unpaid
 * matches), excludes matches with only Waived/Not-Playing/Cancelled players from
 * Expected, and preserves historical cash collected on abandoned matches without
 * adding abandoned matches to billable Expected or Outstanding totals.
 */
export function summarizeClubFinanceOverview(
  reportData: MatchFinanceSummary[],
  isBillableFn: (match: Match) => boolean,
) {
  const includedMatches = reportData.filter((d) => {
    const hasObligations =
      d.matchFeeTotal > 0 ||
      d.totalDue > 0 ||
      d.paidCount > 0 ||
      d.unpaidCount > 0 ||
      d.feeOffset > 0;
    if (isBillableFn(d.match)) {
      return hasObligations;
    }
    // Non-billable / abandoned matches appear only if historical cash/sub was recorded
    return d.feeCollected > 0 || d.subscriptionCovered > 0;
  });

  const billableMatches = includedMatches.filter((d) => isBillableFn(d.match));
  const totalExpected = billableMatches.reduce((s, d) => s + d.matchFeeTotal, 0);
  const actualCashReceived = includedMatches.reduce((s, d) => s + d.feeCollected, 0);
  const billableCashReceived = billableMatches.reduce((s, d) => s + d.feeCollected, 0);
  const subscriptionCovered = billableMatches.reduce((s, d) => s + d.subscriptionCovered, 0);
  const sponsored = billableMatches.reduce((s, d) => s + d.feeOffset, 0);
  const outstanding = billableMatches.reduce((s, d) => s + d.totalDue, 0);

  const cashCollectionPct =
    totalExpected > 0 ? Math.round((billableCashReceived * 10000) / totalExpected) / 100 : null;
  const settlementPct =
    totalExpected > 0
      ? Math.round(((billableCashReceived + subscriptionCovered) * 10000) / totalExpected) / 100
      : null;

  return {
    includedMatches,
    matchCount: includedMatches.length,
    billableMatchCount: billableMatches.length,
    totalExpected,
    actualCashReceived,
    billableCashReceived,
    historicalAbandonedCash: Math.max(0, actualCashReceived - billableCashReceived),
    subscriptionCovered,
    sponsored,
    outstanding,
    cashCollectionPct,
    settlementPct,
  };
}

export interface MatchPaidPlayerRow {
  paymentId: string;
  playerId: string;
  name: string;
  amount: number;
  method: string;
  reference?: string;
  sponsoredNote?: string;
}

export interface MatchUnpaidPlayerRow {
  paymentId: string;
  playerId: string;
  name: string;
  due: number;
  paidSoFar: number;
  dueStatus: "Unpaid" | "Partially Paid";
  planTag?: string;
  sponsoredNote?: string;
}

export interface MatchSponsoredPlayerRow {
  paymentId: string;
  playerId: string;
  name: string;
  amount: number;
  details: string;
}

/**
 * Partitions a match's non-excluded payments into mutually exclusive
 * Paid, Unpaid, and Sponsored lists so no payment row appears in multiple categories.
 */
export function partitionMatchFinancePlayers(
  match: Match,
  paymentsForMatch: readonly MatchPayment[],
  players: readonly Player[],
): {
  paid: MatchPaidPlayerRow[];
  unpaid: MatchUnpaidPlayerRow[];
  sponsored: MatchSponsoredPlayerRow[];
} {
  const paid: MatchPaidPlayerRow[] = [];
  const unpaid: MatchUnpaidPlayerRow[] = [];
  const sponsored: MatchSponsoredPlayerRow[] = [];

  for (const p of paymentsForMatch) {
    const cls = classifyMatchPayment(p, match.fee || 0);
    if (cls.category === "excluded") continue;

    const player = players.find((x) => x.id === p.playerId);
    const name = p.guestName ? `${p.guestName} (Guest)` : (player?.name || "Player");
    const totalSponsored = cls.clubSponsored + cls.playerSponsored;
    const sponsorName = p.sponsoredBy ? players.find((x) => x.id === p.sponsoredBy)?.name : undefined;
    const sponsorDetails =
      cls.playerSponsored > 0
        ? `Sponsored by ${sponsorName || "Member"}`
        : p.planTag || (p.manualMethod === "club_sponsored" ? "Club Sponsored" : "Club Sponsorship");

    if (cls.outstanding > 0) {
      unpaid.push({
        paymentId: p.id,
        playerId: p.playerId,
        name,
        due: cls.outstanding,
        paidSoFar: cls.cashReceived,
        dueStatus: cls.cashReceived > 0 ? "Partially Paid" : "Unpaid",
        planTag: p.planTag,
        sponsoredNote: totalSponsored > 0 ? `₹${totalSponsored} ${sponsorDetails}` : undefined,
      });
      continue;
    }

    if (
      cls.category === "club_sponsored" ||
      cls.category === "player_sponsored" ||
      (cls.cashReceived === 0 && cls.subscriptionCovered === 0 && totalSponsored > 0)
    ) {
      sponsored.push({
        paymentId: p.id,
        playerId: p.playerId,
        name,
        amount: totalSponsored,
        details: sponsorDetails,
      });
      continue;
    }

    if (cls.isSettled) {
      const method =
        cls.category === "razorpay"
          ? "Razorpay"
          : cls.category === "subscription_covered"
            ? "Subscription Covered"
            : "Cash";
      paid.push({
        paymentId: p.id,
        playerId: p.playerId,
        name,
        amount: cls.cashReceived > 0 ? cls.cashReceived : cls.subscriptionCovered,
        method,
        reference: (p as any).razorpayPaymentId || (p as any).transactionId || undefined,
        sponsoredNote: totalSponsored > 0 ? `₹${totalSponsored} ${sponsorDetails}` : undefined,
      });
    }
  }

  return { paid, unpaid, sponsored };
}

export interface PlayerFinancialProfile {
  player: Player;
  totalOutstanding: number;
  matchOutstanding: number;
  otherFeesOutstanding: number;
  totalPaidMatches: number;
  totalSponsored: number;
  totalSubscriptionCovered: number;
  matchEntries: {
    matchId: string;
    date: string;
    opponent: string;
    statusLabel: "Paid" | "Partially Paid" | "Unpaid" | "Waived" | "Sponsored" | "Subscription";
    paid: number;
    outstanding: number;
    sponsored: number;
    subscriptionCovered: number;
  }[];
  otherFeeEntries: {
    id: string;
    title: string;
    category: "No Show" | "Penalty" | "Exemption" | "Ad-hoc";
    amount: number;
    status: string;
    comment?: string;
    date?: string;
  }[];
}

export function summarizePlayerFinancialProfile(
  player: Player,
  matches: readonly Match[],
  payments: readonly MatchPayment[],
  otherFees: readonly any[],
): PlayerFinancialProfile {
  let matchOutstanding = 0;
  let totalPaidMatches = 0;
  let totalSponsored = 0;
  let totalSubscriptionCovered = 0;
  const matchEntries: PlayerFinancialProfile["matchEntries"] = [];

  for (const p of payments) {
    if (p.playerId !== player.id || p.status === "Not Playing") continue;
    const match = matches.find((m) => m.id === p.matchId);
    if (!match) continue;
    const cls = classifyMatchPayment(p, match.fee || 0);
    if (cls.category === "excluded") {
      if (p.status === "Waived" || match.result === "Abandoned") {
        matchEntries.push({
          matchId: match.id,
          date: match.date,
          opponent: match.opponent || "TBD",
          statusLabel: "Waived",
          paid: cls.cashReceived,
          outstanding: 0,
          sponsored: 0,
          subscriptionCovered: 0,
        });
      }
      continue;
    }

    const sp = cls.clubSponsored + cls.playerSponsored;
    matchOutstanding += cls.outstanding;
    totalPaidMatches += cls.cashReceived;
    totalSponsored += sp;
    totalSubscriptionCovered += cls.subscriptionCovered;

    const statusLabel: PlayerFinancialProfile["matchEntries"][number]["statusLabel"] =
      cls.outstanding > 0
        ? cls.cashReceived > 0
          ? "Partially Paid"
          : "Unpaid"
        : cls.category === "club_sponsored" || cls.category === "player_sponsored"
          ? "Sponsored"
          : cls.category === "subscription_covered"
            ? "Subscription"
            : "Paid";

    matchEntries.push({
      matchId: match.id,
      date: match.date,
      opponent: match.opponent || "TBD",
      statusLabel,
      paid: cls.cashReceived,
      outstanding: cls.outstanding,
      sponsored: sp,
      subscriptionCovered: cls.subscriptionCovered,
    });
  }

  matchEntries.sort((a, b) => b.date.localeCompare(a.date));

  let otherFeesOutstanding = 0;
  const otherFeeEntries: PlayerFinancialProfile["otherFeeEntries"] = [];
  for (const f of otherFees) {
    if (f.playerId !== player.id || f.status === "Cancelled") continue;
    const title = String(f.title || "");
    const templateId = String(f.templateId || "");
    const category: PlayerFinancialProfile["otherFeeEntries"][number]["category"] =
      title.startsWith("Late Fee Exemption:") || templateId.startsWith("latefee_exempt_")
        ? "Exemption"
        : templateId.startsWith("latefee_") || title.toLowerCase().includes("penalty") || title.toLowerCase().includes("late fee")
          ? "Penalty"
          : title.toLowerCase().includes("no show")
            ? "No Show"
            : "Ad-hoc";
    if (f.status === "Unpaid") {
      otherFeesOutstanding += Number(f.amount) || 0;
    }
    const rawTs = f.createdAt?.seconds
      ? new Date(f.createdAt.seconds * 1000).toISOString().slice(0, 10)
      : typeof f.createdAt === "string"
        ? f.createdAt.slice(0, 10)
        : undefined;
    otherFeeEntries.push({
      id: f.id,
      title,
      category,
      amount: Number(f.amount) || 0,
      status: f.status,
      comment: f.comment,
      date: rawTs,
    });
  }

  return {
    player,
    totalOutstanding: matchOutstanding + otherFeesOutstanding,
    matchOutstanding,
    otherFeesOutstanding,
    totalPaidMatches,
    totalSponsored,
    totalSubscriptionCovered,
    matchEntries,
    otherFeeEntries,
  };
}
