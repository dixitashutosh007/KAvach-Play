import { getOperationalWeekStartMs } from "./action-centre.ts";

export interface ActivityNotificationLike {
  id: string;
  userId?: string;
  title?: string;
  message?: string;
  createdAt?: unknown;
  metadata?: { type?: string } | null;
}

const OBSOLETE_ADMIN_PROMPT_PATTERNS = [
  /\bassign\s+captain\b/i,
  /\bfriday\s+captain\s+reminder\b/i,
  /\bplayer\s+of\s+the\s+week(?:end)?\b/i,
  /\bactual\s+match\s+fee\b/i,
  /\bmatch\s+fee\s+(?:entry|reminder|prompt)\b/i,
];

function toMillis(ts: unknown): number | null {
  if (!ts) return null;
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  if (ts instanceof Date) return Number.isFinite(ts.getTime()) ? ts.getTime() : null;
  if (typeof ts === "object" && ts !== null) {
    const obj = ts as { seconds?: number; toMillis?: () => number };
    if (typeof obj.toMillis === "function") return obj.toMillis();
    if (typeof obj.seconds === "number") return obj.seconds * 1000;
  }
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Returns true for stale historical administrative prompt notifications
 * (Assign Captain, Player of the Week/Weekend, Match Fee entry prompts)
 * created before the current operational week.
 *
 * Non-destructive: used for UI filtering only; never deletes Firestore records
 * and never hides player notifications, award announcements, or financial records.
 */
export function isObsoleteAdminActivityNotification(
  notif: ActivityNotificationLike,
  nowMs: number = Date.now(),
): boolean {
  if (notif.userId !== "admin" && notif.userId !== "all") return false;
  const metaType = String(notif.metadata?.type || "").toLowerCase();
  if (metaType === "potw_award" || metaType === "payment_receipt" || metaType === "player_request") {
    return false;
  }

  const text = `${notif.title || ""} ${notif.message || ""}`.trim();
  const matchesObsoletePrompt =
    OBSOLETE_ADMIN_PROMPT_PATTERNS.some((re) => re.test(text)) ||
    metaType === "captain_reminder" ||
    metaType === "potw_prompt" ||
    metaType === "match_fee_prompt";

  if (!matchesObsoletePrompt) return false;

  const createdMs = toMillis(notif.createdAt);
  if (createdMs === null) return true;
  return createdMs < getOperationalWeekStartMs(nowMs);
}

/**
 * Filters notifications for the Notification Hub without mutating Firestore.
 */
export function filterVisibleNotifications<T extends ActivityNotificationLike>(
  notifications: readonly T[],
  opts: { isAdmin: boolean; uid?: string | null; nowMs?: number },
): T[] {
  const nowMs = opts.nowMs ?? Date.now();
  return notifications.filter((n) => {
    if (opts.isAdmin) {
      if (n.userId !== "admin" && n.userId !== "all") return false;
      return !isObsoleteAdminActivityNotification(n, nowMs);
    }
    return n.userId === opts.uid || n.userId === "all";
  });
}
