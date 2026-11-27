import { FieldValue, type Firestore } from "firebase-admin/firestore";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;

/**
 * Shared Firestore-backed fixed-window rate limiter (`rateLimits/{docId}`).
 * Safe across multiple serverless / Cloud Run instances and testable in the
 * Firebase Emulator. Clients cannot read or write `rateLimits` (default-deny).
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

  const safeKey = `${scope}_${key}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
  const docRef = db.collection("rateLimits").doc(`${safeKey}_${windowId}`);

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
        key,
        windowId,
        count: nextCount,
        expiresAt: new Date(windowEndMs + windowMs),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { allowed: true, retryAfterSec: 0, remaining: Math.max(0, maxRequests - nextCount) };
  });
}
