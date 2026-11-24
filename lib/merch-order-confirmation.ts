/**
 * B1 (PX-1 / FIN-004): merchandise online-order identity and browser confirmation.
 *
 * - The Razorpay webhook is the ONLY creator of a Paid online merchandise order. Its document id
 *   is derived from the server-created payment intent: `mo_{intentId}` (merchOrderIdForIntent).
 * - After the gateway reports success, the browser does not write any order. It waits for the
 *   server-created document with waitForServerOrder(), reading that single document only.
 * - Absence of the document is NEVER treated as a payment failure: until the webhook commits,
 *   "not found" and "permission denied" (the rules cannot evaluate a missing document) both mean
 *   "pending". On timeout the result is "pending", never "failed".
 *
 * Pure module: no Firebase imports, so it is shared by the server (webhook) and the browser,
 * and unit-testable with an injected reader, clock and sleep.
 */

/** Firestore-safe intent ids only (server-created intents use auto-ids). */
const INTENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidIntentId(intentId: unknown): intentId is string {
  return typeof intentId === "string" && INTENT_ID_PATTERN.test(intentId);
}

/** Deterministic, server-controlled merchandise order id for one payment intent. */
export function merchOrderIdForIntent(intentId: string): string {
  if (!isValidIntentId(intentId)) {
    throw new Error("Invalid payment intent id for merchandise order identity.");
  }
  return `mo_${intentId}`;
}

export const CONFIRMATION_INTERVAL_MS = 2000;
export const CONFIRMATION_TIMEOUT_MS = 60000;

export type ServerOrderReadResult = "found" | "absent";
export type ConfirmationStatus = "confirmed" | "pending" | "cancelled";

export interface WaitForServerOrderOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Injectable clock (ms). */
  now?: () => number;
  /** Injectable sleep; must resolve after `ms` (or earlier when the signal aborts). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}

export interface ConfirmationResult {
  status: ConfirmationStatus;
  attempts: number;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Polls one server-created order document until it exists, the timeout elapses, or the signal
 * aborts. `readOrder(orderId)` performs a single-document read. Any thrown error (permission
 * denied before the document exists, network failure) counts as "absent" for this attempt.
 */
export async function waitForServerOrder(
  readOrder: (orderId: string) => Promise<ServerOrderReadResult>,
  intentId: string,
  options: WaitForServerOrderOptions = {},
): Promise<ConfirmationResult> {
  const intervalMs = options.intervalMs ?? CONFIRMATION_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? CONFIRMATION_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const { signal } = options;

  // Without a usable intent id the order cannot be looked up; it is still never a failure.
  if (!isValidIntentId(intentId)) return { status: "pending", attempts: 0 };

  const orderId = merchOrderIdForIntent(intentId);
  const deadline = now() + timeoutMs;
  let attempts = 0;

  while (true) {
    if (signal?.aborted) return { status: "cancelled", attempts };
    attempts += 1;
    let result: ServerOrderReadResult = "absent";
    try {
      result = await readOrder(orderId);
    } catch {
      result = "absent";
    }
    if (signal?.aborted) return { status: "cancelled", attempts };
    if (result === "found") return { status: "confirmed", attempts };
    if (now() + intervalMs > deadline) return { status: "pending", attempts };
    await sleep(intervalMs, signal);
  }
}
