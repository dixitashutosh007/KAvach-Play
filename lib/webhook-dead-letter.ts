/**
 * R5: durable record of signed Razorpay payment events that could not be applied.
 *
 * Policy
 * - A signed, supported payment event (payment.captured / order.paid) that cannot be matched to
 *   its intent, or that contradicts it, is recorded here and then acknowledged (HTTP 200), so
 *   Razorpay stops retrying an event that can never succeed and the webhook is not disabled.
 * - Recording happens BEFORE acknowledgement. If the record cannot be written, the route answers
 *   503 and Razorpay retries: an event is never acknowledged without being stored.
 * - Nothing here changes payments, fees, ledgers or intents. Money is only applied by the normal
 *   webhook path. Resolving a record only stores the human/finance outcome.
 * - One record per gateway payment (falls back to event id, order id, then a body hash), so the
 *   same money reported by payment.captured and order.paid is one reconciliation item.
 * - Only identifiers, amounts, reason codes and timestamps are stored: no raw payload, no payer
 *   email/phone/VPA/card data.
 */
import crypto from "crypto";
import type { WebhookPermanentReason } from "./razorpay-webhook.ts";
import type { ObligationReason } from "./payment-decision.ts";
import { writeServerAudit } from "./server-audit.ts";

export const DEAD_LETTER_COLLECTION = "webhookDeadLetters";

export type DeadLetterClassification =
  | "unmatched" // cannot be tied to any intent
  | "mismatch" // tied to an intent but amount/currency/order/payment data disagree
  | "conflicting_payment" // a second, different payment for an intent already paid
  | "data_integrity" // intent found but linked records are inconsistent (e.g. merge chain)
  | "duplicate_payment" // B2: captured payment for an obligation that is already settled
  | "held_for_review" // B2: obligation missing / changed / not due / unclassifiable
  | "identity_conflict"; // B2: same payment id seen with a different identity

/** B2: every reason a dead-letter record can carry. */
export type DeadLetterReason = WebhookPermanentReason | ObligationReason | "PAYMENT_IDENTITY_CONFLICT";

export function classifyDeadLetter(reason: DeadLetterReason): DeadLetterClassification {
  switch (reason) {
    case "OBLIGATION_SETTLED":
    case "RENEWAL_ALREADY_SETTLED":
      return "duplicate_payment";
    case "OBLIGATION_NOT_DUE":
    case "OBLIGATION_CHANGED":
    case "OBLIGATION_MISSING":
    case "OBLIGATION_CONFLICT":
    case "OBLIGATION_UNCLASSIFIABLE":
    case "LATE_FEE_ALREADY_RECORDED":
    case "RENEWAL_BASIS_CHANGED":
    case "RENEWAL_LEGACY_SUPERSEDED":
      return "held_for_review";
    case "PAYMENT_IDENTITY_CONFLICT":
      return "identity_conflict";
    case "NO_INTENT_ID":
    case "MALFORMED_EVENT":
    case "INTENT_NOT_FOUND":
      return "unmatched";
    case "CONFLICTING_PAYMENT":
      return "conflicting_payment";
    case "MERGE_CHAIN_INVALID":
    case "MERCH_ORDER_EXISTS": // B1 (PX-1): target order id already taken; never overwritten
      return "data_integrity";
    default:
      return "mismatch";
  }
}

export interface DeadLetterInput {
  reason: DeadLetterReason;
  event: string;
  eventId?: string;
  correlationId: string;
  orderId?: string;
  paymentId?: string;
  intentId?: string;
  amountPaise?: number;
  currency?: string;
  rawBody: string;
}

const SAFE_ID = /^[A-Za-z0-9_\-]{1,100}$/;
const safe = (v: unknown): string | undefined =>
  typeof v === "string" && SAFE_ID.test(v.trim()) ? v.trim() : undefined;

/** Stable document id for an event, so repeated deliveries land on the same record. */
export function deadLetterKey(input: Pick<DeadLetterInput, "paymentId" | "eventId" | "orderId" | "rawBody">): string {
  const pay = safe(input.paymentId);
  if (pay) return `pay_${pay}`.slice(0, 140);
  const evt = safe(input.eventId);
  if (evt) return `evt_${evt}`.slice(0, 140);
  const ord = safe(input.orderId);
  if (ord) return `ord_${ord}`.slice(0, 140);
  return `body_${crypto.createHash("sha256").update(input.rawBody).digest("hex").slice(0, 40)}`;
}

/**
 * B2: plans a dead-letter write inside a caller's transaction. Performs the read now (callers
 * must call this before any transaction write) and returns `write()` to apply in the write phase.
 * The record and the payment decision therefore commit, or fail, together.
 */
export async function planWebhookDeadLetter(
  tx: any,
  db: any,
  input: DeadLetterInput,
  keyOverride?: string,
): Promise<{ key: string; created: boolean; write: () => void }> {
  const key = keyOverride || deadLetterKey(input);
  const ref = db.collection(DEAD_LETTER_COLLECTION).doc(key);
  const eventId = safe(input.eventId);
  const snap = await tx.get(ref);
  const now = new Date();
  if (snap.exists) {
    const data = snap.data() || {};
    const eventIds: string[] = Array.isArray(data.eventIds) ? data.eventIds : [];
    const events: string[] = Array.isArray(data.events) ? data.events : [];
    return {
      key,
      created: false,
      write: () =>
        tx.update(ref, {
          lastSeenAt: now,
          deliveryCount: Number(data.deliveryCount || 0) + 1,
          eventIds: eventId && !eventIds.includes(eventId) ? [...eventIds, eventId].slice(-20) : eventIds,
          events: input.event && !events.includes(input.event) ? [...events, input.event] : events,
          lastCorrelationId: input.correlationId,
        }),
    };
  }
  const record: Record<string, unknown> = {
    status: "open",
    reason: input.reason,
    classification: classifyDeadLetter(input.reason),
    events: input.event ? [input.event] : [],
    eventIds: eventId ? [eventId] : [],
    firstSeenAt: now,
    lastSeenAt: now,
    deliveryCount: 1,
    lastCorrelationId: input.correlationId,
  };
  const orderId = safe(input.orderId);
  const paymentId = safe(input.paymentId);
  const intentId = safe(input.intentId);
  if (orderId) record.orderId = orderId;
  if (paymentId) record.paymentId = paymentId;
  if (intentId) record.intentId = intentId;
  if (Number.isFinite(input.amountPaise) && (input.amountPaise as number) > 0) record.amountPaise = input.amountPaise;
  if (input.currency && /^[A-Z]{3}$/.test(input.currency)) record.currency = input.currency;
  return { key, created: true, write: () => tx.create(ref, record) };
}

/**
 * Idempotently records (or re-sights) a dead-letter event in its own transaction. Used by the
 * route for events that never reach the payment transaction (malformed, unsigned body shape).
 * Re-delivery never reopens a resolved record; it only updates lastSeenAt / deliveryCount / eventIds.
 */
export async function recordWebhookDeadLetter(
  db: any,
  input: DeadLetterInput,
): Promise<{ key: string; created: boolean }> {
  return db.runTransaction(async (tx: any) => {
    const plan = await planWebhookDeadLetter(tx, db, input);
    plan.write();
    return { key: plan.key, created: plan.created };
  });
}

export const DEAD_LETTER_RESOLUTIONS = [
  "linked_to_obligation", // finance applied the payment to the right obligation through an authorised workflow
  "refund_initiated", // money returned to the payer through Razorpay
  "duplicate_no_action", // the money is already accounted for elsewhere
  "test_or_invalid_event", // test-mode or otherwise non-genuine event
  "other", // requires a note
] as const;
export type DeadLetterResolution = (typeof DEAD_LETTER_RESOLUTIONS)[number];

export class DeadLetterResolveError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Records the finance outcome once, with an audit-log entry in the same transaction.
 * Never modifies payments, fees, intents or ledgers.
 */
export async function resolveWebhookDeadLetter(
  db: any,
  id: string,
  resolution: DeadLetterResolution,
  note: string | undefined,
  actor: { uid: string; name: string },
): Promise<void> {
  const ref = db.collection(DEAD_LETTER_COLLECTION).doc(id);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new DeadLetterResolveError(404, "Record not found.");
    const data = snap.data() || {};
    if (data.status === "resolved") {
      throw new DeadLetterResolveError(409, "Record is already resolved.");
    }
    tx.update(ref, {
      status: "resolved",
      resolution,
      resolutionNote: note || null,
      resolvedBy: actor.uid,
      resolvedAt: new Date(),
    });
    await writeServerAudit(
      db,
      {
        actorId: actor.uid,
        actorName: actor.name,
        action: "status_change",
        entity: "webhook_dead_letter",
        entityId: id,
        entityLabel: `Razorpay ${data.paymentId || data.orderId || id}`,
        changes: [
          { field: "status", oldValue: "open", newValue: "resolved" },
          { field: "resolution", newValue: resolution },
        ],
        summary: `${actor.name} resolved unmatched Razorpay event (${data.reason || "unknown"}) as ${resolution}`,
      },
      tx,
    );
  });
}
