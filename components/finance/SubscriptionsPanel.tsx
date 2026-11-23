"use client";

/**
 * Monthly Subscription periods (`components/finance/SubscriptionsPanel.tsx`).
 *
 * One row per player per month on a Monthly Subscription plan: amount, status,
 * validity, and — once closed — how the subscription was allocated to the
 * matches played (leftover is club income; no carry-forward). Finance / Super
 * Admins create the month's periods, record or void a payment, edit validity
 * (with a reason) and close a period after it ends. Others view. Every action
 * goes through /api/finance/subscriptions, which re-checks the role.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { getClubCalendarDate } from "@/lib/utils";
import type { SubscriptionMethod, SubscriptionPeriod } from "@/lib/subscription-periods";
import { ErrorNote, FIELD, Metric, PRIMARY_BTN, SECONDARY_BTN, Sheet, fmtDate, inr } from "./FinanceUi";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
};
const shift = (m: string, d: number) => {
  const [y, mo] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};

async function post(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string; data?: any }> {
  try {
    const res = await authedFetch("/api/finance/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const json = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data: json } : { ok: false, error: json.error || "The change could not be saved." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The change could not be saved." };
  }
}

type Action = { kind: "pay" | "void" | "validity"; period: SubscriptionPeriod } | null;

export function SubscriptionsPanel({ canManage, todayKey: todayProp }: { canManage: boolean; todayKey?: string }) {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const todayKey = todayProp || getClubCalendarDate().dateString;
  const [month, setMonth] = useState(todayKey.slice(0, 7));
  const [periods, setPeriods] = useState<SubscriptionPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/finance/subscriptions?month=${month}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load subscriptions.");
      setPeriods((json.periods || []).sort((a: SubscriptionPeriod, b: SubscriptionPeriod) => a.playerName.localeCompare(b.playerName)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load subscriptions.");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const totals = useMemo(() => {
    const t = { billed: 0, collected: 0, outstanding: 0, unused: 0 };
    for (const p of periods) {
      t.billed += p.amount;
      if (p.status === "paid") t.collected += p.paidAmount ?? p.amount;
      else t.outstanding += p.amount;
      if (p.closed) t.unused += p.settlement?.unused || 0;
    }
    return t;
  }, [periods]);

  const run = async (payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    const r = await post(payload);
    setBusy(false);
    if (!r.ok) {
      toast(r.error || "The change could not be saved.", "error");
      return false;
    }
    toast(success, "success");
    setAction(null);
    load();
    return true;
  };

  const createPeriods = async () => {
    setBusy(true);
    const r = await post({ action: "createForMonth", month });
    setBusy(false);
    if (!r.ok) return toast(r.error || "Could not create periods.", "error");
    toast(r.data?.created ? `Created ${r.data.created} subscription period${r.data.created === 1 ? "" : "s"}` : "Every subscriber already has a period for this month", "success");
    load();
  };

  const closePeriod = async (p: SubscriptionPeriod) => {
    const ok = await confirm({
      message: `Close ${p.playerName}'s ${monthLabel(p.month)} subscription? The ${inr(p.amount)} is allocated to the matches they played; anything left over is club income (no carry-forward). This can't be undone.${p.status !== "paid" ? " The subscription is not recorded as paid yet." : ""}`,
    });
    if (!ok) return;
    setBusy(true);
    const r = await post({ action: "close", periodId: p.id });
    setBusy(false);
    if (!r.ok) return toast(r.error || "Could not close the period.", "error");
    const s = r.data?.settlement;
    toast(s ? `Closed: ${s.allocations.length} match${s.allocations.length === 1 ? "" : "es"}, ${inr(s.allocatedTotal)} allocated, ${inr(s.unused)} unused` : "Closed", "success");
    load();
  };

  return (
    <div className="flex flex-col gap-4" data-testid="finance-subscriptions">
      {action?.kind === "pay" && <PaySheet period={action.period} busy={busy} onClose={() => setAction(null)} onSave={(method, note) => run({ action: "recordPayment", periodId: action.period.id, method, note }, "Subscription payment recorded")} />}
      {action?.kind === "void" && <ReasonSheet title="Void payment" hint={`Mark ${action.period.playerName}'s ${inr(action.period.paidAmount ?? action.period.amount)} as not received. The record is kept in the history.`} busy={busy} onClose={() => setAction(null)} onSave={(reason) => run({ action: "voidPayment", periodId: action.period.id, reason }, "Payment voided")} />}
      {action?.kind === "validity" && <ValiditySheet period={action.period} busy={busy} onClose={() => setAction(null)} onSave={(periodEnd, reason) => run({ action: "editValidity", periodId: action.period.id, periodEnd, reason }, "Validity updated")} />}

      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setMonth((m) => shift(m, -1))} aria-label="Previous month" className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-surface-hover cursor-pointer">
          <ChevronLeft className="w-5 h-5" aria-hidden="true" />
        </button>
        <p className="text-base font-black font-heading text-text-primary" aria-live="polite">{monthLabel(month)}</p>
        <button type="button" onClick={() => setMonth((m) => shift(m, 1))} aria-label="Next month" className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-surface-hover cursor-pointer">
          <ChevronRight className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Metric label="Billed" value={inr(totals.billed)} />
        <Metric label="Collected" value={inr(totals.collected)} tone="success" />
        <Metric label="Outstanding" value={inr(totals.outstanding)} tone="warning" />
        <Metric label="Unused (club income)" value={inr(totals.unused)} />
      </div>

      {canManage && (
        <button type="button" onClick={createPeriods} disabled={busy} data-testid="subscriptions-create" className="self-start inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl border border-brand/30 text-sm font-bold text-brand hover:bg-brand-surface disabled:opacity-50 cursor-pointer">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
          Create {monthLabel(month)} periods
        </button>
      )}

      {error && <ErrorNote message={error} onRetry={load} />}
      {loading && !periods.length ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : periods.length === 0 ? (
        <p className="text-sm text-text-secondary">No subscription periods for {monthLabel(month)}.{canManage ? " Create them for players on a Monthly Subscription plan." : ""}</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="subscriptions-list">
          {periods.map((p) => (
            <li key={p.id} className="rounded-2xl border border-border bg-surface p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text-primary truncate">{p.playerName}</p>
                  <p className="text-xs text-text-secondary">
                    {p.planName} · {fmtDate(p.periodStart)} → {fmtDate(p.periodEnd)}
                  </p>
                  {(p.validityEdits || []).length > 0 && <p className="text-[11px] text-text-muted">Validity changed: {p.validityEdits!.at(-1)!.reason}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-black tabular-nums text-text-primary">{inr(p.amount)}</p>
                  <span className={`inline-block mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${p.closed ? "bg-surface-hover text-text-secondary" : p.status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                    {p.closed ? "Closed" : p.status === "paid" ? `Paid · ${p.paidMethod?.toUpperCase()}` : "Due"}
                  </span>
                </div>
              </div>

              {p.closed && p.settlement && (
                <div className="rounded-xl bg-surface-hover px-3 py-2 text-xs text-text-secondary" data-testid={`subscription-settlement-${p.id}`}>
                  <p>
                    {p.settlement.allocations.length} match{p.settlement.allocations.length === 1 ? "" : "es"} · allocated {inr(p.settlement.allocatedTotal)} · club sponsored {inr(p.settlement.sponsorshipTotal)} · unused {inr(p.settlement.unused)}
                  </p>
                  {p.settlement.allocations.map((a) => (
                    <p key={a.paymentId} className="tabular-nums">
                      {fmtDate(a.date)} vs {a.opponent || "Match"}: subscription {inr(a.allocated)}, club {inr(a.sponsorship)}
                    </p>
                  ))}
                </div>
              )}

              {canManage && !p.closed && (
                <div className="flex flex-wrap gap-1.5">
                  {p.status !== "paid" ? (
                    <SmallBtn onClick={() => setAction({ kind: "pay", period: p })} testId={`subscription-pay-${p.id}`}>Record payment</SmallBtn>
                  ) : (
                    <SmallBtn onClick={() => setAction({ kind: "void", period: p })}>Void payment</SmallBtn>
                  )}
                  <SmallBtn onClick={() => setAction({ kind: "validity", period: p })}>Edit validity</SmallBtn>
                  <SmallBtn onClick={() => closePeriod(p)} disabled={busy || p.periodEnd >= todayKey} title={p.periodEnd >= todayKey ? `Can be closed after ${fmtDate(p.periodEnd)}` : undefined} testId={`subscription-close-${p.id}`}>
                    Close period
                  </SmallBtn>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SmallBtn({ children, onClick, disabled, title, testId }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string; testId?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} data-testid={testId} className="min-h-[40px] px-3 rounded-lg border border-border text-xs font-bold text-text-primary hover:bg-surface-hover disabled:opacity-40 cursor-pointer">
      {children}
    </button>
  );
}

function PaySheet({ period, busy, onClose, onSave }: { period: SubscriptionPeriod; busy: boolean; onClose: () => void; onSave: (m: SubscriptionMethod, note: string) => void }) {
  const [method, setMethod] = useState<SubscriptionMethod>("upi");
  const [note, setNote] = useState("");
  return (
    <Sheet title={`Record payment · ${period.playerName}`} onClose={onClose} testId="subscription-pay-sheet">
      <p className="text-sm text-text-secondary">
        {period.planName}, {monthLabel(period.month)}: <span className="font-bold text-text-primary">{inr(period.amount)}</span> (full plan amount)
      </p>
      <fieldset className="flex gap-2">
        <legend className="sr-only">Method</legend>
        {(["upi", "cash", "bank"] as SubscriptionMethod[]).map((m) => (
          <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={`flex-1 min-h-[44px] rounded-xl border text-sm font-bold cursor-pointer ${method === m ? "bg-brand text-white border-brand" : "border-border text-text-primary"}`}>
            {m === "upi" ? "UPI" : m === "cash" ? "Cash" : "Bank"}
          </button>
        ))}
      </fieldset>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Reference / note (optional)" className={FIELD} />
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className={SECONDARY_BTN}>Cancel</button>
        <button type="button" disabled={busy} onClick={() => onSave(method, note.trim())} className={PRIMARY_BTN}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Record {inr(period.amount)}
        </button>
      </div>
    </Sheet>
  );
}

function ReasonSheet({ title, hint, busy, onClose, onSave }: { title: string; hint: string; busy: boolean; onClose: () => void; onSave: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="text-sm text-text-secondary">{hint}</p>
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason (required)" className={FIELD} />
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className={SECONDARY_BTN}>Cancel</button>
        <button type="button" disabled={busy || !reason.trim()} onClick={() => onSave(reason.trim())} className={PRIMARY_BTN}>Save</button>
      </div>
    </Sheet>
  );
}

function ValiditySheet({ period, busy, onClose, onSave }: { period: SubscriptionPeriod; busy: boolean; onClose: () => void; onSave: (end: string, reason: string) => void }) {
  const [end, setEnd] = useState(period.periodEnd);
  const [reason, setReason] = useState("");
  return (
    <Sheet title={`Edit validity · ${period.playerName}`} onClose={onClose} testId="subscription-validity-sheet">
      <p className="text-sm text-text-secondary">
        Starts {fmtDate(period.periodStart)}. Matches up to the new end date count towards this subscription when it closes.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold text-text-secondary">Valid until</span>
        <input type="date" value={end} min={period.periodStart} onChange={(e) => setEnd(e.target.value)} className={FIELD} />
      </label>
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason (required), e.g. washed-out weekends" className={FIELD} />
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className={SECONDARY_BTN}>Cancel</button>
        <button type="button" disabled={busy || !reason.trim() || !end || end === period.periodEnd} onClick={() => onSave(end, reason.trim())} className={PRIMARY_BTN}>Save</button>
      </div>
    </Sheet>
  );
}
