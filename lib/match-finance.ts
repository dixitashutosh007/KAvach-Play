/**
 * Per-match collection summary (`lib/match-finance.ts`). Pure.
 *
 * Extracted VERBATIM from the Finance → Matches report (FinanceTab) so the
 * Finance report and the Admin Match Centre payment panel share ONE
 * calculation. Semantics (unchanged):
 *  - feeCollected: real money collected (Razorpay, cash, plan allocation;
 *    club-sponsored payments collect 0);
 *  - feeOffset:    club-sponsored / plan / discount offsets ("Club Sponsored");
 *  - totalDue:     sum of effective fees for payments still "Unpaid";
 *  - paid / unpaid player lists: "Paid" vs every other non-"Not Playing" status.
 *
 * Callers pass the match's payments already filtered the way the Finance report
 * does (see `financeReportPayments`).
 */
import type { Match, MatchPayment, Player } from "@/lib/types";

/** The Finance report's inclusion rule: not "Not Playing" and a known player. */
export function financeReportPayments(match: Pick<Match, "id">, payments: MatchPayment[], players: Player[]): MatchPayment[] {
  return payments.filter(
    (p) => p.matchId === match.id && p.status !== "Not Playing" && players.some((pl) => pl.id === p.playerId),
  );
}

export function summarizeMatchFinance(match: Match, paymentsForMatch: MatchPayment[], players: Player[]) {
  const playingCount = paymentsForMatch.length;
  const paidCount = paymentsForMatch.filter(
    (p) => p.status === "Paid",
  ).length;
  const unpaidCount = paymentsForMatch.filter(
    (p) => p.status === "Unpaid" && (p.feeOverride !== undefined ? p.feeOverride : match.fee) > 0,
  ).length;
  const razorpayPaidCount = paymentsForMatch.filter(
    (p) => p.status === "Paid" && p.paymentMethod !== "manual"
  ).length;
  const manualPaidCount = paymentsForMatch.filter(
    (p) => p.status === "Paid" && p.paymentMethod === "manual"
  ).length;

  const getFee = (p: any) => p.feeOverride !== undefined ? p.feeOverride : match.fee;

  const matchFeeTotal = match.matchFeeBudget !== undefined ? match.matchFeeBudget : (match.fee || 0) * 12;

  let feeCollected = 0;
  let feeCollectedCount = 0;
  let feeOffset = 0;
  let feeOffsetCount = 0;
  const sponsoredDetails: { playerName: string; amount: number; reason: string }[] = [];
  const paidPlayers: string[] = [];
  const unpaidPlayers: string[] = [];
  const paidPlayerDetails: { name: string; amount: number; method: string }[] = [];
  const unpaidPlayerDetails: { name: string; due: number; planTag?: string }[] = [];

  for (const p of paymentsForMatch) {
    const effectiveFee = p.feeOverride !== undefined ? p.feeOverride : match.fee;
    const player = players.find((x) => x.id === p.playerId);
    const playerName = p.guestName ? `${p.guestName} (Guest)` : (player?.name || "Player");

    if (p.status === "Paid") {
      paidPlayers.push(playerName);
      const methodLabel =
        p.paymentMethod === "razorpay"
          ? "Razorpay"
          : p.manualMethod === "club_sponsored"
            ? "Sponsored"
            : p.manualMethod === "part_of_plan"
              ? "Subscription"
              : "Cash";
      paidPlayerDetails.push({
        name: playerName,
        amount: p.feeCollectedAmount !== undefined ? p.feeCollectedAmount : effectiveFee,
        method: methodLabel,
      });
    } else {
      unpaidPlayers.push(playerName);
      unpaidPlayerDetails.push({
        name: playerName,
        due: effectiveFee,
        planTag: p.planTag,
      });
    }

    // Calculate real money collected (Razorpay + Cash collected + Monthly subscription allocation)
    if (p.status === "Paid") {
      if (p.manualMethod === "club_sponsored") {
        // Entirely sponsored by club; 0 direct money collected
      } else if (p.manualMethod === "part_of_plan") {
        // Monthly flat fee subscription allocation
        const collected = p.feeCollectedAmount !== undefined ? p.feeCollectedAmount : (match.fee - (p.feeOffsetAmount || 0));
        feeCollected += collected;
        feeCollectedCount++;
      } else {
        // Razorpay, cash, direct deposit, or standard manual
        const collected = p.feeCollectedAmount !== undefined ? p.feeCollectedAmount : effectiveFee;
        feeCollected += collected;
        feeCollectedCount++;
      }
    }

    // Calculate Club Sponsored offset and breakdown for hover tooltip
    if (p.feeOffsetAmount !== undefined && p.feeOffsetAmount > 0) {
      feeOffset += p.feeOffsetAmount;
      feeOffsetCount++;
      sponsoredDetails.push({
        playerName,
        amount: p.feeOffsetAmount,
        reason: p.planTag || (p.manualMethod === "club_sponsored" ? "Club Sponsored" : "Plan Offset"),
      });
    } else if (p.manualMethod === "club_sponsored") {
      const sponsoredAmt = p.feeOverride !== undefined && p.feeOverride > 0 ? p.feeOverride : match.fee;
      feeOffset += sponsoredAmt;
      feeOffsetCount++;
      sponsoredDetails.push({
        playerName,
        amount: sponsoredAmt,
        reason: p.planTag || "Club Sponsored",
      });
    } else if (p.sponsoredBy) {
      const sponsor = players.find((x) => x.id === p.sponsoredBy);
      feeOffset += match.fee;
      feeOffsetCount++;
      sponsoredDetails.push({
        playerName,
        amount: match.fee,
        reason: `Sponsored by ${sponsor?.name || "Member"}`,
      });
    } else if ((p.status === "Paid" || p.feeOverride !== undefined) && p.manualMethod !== "part_of_plan" && match.fee > effectiveFee) {
      const discount = match.fee - effectiveFee;
      if (discount > 0) {
        feeOffset += discount;
        feeOffsetCount++;
        sponsoredDetails.push({
          playerName,
          amount: discount,
          reason: p.planTag || "Fixed Discount",
        });
      }
    }
  }

  const percentRecovered = matchFeeTotal > 0 ? Math.round((feeCollected * 100) / matchFeeTotal) : null;

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
    totalCollected: paymentsForMatch.filter(p => p.status === "Paid").reduce((s, p) => s + getFee(p), 0),
    razorpayCollected: paymentsForMatch.filter(p => p.status === "Paid" && p.paymentMethod !== "manual").reduce((s, p) => s + getFee(p), 0),
    manualCollected: paymentsForMatch.filter(p => p.status === "Paid" && p.paymentMethod === "manual").reduce((s, p) => s + getFee(p), 0),
    totalDue: paymentsForMatch.filter(p => p.status === "Unpaid").reduce((s, p) => s + getFee(p), 0),
    feeCollected,
    feeCollectedCount,
    feeOffset,
    feeOffsetCount,
    sponsoredDetails,
    matchFeeTotal,
    percentRecovered,
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

/** Collected amount recorded on a Paid payment (money), or 0. */
export function collectedMoney(p: Pick<MatchPayment, "status" | "manualMethod" | "sponsoredBy" | "feeCollectedAmount" | "feeOverride">, matchFee: number): number {
  if (p.status !== "Paid") return 0;
  if (p.manualMethod === "club_sponsored" || p.manualMethod === "part_of_plan" || p.sponsoredBy) return 0;
  return rupees(p.feeCollectedAmount !== undefined ? p.feeCollectedAmount : p.feeOverride !== undefined ? p.feeOverride : matchFee);
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
  maxPlayerCollection: number;
  collected: number;
  /** Part of `collected` covered by subscriptions (not match-level cash). */
  collectedViaSubscription: number;
  outstanding: number;
  /** Collected ÷ maximum player collection × 100 (2 dp); null when nothing is expected. */
  collectionPct: number | null;
  paidCount: number;
  unpaidCount: number;
  pendingAllocationCount: number;
  /** Squad size counted (Not Playing / Waived excluded). */
  players: number;
  /** null = not recorded (never invented). */
  actualFeePaid: number | null;
  /** maxPlayerCollection − actualFeePaid; null when the actual fee is not recorded. */
  netResult: number | null;
  /** collected − actualFeePaid (secondary). */
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
    maxPlayerCollection: 0,
    collected: 0,
    collectedViaSubscription: 0,
    outstanding: 0,
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
    const share = paymentShare(p, fee);
    if (!share) continue;
    s.players += 1;
    s.clubSponsored += share.sponsorship;
    s.maxPlayerCollection += share.contribution;
    if (share.kind === "pending") s.pendingAllocationCount += 1;
    if (share.paid) {
      s.paidCount += 1;
      s.collected += share.contribution;
      if (share.kind === "subscription") s.collectedViaSubscription += share.contribution;
    } else {
      s.unpaidCount += 1;
      s.outstanding += share.contribution;
    }
  }
  s.systemFee = s.maxPlayerCollection + s.clubSponsored;
  s.collectionPct = s.maxPlayerCollection > 0 ? Math.round((s.collected * 10000) / s.maxPlayerCollection) / 100 : null;
  const actual = match.groundFeePaidAmount;
  if (typeof actual === "number" && Number.isFinite(actual) && actual >= 0) {
    s.actualFeePaid = Math.round(actual);
    s.netResult = s.maxPlayerCollection - s.actualFeePaid;
    s.cashPosition = s.collected - s.actualFeePaid;
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
