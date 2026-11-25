import crypto from "crypto";
import { isValidIntentId, merchOrderIdForIntent } from "./merch-order-confirmation.ts";
import {
  assessRenewal,
  classifyLateFeeInterim,
  classifyMatchFee,
  classifyMerchDuesOrder,
  classifyMerchShop,
  classifyOtherFee,
  currentExpiryOf,
  decidePaymentApplication,
  intentHasFirstPayment,
  isUsablePaymentId,
  RENEWAL_BASIS_NONE,
  toPaise,
  type ObligationAssessment,
  type PaymentIdentity,
} from "./payment-decision.ts";
import { planWebhookDeadLetter } from "./webhook-dead-letter.ts";
import { getClubCalendarDate } from "./utils.ts";

export interface WebhookEventDetails {
  event: string;
  paymentId: string;
  orderId: string;
  capturedPaise: number;
  capturedCurrency: string;
  intentId: string;
  notes: Record<string, any>;
  isFullyPaid?: boolean;
}

/**
 * R3: webhook failure classification.
 *
 * Razorpay retries EVERY non-2xx response for 24 hours (exponential backoff) and may
 * disable the webhook if failures persist. So the HTTP status is chosen by what the
 * failure means, not by habit:
 *  - WebhookPermanentError: retrying cannot help (data does not match the intent).
 *    The event must be recorded for finance reconciliation and must never fulfil payment.
 *  - WebhookRetryableError: a known temporary state (e.g. player merge in progress).
 *  - Anything else (Firestore UNAVAILABLE / DEADLINE_EXCEEDED / ABORTED, network, unknown):
 *    treated as retryable. Processing is idempotent, so a retry is safe; dropping is not.
 */
export type WebhookPermanentReason =
  | "INTENT_NOT_FOUND"
  | "INTENT_INVALID"
  | "UNSUPPORTED_EVENT"
  | "ORDER_MISMATCH"
  | "PAYMENT_ID_INVALID"
  | "PARTIAL_PAYMENT"
  | "AMOUNT_INVALID"
  | "AMOUNT_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "CONFLICTING_PAYMENT"
  | "MERGE_CHAIN_INVALID"
  | "NO_INTENT_ID"
  | "MALFORMED_EVENT"
  | "MERCH_ORDER_EXISTS";

export type WebhookRetryableReason = "MERGE_IN_PROGRESS" | "INFRASTRUCTURE";

export class WebhookPermanentError extends Error {
  readonly reason: WebhookPermanentReason;
  constructor(reason: WebhookPermanentReason, message: string) {
    super(message);
    this.name = "WebhookPermanentError";
    this.reason = reason;
  }
}

export class WebhookRetryableError extends Error {
  readonly reason: WebhookRetryableReason;
  constructor(reason: WebhookRetryableReason, message: string) {
    super(message);
    this.name = "WebhookRetryableError";
    this.reason = reason;
  }
}

export type WebhookFailureClass =
  | { kind: "permanent"; reason: WebhookPermanentReason }
  | { kind: "retryable"; reason: WebhookRetryableReason };

/** Classifies any error thrown while processing a verified webhook event. Unknown → retryable. */
export function classifyWebhookError(err: unknown): WebhookFailureClass {
  if (err instanceof WebhookPermanentError) return { kind: "permanent", reason: err.reason };
  if (err instanceof WebhookRetryableError) return { kind: "retryable", reason: err.reason };
  return { kind: "retryable", reason: "INFRASTRUCTURE" };
}

/**
 * Extracts normalized transaction details from Razorpay webhook payload,
 * correctly handling event-specific structures for 'payment.captured' and 'order.paid'.
 */
export function extractWebhookEventDetails(payload: any): WebhookEventDetails | null {
  if (!payload || typeof payload !== "object") return null;

  const event = String(payload.event || "");
  // Strictly allow only supported Razorpay events
  if (event !== "payment.captured" && event !== "order.paid") {
    return null;
  }

  const paymentEntity = payload.payload?.payment?.entity;
  const orderEntity = payload.payload?.order?.entity;

  if (!paymentEntity && !orderEntity) return null;

  // Ensure paymentId and orderId are never confused (order.entity.id is ALWAYS orderId)
  let paymentId = "";
  if (paymentEntity?.id && String(paymentEntity.id).trim().startsWith("pay_")) {
    paymentId = String(paymentEntity.id).trim();
  } else if (orderEntity?.payment_id && String(orderEntity.payment_id).trim().startsWith("pay_")) {
    paymentId = String(orderEntity.payment_id).trim();
  } else if (Array.isArray(orderEntity?.payments) && orderEntity.payments.length > 0) {
    const p0 = orderEntity.payments[0];
    const pid = typeof p0 === "string" ? p0 : p0?.id;
    if (pid && String(pid).trim().startsWith("pay_")) {
      paymentId = String(pid).trim();
    }
  }

  let orderId = "";
  if (paymentEntity?.order_id && String(paymentEntity.order_id).trim().startsWith("order_")) {
    orderId = String(paymentEntity.order_id).trim();
  } else if (orderEntity?.id && String(orderEntity.id).trim().startsWith("order_")) {
    orderId = String(orderEntity.id).trim();
  }

  // Raw amount check - do NOT default to valid number if missing
  const rawAmount =
    event === "order.paid"
      ? (orderEntity?.amount_paid ?? orderEntity?.amount)
      : paymentEntity?.amount;

  const capturedPaise =
    rawAmount !== undefined && rawAmount !== null && !isNaN(Number(rawAmount))
      ? Number(rawAmount)
      : 0;

  // Strict currency extraction - do NOT default to "INR" if missing from payload
  const rawCurrency = paymentEntity?.currency || orderEntity?.currency;
  const capturedCurrency = rawCurrency ? String(rawCurrency).trim().toUpperCase() : "";

  const notes = paymentEntity?.notes || orderEntity?.notes || {};
  const intentId = String(notes.intentId || "").trim();

  // Validate full payment on order.paid
  let isFullyPaid = true;
  if (event === "order.paid" && orderEntity) {
    const totalAmount = Number(orderEntity.amount || 0);
    const paidAmount = Number(orderEntity.amount_paid || 0);
    const status = String(orderEntity.status || "").toLowerCase();
    if (paidAmount < totalAmount || (totalAmount > 0 && status !== "paid")) {
      isFullyPaid = false;
    }
  }

  return {
    event,
    paymentId,
    orderId,
    capturedPaise,
    capturedCurrency,
    intentId,
    notes,
    isFullyPaid,
  };
}

/**
 * Validates captured webhook details against the stored intent (FIN-003).
 */
export function validateWebhookTransaction(
  intent: any,
  details: WebhookEventDetails,
): { ok: boolean; error?: string; reason?: WebhookPermanentReason } {
  if (!intent) {
    return { ok: false, reason: "INTENT_NOT_FOUND", error: "Intent record is missing." };
  }

  // 1. Event verification
  if (details.event !== "payment.captured" && details.event !== "order.paid") {
    return { ok: false, reason: "UNSUPPORTED_EVENT", error: `Unsupported webhook event type: ${details.event}` };
  }

  // 2. Order ID verification (both MUST be present and match)
  if (!intent.orderId || typeof intent.orderId !== "string" || !intent.orderId.trim()) {
    return { ok: false, reason: "INTENT_INVALID", error: "Stored intent is missing a valid orderId." };
  }
  if (!details.orderId || typeof details.orderId !== "string" || !details.orderId.trim()) {
    return { ok: false, reason: "ORDER_MISMATCH", error: "Incoming webhook event is missing a valid orderId." };
  }
  if (details.orderId !== intent.orderId) {
    return {
      ok: false,
      reason: "ORDER_MISMATCH",
      error: `Order ID mismatch: expected ${intent.orderId}, received ${details.orderId}`,
    };
  }

  // 3. Mandatory Payment ID verification for BOTH events (payment.captured AND order.paid)
  // Prevents financial fulfilment without an authoritative payment identifier
  if (!details.paymentId || !details.paymentId.startsWith("pay_") || details.paymentId.trim() === "pay_") {
    return {
      ok: false,
      reason: "PAYMENT_ID_INVALID",
      error: `Missing or invalid payment ID (must start with 'pay_') for event '${details.event}'.`,
    };
  }

  // 4. Partial payment verification for order.paid
  if (details.event === "order.paid" && details.isFullyPaid === false) {
    return { ok: false, reason: "PARTIAL_PAYMENT", error: "Partial payment detected: order is not fully paid." };
  }

  // 5. Amount verification
  if (!details.capturedPaise || details.capturedPaise <= 0 || isNaN(details.capturedPaise)) {
    return { ok: false, reason: "AMOUNT_INVALID", error: "Missing or invalid captured amount." };
  }
  const expectedPaise = Math.round(Number(intent.amount) * 100);
  if (details.capturedPaise !== expectedPaise) {
    return {
      ok: false,
      reason: "AMOUNT_MISMATCH",
      error: `Amount mismatch: expected ${expectedPaise} paise, received ${details.capturedPaise} paise`,
    };
  }

  // 6. Currency verification (Strict: no silent defaulting on stored intent or payload)
  if (!intent.currency || typeof intent.currency !== "string" || !intent.currency.trim()) {
    return { ok: false, reason: "INTENT_INVALID", error: "Stored intent is missing a valid currency." };
  }
  if (!details.capturedCurrency) {
    return { ok: false, reason: "CURRENCY_MISMATCH", error: "Missing currency in webhook payload." };
  }
  const expectedCurrency = intent.currency.trim().toUpperCase();
  if (details.capturedCurrency !== expectedCurrency) {
    return {
      ok: false,
      reason: "CURRENCY_MISMATCH",
      error: `Currency mismatch: expected ${expectedCurrency}, received ${details.capturedCurrency}`,
    };
  }

  return { ok: true };
}

/** B1 (PX-1): order statuses the stored checkout payload may carry (MOQ display state only). */
const STORED_MERCH_ORDER_STATUSES = ["Awaiting Min Order Qnty", "Ready to Place Order", "Order Placed"];

/**
 * B1 (PX-1): copies only the allowlisted display fields from an intent's stored merchandise
 * payload. Never copies an id or a payment field, and never throws (legacy intents may carry
 * extra fields; they are dropped, not rejected, so a captured payment is never blocked by them).
 */
export function pickStoredMerchOrderFields(orderPayload: any, intentAmount: unknown): Record<string, any> {
  const src = orderPayload && typeof orderPayload === "object" ? orderPayload : {};
  const out: Record<string, any> = {};
  const str = (key: string, max: number) => {
    const v = src[key];
    if (typeof v === "string" && v.trim() && v.length <= max) out[key] = v.trim();
  };
  str("playerId", 128);
  str("playerName", 100);
  str("merchId", 128);
  str("merchName", 100);
  str("size", 50);
  str("spec", 200);
  str("jerseyName", 30);
  if (typeof src.jerseyNumber === "number" && Number.isFinite(src.jerseyNumber)) {
    out.jerseyNumber = String(src.jerseyNumber);
  } else {
    str("jerseyNumber", 10);
  }
  if (src.customSelections && typeof src.customSelections === "object" && !Array.isArray(src.customSelections)) {
    const sel: Record<string, string> = {};
    for (const [k, v] of Object.entries(src.customSelections).slice(0, 20)) {
      if (k.length > 0 && k.length <= 50 && typeof v === "string" && v.length <= 100) sel[k] = v;
    }
    if (Object.keys(sel).length > 0) out.customSelections = sel;
  }
  const additions = Number(src.customPriceAdditions);
  if (Number.isFinite(additions) && additions > 0) out.customPriceAdditions = additions;
  const price = Number(src.price);
  const amount = Number(intentAmount);
  const resolvedPrice = Number.isFinite(price) && price > 0 ? price : Number.isFinite(amount) ? amount : 0;
  out.price = resolvedPrice;
  out.quantity = 1;
  out.priceSnapshot = {
    unitPrice: resolvedPrice,
    quantity: 1,
    totalAmount: resolvedPrice,
    currency: "INR",
  };
  out.trustedSource = "server";
  out.orderStatus = STORED_MERCH_ORDER_STATUSES.includes(src.orderStatus) ? src.orderStatus : "Order Placed";
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// B2: one Firestore transaction per captured payment (right-sized architecture §3, §15, §16, §18).
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const GATEWAY_PAYMENTS_COLLECTION = "gatewayPayments";

export type WebhookOutcome =
  | "processed"
  | "already_processed"
  | "duplicate"
  | "held"
  | "unmatched"
  | "identity_conflict";

export interface WebhookContext {
  correlationId?: string;
  eventId?: string;
  rawBody?: string;
}

export interface WebhookPaymentResult {
  outcome: WebhookOutcome;
  /** Reason code for non-applied outcomes (also the dead-letter reason). */
  code?: string;
  message?: string;
  /** True when a gatewayPayments record exists for this payment after the commit. */
  paymentRecorded: boolean;
  deadLetterKey?: string;
}

const ALREADY_EXISTS = 6; // gRPC code surfaced by the Admin SDK for create() conflicts

/** Studio renewal subject: the linked player document, else the account document itself. */
export interface RenewalSubject {
  kind: "player" | "account";
  id: string;
}

/**
 * Resolves whose Studio membership a renewal extends: the payer's linked player (appUsers.playerId,
 * or a player document keyed by the uid), following merge chains; otherwise the account document.
 * `getDoc(ref)` is a plain read or a transaction read.
 */
export async function resolveRenewalSubject(
  db: any,
  getDoc: (ref: any) => Promise<any>,
  uid: string,
): Promise<RenewalSubject> {
  const follow = async (startId: string): Promise<string | null> => {
    let id = startId;
    for (let i = 0; i < 10; i += 1) {
      const snap = await getDoc(db.collection("players").doc(id));
      if (!snap.exists) return i === 0 ? null : id;
      const next = snap.data()?.mergedInto;
      if (typeof next === "string" && next.trim()) id = next.trim();
      else return id;
    }
    return null;
  };
  const userSnap = await getDoc(db.collection("appUsers").doc(uid));
  const linked = userSnap.exists ? userSnap.data()?.playerId : undefined;
  if (typeof linked === "string" && linked.trim()) {
    const resolved = await follow(linked.trim());
    if (resolved) return { kind: "player", id: resolved };
  }
  const own = await follow(uid);
  if (own) return { kind: "player", id: own };
  // A player linked by authUid (the same link verifyPlayerOwnership accepts). Exactly one, else none.
  const byAuth = await getDoc(db.collection("players").where("authUid", "==", uid).limit(2));
  if (byAuth?.docs?.length === 1) {
    const resolved = await follow(byAuth.docs[0].id);
    if (resolved) return { kind: "player", id: resolved };
  }
  return { kind: "account", id: uid };
}

export function renewalAnchorId(subject: RenewalSubject, basisExpiry: string): string {
  const key = `sub|${subject.kind}:${subject.id}|${basisExpiry}`;
  return `sub_${crypto.createHash("sha256").update(key).digest("base64url")}`;
}

function conflictDeadLetterKey(identity: PaymentIdentity): string {
  const h = crypto
    .createHash("sha256")
    .update(`${identity.orderId}|${identity.amountPaise}|${identity.currency}|${identity.intentId}`)
    .digest("hex")
    .slice(0, 16);
  return `conflict_${identity.paymentId}_${h}`.slice(0, 140);
}

/** Everything the APPLY write set needs, gathered during the read phase. */
interface ApplyPlan {
  writes: Array<() => void>;
  appliedTo: Array<{ key: string; path?: string; amountPaise: number }>;
  followUps: Array<{ code: string; severity: "low" | "high"; detail?: string }>;
  playerId: string | null;
}

interface Gathered {
  assessments: ObligationAssessment[];
  holdReason: string | null;
  holdMessage?: string;
  plan: ApplyPlan;
}

/**
 * Read phase for the obligations of one intent: reads every document, classifies each obligation
 * (§15 / §16 / §18) and prepares (but does not perform) the APPLY writes.
 */
async function gatherObligations(
  tx: any,
  db: any,
  intent: any,
  intentId: string,
  details: WebhookEventDetails,
  now: Date,
): Promise<Gathered> {
  const plan: ApplyPlan = { writes: [], appliedTo: [], followUps: [], playerId: null };
  const assessments: ObligationAssessment[] = [];

  // Merge-chain resolution (unchanged semantics: in-progress merge → retry; invalid chain → hold).
  const resolvedPlayerMap: Record<string, string> = {};
  async function resolveActivePlayer(startId: string): Promise<string> {
    if (!startId || typeof startId !== "string" || !startId.trim()) return startId;
    const cleanId = startId.trim();
    if (resolvedPlayerMap[cleanId]) return resolvedPlayerMap[cleanId];
    let currentId = cleanId;
    const visited = new Set<string>();
    while (currentId) {
      if (visited.has(currentId)) {
        throw new WebhookPermanentError("MERGE_CHAIN_INVALID", `Invalid or cyclic merge chain detected involving player ${currentId}.`);
      }
      visited.add(currentId);
      const pSnap = await tx.get(db.collection("players").doc(currentId));
      if (!pSnap.exists) {
        if (visited.size > 1) {
          throw new WebhookPermanentError("MERGE_CHAIN_INVALID", `Target keeper player ${currentId} in merge chain does not exist.`);
        }
        resolvedPlayerMap[cleanId] = currentId;
        return currentId;
      }
      const pData = pSnap.data() || {};
      if (pData.mergeStatus === "in_progress") {
        throw new WebhookRetryableError("MERGE_IN_PROGRESS", `Player ${currentId} merge is currently in progress; retry requested.`);
      }
      if (pData.mergedInto && typeof pData.mergedInto === "string" && pData.mergedInto.trim()) {
        currentId = pData.mergedInto.trim();
      } else {
        resolvedPlayerMap[cleanId] = currentId;
        return currentId;
      }
    }
    resolvedPlayerMap[cleanId] = startId;
    return startId;
  }

  const playerFeesCache: Record<string, any[]> = {};
  async function playerFees(playerId: string): Promise<any[]> {
    if (!playerFeesCache[playerId]) {
      const qs = await tx.get(db.collection("players").doc(playerId).collection("otherFees"));
      playerFeesCache[playerId] = qs.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    }
    return playerFeesCache[playerId];
  }

  const matchCache: Record<string, any> = {};
  async function readMatch(matchId: string): Promise<any | null> {
    if (!(matchId in matchCache)) {
      const snap = await tx.get(db.collection("matches").doc(matchId));
      matchCache[matchId] = snap.exists ? snap.data() || {} : null;
    }
    return matchCache[matchId];
  }

  try {
    const type = intent.type;

    if (type === "match" || type === "finance_dues") {
      const intentPlayerRaw = String(intent.playerId || intent.userId || "").trim();
      const intentPlayer = intentPlayerRaw ? await resolveActivePlayer(intentPlayerRaw) : null;
      plan.playerId = intentPlayer;

      // Normalised obligation list from the immutable server-derived intent fields.
      type Item =
        | { t: "match"; matchId: string; paymentId: string; paise: number }
        | { t: "other"; feeId: string; paise: number }
        | { t: "late"; matchId: string; paise: number; items: any[] }
        | { t: "merch"; merchId: string; paise: number }
        | { t: "unknown" };
      const items: Item[] = [];
      if (type === "match") {
        const lateItems = Array.isArray(intent.lateFeeItems) ? intent.lateFeeItems : [];
        const lateTotal = lateItems.reduce((acc: number, lf: any) => acc + Number(lf?.amount || 0), 0);
        if (intent.matchId && intent.paymentId) {
          items.push({ t: "match", matchId: intent.matchId, paymentId: intent.paymentId, paise: toPaise(Number(intent.amount) - lateTotal) });
          if (lateItems.length) items.push({ t: "late", matchId: intent.matchId, paise: toPaise(lateTotal), items: lateItems });
        } else {
          items.push({ t: "unknown" });
        }
      } else {
        const raw = Array.isArray(intent.items) ? intent.items : [];
        for (const it of raw) {
          if (it?.type === "match" && it.matchId && it.paymentId) items.push({ t: "match", matchId: it.matchId, paymentId: it.paymentId, paise: toPaise(it.amount) });
          else if (it?.type === "other" && it.feeId) items.push({ t: "other", feeId: it.feeId, paise: toPaise(it.amount) });
          else if (it?.isLateFee && it.matchId) items.push({ t: "late", matchId: it.matchId, paise: toPaise(it.lateFeeAmount), items: [it] });
          else if (it?.type === "merch" && it.merchId) items.push({ t: "merch", merchId: it.merchId, paise: toPaise(it.amount) });
          else items.push({ t: "unknown" });
        }
      }

      for (const item of items) {
        if (item.t === "unknown") {
          assessments.push({ key: "unknown", kind: "other_fee", amountPaise: 0, cls: "UNCLASSIFIABLE", reason: "OBLIGATION_UNCLASSIFIABLE" });
          continue;
        }
        if (item.t === "match") {
          const path = `matches/${item.matchId}/payments/${item.paymentId}`;
          const ref = db.collection("matches").doc(item.matchId).collection("payments").doc(item.paymentId);
          const match = await readMatch(item.matchId);
          const snap = await tx.get(ref);
          const pay = snap.exists ? snap.data() || {} : null;
          const original = pay?.playerId || null;
          const effective = original ? await resolveActivePlayer(original) : null;
          const a = classifyMatchFee({
            key: `match|${item.matchId}|${item.paymentId}`, path, snapshotPaise: item.paise,
            intentPlayerId: intentPlayer, payment: pay, paymentPlayerId: effective, match,
          });
          assessments.push(a);
          plan.appliedTo.push({ key: a.key, path, amountPaise: item.paise });
          plan.writes.push(() => {
            const update: Record<string, any> = {
              status: "Paid", paymentMethod: "razorpay", razorpayPaymentId: details.paymentId,
              gatewayPaymentId: details.paymentId,
              // Unchanged pre-B2 value: whole intent amount for a match intent, item amount in dues.
              feeCollectedAmount: type === "match" ? Number(intent.amount || 0) : item.paise / 100,
              updatedAt: now,
            };
            if (effective && original && effective !== original) {
              update.playerId = effective;
              update.migratedFromPlayerId = original;
            }
            tx.update(ref, update);
          });
        } else if (item.t === "other") {
          const target = intentPlayer || "";
          if (!target) {
            assessments.push({ key: `fee||${item.feeId}`, kind: "other_fee", amountPaise: item.paise, cls: "MISSING", reason: "OBLIGATION_MISSING" });
            continue;
          }
          let ref = db.collection("players").doc(target).collection("otherFees").doc(item.feeId);
          let snap: any = await tx.get(ref);
          if (!snap.exists && intentPlayerRaw && target !== intentPlayerRaw) {
            const origRef = db.collection("players").doc(intentPlayerRaw).collection("otherFees").doc(item.feeId);
            const origSnap = await tx.get(origRef);
            if (origSnap.exists) { ref = origRef; snap = origSnap; }
          }
          const fee = snap.exists ? snap.data() || {} : null;
          const path = `players/${ref.parent?.parent?.id || target}/otherFees/${item.feeId}`;
          const a = classifyOtherFee({ key: `fee|${intentPlayerRaw}|${item.feeId}`, path, snapshotPaise: item.paise, fee });
          assessments.push(a);
          plan.appliedTo.push({ key: a.key, path, amountPaise: item.paise });
          plan.writes.push(() =>
            tx.update(ref, { status: "Paid", paymentMethod: "razorpay", razorpayPaymentId: details.paymentId, gatewayPaymentId: details.paymentId, updatedAt: now }),
          );
        } else if (item.t === "merch") {
          const ref = db.collection("merchOrders").doc(item.merchId);
          const snap = await tx.get(ref);
          const order = snap.exists ? snap.data() || {} : null;
          const orderPlayer = order?.playerId ? await resolveActivePlayer(order.playerId) : null;
          const path = `merchOrders/${item.merchId}`;
          const a = classifyMerchDuesOrder({
            key: `merch|${item.merchId}`, path, snapshotPaise: item.paise, order, orderPlayerId: orderPlayer, intentPlayerId: intentPlayer,
          });
          assessments.push(a);
          plan.appliedTo.push({ key: a.key, path, amountPaise: item.paise });
          plan.writes.push(() =>
            tx.update(ref, { paymentStatus: "Paid", razorpayPaymentId: details.paymentId, gatewayPaymentId: details.paymentId, updatedAt: now }),
          );
        } else if (item.t === "late") {
          const lfPlayer = intentPlayer || "";
          if (!lfPlayer) {
            assessments.push({ key: `latefee||${item.matchId}|${intentId}`, kind: "late_fee", amountPaise: item.paise, cls: "MISSING", reason: "OBLIGATION_MISSING" });
            continue;
          }
          const match = await readMatch(item.matchId);
          const fees = lfPlayer ? await playerFees(lfPlayer) : [];
          const a = classifyLateFeeInterim({
            key: `latefee|${intentPlayerRaw}|${item.matchId}|${intentId}`, matchId: item.matchId, snapshotPaise: item.paise, match, playerFees: fees,
          });
          assessments.push(a);
          plan.appliedTo.push({ key: a.key, amountPaise: item.paise });
          // Late-fee records keep today's per-intent identity until B3 (weekly identity).
          for (const lf of item.items) {
            const templateId = type === "match" ? lf.templateId || lf.playerId : lf.lateFeeTemplateId || lfPlayer;
            const feeDocId = `lf_${intentId}_${templateId}`;
            const ref = db.collection("players").doc(lfPlayer).collection("otherFees").doc(feeDocId);
            const snap = await tx.get(ref);
            if (snap.exists) continue;
            const originalPlayer = type === "match" ? lf.playerId : intentPlayerRaw;
            plan.writes.push(() =>
              tx.set(ref, {
                id: feeDocId,
                playerId: lfPlayer,
                ...(originalPlayer && lfPlayer !== originalPlayer ? { originalPlayerId: originalPlayer } : {}),
                title: (type === "match" ? lf.label : lf.lateFeeLabel) || "Late Fee",
                amount: Number((type === "match" ? lf.amount : lf.lateFeeAmount) || 0),
                comment: "Auto-levied late fee penalty",
                templateId: (type === "match" ? lf.templateId : lf.lateFeeTemplateId) || "",
                status: "Paid",
                paymentMethod: "razorpay",
                razorpayPaymentId: details.paymentId,
                gatewayPaymentId: details.paymentId,
                createdAt: now,
                updatedAt: now,
              }),
            );
          }
        }
      }
    } else if (type === "subscription") {
      const uid = String(intent.userId || "").trim();
      const snapshot = intent.renewal && typeof intent.renewal === "object" ? intent.renewal : null;
      const subject: RenewalSubject | null = snapshot?.subjectKind && snapshot?.subjectId
        ? { kind: snapshot.subjectKind === "account" ? "account" : "player", id: String(snapshot.subjectId) }
        : uid ? await resolveRenewalSubject(db, (r) => tx.get(r), uid) : null;
      let subjectRef: any = null;
      let subjectDoc: any = null;
      if (subject) {
        const subjectId = subject.kind === "player" ? await resolveActivePlayer(subject.id) : subject.id;
        subject.id = subjectId;
        subjectRef = db.collection(subject.kind === "player" ? "players" : "appUsers").doc(subjectId);
        const snap = await tx.get(subjectRef);
        subjectDoc = snap.exists ? snap.data() || {} : null;
      }
      plan.playerId = subject?.kind === "player" ? subject.id : null;
      const currentExpiry = currentExpiryOf(subjectDoc);
      const basisExpiry = snapshot ? String(snapshot.basisExpiry || RENEWAL_BASIS_NONE) : currentExpiry;
      const durationDays = Number(snapshot ? snapshot.durationDays : intent.durationDays || 30);
      const amountPaise = snapshot ? Number(snapshot.amountPaise) : toPaise(intent.amount);
      const planId = String((snapshot ? snapshot.planId : intent.planId) || "");
      const planName = String((snapshot ? snapshot.planName : intent.planId) || planId);
      const anchorRef = subject ? db.collection("subscriptionHistory").doc(renewalAnchorId(subject, basisExpiry)) : null;
      const anchorSnap = anchorRef ? await tx.get(anchorRef) : { exists: false };

      // Legacy intents (no snapshot): hold if any renewal was recorded after the order was created.
      let legacySuperseded = false;
      if (!snapshot && subject) {
        const createdAtMs = intent.createdAt?.toMillis ? intent.createdAt.toMillis() : new Date(intent.createdAt || 0).getTime();
        const ids = Array.from(new Set([subject.id, uid].filter(Boolean)));
        const qs = await tx.get(db.collection("subscriptionHistory").where("playerId", "in", ids));
        legacySuperseded = qs.docs.some((d: any) => {
          const c = d.data()?.createdAt;
          const ms = c?.toMillis ? c.toMillis() : new Date(c || 0).getTime();
          return Number.isFinite(ms) && ms > createdAtMs;
        });
      }

      const { assessment, newExpiry } = assessRenewal({
        key: `sub|${subject ? `${subject.kind}:${subject.id}` : "none"}|${basisExpiry}`,
        path: anchorRef ? `subscriptionHistory/${anchorRef.id}` : "subscriptionHistory/-",
        snapshotPaise: amountPaise,
        subjectExists: !!subjectDoc,
        anchorExists: !!anchorSnap.exists,
        basisExpiry,
        currentExpiry,
        durationDays,
        clubTodayYmd: getClubCalendarDate(now).dateString,
        legacySuperseded,
      });
      assessments.push(assessment);
      plan.appliedTo.push({ key: assessment.key, path: assessment.path, amountPaise });

      if (assessment.cls === "PAYABLE" && subject && subjectRef && anchorRef && newExpiry) {
        // appUsers mirror (§16): the subject document is the source of truth.
        let mirror: { ref: any; old: string } | null = null;
        if (subject.kind === "player" && uid) {
          const userRef = db.collection("appUsers").doc(uid);
          const userSnap = await tx.get(userRef);
          if (!userSnap.exists) {
            plan.followUps.push({ code: "appusers_mirror_missing", severity: "low" });
          } else {
            const u = userSnap.data() || {};
            const linked = u.playerId ? u.playerId === subject.id || u.playerId === snapshot?.subjectId : subject.id === uid;
            if (!linked) {
              plan.followUps.push({ code: "appusers_mirror_conflict", severity: "high" });
            } else {
              const old = currentExpiryOf(u);
              if (old !== currentExpiry) plan.followUps.push({ code: "appusers_mirror_corrected", severity: "low", detail: old });
              mirror = { ref: userRef, old };
            }
          }
        }
        plan.writes.push(() => {
          tx.create(anchorRef, {
            planId,
            planName,
            playerId: subject.id,
            subjectKind: subject.kind,
            adminId: "webhook",
            adminName: "Razorpay Webhook",
            oldExpiryDate: currentExpiry === RENEWAL_BASIS_NONE ? null : currentExpiry,
            newExpiryDate: newExpiry,
            renewalBasis: basisExpiry,
            durationDays,
            amountPaise,
            paidAmount: amountPaise / 100,
            razorpayPaymentId: details.paymentId,
            intentId,
            createdAt: now,
          });
          const expiryFields = { studioExpiryDate: newExpiry, studioEndDate: newExpiry, isStudioMember: true, updatedAt: now };
          tx.update(subjectRef, expiryFields);
          if (mirror) tx.update(mirror.ref, expiryFields);
        });
      }
    } else if (type === "merch_order") {
      // B1 (PX-1): server-controlled id mo_{intentId}; create only.
      if (!isValidIntentId(intentId)) {
        assessments.push({ key: "merch|invalid", kind: "merch_shop", amountPaise: 0, cls: "UNCLASSIFIABLE", reason: "OBLIGATION_UNCLASSIFIABLE" });
      } else {
        const ref = db.collection("merchOrders").doc(merchOrderIdForIntent(intentId));
        const snap = await tx.get(ref);
        const a = classifyMerchShop({ key: `merch|${ref.id}`, path: `merchOrders/${ref.id}`, snapshotPaise: toPaise(intent.amount), exists: snap.exists });
        assessments.push(a);
        plan.appliedTo.push({ key: a.key, path: a.path, amountPaise: a.amountPaise });
        const pid = intent.orderPayload?.playerId;
        plan.playerId = typeof pid === "string" ? pid : null;
        plan.writes.push(() =>
          tx.create(ref, {
            ...pickStoredMerchOrderFields(intent.orderPayload, intent.amount),
            id: ref.id,
            intentId,
            paymentStatus: "Paid",
            isManual: false,
            razorpayPaymentId: details.paymentId,
            gatewayPaymentId: details.paymentId,
            createdAt: now,
            updatedAt: now,
          }),
        );
      }
    } else {
      assessments.push({ key: `unknown|${String(type)}`, kind: "other_fee", amountPaise: 0, cls: "UNCLASSIFIABLE", reason: "OBLIGATION_UNCLASSIFIABLE" });
    }
  } catch (err) {
    if (err instanceof WebhookPermanentError) {
      return { assessments, holdReason: err.reason, holdMessage: err.message, plan };
    }
    throw err; // retryable / infrastructure → abort the transaction, nothing written
  }
  return { assessments, holdReason: null, plan };
}

/**
 * B2: decides and records one captured payment in ONE Firestore transaction.
 *
 * - APPLY: obligations settled, gatewayPayments `applied` (+ appliedTo), intent `paid`.
 * - REPLAY: no writes (pre-B2 payments get their missing registry record created as `applied`).
 * - DUPLICATE / HOLD / UNMATCHED: gatewayPayments record + dead-letter; no obligation write.
 * - IDENTITY_CONFLICT: dead-letter only; the original record is never touched.
 * - Infrastructure failure: the transaction aborts and nothing (not even the dead-letter) commits.
 */
export async function processWebhookPayment(
  db: any,
  details: WebhookEventDetails,
  ctx: WebhookContext = {},
): Promise<WebhookPaymentResult> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await processWebhookPaymentOnce(db, details, ctx);
    } catch (err: any) {
      // A concurrent delivery created the same document first: re-run once; the re-read decides.
      if (attempt === 0 && (err?.code === ALREADY_EXISTS || /ALREADY_EXISTS|already exists/i.test(String(err?.message)))) continue;
      throw err;
    }
  }
}

async function processWebhookPaymentOnce(
  db: any,
  details: WebhookEventDetails,
  ctx: WebhookContext,
): Promise<WebhookPaymentResult> {
  const intentId = typeof details.intentId === "string" ? details.intentId.trim() : "";
  const identity: PaymentIdentity = {
    paymentId: details.paymentId || "",
    orderId: details.orderId || "",
    amountPaise: Number(details.capturedPaise) || 0,
    currency: details.capturedCurrency || "",
    intentId,
  };
  const paymentIdUsable = isUsablePaymentId(details.paymentId);

  return db.runTransaction(async (tx: any) => {
    const now = new Date();
    // ── Reads ──
    const paymentRef = paymentIdUsable ? db.collection(GATEWAY_PAYMENTS_COLLECTION).doc(details.paymentId) : null;
    const paymentSnap = paymentRef ? await tx.get(paymentRef) : null;
    const existingPayment = paymentSnap?.exists ? paymentSnap.data() || {} : null;

    const intentRef = intentId && isValidIntentId(intentId) ? db.collection("razorpayIntents").doc(intentId) : null;
    let intent: any = null;
    if (intentRef && !existingPayment) {
      const intentSnap = await tx.get(intentRef);
      intent = intentSnap.exists ? intentSnap.data() || {} : null;
    }
    const validation = intent ? validateWebhookTransaction(intent, details) : { ok: false as const };

    let gathered: Gathered | null = null;
    let reservation: { ref: any; data: any } | null = null;
    const pendingAndValid =
      paymentIdUsable && !existingPayment && intent && !intentHasFirstPayment(intent) && validation.ok;
    if (pendingAndValid) {
      gathered = await gatherObligations(tx, db, intent, intentId, details, now);
      if (intent.reservationKey && typeof intent.reservationKey === "string") {
        const rRef = db.collection("paymentReservations").doc(intent.reservationKey);
        const rSnap = await tx.get(rRef);
        if (rSnap.exists) reservation = { ref: rRef, data: rSnap.data() || {} };
      }
    }

    const decision = decidePaymentApplication({
      event: identity,
      paymentIdUsable,
      existingPayment,
      intent,
      hasIntentId: !!intentId,
      validation: { ok: validation.ok, reason: (validation as any).reason },
      holdReason: gathered?.holdReason ?? null,
      assessments: gathered?.assessments ?? [],
    });

    const message = (validation as any).error as string | undefined;
    const dlInput = (reason: any) => ({
      reason,
      event: details.event,
      eventId: ctx.eventId,
      correlationId: ctx.correlationId || "",
      orderId: details.orderId,
      paymentId: details.paymentId,
      intentId,
      amountPaise: details.capturedPaise,
      currency: details.capturedCurrency,
      rawBody: ctx.rawBody || "",
    });

    // Dead-letter reads also happen before any write.
    let deadLetter: { key: string; write: () => void } | null = null;
    if (decision.kind === "IDENTITY_CONFLICT") {
      deadLetter = await planWebhookDeadLetter(tx, db, dlInput(decision.reason), conflictDeadLetterKey(identity));
    } else if (decision.kind === "NO_PAYMENT_ID" || decision.kind === "UNMATCHED" || decision.kind === "DUPLICATE" || decision.kind === "HOLD") {
      deadLetter = await planWebhookDeadLetter(tx, db, dlInput(decision.reason));
    }

    // ── Writes ──
    const registryBase = {
      paymentId: details.paymentId,
      orderId: details.orderId || "",
      amountPaise: identity.amountPaise,
      currency: identity.currency,
      intentId,
      intentType: intent?.type || null,
      playerId: gathered?.plan.playerId ?? null,
      event: details.event,
      firstEventId: ctx.eventId || null,
      recordedAt: now,
    };
    const markReservationException = (reason: string) => {
      if (reservation && reservation.data.intentId === intentId && reservation.data.isPaid !== true) {
        tx.update(reservation.ref, { status: "exception", exceptionReason: reason, updatedAt: now });
      }
    };

    switch (decision.kind) {
      case "REPLAY": {
        if (decision.backfill && paymentRef) {
          const application =
            intent?.status === "paid" ? "applied" : intent?.status === "paid_unapplied" ? "rejected_duplicate" : "held_for_review";
          tx.create(paymentRef, { ...registryBase, application, reasons: [], source: "pre_cutover_replay" });
        }
        return { outcome: "already_processed", paymentRecorded: !!paymentRef };
      }
      case "IDENTITY_CONFLICT": {
        deadLetter!.write();
        return {
          outcome: "identity_conflict",
          code: decision.reason,
          paymentRecorded: !!existingPayment,
          deadLetterKey: deadLetter!.key,
          message: message || "Payment id seen with a different identity.",
        };
      }
      case "NO_PAYMENT_ID": {
        deadLetter!.write();
        return { outcome: "unmatched", code: decision.reason, paymentRecorded: false, deadLetterKey: deadLetter!.key, message: message || "Missing or invalid payment ID." };
      }
      case "UNMATCHED": {
        tx.create(paymentRef, { ...registryBase, application: "unmatched", reasons: [decision.reason], source: "webhook" });
        deadLetter!.write();
        return { outcome: "unmatched", code: decision.reason, paymentRecorded: true, deadLetterKey: deadLetter!.key, message: message || decision.reason };
      }
      case "DUPLICATE":
      case "HOLD": {
        const reasons = (gathered?.assessments || []).filter((a) => a.cls !== "PAYABLE").map((a) => `${a.key}:${a.reason}`);
        tx.create(paymentRef, {
          ...registryBase,
          application: decision.kind === "DUPLICATE" ? "rejected_duplicate" : "held_for_review",
          reasons: [decision.reason, ...reasons],
          source: "webhook",
        });
        deadLetter!.write();
        if (intent && !intentHasFirstPayment(intent) && intentRef) {
          tx.update(intentRef, {
            status: decision.kind === "DUPLICATE" ? "paid_unapplied" : "exception",
            razorpayPaymentId: details.paymentId,
            exceptionReason: decision.reason,
            updatedAt: now,
          });
          markReservationException(decision.reason);
        }
        return {
          outcome: decision.kind === "DUPLICATE" ? "duplicate" : "held",
          code: decision.reason,
          paymentRecorded: true,
          deadLetterKey: deadLetter!.key,
          message:
            decision.reason === "CONFLICTING_PAYMENT"
              ? `Conflicting payment ID replay: intent was already fulfilled with payment ${intent?.razorpayPaymentId}, received ${details.paymentId}`
              : gathered?.holdReason === decision.reason && gathered?.holdMessage
                ? gathered.holdMessage
                : `Payment recorded for Finance review (${decision.reason}).`,
        };
      }
      case "APPLY": {
        for (const w of gathered!.plan.writes) w();
        tx.create(paymentRef, {
          ...registryBase,
          application: "applied",
          reasons: [],
          appliedTo: gathered!.plan.appliedTo,
          ...(gathered!.plan.followUps.length ? { followUps: gathered!.plan.followUps } : {}),
          source: "webhook",
        });
        // R2-C: verified gateway identifiers only, never the raw payload.
        tx.update(intentRef, {
          status: "paid",
          razorpayPaymentId: details.paymentId,
          gatewayEvent: {
            event: details.event,
            orderId: details.orderId,
            paymentId: details.paymentId,
            amountPaise: details.capturedPaise,
            currency: details.capturedCurrency,
          },
          updatedAt: now,
        });
        if (intent.reservationKey) {
          tx.set(
            db.collection("paymentReservations").doc(intent.reservationKey),
            { status: "active", isPaid: true, paidAt: now, razorpayPaymentId: details.paymentId, updatedAt: now },
            { merge: true },
          );
        }
        return { outcome: "processed", paymentRecorded: true };
      }
    }
  });
}

/**
 * Compatibility API (pre-B2 signature). Runs processWebhookPayment and, for outcomes that were
 * previously thrown, throws the same WebhookPermanentError AFTER the registry record and the
 * dead-letter have committed. New code (the webhook route) uses processWebhookPayment directly.
 */
export async function processWebhookIntentTransaction(
  db: any,
  details: WebhookEventDetails,
  // Retained for call-site compatibility; deliberately not persisted (R2-C).
  _rawPayload?: unknown,
): Promise<{ success: boolean; alreadyProcessed?: boolean; error?: string }> {
  if (!details.intentId) {
    return { success: false, error: "Missing intentId in event details." };
  }
  const r = await processWebhookPayment(db, details);
  if (r.outcome === "processed") return { success: true };
  if (r.outcome === "already_processed") return { success: true, alreadyProcessed: true };
  throw new WebhookPermanentError((r.code || "INTENT_INVALID") as WebhookPermanentReason, r.message || r.code || "Payment not applied.");
}
