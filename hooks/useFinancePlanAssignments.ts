"use client";

/**
 * Finance Plan assignments for admin screens (`hooks/useFinancePlanAssignments.ts`).
 *
 * Reads and writes go through `/api/finance/assignments` (Admin SDK, server-side
 * role checks); the browser never reads or writes the collection directly.
 */
import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import type { FinancePlanAssignment } from "@/lib/types";

export type AssignmentAction =
  | { action: "assign"; planId: string; playerIds: string[]; startDate: string; endDate: string | null }
  | { action: "end"; assignmentId: string; endDate: string; reason: string }
  | { action: "cancel"; assignmentId: string; reason: string }
  | { action: "endLegacy"; playerId: string; planId: string; endDate: string; reason: string };

export interface AssignmentActionResult {
  ok: boolean;
  error?: string;
  conflicts?: { playerId: string; playerName: string; message: string }[];
}

export function useFinancePlanAssignments(enabled = true) {
  const [assignments, setAssignments] = useState<FinancePlanAssignment[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch("/api/finance/assignments");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load plan assignments.");
      setAssignments(Array.isArray(json.assignments) ? json.assignments : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load plan assignments.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = useCallback(
    async (payload: AssignmentAction): Promise<AssignmentActionResult> => {
      try {
        const res = await authedFetch("/api/finance/assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          return { ok: false, error: json.error || "The change could not be saved.", conflicts: json.details?.conflicts };
        }
        await refresh();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "The change could not be saved." };
      }
    },
    [refresh],
  );

  return { assignments, loading, error, refresh, run };
}
