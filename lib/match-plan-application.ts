/**
 * Finance Plans → match payments (`lib/match-plan-application.ts`). Pure.
 *
 * Decides, for every squad payment of a match, which plan applies ON THE MATCH
 * DATE (dated assignment, else a legacy `player.feePlanIds` entry, else
 * Regular), what the player contributes and what the club sponsors, and the
 * exact payment fields to write. Used by the server API (authoritative) and by
 * the UI for previews/counts, so both always agree.
 *
 * Accounting conventions are the existing ones, so dues, checkout, Razorpay
 * order amounts and match finance reports keep working unchanged:
 *   fixed / percentage   status Unpaid, feeOverride = contribution,
 *                        feeOffsetAmount = sponsorship
 *   sponsored            status Paid (manual, club_sponsored), feeOverride 0,
 *                        feeOffsetAmount = fee, feeCollectedAmount 0
 *   monthly (fixed per   status Paid (manual, part_of_plan), feeOverride 0,
 *   match)               feeCollectedAmount = allocated contribution,
 *                        feeOffsetAmount = sponsorship
 *   monthly distribute   status Paid (manual, part_of_plan), amounts ₹0 and
 *                        `pendingAllocation` until the subscription period
 *                        closes (lib/subscription-periods settles them)
 *
 * Snapshot: every write carries `financeSnapshot` recording plan, assignment,
 * match date/fee, contribution, sponsorship and the exact fields written
 * (`applied`). A payment is only re-evaluated while it is still exactly as the
 * snapshot left it ("untouched"): once anyone pays, collects, overrides or
 * edits it by hand, its snapshot is final and later plan, assignment or fee
 * changes never alter it.
 */
import type { FeePlan, FinancePlanAssignment, Match, MatchPayment, Player } from "@/lib/types";
import { assignmentOn, legacyAssignmentsFor, planContribution } from "@/lib/finance-plans";

export const AUTO_MANUAL_BY = "Finance Plans (auto)";

/** The fee fields a plan application controls. `null` = field absent. */
export interface AppliedFields {
  status: "Paid" | "Unpaid";
  feeOverride: number | null;
  feeOffsetAmount: number | null;
  feeCollectedAmount: number | null;
  planTag: string | null;
  paymentMethod: "manual" | null;
  manualMethod: "club_sponsored" | "part_of_plan" | null;
}

export interface FinanceSnapshot {
  version: 1;
  source: "auto" | "override";
  planId: string | null;
  planName: string;
  planType: "regular" | FeePlan["type"];
  assignmentId: string | null;
  legacy: boolean;
  matchDate: string;
  matchFee: number;
  contribution: number;
  sponsorship: number;
  warning?: string;
  /** Monthly "distribute": amounts are set when the subscription period closes. */
  pendingAllocation?: boolean;
  /** Set when a subscription period settled this payment: final from then on. */
  periodId?: string;
  applied: AppliedFields;
  /** Present on overrides: why, and what the plan rule would have produced. */
  override?: { reason: string; computedContribution: number; computedSponsorship: number; computedPlanName: string };
  computedBy?: string;
  computedByName?: string;
  computedAt?: unknown;
}

export type PaymentWithSnapshot = MatchPayment & { financeSnapshot?: FinanceSnapshot };

export const REGULAR_FIELDS: AppliedFields = {
  status: "Unpaid",
  feeOverride: null,
  feeOffsetAmount: null,
  feeCollectedAmount: null,
  planTag: null,
  paymentMethod: null,
  manualMethod: null,
};

/** Fields a plan's contribution translates into (existing conventions). */
export function fieldsForPlan(plan: FeePlan | null, contribution: number, sponsorship: number, fee: number): AppliedFields {
  if (!plan) return REGULAR_FIELDS;
  if (plan.type === "sponsored" || (contribution === 0 && plan.type !== "monthly")) {
    return {
      status: "Paid",
      feeOverride: 0,
      feeOffsetAmount: fee,
      feeCollectedAmount: 0,
      planTag: plan.name,
      paymentMethod: "manual",
      manualMethod: "club_sponsored",
    };
  }
  if (plan.type === "monthly") {
    return {
      status: "Paid",
      feeOverride: 0,
      feeOffsetAmount: sponsorship,
      feeCollectedAmount: contribution,
      planTag: `${plan.name} (Subscription)`,
      paymentMethod: "manual",
      manualMethod: "part_of_plan",
    };
  }
  return {
    status: "Unpaid",
    feeOverride: contribution,
    feeOffsetAmount: sponsorship,
    feeCollectedAmount: null,
    planTag: plan.name,
    paymentMethod: null,
    manualMethod: null,
  };
}

/** Fields for a Finance/Super Admin override of the player's contribution. */
export function fieldsForOverride(contribution: number, fee: number, label: string): AppliedFields {
  const c = Math.max(0, Math.min(fee, Math.round(contribution)));
  if (c === 0) {
    return { ...fieldsForPlan({ id: "override", name: label, type: "sponsored" }, 0, fee, fee) };
  }
  return {
    status: "Unpaid",
    feeOverride: c,
    feeOffsetAmount: fee - c,
    feeCollectedAmount: null,
    planTag: label,
    paymentMethod: null,
    manualMethod: null,
  };
}

const norm = (v: unknown) => (v === undefined ? null : v);

/** The payment's current values for the fields a plan application controls. */
export function currentFields(p: MatchPayment): AppliedFields {
  return {
    status: p.status as AppliedFields["status"],
    feeOverride: norm(p.feeOverride) as number | null,
    feeOffsetAmount: norm(p.feeOffsetAmount) as number | null,
    feeCollectedAmount: norm(p.feeCollectedAmount) as number | null,
    planTag: norm(p.planTag) as string | null,
    paymentMethod: norm(p.paymentMethod) as "manual" | null,
    manualMethod: norm(p.manualMethod) as AppliedFields["manualMethod"],
  };
}

export function sameFields(a: AppliedFields, b: AppliedFields): boolean {
  return (Object.keys(REGULAR_FIELDS) as (keyof AppliedFields)[]).every((k) => norm(a[k]) === norm(b[k]));
}

/** Still exactly as the last automatic application left it? */
export function isUntouchedAuto(p: PaymentWithSnapshot): boolean {
  const s = p.financeSnapshot;
  return !!s && s.source === "auto" && sameFields(currentFields(p), s.applied) && !p.sponsoredBy && !p.sponsoring;
}

/** Has nobody adjusted the fee at all (no plan, override, sponsorship or collection)? */
export function isPristineRegular(p: PaymentWithSnapshot): boolean {
  return (
    p.status === "Unpaid" &&
    !p.financeSnapshot &&
    p.feeOverride === undefined &&
    p.feeOffsetAmount === undefined &&
    p.feeCollectedAmount === undefined &&
    !p.planTag &&
    !p.manualMethod &&
    !p.sponsoredBy &&
    !p.sponsoring
  );
}

/**
 * Can a Finance/Super Admin override this payment's fee? Only while no money
 * has been collected from the player: Unpaid, or "paid" purely by club
 * sponsorship / subscription allocation. Not for fees paid by another player.
 */
export function isOverridable(p: MatchPayment): boolean {
  if (p.guestName || p.sponsoredBy || p.sponsoring) return false;
  if (p.status === "Unpaid") return true;
  return p.status === "Paid" && (p.manualMethod === "club_sponsored" || p.manualMethod === "part_of_plan");
}

export type RowAction = "apply" | "update" | "revert" | "unchanged" | "regular" | "skip";

export interface PlanRow {
  paymentId: string;
  playerId: string;
  playerName: string;
  action: RowAction;
  /** Why the row is skipped / unchanged (shown to the admin). */
  reason?: string;
  planId: string | null;
  planName: string;
  planType: FinanceSnapshot["planType"];
  assignmentId: string | null;
  legacy: boolean;
  fee: number;
  contribution: number;
  sponsorship: number;
  warning?: string;
  pendingAllocation?: boolean;
  /** Fields to write (apply/update/revert only). */
  fields?: AppliedFields;
}

export interface MatchPlanApplication {
  matchId: string;
  matchDate: string;
  matchFee: number;
  /** Set when the match cannot have plans applied at all. */
  blocked?: string;
  rows: PlanRow[];
  /** Rows that will be written. */
  changes: PlanRow[];
  totals: { players: number; onPlans: number; regular: number; contribution: number; sponsorship: number; pendingAllocation: number };
}

/** Builds the per-player breakdown for a match. Pure. */
export function buildMatchPlanApplication({
  match,
  payments,
  players,
  plans,
  assignments,
}: {
  match: Pick<Match, "id" | "fee" | "date" | "result"> & { financeStatus?: string };
  payments: PaymentWithSnapshot[];
  players: Pick<Player, "id" | "name" | "feePlanIds">[];
  plans: FeePlan[];
  assignments: FinancePlanAssignment[];
}): MatchPlanApplication {
  const fee = Math.max(0, Math.round(Number(match.fee) || 0));
  const matchDate = String(match.date || "");
  const out: MatchPlanApplication = {
    matchId: match.id,
    matchDate,
    matchFee: fee,
    rows: [],
    changes: [],
    totals: { players: 0, onPlans: 0, regular: 0, contribution: 0, sponsorship: 0, pendingAllocation: 0 },
  };
  if (match.financeStatus === "closed") {
    out.blocked = "Match finances are closed. Reopen them in the Finance tab to change Finance Plans.";
    return out;
  }
  if (match.result === "Abandoned") {
    out.blocked = "This match was abandoned, so no match fees apply.";
    return out;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(matchDate)) {
    out.blocked = "The match has no valid date.";
    return out;
  }

  for (const p of payments) {
    if (p.matchId !== match.id || p.status === "Not Playing") continue;
    const player = players.find((pl) => pl.id === p.playerId);
    if (!player) continue;
    const name = p.guestName || player.name;
    const base = { paymentId: p.id, playerId: player.id, playerName: name, fee };

    if (p.guestName) {
      out.rows.push({ ...base, action: "skip", reason: "Guest — plans apply to members only", planId: null, planName: "Guest", planType: "regular", assignmentId: null, legacy: false, contribution: p.feeOverride ?? fee, sponsorship: 0 });
      continue;
    }

    // Plan in effect on the match date.
    const all = [...assignments.filter((a) => a.playerId === player.id), ...legacyAssignmentsFor(player, plans)];
    const a = assignmentOn(all, player.id, matchDate);
    const plan = a ? plans.find((pl) => pl.id === a.planId) || null : null;
    const planName = plan?.name || a?.planName || "Regular";
    const planType: FinanceSnapshot["planType"] = plan ? plan.type : "regular";
    const calc = planContribution(plan, fee);
    const desc = {
      planId: plan?.id || null,
      planName: a && !plan ? `${planName} (missing)` : planName,
      planType,
      assignmentId: a && !a.legacy ? a.id : null,
      legacy: !!a?.legacy,
      contribution: calc.contribution,
      sponsorship: calc.sponsorship,
      warning: calc.warning,
      ...(calc.pendingAllocation ? { pendingAllocation: true } : {}),
    };
    const snap = p.financeSnapshot;

    if (snap?.periodId) {
      out.rows.push({
        ...base,
        ...desc,
        planName: snap.planName,
        planType: snap.planType,
        contribution: snap.contribution,
        sponsorship: snap.sponsorship,
        pendingAllocation: false,
        action: "skip",
        reason: "Settled when the subscription period closed",
      });
      continue;
    }

    // Final records are never re-evaluated.
    const editable = isPristineRegular(p) || isUntouchedAuto(p);
    if (!editable) {
      let reason = "Fee was adjusted by hand";
      if (snap?.source === "override") reason = `Overridden${snap.override?.reason ? `: ${snap.override.reason}` : ""}`;
      else if (p.sponsoredBy) reason = "Fee is paid by another player";
      else if (p.sponsoring) reason = "Also paying another player's fee";
      else if (p.status === "Paid") reason = "Already paid";
      else if (p.status === "Waived") reason = "Fee waived";
      else if (p.status === "Failed") reason = "Last payment attempt failed";
      else if (snap) reason = "Changed after plans were applied";
      const shownContribution = snap ? snap.contribution : p.feeOverride ?? fee;
      out.rows.push({
        ...base,
        ...desc,
        planName: snap?.planName || p.planTag || desc.planName,
        planType: snap?.planType || desc.planType,
        contribution: shownContribution,
        sponsorship: snap ? snap.sponsorship : Number(p.feeOffsetAmount) || 0,
        action: "skip",
        reason,
      });
      continue;
    }

    if (a && !plan) {
      out.rows.push({ ...base, ...desc, action: "skip", reason: "Assigned plan no longer exists — check Finance Plans" });
      continue;
    }
    if (!plan) {
      if (isUntouchedAuto(p) && snap?.planType !== "regular") {
        out.rows.push({ ...base, ...desc, action: "revert", reason: `No plan on ${matchDate}; back to the regular fee`, fields: REGULAR_FIELDS });
      } else {
        out.rows.push({ ...base, ...desc, action: "regular" });
      }
      continue;
    }

    const fields = fieldsForPlan(plan, calc.contribution, calc.sponsorship, fee);
    if (snap && isUntouchedAuto(p)) {
      const same =
        snap.planId === desc.planId &&
        snap.assignmentId === desc.assignmentId &&
        snap.matchFee === fee &&
        snap.matchDate === matchDate &&
        snap.contribution === calc.contribution &&
        snap.sponsorship === calc.sponsorship &&
        sameFields(snap.applied, fields);
      out.rows.push(same ? { ...base, ...desc, action: "unchanged", reason: "Already applied" } : { ...base, ...desc, action: "update", fields });
    } else {
      out.rows.push({ ...base, ...desc, action: "apply", fields });
    }
  }

  out.rows.sort((x, y) => x.playerName.localeCompare(y.playerName));
  out.changes = out.rows.filter((r) => r.action === "apply" || r.action === "update" || r.action === "revert");
  // Totals describe the squad AFTER the changes (skipped rows at their recorded values).
  for (const r of out.rows) {
    out.totals.players += 1;
    if (r.planType === "regular") out.totals.regular += 1;
    else out.totals.onPlans += 1;
    out.totals.contribution += r.contribution;
    out.totals.sponsorship += r.sponsorship;
    if (r.pendingAllocation) out.totals.pendingAllocation += 1;
  }
  return out;
}

/** Snapshot for a row about to be written (server adds who/when). */
export function snapshotForRow(app: Pick<MatchPlanApplication, "matchDate" | "matchFee">, row: PlanRow): FinanceSnapshot {
  const reverted = row.action === "revert";
  return {
    version: 1,
    source: "auto",
    planId: reverted ? null : row.planId,
    planName: reverted ? "Regular" : row.planName,
    planType: reverted ? "regular" : row.planType,
    assignmentId: reverted ? null : row.assignmentId,
    legacy: reverted ? false : row.legacy,
    matchDate: app.matchDate,
    matchFee: app.matchFee,
    contribution: reverted ? app.matchFee : row.contribution,
    sponsorship: reverted ? 0 : row.sponsorship,
    ...(row.warning && !reverted ? { warning: row.warning } : {}),
    ...(row.pendingAllocation && !reverted ? { pendingAllocation: true } : {}),
    applied: row.fields || REGULAR_FIELDS,
  };
}

/** Plan preview for one player on a match date (squad picker). */
export function previewPlayerPlan(
  player: Pick<Player, "id" | "feePlanIds">,
  plans: FeePlan[],
  assignments: FinancePlanAssignment[],
  matchDate: string,
  matchFee: number,
): { label: string; fee: number; sponsored: number; kind: "regular" | "plan" | "pending" } {
  const all = [...assignments.filter((a) => a.playerId === player.id), ...legacyAssignmentsFor(player, plans)];
  const a = /^\d{4}-\d{2}-\d{2}$/.test(matchDate) ? assignmentOn(all, player.id, matchDate) : null;
  const plan = a ? plans.find((p) => p.id === a.planId) || null : null;
  const calc = planContribution(plan, matchFee);
  if (!plan) return { label: "Regular", fee: calc.contribution, sponsored: 0, kind: "regular" };
  if (calc.pendingAllocation) return { label: plan.name, fee: 0, sponsored: 0, kind: "pending" };
  return { label: plan.name, fee: calc.contribution, sponsored: calc.sponsorship, kind: "plan" };
}
