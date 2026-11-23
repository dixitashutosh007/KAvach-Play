/**
 * Monthly Subscription periods and sponsorship reporting
 * (`lib/subscription-periods.ts`). Pure — shared by the server API and UI.
 *
 * Owner decisions (D3, approved):
 *  - One period per player per calendar month while they hold a Monthly
 *    Subscription assignment; the full plan amount is due (no proration).
 *  - A month with no matches still owes the subscription.
 *  - No carry-forward: whatever is not allocated to matches when the period
 *    closes is club income for that period.
 *  - Finance / Super Admins may edit a period's validity (end date) with a
 *    reason, until the period is closed. Refunds are a separate process.
 *
 * Allocation when a period closes (subscription money counted ONCE):
 *  - distribute       subscription split evenly over the matches played,
 *                     capped at each match fee; leftover rupees go to the
 *                     earliest matches.
 *  - fixed_per_match  each match takes the per-match amount (capped at its
 *                     fee) in date order until the subscription runs out.
 *  Any part of a match fee not covered is club sponsorship.
 */
import type { FeePlan, FinancePlanAssignment } from "@/lib/types";

export type SubscriptionMethod = "cash" | "upi" | "bank";

export interface SubscriptionPeriod {
  id: string;
  playerId: string;
  playerName: string;
  planId: string;
  planName: string;
  assignmentId: string | null;
  /** "YYYY-MM" the period was created for. */
  month: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  allocationPolicy: "fixed_per_match" | "distribute";
  perMatchContribution: number | null;
  status: "due" | "paid";
  paidAmount?: number;
  paidMethod?: SubscriptionMethod;
  paidNote?: string;
  paidByName?: string;
  paidAt?: unknown;
  closed?: boolean;
  settlement?: PeriodSettlement;
  validityEdits?: { from: string; to: string; reason: string; byName: string; at: string }[];
  paymentHistory?: { action: "paid" | "voided"; amount: number; method?: string; reason?: string; byName: string; at: string }[];
}

export interface PeriodMatchItem {
  matchId: string;
  paymentId: string;
  date: string;
  fee: number;
  opponent?: string;
}

export interface PeriodAllocation extends PeriodMatchItem {
  allocated: number;
  sponsorship: number;
}

export interface PeriodSettlement {
  allocations: PeriodAllocation[];
  allocatedTotal: number;
  sponsorshipTotal: number;
  /** Subscription not used by matches — club income, never carried forward. */
  unused: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
export const isMonthKey = (v: unknown): v is string => typeof v === "string" && MONTH_RE.test(v);

export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

export const periodId = (playerId: string, planId: string, month: string) => `${playerId}_${planId}_${month}`;

/**
 * Periods to create for a month: one per player per Monthly Subscription
 * assignment overlapping the month (dated assignments only), skipping ones
 * that already exist. The period runs within the month while the assignment
 * covers it; the full amount is due (no proration).
 */
export function periodsForMonth({
  month,
  plans,
  assignments,
  existingIds,
  playerNames,
}: {
  month: string;
  plans: FeePlan[];
  assignments: FinancePlanAssignment[];
  existingIds: Set<string>;
  playerNames: Record<string, string>;
}): SubscriptionPeriod[] {
  const { start, end } = monthBounds(month);
  const out: SubscriptionPeriod[] = [];
  for (const a of assignments) {
    if (a.cancelled || a.legacy) continue;
    const plan = plans.find((p) => p.id === a.planId);
    if (!plan || plan.type !== "monthly") continue;
    const aStart = a.startDate || start;
    const aEnd = a.endDate || end;
    if (aStart > end || aEnd < start) continue;
    const id = periodId(a.playerId, plan.id, month);
    if (existingIds.has(id) || out.some((p) => p.id === id)) continue;
    out.push({
      id,
      playerId: a.playerId,
      playerName: playerNames[a.playerId] || "Player",
      planId: plan.id,
      planName: plan.name,
      assignmentId: a.id,
      month,
      periodStart: aStart > start ? aStart : start,
      periodEnd: aEnd < end ? aEnd : end,
      amount: Math.max(0, Math.round(Number(plan.monthlyAmount) || 0)),
      allocationPolicy: plan.allocationPolicy === "fixed_per_match" ? "fixed_per_match" : "distribute",
      perMatchContribution: plan.allocationPolicy === "fixed_per_match" ? Math.max(0, Math.round(Number(plan.perMatchContribution) || 0)) : null,
      status: "due",
    });
  }
  return out.sort((x, y) => x.playerName.localeCompare(y.playerName));
}

/** Validity (end date) edit: message or null. Same player + plan periods must not overlap. */
export function validateValidityEdit(
  period: Pick<SubscriptionPeriod, "id" | "playerId" | "planId" | "periodStart" | "periodEnd" | "closed">,
  newEnd: unknown,
  others: Pick<SubscriptionPeriod, "id" | "playerId" | "planId" | "periodStart" | "periodEnd">[],
): string | null {
  if (period.closed) return "This period is closed; its validity can no longer change.";
  if (typeof newEnd !== "string" || !DATE_RE.test(newEnd)) return "Choose a valid end date.";
  if (newEnd < period.periodStart) return "The end date can't be before the period starts.";
  if (newEnd === period.periodEnd) return "That is already the end date.";
  const clash = others.find(
    (o) => o.id !== period.id && o.playerId === period.playerId && o.planId === period.planId && o.periodStart <= newEnd && period.periodStart <= o.periodEnd,
  );
  if (clash) return `That would overlap the ${clash.periodStart} to ${clash.periodEnd} period.`;
  return null;
}

/** Allocates the subscription to the matches played in the period. */
export function settlePeriod(
  period: Pick<SubscriptionPeriod, "amount" | "allocationPolicy" | "perMatchContribution">,
  items: PeriodMatchItem[],
): PeriodSettlement {
  const amount = Math.max(0, Math.round(Number(period.amount) || 0));
  const sorted = [...items]
    .map((i) => ({ ...i, fee: Math.max(0, Math.round(Number(i.fee) || 0)) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.matchId.localeCompare(b.matchId));
  const alloc: number[] = sorted.map(() => 0);

  if (period.allocationPolicy === "fixed_per_match") {
    let left = amount;
    const per = Math.max(0, Math.round(Number(period.perMatchContribution) || 0));
    sorted.forEach((m, i) => {
      const take = Math.min(per, m.fee, left);
      alloc[i] = take;
      left -= take;
    });
  } else if (sorted.length) {
    // Even split, leftover rupees to the earliest matches; then capped at each
    // fee, with any excess re-offered to matches that still have room.
    let left = amount;
    let open = sorted.map((_, i) => i);
    while (left > 0 && open.length) {
      const share = Math.floor(left / open.length);
      let extra = left - share * open.length;
      let moved = 0;
      for (const i of open) {
        const want = share + (extra > 0 ? 1 : 0);
        if (extra > 0) extra -= 1;
        const take = Math.min(want, sorted[i].fee - alloc[i]);
        alloc[i] += take;
        moved += take;
      }
      left -= moved;
      open = open.filter((i) => alloc[i] < sorted[i].fee);
      if (moved === 0) break;
    }
  }

  const allocations = sorted.map((m, i) => ({ ...m, allocated: alloc[i], sponsorship: m.fee - alloc[i] }));
  const allocatedTotal = allocations.reduce((s, a) => s + a.allocated, 0);
  return {
    allocations,
    allocatedTotal,
    sponsorshipTotal: allocations.reduce((s, a) => s + a.sponsorship, 0),
    unused: amount - allocatedTotal,
  };
}

// ── Sponsorship report ───────────────────────────────────────────────────────

export interface ReportPayment {
  matchId: string;
  playerId: string;
  playerName: string;
  status: string;
  guestName?: string;
  feeOverride?: number;
  feeOffsetAmount?: number;
  feeCollectedAmount?: number;
  manualMethod?: string;
  planTag?: string;
  financeSnapshot?: { planId?: string | null; planName?: string; planType?: string; source?: string; pendingAllocation?: boolean; periodId?: string };
}

export interface ReportMatch {
  id: string;
  date: string;
  opponent?: string;
  fee: number;
  result?: string;
}

interface Bucket {
  key: string;
  label: string;
  matchFees: number;
  playerShare: number;
  subscriptionCovered: number;
  clubSponsored: number;
  pending: number;
  count: number;
}

export interface SponsorshipReport {
  from: string;
  to: string;
  totals: {
    matches: number;
    players: number;
    matchFees: number;
    /** Owed / paid by players directly for these matches (not subscriptions). */
    playerShare: number;
    /** Covered by subscription allocations (non-cash at match level). */
    subscriptionCovered: number;
    clubSponsored: number;
    /** Subscription-plan matches whose allocation is settled when the period closes. */
    pendingAllocation: number;
  };
  subscriptions: { periods: number; billed: number; collected: number; outstanding: number; unusedIncome: number; openPeriods: number };
  byPlan: Bucket[];
  byPlayer: Bucket[];
  byMatch: Bucket[];
}

/**
 * Sponsorship and subscription report for matches dated in [from, to].
 * Cash is counted once: subscriptions at the period (collected), match-level
 * subscription allocations only as "covered", never again as collected.
 * Abandoned matches and Not Playing / Waived rows are excluded.
 */
export function buildSponsorshipReport({
  from,
  to,
  matches,
  payments,
  periods,
}: {
  from: string;
  to: string;
  matches: ReportMatch[];
  payments: ReportPayment[];
  periods: Pick<SubscriptionPeriod, "periodStart" | "periodEnd" | "amount" | "status" | "paidAmount" | "closed" | "settlement">[];
}): SponsorshipReport {
  const inRange = matches.filter((m) => m.date >= from && m.date <= to && m.result !== "Abandoned");
  const byId = new Map(inRange.map((m) => [m.id, m]));
  const plan = new Map<string, Bucket>();
  const player = new Map<string, Bucket>();
  const match = new Map<string, Bucket>();
  const bucket = (map: Map<string, Bucket>, key: string, label: string) => {
    let b = map.get(key);
    if (!b) map.set(key, (b = { key, label, matchFees: 0, playerShare: 0, subscriptionCovered: 0, clubSponsored: 0, pending: 0, count: 0 }));
    return b;
  };
  const totals = { matches: inRange.length, players: 0, matchFees: 0, playerShare: 0, subscriptionCovered: 0, clubSponsored: 0, pendingAllocation: 0 };
  const seenPlayers = new Set<string>();

  for (const p of payments) {
    const m = byId.get(p.matchId);
    if (!m || p.status === "Not Playing" || p.status === "Waived") continue;
    const fee = Math.max(0, Math.round(Number(m.fee) || 0));
    const snap = p.financeSnapshot;
    let playerShare = 0;
    let covered = 0;
    let club = 0;
    let pending = 0;
    if (p.manualMethod === "part_of_plan") {
      if (snap?.pendingAllocation) pending = 1;
      covered = Number(p.feeCollectedAmount) || 0;
      club = Number(p.feeOffsetAmount) || 0;
    } else if (p.manualMethod === "club_sponsored") {
      club = p.feeOffsetAmount !== undefined ? Number(p.feeOffsetAmount) || 0 : fee;
    } else {
      const own = p.feeOverride !== undefined ? Number(p.feeOverride) || 0 : fee;
      playerShare = own;
      club = p.feeOffsetAmount !== undefined ? Number(p.feeOffsetAmount) || 0 : Math.max(0, fee - own);
    }
    const planLabel = snap?.source === "override" ? "Overrides" : snap?.planName || p.planTag?.replace(/ \(Subscription\)$/, "") || "Regular";
    const planKey = snap?.source === "override" ? "override" : snap?.planId || (p.planTag ? `tag:${planLabel}` : "regular");
    const rows: Bucket[] = [
      bucket(plan, planKey, planLabel),
      bucket(player, p.guestName ? `guest:${p.guestName}` : p.playerId, p.guestName ? `${p.guestName} (guest)` : p.playerName),
      bucket(match, m.id, `${m.date} · vs ${m.opponent || "Match"}`),
    ];
    for (const b of rows) {
      b.matchFees += fee;
      b.playerShare += playerShare;
      b.subscriptionCovered += covered;
      b.clubSponsored += club;
      b.pending += pending;
      b.count += 1;
    }
    totals.matchFees += fee;
    totals.playerShare += playerShare;
    totals.subscriptionCovered += covered;
    totals.clubSponsored += club;
    totals.pendingAllocation += pending;
    if (!p.guestName) seenPlayers.add(p.playerId);
  }
  totals.players = seenPlayers.size;

  const subs = { periods: 0, billed: 0, collected: 0, outstanding: 0, unusedIncome: 0, openPeriods: 0 };
  for (const s of periods) {
    if (s.periodEnd < from || s.periodStart > to) continue;
    subs.periods += 1;
    subs.billed += s.amount;
    if (s.status === "paid") subs.collected += Number(s.paidAmount ?? s.amount) || 0;
    else subs.outstanding += s.amount;
    if (s.closed) subs.unusedIncome += s.settlement?.unused || 0;
    else subs.openPeriods += 1;
  }

  const sortB = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => b.clubSponsored - a.clubSponsored || a.label.localeCompare(b.label));
  return {
    from,
    to,
    totals,
    subscriptions: subs,
    byPlan: sortB(plan),
    byPlayer: sortB(player),
    byMatch: [...match.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}
