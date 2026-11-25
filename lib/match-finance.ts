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
export function collectedMoney(p: Pick<MatchPayment, "status" | "manualMethod" | "sponsoredBy" | "feeCollectedAmount" | "feeOverride">, matchFee: number): number {
  const status = String(p.status || "");
  if (EXCLUDED_STATUSES.has(status)) return 0;
  if (p.manualMethod === "club_sponsored" || p.manualMethod === "part_of_plan" || p.sponsoredBy) return 0;
  if (status === "Paid") {
    return rupees(p.feeCollectedAmount !== undefined ? p.feeCollectedAmount : p.feeOverride !== undefined ? p.feeOverride : matchFee);
  }
  if (status === "Unpaid" && p.feeCollectedAmount !== undefined && p.feeCollectedAmount > 0) {
    const expected = rupees(p.feeOverride !== undefined ? p.feeOverride : matchFee);
    return Math.min(expected, rupees(p.feeCollectedAmount));
  }
  return 0;
}

/** Is real money held on this payment (only these may be refunded / reversed)? */
export function isRealMoneyPayment(p: Pick<MatchPayment, "status" | "manualMethod" | "sponsoredBy" | "feeCollectedAmount" | "feeOverride" | "guestName">, matchFee: number): boolean {
  return collectedMoney(p, matchFee) > 0;
}

/** Player / club shares for one payment; null when it is not part of the match finances. */
export function paymentShare(p: MatchPayment, matchFee: number): PaymentShare | null {
  if (p.status === "Not Playing" || p.status === "Waived") return null;
  const fee = rupees(matchFee);
  const paid = p.status === "Paid";
  const snap = (p as MatchPayment & { financeSnapshot?: { pendingAllocation?: boolean; source?: string; planType?: string } }).financeSnapshot;
  if (p.sponsoredBy) {
    // Fee carried by another player's payment (their feeOverride includes it).
    return { contribution: 0, sponsorship: 0, paid, realMoney: false, collectedAmount: 0, kind: "paid_by_other" };
  }
  if (p.manualMethod === "club_sponsored") {
    return { contribution: 0, sponsorship: p.feeOffsetAmount !== undefined ? rupees(p.feeOffsetAmount) : fee, paid, realMoney: false, collectedAmount: 0, kind: "sponsored" };
  }
  if (p.manualMethod === "part_of_plan") {
    if (snap?.pendingAllocation) return { contribution: 0, sponsorship: 0, paid, realMoney: false, collectedAmount: 0, kind: "pending" };
    const sponsorship = rupees(p.feeOffsetAmount);
    const contribution = p.feeCollectedAmount !== undefined ? rupees(p.feeCollectedAmount) : Math.max(0, fee - sponsorship);
    return { contribution, sponsorship, paid, realMoney: false, collectedAmount: 0, kind: "subscription" };
  }
  const contribution = p.feeOverride !== undefined ? rupees(p.feeOverride) : fee;
  const sponsorship = p.feeOffsetAmount !== undefined ? rupees(p.feeOffsetAmount) : Math.max(0, fee - contribution);
  const kind: ShareKind = snap?.source === "override" ? "override" : snap && snap.planType && snap.planType !== "regular" ? "plan" : p.feeOverride !== undefined || p.planTag ? "plan" : "regular";
  const money = collectedMoney(p, fee);
  return { contribution, sponsorship, paid, realMoney: money > 0, collectedAmount: money, kind };
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
    subscriptionCovered,
    sponsored,
    outstanding,
    cashCollectionPct,
    settlementPct,
  };
}
