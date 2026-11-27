import crypto from "node:crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;

/**
 * Shared Firestore-backed fixed-window rate limiter (`rateLimits/{docId}`).
 *
 * Security & correctness properties (P2-API-05):
 * - Strong collision resistance via 256-bit SHA-256 digest of `${scope}:${key}`
 *   truncated to 128 bits (32 hex chars), with no lossy character replacement.
 * - Does NOT store raw UIDs/IPs in the rate-limit document ID or fields.
 * - Stores Firestore `Timestamp` `expiresAt` for native Firestore TTL cleanup.
 * - Fail-closed: Firestore transaction errors propagate so callers return 5xx
 *   rather than bypassing rate limiting during DB degradation.
 */
export async function checkSharedRateLimit(
  db: Firestore,
  scope: string,
  key: string,
  options: { windowMs?: number; maxRequests?: number; nowMs?: number } = {},
): Promise<{ allowed: boolean; retryAfterSec: number; remaining: number }> {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const now = options.nowMs ?? Date.now();
  const windowId = Math.floor(now / windowMs);
  const windowEndMs = (windowId + 1) * windowMs;
  const retryAfterSec = Math.max(1, Math.ceil((windowEndMs - now) / 1000));

  const keyHash = crypto.createHash("sha256").update(`${scope}:${key}`).digest("hex").slice(0, 32);
  const docRef = db.collection("rateLimits").doc(`${keyHash}_${windowId}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const currentCount = snap.exists ? Number(snap.data()?.count || 0) : 0;
    if (currentCount >= maxRequests) {
      return { allowed: false, retryAfterSec, remaining: 0 };
    }
    const nextCount = currentCount + 1;
    tx.set(
      docRef,
      {
        scope,
        windowId,
        count: nextCount,
        expiresAt: Timestamp.fromMillis(windowEndMs + windowMs),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { allowed: true, retryAfterSec: 0, remaining: Math.max(0, maxRequests - nextCount) };
  });
}
