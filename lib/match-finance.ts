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
