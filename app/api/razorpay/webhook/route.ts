import { NextRequest, NextResponse } from "next/server.js";
import crypto from "crypto";
import {
  extractWebhookEventDetails,
  processWebhookPayment,
  classifyWebhookError,
} from "../../../../lib/razorpay-webhook.ts";
import {
  getServerFirestore,
  arePaymentOperationsEnabled,
} from "../../../../lib/server-db.ts";
import { recordWebhookDeadLetter } from "../../../../lib/webhook-dead-letter.ts";
import type { WebhookPermanentReason } from "../../../../lib/razorpay-webhook.ts";

/**
 * Razorpay webhook receiver.
 *
 * Response policy (R3). Razorpay treats ANY non-2xx (or no reply within 5 s) as a failed
 * delivery and retries with exponential backoff for 24 hours; persistent failures can get the
 * webhook disabled. Statuses therefore reflect what the failure means:
 *  - 401  missing/invalid signature (not from Razorpay, or misconfigured secret)
 *  - 400  signed body that is not valid JSON
 *  - 503  retryable: infrastructure errors, known temporary states, and any unclassified error.
 *         Processing is idempotent, so Razorpay's retry is the recovery path.
 *  - 200  processed, duplicate already processed, or event type we do not act on.
 *  - 200  permanent (R5): the event cannot be matched to, or contradicts, its intent. It never
 *         fulfils payment; it is first recorded in `webhookDeadLetters` for finance
 *         reconciliation and only then acknowledged. If that record cannot be written: 503.
 *  - B2: every captured payment with a usable id gets one `gatewayPayments` record. Duplicate,
 *         held, unmatched and identity-conflict outcomes are recorded (registry + dead-letter) in
 *         the SAME transaction as the decision, then acknowledged with 200. Any failure before
 *         commit is 503 and nothing is recorded, so nothing is ever reported as recorded unless
 *         it committed.
 *
 * Every response carries a correlation id (Razorpay's x-razorpay-event-id when present).
 * Logs and responses carry a reason code and identifiers only: no secrets, no raw payload,
 * no payer contact data.
 */

function reply(
  status: number,
  correlationId: string,
  body: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ ...body, correlationId }, { status });
}

function log(
  level: "info" | "warn" | "error",
  correlationId: string,
  outcome: string,
  fields: Record<string, string | number | boolean | undefined> = {},
) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`);
  console[level](`[razorpay/webhook] cid=${correlationId} outcome=${outcome} ${parts.join(" ")}`.trim());
}

/**
 * R5: record a permanent failure, then acknowledge it. Never acknowledges without a stored record.
 */
async function deadLetter(
  correlationId: string,
  eventIdHeader: string,
  rawBody: string,
  reason: WebhookPermanentReason,
  fields: {
    event: string;
    orderId?: string;
    paymentId?: string;
    intentId?: string;
    amountPaise?: number;
    currency?: string;
  },
): Promise<NextResponse> {
  try {
    const { key, created } = await recordWebhookDeadLetter(getServerFirestore(), {
      reason,
      correlationId,
      eventId: eventIdHeader,
      rawBody,
      ...fields,
    });
    log("warn", correlationId, "dead_lettered", {
      event: fields.event,
      reason,
      record: key,
      firstSighting: created,
      intentId: fields.intentId,
      orderId: fields.orderId,
      paymentId: fields.paymentId,
    });
    return reply(200, correlationId, { received: true, outcome: "recorded_for_reconciliation", code: reason });
  } catch (err) {
    const errCode = (err as any)?.code;
    log("error", correlationId, "retryable", {
      event: fields.event,
      reason: "DEAD_LETTER_WRITE_FAILED",
      deadLetterReason: reason,
      errCode: typeof errCode === "string" || typeof errCode === "number" ? errCode : undefined,
    });
    return reply(503, correlationId, { error: "Temporary processing failure; retry expected.", code: "DEAD_LETTER_WRITE_FAILED" });
  }
}

export async function POST(req: NextRequest) {
  const eventIdHeader = (req.headers.get("x-razorpay-event-id") || "").trim();
  const correlationId = /^[A-Za-z0-9_\-]{1,100}$/.test(eventIdHeader)
    ? eventIdHeader
    : `wh_${crypto.randomUUID()}`;

  // 1. Strict Webhook Processing Check (Development Isolation)
  if (!arePaymentOperationsEnabled()) {
    return NextResponse.json(
      {
        error:
          "Webhook processing is disabled in this environment (development / sandbox mode). Inbound webhook events are rejected to prevent modifications to development records.",
        code: "WEBHOOKS_DISABLED",
      },
      { status: 403 },
    );
  }

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    log("error", correlationId, "config_error", { reason: "WEBHOOK_SECRET_MISSING" });
    return reply(500, correlationId, { error: "Webhook secret not configured.", code: "CONFIG_ERROR" });
  }

  // 2. Signature over the exact raw body (timing-safe)
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    log("warn", correlationId, "retryable", { reason: "BODY_READ_FAILED" });
    return reply(503, correlationId, { error: "Could not read request body.", code: "BODY_READ_FAILED" });
  }
  const signature = req.headers.get("x-razorpay-signature");
  if (!signature) {
    log("warn", correlationId, "rejected", { reason: "SIGNATURE_MISSING" });
    return reply(401, correlationId, { error: "Missing x-razorpay-signature header.", code: "SIGNATURE_MISSING" });
  }
  const expectedBuf = Buffer.from(
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex"),
    "hex",
  );
  const receivedBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
    log("warn", correlationId, "rejected", { reason: "SIGNATURE_INVALID" });
    return reply(401, correlationId, { error: "Invalid signature.", code: "SIGNATURE_INVALID" });
  }

  // 3. Parse
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    log("warn", correlationId, "rejected", { reason: "MALFORMED_JSON" });
    return reply(400, correlationId, { error: "Malformed JSON payload.", code: "MALFORMED_JSON" });
  }

  const event = typeof payload?.event === "string" ? payload.event : "";
  if (event !== "payment.captured" && event !== "order.paid") {
    log("info", correlationId, "ignored", { event: event || "unknown" });
    return reply(200, correlationId, { received: true, outcome: "ignored" });
  }

  const details = extractWebhookEventDetails(payload);
  if (!details) {
    // Signed, supported event type without a usable payment / order entity: record, never fulfil (R5).
    return deadLetter(correlationId, eventIdHeader, rawBody, "MALFORMED_EVENT", { event });
  }

  const eventFields = {
    event,
    intentId: details.intentId,
    orderId: details.orderId,
    paymentId: details.paymentId,
    amountPaise: details.capturedPaise,
    currency: details.capturedCurrency,
  };

  // 4. Process (FIN-002 / B2: one transaction decides and records; idempotent)
  try {
    const result = await processWebhookPayment(getServerFirestore(), details, {
      correlationId,
      eventId: eventIdHeader,
      rawBody,
    });
    // Logged only after the transaction committed.
    if (result.outcome === "processed" || result.outcome === "already_processed") {
      log("info", correlationId, result.outcome === "already_processed" ? "duplicate" : "processed", {
        event,
        intentId: details.intentId,
        orderId: details.orderId,
        paymentId: details.paymentId,
      });
      return reply(200, correlationId, { success: true, outcome: result.outcome });
    }
    log("warn", correlationId, "recorded_for_reconciliation", {
      event,
      decision: result.outcome,
      reason: result.code,
      record: result.deadLetterKey,
      registry: result.paymentRecorded,
      intentId: details.intentId,
      orderId: details.orderId,
      paymentId: details.paymentId,
    });
    return reply(200, correlationId, {
      received: true,
      outcome: "recorded_for_reconciliation",
      decision: result.outcome,
      code: result.code,
    });
  } catch (err) {
    const cls = classifyWebhookError(err);
    const errCode = (err as any)?.code;
    const fields = {
      event,
      reason: cls.reason,
      intentId: details.intentId,
      orderId: details.orderId,
      paymentId: details.paymentId,
      errCode: typeof errCode === "string" || typeof errCode === "number" ? errCode : undefined,
    };
    if (cls.kind === "retryable") {
      log("error", correlationId, "retryable", fields);
      return reply(503, correlationId, { error: "Temporary processing failure; retry expected.", code: cls.reason });
    }
    return deadLetter(correlationId, eventIdHeader, rawBody, cls.reason, eventFields);
  }
}
