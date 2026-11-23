"use client";

/**
 * Apply Finance Plans to a match squad (`components/matches/FeePlanApplyDialog.tsx`).
 *
 * Shows the server-computed breakdown (plan in effect on the MATCH DATE for
 * each squad player: player pays / club sponsors), what will change, and who
 * is left alone and why. Confirm asks the server to apply; amounts are never
 * sent from the browser. Read-only for roles that can view but not apply.
 */
import React, { useCallback, useEffect, useState } from "react";
import { HandCoins, Loader2, X } from "lucide-react";
import { useMatchFinancePlans, type MatchPlanPreview } from "@/hooks/useMatchFinancePlans";
import { PLAN_TYPE_LABEL } from "@/lib/finance-plans";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const ACTION_LABEL: Record<string, { text: string; cls: string }> = {
  apply: { text: "Apply", cls: "bg-brand-surface text-brand" },
  update: { text: "Update", cls: "bg-amber-50 text-amber-800" },
  revert: { text: "Back to regular", cls: "bg-amber-50 text-amber-800" },
  unchanged: { text: "Applied", cls: "bg-emerald-50 text-emerald-700" },
  regular: { text: "Regular", cls: "bg-surface-hover text-text-secondary" },
  skip: { text: "Left as is", cls: "bg-surface-hover text-text-secondary" },
};

export function FeePlanApplyDialog({
  matchId,
  canApply,
  onClose,
  onApplied,
}: {
  matchId: string;
  /** Match, Finance or Super Admin. Club Admins see the breakdown only. */
  canApply: boolean;
  onClose: () => void;
  onApplied: (written: number, sponsorship: number) => void;
}) {
  const { preview, apply } = useMatchFinancePlans(matchId);
  const [data, setData] = useState<MatchPlanPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await preview();
    if (r.ok) setData(r.data as MatchPlanPreview);
    else setError(r.error);
    setLoading(false);
  }, [preview]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const confirm = async () => {
    if (applying) return;
    setApplying(true);
    setError(null);
    const r = await apply("all");
    setApplying(false);
    if (!r.ok) {
      setError(r.error);
      load();
      return;
    }
    const d = r.data as MatchPlanPreview;
    onApplied(d.written ?? 0, d.totals.sponsorship);
  };

  const changes = data?.rows.filter((r) => r.action === "apply" || r.action === "update" || r.action === "revert") || [];
  const others = data?.rows.filter((r) => !changes.includes(r)) || [];

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/60 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="fee-plan-apply-title">
      <div className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface shadow-xl" data-testid="fee-plan-apply-dialog">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 bg-surface border-b border-border">
          <h2 id="fee-plan-apply-title" className="inline-flex items-center gap-2 text-base font-black font-heading text-text-primary">
            <HandCoins className="w-5 h-5 text-brand" aria-hidden="true" />
            Finance Plans for this match
          </h2>
          <button type="button" onClick={onClose} disabled={applying} aria-label="Close" className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-surface-hover cursor-pointer">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {loading && !data ? (
            <p className="inline-flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Working out each player's plan…
            </p>
          ) : null}

          {error && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" data-testid="fee-plan-error">
              {error}
            </p>
          )}

          {data && data.blocked && <p className="text-sm font-semibold text-text-primary">{data.blocked}</p>}

          {data && !data.blocked && (
            <>
              <p className="text-xs text-text-secondary">
                Plans in effect on the match date ({data.matchDate}) · match fee {inr(data.matchFee)} per player.
              </p>
              <div className="grid grid-cols-3 gap-2" data-testid="fee-plan-summary">
                <div className="rounded-xl border border-border px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">On plans</p>
                  <p className="text-lg font-black font-heading text-text-primary tabular-nums">
                    {data.totals.onPlans}
                    <span className="text-xs font-semibold text-text-muted"> / {data.totals.players}</span>
                  </p>
                </div>
                <div className="rounded-xl border border-border px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Players pay</p>
                  <p className="text-lg font-black font-heading text-text-primary tabular-nums">{inr(data.totals.contribution)}</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Club sponsors</p>
                  <p className="text-lg font-black font-heading text-emerald-700 tabular-nums" data-testid="fee-plan-total-sponsored">
                    {inr(data.totals.sponsorship)}
                  </p>
                </div>
              </div>

              <RowList title={changes.length ? `Will change (${changes.length})` : "Nothing to change"} rows={changes} testId="fee-plan-items" />
              {changes.length === 0 && <p className="text-sm text-text-secondary">Every squad player already has the right fee for their plan.</p>}
              {others.length > 0 && (
                <details className="rounded-xl border border-border px-3 py-2" data-testid="fee-plan-skipped" open={changes.length === 0}>
                  <summary className="cursor-pointer text-xs font-bold text-text-secondary min-h-[32px] flex items-center">Everyone else ({others.length})</summary>
                  <RowList rows={others} />
                </details>
              )}
            </>
          )}

          <div className="flex gap-2 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={onClose} disabled={applying} className="min-h-[48px] px-5 rounded-xl border border-border text-sm font-bold text-text-primary hover:bg-surface-hover cursor-pointer">
              {canApply ? "Cancel" : "Close"}
            </button>
            {canApply && (
              <button
                type="button"
                onClick={confirm}
                disabled={applying || loading || !data || !!data.blocked || changes.length === 0}
                data-testid="fee-plan-confirm"
                className="flex-1 min-h-[48px] rounded-xl bg-brand text-white text-sm font-black inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {applying && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {applying ? "Applying…" : `Apply to ${changes.length} ${changes.length === 1 ? "player" : "players"}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RowList({ title, rows, testId }: { title?: string; rows: MatchPlanPreview["rows"]; testId?: string }) {
  if (!rows.length) return title ? <p className="text-xs font-bold uppercase tracking-wide text-text-muted">{title}</p> : null;
  return (
    <div className="flex flex-col gap-1.5">
      {title && <p className="text-xs font-bold uppercase tracking-wide text-text-muted">{title}</p>}
      <ul className="rounded-xl border border-border divide-y divide-border overflow-hidden" data-testid={testId}>
        {rows.map((r) => {
          const badge = ACTION_LABEL[r.action] || ACTION_LABEL.skip;
          const regularNow = r.action === "revert" || r.planType === "regular";
          return (
            <li key={r.paymentId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-bold text-text-primary truncate">{r.playerName}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.text}</span>
                </span>
                <span className="block text-[11px] text-text-secondary truncate">
                  {regularNow ? "Regular" : `${r.planName} · ${PLAN_TYPE_LABEL[r.planType] || r.planType}`}
                  {r.legacy ? " · legacy assignment" : ""}
                </span>
                {r.reason && <span className="block text-[11px] text-text-muted">{r.reason}</span>}
                {r.warning && <span className="block text-[11px] font-semibold text-amber-700">{r.warning}</span>}
                {r.pendingAllocation && <span className="block text-[11px] text-blue-700">Covered by subscription · amount set when the period closes</span>}
              </span>
              <span className="text-right text-sm tabular-nums">
                <span className="block font-black text-text-primary">{r.pendingAllocation ? "Sub" : inr(regularNow && r.action === "revert" ? r.fee : r.contribution)}</span>
                {r.sponsorship > 0 && r.action !== "revert" && (
                  <span className="block text-[11px] font-bold text-emerald-700">club {inr(r.sponsorship)}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
