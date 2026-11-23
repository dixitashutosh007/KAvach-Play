import { NextRequest, NextResponse } from "next/server.js";
import crypto from "crypto";
import {
  extractWebhookEventDetails,
  processWebhookIntentTransaction,
  classifyWebhookError,
} from "../../../../lib/razorpay-webhook.ts";
import {
  getServerFirestore,
  arePaymentOperationsEnabled,
} from "../../../../lib/server-db.ts";

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
 *  - 422  permanent: the event cannot match its intent. Never fulfils payment.
 *  - 200  processed, duplicate already processed, or event type we do not act on.
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
  if (!details || !details.intentId) {
    // Valid, signed, supported event that names no intent. Recorded for reconciliation in R5.
    log("warn", correlationId, "unmatched", {
      event,
      reason: details ? "NO_INTENT_ID" : "MALFORMED_EVENT",
      orderId: details?.orderId,
      paymentId: details?.paymentId,
    });
    return reply(200, correlationId, { success: true, message: "No intentId attached." });
  }

  // 4. Process (FIN-002: transactional, idempotent)
  try {
    const result = await processWebhookIntentTransaction(getServerFirestore(), details, payload);
    if (!result.success) {
      log("warn", correlationId, "permanent", { event, reason: "NO_INTENT_ID", intentId: details.intentId });
      return reply(422, correlationId, { error: "Event could not be matched to a payment intent.", code: "NO_INTENT_ID" });
    }
    log("info", correlationId, result.alreadyProcessed ? "duplicate" : "processed", {
      event,
      intentId: details.intentId,
      orderId: details.orderId,
      paymentId: details.paymentId,
    });
    return reply(200, correlationId, {
      success: true,
      outcome: result.alreadyProcessed ? "already_processed" : "processed",
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
    log("warn", correlationId, "permanent", fields);
    return reply(422, correlationId, { error: "Event does not match its payment intent.", code: cls.reason });
  }
}
