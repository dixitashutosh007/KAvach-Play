import { isMatchBillable } from "./matchBillable.ts";
import type { Match, MatchPayment, OtherFee, Player } from "./types.ts";

export interface BillableMatchPaymentItem {
  payment: MatchPayment;
  match: Match;
  fee: number;
}

export interface PlayerDuesSummary {
  totalDue: number;
  dueCount: number;
  hasDues: boolean;
  matchDue: number;
  otherFeeDue: number;
  billableMatchPayments: BillableMatchPaymentItem[];
  unpaidOtherFees: OtherFee[];
}

/**
 * Shared, deterministic dues calculation for club members.
 *
 * Rules:
 * 1. Only considers players in `myPlayers` (verified links).
 * 2. Filters match payments to status === "Unpaid".
 * 3. Consistently EXCLUDES abandoned matches (`match.result === "Abandoned"`),
 *    as abandoned matches create no match-fee obligation (Option A policy).
 * 4. Respects `payment.feeOverride` if defined; otherwise uses `match.fee`.
 * 5. Sums unpaid other fees (`status === "Unpaid"`).
 * 6. `hasDues` and `dueCount` consistently derive from billable obligations.
 */
export function calculatePlayerDues(
  myPlayers: Player[] | undefined | null,
  payments: MatchPayment[] | undefined | null,
  matches: Match[] | undefined | null,
  otherFees: OtherFee[] | undefined | null,
): PlayerDuesSummary {
  const emptySummary: PlayerDuesSummary = {
    totalDue: 0,
    dueCount: 0,
    hasDues: false,
    matchDue: 0,
    otherFeeDue: 0,
    billableMatchPayments: [],
    unpaidOtherFees: [],
  };

  if (!myPlayers || myPlayers.length === 0) {
    return emptySummary;
  }

  const myPlayerIds = new Set(myPlayers.map((p) => p.id));

  // 1. Unpaid match payments for my players
  const unpaidPayments = (payments || []).filter(
    (p) => myPlayerIds.has(p.playerId) && p.status === "Unpaid",
  );

  const billableMatchPayments: BillableMatchPaymentItem[] = [];
  for (const payment of unpaidPayments) {
    const match = (matches || []).find((m) => m.id === payment.matchId);
    // Consistently exclude non-billable matches (Abandoned matches, zero fee budget)
    if (match && isMatchBillable(match)) {
      const fee =
        payment.feeOverride !== undefined ? payment.feeOverride : (match.fee || 0);
      billableMatchPayments.push({ payment, match, fee });
    }
  }

  const matchDue = billableMatchPayments.reduce((sum, item) => sum + item.fee, 0);

  // 2. Unpaid other fees for my players
  const unpaidOther = (otherFees || []).filter(
    (f) => myPlayerIds.has(f.playerId) && f.status === "Unpaid",
  );
  const otherFeeDue = unpaidOther.reduce((sum, f) => sum + (f.amount || 0), 0);

  const totalDue = matchDue + otherFeeDue;
  const dueCount = billableMatchPayments.length + unpaidOther.length;
  const hasDues = dueCount > 0 && totalDue > 0;

  return {
    totalDue,
    dueCount,
    hasDues,
    matchDue,
    otherFeeDue,
    billableMatchPayments,
    unpaidOtherFees: unpaidOther,
  };
}
