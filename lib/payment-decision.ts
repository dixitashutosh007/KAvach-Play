/**
 * B2: obligation-level payment decision (pure; no Firestore access).
 *
 * Implements the right-sized architecture (docs/implementation/R4_RIGHT_SIZED_ARCHITECTURE_PROPOSAL.md,
 * revision 3): rules P1–P7 (§3.3), the canonical obligation state table (§15), the Studio renewal
 * rules (§16) and the interim late-fee guard (§18). The webhook transaction reads every document,
 * this module classifies and decides, and the transaction then performs exactly one write set.
 *
 * P4 (orphan-order adoption) is B7 and is not implemented here: an intent without an order id is
 * UNMATCHED, as before B2.
 */

export type ObligationClass =
  | "PAYABLE"
  | "SETTLED"
  | "NOT_DUE"
  | "CHANGED"
  | "MISSING"
  | "CONFLICT"
  | "UNCLASSIFIABLE";

/** Reason codes recorded on gatewayPayments and webhookDeadLetters. */
export type ObligationReason =
  | "OK"
  | "OBLIGATION_SETTLED"
  | "OBLIGATION_NOT_DUE"
  | "OBLIGATION_CHANGED"
  | "OBLIGATION_MISSING"
  | "OBLIGATION_CONFLICT"
  | "OBLIGATION_UNCLASSIFIABLE"
  | "LATE_FEE_ALREADY_RECORDED"
  | "MERCH_ORDER_EXISTS"
  | "RENEWAL_ALREADY_SETTLED"
  | "RENEWAL_BASIS_CHANGED"
  | "RENEWAL_LEGACY_SUPERSEDED";

export type ObligationKind = "match_fee" | "other_fee" | "late_fee" | "merch_order" | "merch_shop" | "studio_renewal";

export interface ObligationAssessment {
  key: string;
  kind: ObligationKind;
  path?: string;
  amountPaise: number;
  cls: ObligationClass;
  reason: ObligationReason;
}

export const toPaise = (rupees: unknown): number => {
  const n = Number(rupees);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

/** Razorpay payment ids are `pay_` + alphanumerics; anything else cannot key a registry record. */
export function isUsablePaymentId(id: unknown): id is string {
  return typeof id === "string" && /^pay_[A-Za-z0-9_-]{1,100}$/.test(id);
}

function assess(
  base: Omit<ObligationAssessment, "cls" | "reason">,
  cls: ObligationClass,
  reason: ObligationReason,
): ObligationAssessment {
  return { ...base, cls, reason };
}

const isAbandonedMatch = (m: any): boolean =>
  m?.abandoned === true || m?.status === "abandoned" || m?.result === "Abandoned";

/** §15 match fee. `snapshotPaise` is the fee the payer was charged at order time. */
export function classifyMatchFee(input: {
  key: string;
  path: string;
  snapshotPaise: number;
  intentPlayerId: string | null;
  payment: any | null;
  paymentPlayerId: string | null;
  match: any | null;
}): ObligationAssessment {
  const base = { key: input.key, kind: "match_fee" as const, path: input.path, amountPaise: input.snapshotPaise };
  const p = input.payment;
  if (!p || !input.match) return assess(base, "MISSING", "OBLIGATION_MISSING");
  if (!input.intentPlayerId || input.paymentPlayerId !== input.intentPlayerId) {
    return assess(base, "CONFLICT", "OBLIGATION_CONFLICT");
  }
  if (isAbandonedMatch(input.match)) return assess(base, "NOT_DUE", "OBLIGATION_NOT_DUE");
  if (p.status === "Paid") return assess(base, "SETTLED", "OBLIGATION_SETTLED");
  if (p.sponsoredBy || ["club_sponsored", "part_of_plan"].includes(p.manualMethod)) {
    return assess(base, "SETTLED", "OBLIGATION_SETTLED");
  }
  if (p.status === "Waived" || p.status === "Not Playing" || p.feeOverride === 0) {
    return assess(base, "NOT_DUE", "OBLIGATION_NOT_DUE");
  }
  const fee = p.feeOverride !== undefined ? Number(p.feeOverride) : Number(input.match.fee || 0);
  if (!Number.isFinite(input.snapshotPaise) || toPaise(Math.max(fee, 0)) !== input.snapshotPaise) {
    return assess(base, "CHANGED", "OBLIGATION_CHANGED");
  }
  if ((p.status === "Unpaid" || p.status === "Failed") && !p.razorpayPaymentId) {
    return assess(base, "PAYABLE", "OK");
  }
  return assess(base, "UNCLASSIFIABLE", "OBLIGATION_UNCLASSIFIABLE");
}

/** §15 other fee (non-late-fee). */
export function classifyOtherFee(input: { key: string; path: string; snapshotPaise: number; fee: any | null }): ObligationAssessment {
  const base = { key: input.key, kind: "other_fee" as const, path: input.path, amountPaise: input.snapshotPaise };
  const f = input.fee;
  if (!f) return assess(base, "MISSING", "OBLIGATION_MISSING");
  if (f.status === "Paid") return assess(base, "SETTLED", "OBLIGATION_SETTLED");
  if (f.status === "Waived" || f.status === "Cancelled") return assess(base, "NOT_DUE", "OBLIGATION_NOT_DUE");
  if (!Number.isFinite(input.snapshotPaise) || toPaise(f.amount) !== input.snapshotPaise) {
    return assess(base, "CHANGED", "OBLIGATION_CHANGED");
  }
  if ((f.status === "Unpaid" || f.status === "Failed" || f.status === undefined) && !f.razorpayPaymentId) {
    return assess(base, "PAYABLE", "OK");
  }
  return assess(base, "UNCLASSIFIABLE", "OBLIGATION_UNCLASSIFIABLE");
}

/** §15 merchandise order paid through the dues bundle (existing merchOrders document). */
export function classifyMerchDuesOrder(input: {
  key: string;
  path: string;
  snapshotPaise: number;
  order: any | null;
  orderPlayerId: string | null;
  intentPlayerId: string | null;
}): ObligationAssessment {
  const base = { key: input.key, kind: "merch_order" as const, path: input.path, amountPaise: input.snapshotPaise };
  const o = input.order;
  if (!o) return assess(base, "MISSING", "OBLIGATION_MISSING");
  if (!input.intentPlayerId || input.orderPlayerId !== input.intentPlayerId) {
    return assess(base, "CONFLICT", "OBLIGATION_CONFLICT");
  }
  if (o.paymentStatus === "Paid") return assess(base, "SETTLED", "OBLIGATION_SETTLED");
  if (!Number.isFinite(input.snapshotPaise) || toPaise(o.price) !== input.snapshotPaise) {
    return assess(base, "CHANGED", "OBLIGATION_CHANGED");
  }
  if ((o.paymentStatus === "Unpaid" || o.paymentStatus === "Failed") && !o.razorpayPaymentId) {
    return assess(base, "PAYABLE", "OK");
  }
  return assess(base, "UNCLASSIFIABLE", "OBLIGATION_UNCLASSIFIABLE");
}

/** §15 shop purchase: the server-controlled order mo_{intentId} (B1). */
export function classifyMerchShop(input: { key: string; path: string; snapshotPaise: number; exists: boolean }): ObligationAssessment {
  const base = { key: input.key, kind: "merch_shop" as const, path: input.path, amountPaise: input.snapshotPaise };
  return input.exists ? assess(base, "SETTLED", "MERCH_ORDER_EXISTS") : assess(base, "PAYABLE", "OK");
}

// ── Late fees: interim guard (§18) until B3 introduces the weekly identity ──

/** Same predicate the Finance and Dues screens use to treat a match's late fee as recorded. */
export function isRecordedLateFee(fee: any, matchId: string): boolean {
  if (!fee || fee.status === "Cancelled") return false;
  const title = typeof fee.title === "string" ? fee.title : "";
  const comment = typeof fee.comment === "string" ? fee.comment : "";
  const templateId = typeof fee.templateId === "string" ? fee.templateId : "";
  if (title.startsWith("Late Fee Exemption:")) return false;
  return (
    (title.startsWith("Late Fee") && (title.includes(matchId) || comment.includes(matchId))) ||
    templateId.includes(`latefee_${matchId}`)
  );
}

export function isLateFeeExemption(fee: any, matchId: string): boolean {
  if (!fee || fee.status === "Cancelled") return false;
  const title = typeof fee.title === "string" ? fee.title : "";
  return title.startsWith("Late Fee Exemption:") && title.includes(matchId);
}

/**
 * §18 interim guard: a late fee for (player, match) is payable only while nothing is recorded for
 * that pair. Anything recorded holds the payment for Finance (identity is not yet per week).
 */
export function classifyLateFeeInterim(input: {
  key: string;
  matchId: string;
  snapshotPaise: number;
  match: any | null;
  playerFees: any[];
}): ObligationAssessment {
  const base = { key: input.key, kind: "late_fee" as const, amountPaise: input.snapshotPaise };
  if (!input.match) return assess(base, "MISSING", "OBLIGATION_MISSING");
  if (isAbandonedMatch(input.match)) return assess(base, "NOT_DUE", "OBLIGATION_NOT_DUE");
  if (input.playerFees.some((f) => isLateFeeExemption(f, input.matchId))) {
    return assess(base, "NOT_DUE", "OBLIGATION_NOT_DUE");
  }
  if (input.playerFees.some((f) => isRecordedLateFee(f, input.matchId))) {
    return assess(base, "UNCLASSIFIABLE", "LATE_FEE_ALREADY_RECORDED");
  }
  if (!Number.isFinite(input.snapshotPaise) || input.snapshotPaise <= 0) {
    return assess(base, "UNCLASSIFIABLE", "OBLIGATION_UNCLASSIFIABLE");
  }
  return assess(base, "PAYABLE", "OK");
}

// ── Studio renewal (§16) ──

export const RENEWAL_BASIS_NONE = "NONE";

/** Parses a stored expiry ("YYYY-MM-DD" or "DD/MM/YYYY") to a UTC day number. */
export function expiryToDayNumber(raw: string): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim();
  let y: number, m: number, d: number;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    [y, m, d] = s.split("-").map(Number);
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    [d, m, y] = s.split("/").map(Number);
  } else {
    return null;
  }
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86400000);
}

export function dayNumberToYmd(day: number): string {
  const dt = new Date(day * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** The stored expiry used as renewal basis: studioExpiryDate, else studioEndDate, else NONE. */
export function currentExpiryOf(doc: any): string {
  const v = doc?.studioExpiryDate || doc?.studioEndDate;
  return typeof v === "string" && v.trim() ? v.trim() : RENEWAL_BASIS_NONE;
}

export interface RenewalComputation {
  assessment: ObligationAssessment;
  newExpiry?: string;
}

/**
 * §16: renewal of exactly the snapshot basis. Applies only if the anchor for this basis does not
 * exist and the stored expiry still equals the basis (compare-and-set inside the transaction).
 * start = max(basis, club today); newExpiry = start + durationDays; the expiry never shrinks.
 */
export function assessRenewal(input: {
  key: string;
  path: string;
  snapshotPaise: number;
  subjectExists: boolean;
  anchorExists: boolean;
  basisExpiry: string;
  currentExpiry: string;
  durationDays: number;
  clubTodayYmd: string;
  legacySuperseded?: boolean;
}): RenewalComputation {
  const base = { key: input.key, kind: "studio_renewal" as const, path: input.path, amountPaise: input.snapshotPaise };
  if (!input.subjectExists) return { assessment: assess(base, "MISSING", "OBLIGATION_MISSING") };
  if (input.anchorExists) return { assessment: assess(base, "SETTLED", "RENEWAL_ALREADY_SETTLED") };
  if (input.legacySuperseded) return { assessment: assess(base, "CHANGED", "RENEWAL_LEGACY_SUPERSEDED") };
  if (input.currentExpiry !== input.basisExpiry) return { assessment: assess(base, "CHANGED", "RENEWAL_BASIS_CHANGED") };

  const today = expiryToDayNumber(input.clubTodayYmd);
  const duration = Number(input.durationDays);
  if (today === null || !Number.isInteger(duration) || duration <= 0) {
    return { assessment: assess(base, "UNCLASSIFIABLE", "OBLIGATION_UNCLASSIFIABLE") };
  }
  let basisDay: number | null = null;
  if (input.basisExpiry !== RENEWAL_BASIS_NONE) {
    basisDay = expiryToDayNumber(input.basisExpiry);
    if (basisDay === null) return { assessment: assess(base, "UNCLASSIFIABLE", "OBLIGATION_UNCLASSIFIABLE") };
  }
  const start = basisDay !== null && basisDay > today ? basisDay : today;
  const end = start + duration;
  if (basisDay !== null && end <= basisDay) {
    return { assessment: assess(base, "UNCLASSIFIABLE", "OBLIGATION_UNCLASSIFIABLE") };
  }
  return { assessment: assess(base, "PAYABLE", "OK"), newExpiry: dayNumberToYmd(end) };
}

// ── Bundle rule and decision (P1–P7) ──

export type BundleResult =
  | { kind: "APPLY" }
  | { kind: "DUPLICATE"; reason: ObligationReason }
  | { kind: "HOLD"; reason: ObligationReason };

/** All PAYABLE → APPLY; every non-payable SETTLED → DUPLICATE; otherwise HOLD. Empty → HOLD. */
export function bundleOutcome(assessments: ObligationAssessment[]): BundleResult {
  if (assessments.length === 0) return { kind: "HOLD", reason: "OBLIGATION_UNCLASSIFIABLE" };
  const blocked = assessments.filter((a) => a.cls !== "PAYABLE");
  if (blocked.length === 0) return { kind: "APPLY" };
  if (blocked.every((a) => a.cls === "SETTLED")) return { kind: "DUPLICATE", reason: blocked[0].reason };
  const firstHold = blocked.find((a) => a.cls !== "SETTLED")!;
  return { kind: "HOLD", reason: firstHold.reason };
}

export interface PaymentIdentity {
  paymentId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  intentId: string;
}

export function sameIdentity(recorded: any, event: PaymentIdentity): boolean {
  return (
    recorded?.paymentId === event.paymentId &&
    recorded?.orderId === event.orderId &&
    recorded?.amountPaise === event.amountPaise &&
    recorded?.currency === event.currency &&
    (recorded?.intentId || "") === (event.intentId || "")
  );
}

/** Intent statuses that mean a first captured payment is already recorded for the intent. */
export const INTENT_FIRST_PAYMENT_STATUSES = ["paid", "paid_unapplied", "exception"];

/** Any other status (pending, created, legacy values) means no payment has been recorded yet. */
export function intentHasFirstPayment(intent: any): boolean {
  return INTENT_FIRST_PAYMENT_STATUSES.includes(intent?.status);
}

export type PaymentDecision =
  | { kind: "NO_PAYMENT_ID"; reason: string }
  | { kind: "REPLAY"; backfill: boolean }
  | { kind: "IDENTITY_CONFLICT"; reason: "PAYMENT_IDENTITY_CONFLICT" }
  | { kind: "UNMATCHED"; reason: string }
  | { kind: "DUPLICATE"; reason: string }
  | { kind: "HOLD"; reason: string }
  | { kind: "APPLY" };

/**
 * P1–P7 in order. `validation` is the existing order / amount / currency / payment-id check of the
 * event against the intent (validateWebhookTransaction). `assessments` are only consulted when the
 * intent is still pending and the event is valid.
 */
export function decidePaymentApplication(input: {
  event: PaymentIdentity;
  paymentIdUsable: boolean;
  existingPayment: any | null;
  intent: any | null;
  hasIntentId: boolean;
  validation: { ok: boolean; reason?: string };
  holdReason?: string | null;
  assessments: ObligationAssessment[];
}): PaymentDecision {
  if (!input.paymentIdUsable) return { kind: "NO_PAYMENT_ID", reason: "PAYMENT_ID_INVALID" };

  // P1 / P2: an existing registry record for this payment id.
  if (input.existingPayment) {
    return sameIdentity(input.existingPayment, input.event)
      ? { kind: "REPLAY", backfill: false }
      : { kind: "IDENTITY_CONFLICT", reason: "PAYMENT_IDENTITY_CONFLICT" };
  }

  // P3: no intent.
  if (!input.intent) return { kind: "UNMATCHED", reason: input.hasIntentId ? "INTENT_NOT_FOUND" : "NO_INTENT_ID" };

  // P1 (cutover): a payment applied before B2 has no registry record; a redelivery is a replay.
  const hasFirstPayment = intentHasFirstPayment(input.intent);
  if (hasFirstPayment && input.intent.razorpayPaymentId === input.event.paymentId) {
    return input.validation.ok
      ? { kind: "REPLAY", backfill: true }
      : { kind: "IDENTITY_CONFLICT", reason: "PAYMENT_IDENTITY_CONFLICT" };
  }

  // P3: the event does not match the intent (order, amount, currency, partial payment).
  if (!input.validation.ok) return { kind: "UNMATCHED", reason: input.validation.reason || "INTENT_INVALID" };

  // P5: the intent already has a first payment.
  if (hasFirstPayment) return { kind: "DUPLICATE", reason: "CONFLICTING_PAYMENT" };

  // Data-integrity hold found while reading (e.g. invalid merge chain).
  if (input.holdReason) return { kind: "HOLD", reason: input.holdReason };

  // P6 / P7.
  const bundle = bundleOutcome(input.assessments);
  if (bundle.kind === "APPLY") return { kind: "APPLY" };
  return { kind: bundle.kind, reason: bundle.reason };
}
