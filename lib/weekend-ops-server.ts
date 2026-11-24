/**
 * Server helpers for the weekend match operations routes.
 * The clock is the server's; a test may pin it with `x-test-now` only when the
 * test auth bypass is allowed (NODE_ENV=test + KAVACH_TEST_AUTH_BYPASS=true).
 */
import { isTestAuthBypassAllowed } from "./server-auth.ts";

export function serverNow(req: Request): number {
  if (isTestAuthBypassAllowed()) {
    const pinned = Number(req.headers.get("x-test-now"));
    if (Number.isFinite(pinned) && pinned > 0) return pinned;
  }
  return Date.now();
}

/** Firestore path-safe document id. */
export function isSafeId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 128 && !id.includes("/") && id !== "." && id !== "..";
}

/**
 * Who may act on each prompt (verified server-side roles):
 *  - results: Super Admin + Club Admin (D-22 role consolidation; Club Admin
 *    absorbed the retired Match Admin role).
 *  - Player of the Weekend: the existing badge-award authority (Club / Super).
 *  - actual match fee: Finance / Super (the existing match-ledger guard).
 */
export const RESULT_RECORDER_ROLES = ["superAdmin", "clubAdmin"] as const;
export const POTW_AWARD_ROLES = ["superAdmin", "clubAdmin"] as const;
export const FEE_ROLES = ["superAdmin", "financeAdmin"] as const;
