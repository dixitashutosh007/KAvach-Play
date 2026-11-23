"use client";

/**
 * Finance/Super Admin fee override for one squad player
 * (`components/matches/FeeOverrideSheet.tsx`).
 *
 * Choose a plan for this match only, set the amount the player pays, or return
 * the player to the plan rule. A reason is required. The server re-checks the
 * role, recomputes amounts from the match and plan, records the override on the
 * payment's finance snapshot (with what the plan rule would have produced) and
 * writes an audit entry.
 */
import React, { useState } from "react";
import { Loader2, X } from "lucide-react";
import type { FeePlan, MatchPayment } from "@/lib/types";
import { PLAN_TYPE_LABEL, planContribution } from "@/lib/finance-plans";
import { isPristineRegular, isUntouchedAuto } from "@/lib/match-plan-application";
import { useMatchFinancePlans } from "@/hooks/useMatchFinancePlans";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
type Mode = "amount" | "plan" | "rule";

export function FeeOverrideSheet({
  matchId,
  payment,
  playerName,
  matchFee,
  plans,
  onClose,
  onDone,
}: {
  matchId: string;
  payment: MatchPayment;
  playerName: string;
  matchFee: number;
  plans: FeePlan[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { override, clearOverride } = useMatchFinancePlans(matchId);
  const followsRule = isPristineRegular(payment) || isUntouchedAuto(payment);
  const activePlans = plans.filter((p) => p.isActive !== false);
  const [mode, setMode] = useState<Mode>("amount");
  const [amount, setAmount] = useState<string>(String(payment.feeOverride ?? matchFee));
  const [planId, setPlanId] = useState<string>("");
  const [allocated, setAllocated] = useState<string>("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fee = Math.max(0, Math.round(Number(matchFee) || 0));
  const plan = activePlans.find((p) => p.id === planId) || null;
  const calc = plan ? planContribution(plan, fee) : null;
  const needsAllocation = !!calc?.pendingAllocation;

  let preview: { pays: number; club: number } | null = null;
  if (mode === "amount" && amount !== "" && Number.isFinite(Number(amount))) {
    const c = Math.max(0, Math.min(fee, Math.round(Number(amount))));
    preview = { pays: c, club: fee - c };
  } else if (mode === "plan" && calc) {
    if (needsAllocation) {
      const a = Math.max(0, Math.min(fee, Math.round(Number(allocated) || 0)));
      preview = { pays: a, club: fee - a };
    } else {
      preview = { pays: calc.contribution, club: calc.sponsorship };
    }
  }

  const submit = async () => {
    setError(null);
    if (!reason.trim()) return setError("Give a reason for the change.");
    if (mode === "amount") {
      const n = Number(amount);
      if (amount === "" || !Number.isFinite(n) || n < 0) return setError("Enter the amount the player pays (₹0 or more).");
      if (Math.round(n) > fee) return setError(`The player's amount can't be more than the match fee (${inr(fee)}).`);
    }
    if (mode === "plan") {
      if (!plan) return setError("Choose a plan.");
      if (needsAllocation && (allocated === "" || !Number.isFinite(Number(allocated)) || Number(allocated) < 0)) {
        return setError("Enter the amount allocated from the subscription.");
      }
    }
    setSaving(true);
    const r =
      mode === "rule"
        ? await clearOverride(payment.id, reason.trim())
        : mode === "plan"
          ? await override(payment.id, reason.trim(), { planId, ...(needsAllocation ? { contribution: Number(allocated) } : {}) })
          : await override(payment.id, reason.trim(), { contribution: Number(amount) });
    setSaving(false);
    if (!r.ok) return setError(r.error);
    onDone(mode === "rule" ? `${playerName} is back on the plan rule` : `${playerName}'s fee updated`);
  };

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => setMode(m)}
      className={`flex-1 min-h-[44px] rounded-lg text-xs font-bold cursor-pointer ${mode === m ? "bg-brand text-white" : "text-text-secondary hover:bg-surface-hover"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/60 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="fee-override-title">
      <div className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface shadow-xl" data-testid="fee-override-sheet">
        <div className="sticky top-0 flex items-center justify-between gap-2 px-4 py-3 bg-surface border-b border-border">
          <div className="min-w-0">
            <h2 id="fee-override-title" className="text-base font-black font-heading text-text-primary truncate">Adjust fee · {playerName}</h2>
            <p className="text-[11px] text-text-secondary">Match fee {inr(fee)} · Finance Admin override, audited</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center hover:bg-surface-hover cursor-pointer">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {payment.financeSnapshot && (
            <p className="rounded-xl bg-surface-hover px-3 py-2 text-xs text-text-secondary" data-testid="fee-override-current">
              Now: <span className="font-bold text-text-primary">{payment.financeSnapshot.planName}</span> · player{" "}
              {inr(payment.financeSnapshot.contribution)} · club {inr(payment.financeSnapshot.sponsorship)}
              {payment.financeSnapshot.override?.reason ? ` · “${payment.financeSnapshot.override.reason}”` : ""}
            </p>
          )}

          <div className="flex gap-1 rounded-xl border border-border p-1" role="tablist" aria-label="Adjustment type">
            {tab("amount", "Set amount")}
            {tab("plan", "Use a plan")}
            {!followsRule && tab("rule", "Plan rule")}
          </div>

          {mode === "amount" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-text-secondary">Player pays (₹)</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={fee}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="fee-override-amount"
                className="min-h-[48px] rounded-xl border border-border bg-surface px-3 text-base font-bold tabular-nums text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              <span className="text-[11px] text-text-muted">₹0 means the club sponsors the full fee.</span>
            </label>
          )}

          {mode === "plan" && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-text-secondary">Plan for this match only</span>
                <select
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  data-testid="fee-override-plan"
                  className="min-h-[48px] rounded-xl border border-border bg-surface px-3 text-sm font-bold text-text-primary"
                >
                  <option value="">Choose a plan</option>
                  {activePlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {PLAN_TYPE_LABEL[p.type] || p.type}
                    </option>
                  ))}
                </select>
              </label>
              {needsAllocation && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-text-secondary">Allocated from the subscription (₹)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={fee}
                    value={allocated}
                    onChange={(e) => setAllocated(e.target.value)}
                    className="min-h-[48px] rounded-xl border border-border bg-surface px-3 text-base font-bold tabular-nums text-text-primary"
                  />
                </label>
              )}
              {calc?.warning && <p className="text-[11px] font-semibold text-amber-700">{calc.warning}</p>}
            </div>
          )}

          {mode === "rule" && (
            <p className="text-sm text-text-secondary">
              Remove the manual adjustment and use the plan {playerName} is on for the match date (or the regular fee).
            </p>
          )}

          {preview && (
            <div className="grid grid-cols-2 gap-2" data-testid="fee-override-preview">
              <div className="rounded-xl border border-border px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Player pays</p>
                <p className="text-lg font-black font-heading tabular-nums text-text-primary">{inr(preview.pays)}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Club sponsors</p>
                <p className="text-lg font-black font-heading tabular-nums text-emerald-700">{inr(preview.club)}</p>
              </div>
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-text-secondary">Reason (required)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="e.g. Approved hardship discount"
              data-testid="fee-override-reason"
              className="min-h-[48px] rounded-xl border border-border bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {error}
            </p>
          )}

          <div className="flex gap-2 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={onClose} disabled={saving} className="min-h-[48px] px-5 rounded-xl border border-border text-sm font-bold text-text-primary hover:bg-surface-hover cursor-pointer">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              data-testid="fee-override-save"
              className="flex-1 min-h-[48px] rounded-xl bg-brand text-white text-sm font-black inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              {saving ? "Saving…" : "Save change"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
