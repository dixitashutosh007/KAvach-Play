/**
 * Manage Match — pure helpers for the squad list and match card
 * (`lib/match-squad.ts`): match status badge, Finance Plan badge per payment,
 * and which contextual actions a player row offers (with the reason when an
 * action is unavailable). UI visibility only — every action is re-checked by
 * Firestore rules or the server route it calls.
 */
import type { FeePlan, Match, MatchPayment } from "@/lib/types";
import { isOverridable } from "@/lib/match-plan-application";
import { paymentShare, type PaymentShare } from "@/lib/match-finance";

export type MatchStatus = "Upcoming" | "Today" | "Completed" | "Abandoned" | "Tentative";

export function matchStatus(match: Pick<Match, "date" | "result" | "isTentative">, todayKey: string): MatchStatus {
  if (match.result === "Abandoned") return "Abandoned";
  if (match.result && match.result !== "Pending") return "Completed";
  if (match.isTentative) return "Tentative";
  if (match.date === todayKey) return "Today";
  if (match.date && match.date < todayKey) return "Completed";
  return "Upcoming";
}

export type PlanBadgeTone = "regular" | "fixed" | "monthly" | "sponsored" | "percentage" | "override" | "other";

/** Finance Plan shown for a squad payment (from its finance record, else legacy fields). */
export function planBadge(p: MatchPayment, plans: Pick<FeePlan, "id" | "type" | "discountPct" | "feeAmount">[]): { label: string; tone: PlanBadgeTone; matchOnly: boolean } {
  const snap = p.financeSnapshot;
  if (p.sponsoredBy) return { label: "Paid by teammate", tone: "other", matchOnly: true };
  if (snap?.source === "override") {
    const label = snap.planType === "regular" || !snap.planId ? (snap.planName?.startsWith("Regular") ? "Regular" : "Custom fee") : snap.planName;
    return { label, tone: "override", matchOnly: true };
  }
  if (snap && snap.planType !== "regular") {
    const plan = plans.find((x) => x.id === snap.planId);
    const tone: PlanBadgeTone = snap.planType === "fixed" || snap.planType === "monthly" || snap.planType === "sponsored" || snap.planType === "percentage" ? snap.planType : "other";
    const suffix = plan?.type === "percentage" && !/%/.test(snap.planName) ? ` (${plan.discountPct ?? 0}%)` : "";
    return { label: `${snap.planName}${suffix}`, tone, matchOnly: false };
  }
  if (p.manualMethod === "club_sponsored") return { label: p.planTag || "Club Sponsored", tone: "sponsored", matchOnly: false };
  if (p.manualMethod === "part_of_plan") return { label: (p.planTag || "Subscription").replace(/ \(Subscription\)$/, ""), tone: "monthly", matchOnly: false };
  if (p.planTag || p.feeOverride !== undefined) return { label: p.planTag || "Custom fee", tone: p.planTag ? "fixed" : "override", matchOnly: !p.planTag };
  return { label: "Regular", tone: "regular", matchOnly: false };
}

export type RowActionId = "plan" | "regular" | "markPaid" | "refund" | "remove" | "refundRemove" | "feePayer" | "undoFeePayer" | "remind";

export interface RowAction {
  id: RowActionId;
  label: string;
  /** Set when the action is shown but can't be used, with the explanation. */
  disabledReason?: string;
  destructive?: boolean;
}

export interface RowActionContext {
  /** Finance Admin / Super Admin. */
  canManageFees: boolean;
  /** Can change the squad / collect (Match, Finance, Super Admin). */
  canManageSquad: boolean;
  financeClosed: boolean;
  matchFee: number;
}

/** Contextual actions for one squad row. */
export function squadRowActions(p: MatchPayment, ctx: RowActionContext): { share: PaymentShare | null; actions: RowAction[] } {
  const share = paymentShare(p, ctx.matchFee);
  const actions: RowAction[] = [];
  if (!share || !ctx.canManageSquad) return { share, actions };
  const closedReason = ctx.financeClosed ? "Match finances are closed — reopen them in the Finance tab first." : undefined;
  const isGuest = !!p.guestName;
  const settledInPeriod = !!p.financeSnapshot?.periodId;

  if (ctx.canManageFees && !isGuest && !p.sponsoredBy && !p.sponsoring) {
    const feeLocked = closedReason || (!isOverridable(p) ? "Money has been collected — refund it first to change the fee." : settledInPeriod ? "Settled in a closed subscription period." : undefined);
    actions.push({ id: "plan", label: "Change / apply Finance Plan", disabledReason: feeLocked });
    if (share.kind !== "regular") actions.push({ id: "regular", label: "Remove plan (Regular for this match)", disabledReason: feeLocked });
  }

  if (!share.paid) {
    if (ctx.canManageFees && share.contribution > 0) actions.push({ id: "markPaid", label: `Mark Paid (cash) · ₹${share.contribution.toLocaleString("en-IN")}` });
  } else if (share.realMoney) {
    if (ctx.canManageFees) actions.push({ id: "refund", label: "Refund / reverse payment…" });
    else actions.push({ id: "refund", label: "Mark Unpaid", disabledReason: `₹${share.collectedAmount.toLocaleString("en-IN")} was collected — a Finance Admin must record the refund first.` });
  }

  if (share.realMoney) {
    if (ctx.canManageFees) actions.push({ id: "refundRemove", label: "Refund & remove from squad…", destructive: true });
    else actions.push({ id: "remove", label: "Remove from squad", destructive: true, disabledReason: "Money was collected for this player — it must be refunded first." });
  } else {
    actions.push({
      id: "remove",
      label: "Remove from squad",
      destructive: true,
      disabledReason: settledInPeriod ? "Settled in a closed subscription period." : undefined,
    });
  }

  if (ctx.canManageFees && !share.paid && !p.sponsoredBy && !p.sponsoring && !isGuest) {
    actions.push({ id: "feePayer", label: "Change fee payer", disabledReason: closedReason });
  }
  if (ctx.canManageFees && p.sponsoredBy) actions.push({ id: "undoFeePayer", label: "Undo fee payer", disabledReason: closedReason });
  if (!share.paid && share.contribution > 0) actions.push({ id: "remind", label: "Send reminder" });
  return { share, actions };
}
