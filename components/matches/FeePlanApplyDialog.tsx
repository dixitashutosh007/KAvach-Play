"use client";

/**
 * Confirm-and-apply dialog for fixed Match Fee Plans
 * (`components/matches/FeePlanApplyDialog.tsx`).
 *
 * Lists, before anything is written, every squad player a fixed plan will be
 * applied to: plan, regular fee, plan fee and what the club sponsors, plus the
 * total. Players who can't be applied automatically are listed with the
 * reason. Confirm runs the existing per-payment plan write for each row.
 */
import React from "react";
import { HandCoins, Loader2, X } from "lucide-react";
import type { FixedPlanApplication } from "@/lib/fee-plan-bulk";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function FeePlanApplyDialog({
  application,
  applying,
  onConfirm,
  onClose,
}: {
  application: FixedPlanApplication;
  applying: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { items, skipped, regularCount, totalSponsored } = application;
  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/60 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="fee-plan-apply-title">
      <div className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface shadow-xl" data-testid="fee-plan-apply-dialog">
        <div className="sticky top-0 flex items-center justify-between gap-2 px-4 py-3 bg-surface border-b border-border">
          <h2 id="fee-plan-apply-title" className="inline-flex items-center gap-2 text-base font-black font-heading text-text-primary">
            <HandCoins className="w-5 h-5 text-brand" aria-hidden="true" />
            Apply Match Fee Plans
          </h2>
          <button type="button" onClick={onClose} disabled={applying} aria-label="Close" className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-hover cursor-pointer">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2" data-testid="fee-plan-summary">
            <div className="rounded-xl border border-border px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Players on plans</p>
              <p className="text-lg font-black font-heading text-text-primary tabular-nums">{items.length}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Club sponsors</p>
              <p className="text-lg font-black font-heading text-emerald-700 tabular-nums" data-testid="fee-plan-total-sponsored">{inr(totalSponsored)}</p>
            </div>
          </div>

          {items.length > 0 ? (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 px-3 py-2 bg-surface-hover text-[10px] font-bold uppercase tracking-wide text-text-muted">
                <span>Player · plan</span>
                <span className="text-right">Fee</span>
                <span className="text-right">Club pays</span>
              </div>
              <ul className="divide-y divide-border" data-testid="fee-plan-items">
                {items.map((i) => (
                  <li key={i.paymentId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-text-primary truncate">{i.playerName}</span>
                      <span className="block text-[11px] text-text-secondary truncate">{i.plan.name}</span>
                    </span>
                    <span className="text-right text-sm tabular-nums">
                      <span className="block font-black text-text-primary">{inr(i.planFee)}</span>
                      <span className="block text-[11px] text-text-muted line-through">{inr(i.standardFee)}</span>
                    </span>
                    <span className="text-right text-sm font-black tabular-nums text-emerald-700">{inr(i.sponsored)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-text-secondary">No squad player needs a fixed Match Fee Plan applied right now.</p>
          )}

          <p className="text-xs text-text-secondary">
            {regularCount} {regularCount === 1 ? "player stays" : "players stay"} on the regular fee.
          </p>

          {skipped.length > 0 && (
            <details className="rounded-xl border border-border px-3 py-2" data-testid="fee-plan-skipped">
              <summary className="cursor-pointer text-xs font-bold text-text-secondary">Not applied automatically ({skipped.length})</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {skipped.map((s, idx) => (
                  <li key={`${s.playerName}-${idx}`} className="text-xs text-text-secondary">
                    <span className="font-bold text-text-primary">{s.playerName}</span> — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex gap-2 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={onClose} disabled={applying} className="min-h-[48px] px-5 rounded-xl border border-border text-sm font-bold text-text-primary hover:bg-surface-hover cursor-pointer">
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={applying || items.length === 0}
              data-testid="fee-plan-confirm"
              className="flex-1 min-h-[48px] rounded-xl bg-brand text-white text-sm font-black inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {applying && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              {applying ? "Applying…" : `Apply to ${items.length} ${items.length === 1 ? "player" : "players"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
