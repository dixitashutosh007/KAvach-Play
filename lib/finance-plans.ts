/**
 * Finance Plans — pure rules (`lib/finance-plans.ts`). No React / Firebase.
 *
 * Shared by the server API (authoritative checks) and the UI (previews).
 *
 * Plan types (stored in `feePlans`; "Regular" = no active assignment):
 *  - fixed       player pays a fixed amount per match; club sponsors the rest
 *  - percentage  player pays the fee minus a % discount (discount rounded to ₹)
 *  - sponsored   player pays ₹0; club sponsors the full fee
 *  - monthly     subscription per period; per-match allocation follows the
 *                plan's allocation policy (settled in the match / reporting
 *                stages — see `planContribution`)
 *
 * Assignments (`financePlanAssignments`): one player, one plan, inclusive
 * date range. A player may hold only ONE plan on any given date. Legacy plan
 * ids still on `player.feePlanIds` count as open-ended assignments with no
 * recorded start until they are converted.
 */
import type { FeePlan, FinancePlanAssignment } from "@/lib/types";

export const FINANCE_PLAN_TYPES: { value: FeePlan["type"]; label: string; desc: string }[] = [
  { value: "fixed", label: "Fixed Fee", desc: "Player pays a fixed amount per match; the club sponsors the rest." },
  { value: "percentage", label: "Percentage Discount", desc: "Player gets a % discount on the match fee; the discount is club sponsorship." },
  { value: "sponsored", label: "Club Sponsored", desc: "Player pays nothing; the club sponsors the full match fee." },
  { value: "monthly", label: "Monthly Subscription", desc: "Player pays a subscription per period; it is allocated across matches." },
];

export const PLAN_TYPE_LABEL: Record<string, string> = {
  regular: "Regular",
  fixed: "Fixed Fee",
  percentage: "Percentage Discount",
  sponsored: "Club Sponsored",
  monthly: "Monthly Subscription",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDateKey = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v);

// ── Plans ────────────────────────────────────────────────────────────────────

/** Validation for plan configuration; returns a message or null. */
export function validatePlanConfig(p: Partial<FeePlan>): string | null {
  if (!p.name || !String(p.name).trim()) return "Give the plan a name.";
  if (String(p.name).trim().length > 80) return "Plan name must be 80 characters or fewer.";
  const t = p.type;
  if (!t || !["fixed", "monthly", "sponsored", "percentage"].includes(t)) return "Choose a plan type.";
  const nonNeg = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (t === "fixed" && !nonNeg(p.feeAmount)) return "Fixed fee must be zero or more.";
  if (t === "percentage") {
    if (!(typeof p.discountPct === "number" && Number.isFinite(p.discountPct) && p.discountPct >= 0 && p.discountPct <= 100)) {
      return "Discount must be between 0 and 100%.";
    }
  }
  if (t === "monthly") {
    if (!nonNeg(p.monthlyAmount)) return "Subscription amount must be zero or more.";
    if (p.allocationPolicy !== "fixed_per_match" && p.allocationPolicy !== "distribute") {
      return "Choose how the subscription is allocated to matches.";
    }
    if (p.allocationPolicy === "fixed_per_match" && !nonNeg(p.perMatchContribution)) {
      return "Enter the contribution allocated per match.";
    }
  }
  if (p.validFrom && !isDateKey(p.validFrom)) return "Valid-from date is invalid.";
  if (p.validTo && !isDateKey(p.validTo)) return "Valid-to date is invalid.";
  if (p.validFrom && p.validTo && p.validTo < p.validFrom) return "Valid-to must be on or after valid-from.";
  return null;
}

/** One-line summary of a plan's financial configuration. */
export function describePlan(p: Pick<FeePlan, "type" | "feeAmount" | "monthlyAmount" | "discountPct" | "allocationPolicy" | "perMatchContribution">): string {
  const inr = (n?: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
  switch (p.type) {
    case "fixed":
      return `${inr(p.feeAmount)} per match`;
    case "percentage":
      return `${Number(p.discountPct) || 0}% off the match fee`;
    case "sponsored":
      return "₹0 — club pays the full fee";
    case "monthly":
      return p.allocationPolicy === "distribute"
        ? `${inr(p.monthlyAmount)} per period · spread across matches played`
        : p.allocationPolicy === "fixed_per_match"
          ? `${inr(p.monthlyAmount)} per period · ${inr(p.perMatchContribution)} allocated per match`
          : `${inr(p.monthlyAmount)} per period`;
    default:
      return "";
  }
}

export interface PlanContribution {
  /** Amount the player is expected to pay for the match. */
  contribution: number;
  /** Amount the club covers (actual fee − contribution). */
  sponsorship: number;
  /** Set when the plan could not be applied as configured (surfaced, not silent). */
  warning?: string;
  /** monthly "distribute": the per-match amount is settled when the period closes. */
  pendingAllocation?: boolean;
}

/**
 * Player contribution and club sponsorship for one match.
 * Contribution is clamped to [0, actual fee], so sponsorship is never
 * negative and the two always add up to the actual fee. A fixed or per-match
 * amount above the actual fee is charged at the actual fee (sponsorship ₹0)
 * and returned with a warning rather than creating a negative value.
 */
export function planContribution(plan: FeePlan | null | undefined, actualFee: number): PlanContribution {
  const fee = Math.max(0, Math.round(Number(actualFee) || 0));
  const clamp = (n: number, label: string): PlanContribution => {
    const c = Math.round(n);
    if (c > fee) {
      return { contribution: fee, sponsorship: 0, warning: `${label} (₹${c}) is above the match fee (₹${fee}); charged at the match fee.` };
    }
    const contribution = Math.max(0, c);
    return { contribution, sponsorship: fee - contribution };
  };
  if (!plan) return { contribution: fee, sponsorship: 0 };
  switch (plan.type) {
    case "fixed":
      return clamp(Number(plan.feeAmount) || 0, "Fixed fee");
    case "percentage": {
      const pct = Math.min(100, Math.max(0, Number(plan.discountPct) || 0));
      const discount = Math.round((fee * pct) / 100);
      return { contribution: fee - discount, sponsorship: discount };
    }
    case "sponsored":
      return { contribution: 0, sponsorship: fee };
    case "monthly":
      if (plan.allocationPolicy === "fixed_per_match") return clamp(Number(plan.perMatchContribution) || 0, "Per-match allocation");
      return { contribution: 0, sponsorship: 0, pendingAllocation: true };
    default:
      return { contribution: fee, sponsorship: 0 };
  }
}

// ── Assignments ──────────────────────────────────────────────────────────────

export type AssignmentStatus = "scheduled" | "active" | "ended" | "cancelled";

export function assignmentStatus(a: Pick<FinancePlanAssignment, "startDate" | "endDate" | "cancelled">, todayKey: string): AssignmentStatus {
  if (a.cancelled) return "cancelled";
  if (a.startDate && a.startDate > todayKey) return "scheduled";
  if (a.endDate && a.endDate < todayKey) return "ended";
  return "active";
}

/** Does the assignment cover this calendar date? (inclusive; legacy start = always) */
export function coversDate(a: Pick<FinancePlanAssignment, "startDate" | "endDate" | "cancelled">, dateKey: string): boolean {
  if (a.cancelled) return false;
  if (a.startDate && dateKey < a.startDate) return false;
  if (a.endDate && dateKey > a.endDate) return false;
  return true;
}

/** Inclusive ranges overlap? null start = −∞, null end = +∞. Cancelled never overlaps. */
export function rangesOverlap(
  a: Pick<FinancePlanAssignment, "startDate" | "endDate" | "cancelled">,
  b: Pick<FinancePlanAssignment, "startDate" | "endDate" | "cancelled">,
): boolean {
  if (a.cancelled || b.cancelled) return false;
  const aStart = a.startDate || "0000-00-00";
  const bStart = b.startDate || "0000-00-00";
  const aEnd = a.endDate || "9999-12-31";
  const bEnd = b.endDate || "9999-12-31";
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Legacy plan ids on `player.feePlanIds` as pseudo-assignments (open-ended,
 * no recorded start) so they are visible and take part in conflict checks.
 */
export function legacyAssignmentsFor(
  player: { id: string; feePlanIds?: string[] },
  plans: Pick<FeePlan, "id" | "name">[],
): FinancePlanAssignment[] {
  return (player.feePlanIds || []).map((planId) => ({
    id: `legacy:${player.id}:${planId}`,
    playerId: player.id,
    planId,
    planName: plans.find((p) => p.id === planId)?.name || "Unknown plan",
    startDate: null,
    endDate: null,
    legacy: true,
  }));
}

/** The assignment in effect for a player on a calendar date (match date), if any. */
export function assignmentOn(assignments: FinancePlanAssignment[], playerId: string, dateKey: string): FinancePlanAssignment | null {
  const hits = assignments.filter((a) => a.playerId === playerId && coversDate(a, dateKey));
  // Conflicts are blocked on write; if old data still has two, prefer a dated
  // assignment over a legacy one, then the most recent start.
  hits.sort((x, y) => Number(!!x.legacy) - Number(!!y.legacy) || String(y.startDate || "").localeCompare(String(x.startDate || "")));
  return hits[0] || null;
}

/** First existing assignment for the player that the proposed range overlaps. */
export function findConflict(
  existing: FinancePlanAssignment[],
  proposal: { playerId: string; startDate: string; endDate: string | null },
  excludeId?: string,
): FinancePlanAssignment | null {
  return (
    existing.find(
      (a) => a.playerId === proposal.playerId && a.id !== excludeId && rangesOverlap(a, { ...proposal, cancelled: false }),
    ) || null
  );
}

/** Validates a proposed assignment range against itself and the plan's validity window. */
export function validateAssignmentRange(
  startDate: unknown,
  endDate: unknown,
  plan: Pick<FeePlan, "validFrom" | "validTo" | "isActive" | "name">,
): string | null {
  if (!isDateKey(startDate)) return "Choose a valid start date.";
  if (endDate !== null && endDate !== undefined && endDate !== "" && !isDateKey(endDate)) return "End date is invalid.";
  const end = endDate ? String(endDate) : null;
  if (end && end < startDate) return "End date must be on or after the start date.";
  if (plan.isActive === false) return `${plan.name} is inactive; reactivate it before assigning players.`;
  if (plan.validFrom && startDate < plan.validFrom) return `${plan.name} is only valid from ${plan.validFrom}.`;
  if (plan.validTo) {
    if (startDate > plan.validTo) return `${plan.name} is only valid until ${plan.validTo}.`;
    if (!end || end > plan.validTo) return `${plan.name} is only valid until ${plan.validTo}; set an end date on or before it.`;
  }
  return null;
}

export function conflictMessage(playerName: string, conflict: FinancePlanAssignment): string {
  const range = conflict.legacy
    ? "with no end date (legacy assignment)"
    : `from ${conflict.startDate || "the start"} ${conflict.endDate ? `to ${conflict.endDate}` : "with no end date"}`;
  return `${playerName} is already on ${conflict.planName} ${range}. End that assignment first.`;
}
