"use client";

/**
 * Finance Plans for one match (`hooks/useMatchFinancePlans.ts`).
 *
 * All calls go to `/api/finance/match-plans`, which computes amounts on the
 * server from Firestore and enforces roles; the browser sends only ids,
 * the chosen plan or amount for an override, and the reason.
 */
import { useCallback } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import type { PlanRow } from "@/lib/match-plan-application";

export interface MatchPlanPreview {
  matchId: string;
  matchDate: string;
  matchFee: number;
  blocked: string | null;
  totals: { players: number; onPlans: number; regular: number; contribution: number; sponsorship: number; pendingAllocation: number };
  rows: Omit<PlanRow, "fields">[];
  changeCount: number;
  written?: number;
}

export type MatchPlanRequest =
  | { action: "preview"; matchId: string }
  | { action: "apply"; matchId: string; scope?: "all" | "refresh" }
  | { action: "override"; matchId: string; paymentId: string; reason: string; contribution?: number; planId?: string; regular?: boolean }
  | { action: "clearOverride"; matchId: string; paymentId: string; reason: string };

export type MatchPlanResult = { ok: true; data: MatchPlanPreview | { ok: true } } | { ok: false; error: string; status?: number };

export async function callMatchPlans(payload: MatchPlanRequest): Promise<MatchPlanResult> {
  try {
    const res = await authedFetch("/api/finance/match-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error || "The request failed.", status: res.status };
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The request failed." };
  }
}

export function useMatchFinancePlans(matchId: string) {
  const preview = useCallback(() => callMatchPlans({ action: "preview", matchId }), [matchId]);
  const apply = useCallback((scope: "all" | "refresh" = "all") => callMatchPlans({ action: "apply", matchId, scope }), [matchId]);
  const override = useCallback(
    (paymentId: string, reason: string, opts: { contribution?: number; planId?: string; regular?: boolean }) =>
      callMatchPlans({ action: "override", matchId, paymentId, reason, ...opts }),
    [matchId],
  );
  const clearOverride = useCallback(
    (paymentId: string, reason: string) => callMatchPlans({ action: "clearOverride", matchId, paymentId, reason }),
    [matchId],
  );
  return { preview, apply, override, clearOverride };
}
