/**
 * Match Fee Plans — preview and one-click application of FIXED plans
 * (`lib/fee-plan-bulk.ts`). Pure.
 *
 * Model (unchanged): an admin assigns plans to a player (`player.feePlanIds`).
 * A player with no active assigned plan is on the regular fee. A fixed plan
 * (e.g. "Youth350") sets that player's match fee to `plan.feeAmount`; the club
 * sponsors the difference. This module only decides WHICH payments a fixed
 * plan applies to and previews the amounts; the write itself is the existing
 * `applyFeePlanToPayment` call with the same arguments the per-player "fixed"
 * plan action already uses:
 *
 *   feeAmount = plan.feeAmount ?? match.fee
 *   offset    = max(0, match.fee − feeAmount)       (club-sponsored amount)
 *   applyFeePlanToPayment(matchId, paymentId, feeAmount, plan.name, offset, undefined, "Unpaid")
 *
 * Applied automatically ONLY when unambiguous: an unpaid squad payment with no
 * fee override yet, for a known (non-guest) player who has exactly one active
 * assigned plan and that plan is fixed. Everyone else is listed as skipped
 * with the reason (monthly / sponsored plans keep their per-player step).
 */
import type { FeePlan, Match, MatchPayment, Player } from "@/lib/types";

export type AssignedPlan =
  | { kind: "regular" }
  | { kind: "fixed"; plan: FeePlan }
  | { kind: "other"; plan: FeePlan }
  | { kind: "multiple"; plans: FeePlan[] };

export function assignedPlanFor(player: Pick<Player, "feePlanIds"> | null | undefined, feePlans: FeePlan[]): AssignedPlan {
  const plans = (player?.feePlanIds || [])
    .map((id) => feePlans.find((fp) => fp.id === id))
    .filter((fp): fp is FeePlan => !!fp && fp.isActive !== false);
  if (plans.length === 0) return { kind: "regular" };
  if (plans.length > 1) return { kind: "multiple", plans };
  return plans[0].type === "fixed" ? { kind: "fixed", plan: plans[0] } : { kind: "other", plan: plans[0] };
}

/** Fee a fixed plan sets, and what the club sponsors, for a standard fee. */
export function fixedPlanAmounts(plan: FeePlan, standardFee: number): { planFee: number; sponsored: number } {
  const planFee = plan.feeAmount ?? standardFee;
  return { planFee, sponsored: Math.max(0, standardFee - planFee) };
}

/** Preview for one player (used while selecting players to add). */
export function previewPlayerFee(
  player: Pick<Player, "feePlanIds">,
  feePlans: FeePlan[],
  standardFee: number,
): { label: string; fee: number; sponsored: number; kind: AssignedPlan["kind"] } {
  const a = assignedPlanFor(player, feePlans);
  if (a.kind === "fixed") {
    const { planFee, sponsored } = fixedPlanAmounts(a.plan, standardFee);
    return { label: a.plan.name, fee: planFee, sponsored, kind: "fixed" };
  }
  if (a.kind === "other") return { label: a.plan.name, fee: standardFee, sponsored: 0, kind: "other" };
  if (a.kind === "multiple") return { label: "Multiple plans", fee: standardFee, sponsored: 0, kind: "multiple" };
  return { label: "Regular", fee: standardFee, sponsored: 0, kind: "regular" };
}

export interface FixedPlanItem {
  paymentId: string;
  playerId: string;
  playerName: string;
  plan: FeePlan;
  standardFee: number;
  planFee: number;
  sponsored: number;
}

export interface FixedPlanSkip {
  playerName: string;
  reason: string;
}

export interface FixedPlanApplication {
  items: FixedPlanItem[];
  skipped: FixedPlanSkip[];
  regularCount: number;
  totalSponsored: number;
}

export function buildFixedPlanApplication({
  match,
  payments,
  players,
  feePlans,
}: {
  match: Pick<Match, "id" | "fee">;
  payments: MatchPayment[];
  players: Player[];
  feePlans: FeePlan[];
}): FixedPlanApplication {
  const items: FixedPlanItem[] = [];
  const skipped: FixedPlanSkip[] = [];
  let regularCount = 0;
  const standardFee = Number(match.fee) || 0;

  for (const p of payments) {
    if (p.matchId !== match.id || p.status === "Not Playing") continue;
    const player = players.find((pl) => pl.id === p.playerId);
    if (!player) continue;
    const name = p.guestName || player.name;
    if (p.guestName) continue; // guest rows ride on the host's id; never auto-plan them
    const a = assignedPlanFor(player, feePlans);
    if (a.kind === "regular") {
      regularCount += 1;
      continue;
    }
    if (p.status !== "Unpaid") {
      if (a.kind === "fixed") skipped.push({ playerName: name, reason: `Already ${p.status.toLowerCase()}` });
      continue;
    }
    if (p.feeOverride !== undefined) {
      if (a.kind === "fixed") skipped.push({ playerName: name, reason: p.planTag ? `Already on ${p.planTag}` : "Fee already adjusted" });
      continue;
    }
    if (a.kind === "multiple") {
      skipped.push({ playerName: name, reason: "Several plans assigned — choose per player" });
      continue;
    }
    if (a.kind === "other") {
      skipped.push({
        playerName: name,
        reason: `${a.plan.name} is a ${a.plan.type} plan — apply per player`,
      });
      continue;
    }
    const { planFee, sponsored } = fixedPlanAmounts(a.plan, standardFee);
    items.push({ paymentId: p.id, playerId: player.id, playerName: name, plan: a.plan, standardFee, planFee, sponsored });
  }

  items.sort((x, y) => x.playerName.localeCompare(y.playerName));
  return { items, skipped, regularCount, totalSponsored: items.reduce((s, i) => s + i.sponsored, 0) };
}
