"use client";

/**
 * Manage Match — Finance tab (`components/matches/MatchFinanceTab.tsx`).
 *
 * Detailed statement (from `buildMatchFinancialStatement`), actual match fee
 * paid with its history, finance close / reopen, payments received with the
 * refund / reversal workflow, and the finance history. Finance controls are
 * shown to Finance / Super Admins only and every action goes through
 * /api/finance/match-ledger, which re-checks the role, recomputes from
 * Firestore and audits. Others see the statement read-only.
 */
import React, { useState } from "react";
import { Loader2, Lock, Unlock } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import type { Match, MatchPayment, PaymentReversal } from "@/lib/types";
import { collectedMoney, netResultLabel, type MatchFinancialStatement } from "@/lib/match-finance";
import { CollectionBar, CompositionBar, NetResultBadge, inr } from "./MatchFinancials";

export async function callLedger(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string; data?: any }> {
  try {
    const res = await authedFetch("/api/finance/match-ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const json = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data: json } : { ok: false, error: json.error || "The change could not be saved." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The change could not be saved." };
  }
}

const FIELD = "min-h-[48px] w-full rounded-xl border border-border bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30";
const PRIMARY = "flex-1 min-h-[48px] rounded-xl bg-brand text-white text-sm font-black inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer";
const SECONDARY = "min-h-[48px] px-5 rounded-xl border border-border text-sm font-bold text-text-primary hover:bg-surface-hover cursor-pointer";
const fmtWhen = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function Modal({ title, onClose, children, testId }: { title: string; onClose: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/60 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface shadow-xl" data-testid={testId}>
        <div className="sticky top-0 flex items-center justify-between gap-2 px-4 py-3 bg-surface border-b border-border">
          <h3 className="text-base font-black font-heading text-text-primary">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-surface-hover cursor-pointer text-xl leading-none">
            ×
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

function Row({ label, value, strong, tone, testId }: { label: string; value: string; strong?: boolean; tone?: "loss" | "surplus"; testId?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className={`text-sm ${strong ? "font-black text-text-primary" : "text-text-secondary"}`}>{label}</dt>
      <dd className={`text-sm tabular-nums ${strong ? "font-black" : "font-bold"} ${tone === "loss" ? "text-rose-700" : tone === "surplus" ? "text-emerald-700" : "text-text-primary"}`} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

export interface ReversalTarget {
  payment: MatchPayment;
  playerName: string;
  removeFromSquad: boolean;
}

export function ReversalSheet({ target, matchId, matchFee, onClose, onDone }: { target: ReversalTarget; matchId: string; matchFee: number; onClose: () => void; onDone: (msg: string) => void }) {
  const p = target.payment;
  const collected = collectedMoney(p, matchFee);
  const [amount, setAmount] = useState(String(collected));
  const [method, setMethod] = useState<PaymentReversal["method"]>(p.paymentMethod === "razorpay" ? "razorpay_refund" : "cash");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [remove, setRemove] = useState(target.removeFromSquad);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    if (Number(amount) !== collected) return setError(`The refund must be the full ${inr(collected)} collected. Partial refunds aren't supported yet.`);
    if (!reference.trim()) return setError(method === "cash" ? "Add the cash refund confirmation." : "Add the refund reference / transaction ID.");
    if (!reason.trim()) return setError("Give a reason for the refund.");
    setSaving(true);
    const r = await callLedger({ action: "reversePayment", matchId, paymentId: p.id, amount: Number(amount), method, reference: reference.trim(), reason: reason.trim(), removeFromSquad: remove });
    setSaving(false);
    if (!r.ok) return setError(r.error || "The refund could not be recorded.");
    onDone(`Refund of ${inr(collected)} recorded for ${target.playerName}${remove ? "; removed from the squad" : "; now Unpaid"}`);
  };
  return (
    <Modal title={`Refund · ${target.playerName}`} onClose={onClose} testId="reversal-sheet">
      <div className="rounded-xl bg-surface-hover px-3 py-2 text-xs text-text-secondary">
        Collected <span className="font-bold text-text-primary">{inr(collected)}</span> via {p.paymentMethod === "razorpay" ? `Razorpay${p.razorpayPaymentId ? ` (${p.razorpayPaymentId})` : ""}` : p.manualMethod === "deposited_directly" ? "direct deposit" : "cash"}
        {p.manualBy ? ` · recorded by ${p.manualBy}` : ""}. The original payment record is kept.
      </div>
      <p className="text-xs text-text-secondary">
        Record a refund that has already been made{method === "razorpay_refund" ? " in the Razorpay dashboard" : ""}. This does not move money.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-text-secondary">Refund amount (₹)</span>
        <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className={FIELD} data-testid="reversal-amount" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-text-secondary">Refund method</span>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentReversal["method"])} className={FIELD} data-testid="reversal-method">
          <option value="razorpay_refund">Razorpay refund</option>
          <option value="upi">UPI</option>
          <option value="bank">Bank transfer</option>
          <option value="cash">Cash</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-text-secondary">{method === "cash" ? "Cash refund confirmation (who returned it, to whom, when)" : method === "razorpay_refund" ? "Razorpay refund ID (rfnd_…)" : "Transaction reference"}</span>
        <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} className={FIELD} data-testid="reversal-reference" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-text-secondary">Reason</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={FIELD} data-testid="reversal-reason" />
      </label>
      <label className="flex items-center gap-2 min-h-[44px] text-sm text-text-primary">
        <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} className="w-5 h-5 accent-[#A30F2D]" />
        Also remove {target.playerName} from the squad
      </label>
      <p className="text-[11px] text-text-muted">After the refund the player is {remove ? "removed (Not Playing)" : "Unpaid and still in the squad"}.</p>
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onClose} disabled={saving} className={SECONDARY}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving} className={PRIMARY} data-testid="reversal-save">
          {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Record refund
        </button>
      </div>
    </Modal>
  );
}

function GroundFeeSheet({ match, mode, onClose, onDone }: { match: Match; mode: "set" | "adjust"; onClose: () => void; onDone: (msg: string) => void }) {
  const current = typeof match.groundFeePaidAmount === "number" ? match.groundFeePaidAmount : null;
  const [amount, setAmount] = useState(current === null ? "" : String(current));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsReason = mode === "adjust" || current !== null;
  const submit = async () => {
    setError(null);
    const n = Number(amount);
    if (amount === "" || !Number.isFinite(n) || n < 0) return setError("Enter the amount actually paid (₹0 or more).");
    if (needsReason && !reason.trim()) return setError("Give a reason for the change.");
    setSaving(true);
    const r = await callLedger({ action: mode === "adjust" ? "adjustGroundFee" : "setGroundFee", matchId: match.id, amount: n, reason: reason.trim() });
    setSaving(false);
    if (!r.ok) return setError(r.error || "Could not save.");
    onDone("Actual match fee paid saved");
  };
  return (
    <Modal title={mode === "adjust" ? "Adjust actual match fee paid" : current === null ? "Record actual match fee paid" : "Correct actual match fee paid"} onClose={onClose} testId="ground-fee-sheet">
      <p className="text-xs text-text-secondary">
        What the club actually paid the ground / vendor for this match. This is never assumed to equal the system match fee.
        {mode === "adjust" ? " Finances are closed, so this is recorded as an authorised adjustment." : ""}
      </p>
      <input type="number" inputMode="numeric" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₹" className={FIELD} data-testid="ground-fee-amount" />
      {needsReason && <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason (required)" className={FIELD} data-testid="ground-fee-reason" />}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onClose} disabled={saving} className={SECONDARY}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving} className={PRIMARY} data-testid="ground-fee-save">
          {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Save
        </button>
      </div>
    </Modal>
  );
}

function ReasonModal({ title, hint, onClose, onSubmit }: { title: string; hint: string; onClose: () => void; onSubmit: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-text-secondary">{hint}</p>
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason (required)" className={FIELD} />
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onClose} disabled={saving} className={SECONDARY}>Cancel</button>
        <button
          type="button"
          disabled={saving || !reason.trim()}
          onClick={async () => {
            setSaving(true);
            const err = await onSubmit(reason.trim());
            setSaving(false);
            if (err) setError(err);
          }}
          className={PRIMARY}
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Confirm
        </button>
      </div>
    </Modal>
  );
}

export function MatchFinanceTab({
  match,
  statement: s,
  payments,
  playerName,
  canManageFees,
  onReverse,
  toast,
  confirm,
}: {
  match: Match;
  statement: MatchFinancialStatement;
  payments: MatchPayment[];
  playerName: (p: MatchPayment) => string;
  canManageFees: boolean;
  onReverse: (t: ReversalTarget) => void;
  toast: (msg: string, kind?: "success" | "error") => void;
  confirm: (opts: { message: string; destructive?: boolean }) => Promise<boolean>;
}) {
  const [sheet, setSheet] = useState<null | "set" | "adjust" | "reopen">(null);
  const [busy, setBusy] = useState(false);
  const closed = s.financeClosed;
  const net = netResultLabel(s.netResult);
  const received = payments.filter((p) => p.matchId === match.id && collectedMoney(p, match.fee) > 0);
  const reversed = payments.filter((p) => p.matchId === match.id && (p.reversals || []).length > 0);

  const close = async () => {
    if (!(await confirm({ message: `Close the finances for this match? The actual fee, Finance Plans and overrides lock, and no new players can be added. Outstanding fees can still be collected. You can reopen with a reason.` }))) return;
    setBusy(true);
    const r = await callLedger({ action: "closeFinance", matchId: match.id });
    setBusy(false);
    toast(r.ok ? "Match finances closed" : r.error || "Could not close", r.ok ? "success" : "error");
  };

  return (
    <div className="flex flex-col gap-3" data-testid="match-finance-tab">
      {sheet === "set" || sheet === "adjust" ? (
        <GroundFeeSheet match={match} mode={sheet} onClose={() => setSheet(null)} onDone={(m) => { setSheet(null); toast(m, "success"); }} />
      ) : null}
      {sheet === "reopen" && (
        <ReasonModal
          title="Reopen match finances"
          hint="Reopening allows plan, fee and squad changes again. The closed statement stays in the finance history."
          onClose={() => setSheet(null)}
          onSubmit={async (reason) => {
            const r = await callLedger({ action: "reopenFinance", matchId: match.id, reason });
            if (!r.ok) return r.error || "Could not reopen";
            setSheet(null);
            toast("Match finances reopened", "success");
            return null;
          }}
        />
      )}

      {/* Status */}
      <section className="rounded-2xl border border-border bg-surface p-3 sm:p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-sm font-black text-text-primary">
            {closed ? <Lock className="w-4 h-4" aria-hidden="true" /> : <Unlock className="w-4 h-4" aria-hidden="true" />}
            Finances {closed ? "closed" : "open"}
          </p>
          <p className="text-xs text-text-secondary">
            {closed
              ? `Closed${match.financeClosedByName ? ` by ${match.financeClosedByName}` : ""}. Collections and refunds continue; plans, fees and new players are locked.`
              : "Plans, overrides and the squad can change. Close once the actual fee is recorded."}
          </p>
        </div>
        {canManageFees && (
          closed ? (
            <button type="button" onClick={() => setSheet("reopen")} className="min-h-[44px] px-4 rounded-xl border border-border text-sm font-bold text-text-primary hover:bg-surface-hover cursor-pointer" data-testid="finance-reopen">
              Reopen finances
            </button>
          ) : (
            <button
              type="button"
              onClick={close}
              disabled={busy || s.actualFeePaid === null}
              title={s.actualFeePaid === null ? "Record the actual match fee paid first" : undefined}
              className="min-h-[44px] px-4 rounded-xl bg-brand text-white text-sm font-bold disabled:opacity-50 cursor-pointer"
              data-testid="finance-close"
            >
              Close finances
            </button>
          )
        )}
      </section>

      {/* Statement */}
      <section className="rounded-2xl border border-border bg-surface p-3 sm:p-4 flex flex-col gap-3" data-testid="finance-statement">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-base font-black font-heading text-text-primary">Financial statement</h3>
          <NetResultBadge net={s.netResult} />
        </div>
        <CompositionBar s={s} />
        <dl className="divide-y divide-border">
          <Row label="Match Fee in System" value={inr(s.systemFee)} testId="stmt-system" />
          <Row label="Club Sponsored" value={inr(s.clubSponsored)} testId="stmt-club" />
          <Row label="Maximum Player Collection" value={inr(s.maxPlayerCollection)} strong testId="stmt-max" />
          <Row label="Collected Already" value={inr(s.collected)} testId="stmt-collected" />
          {s.collectedViaSubscription > 0 && <Row label="  of which via subscriptions" value={inr(s.collectedViaSubscription)} />}
          <Row label="To Be Collected" value={inr(s.outstanding)} testId="stmt-outstanding" />
          <Row label="Collection progress" value={s.collectionPct === null ? "—" : `${s.collectionPct.toFixed(2)}%`} />
          <Row label="Actual Match Fee Paid" value={s.actualFeePaid === null ? "Not recorded" : inr(s.actualFeePaid)} testId="stmt-actual" />
          <Row
            label={`Net Match Result${s.netResult === null ? "" : ` (${net.label})`}`}
            value={s.netResult === null ? "—" : inr(s.netResult)}
            strong
            tone={net.tone === "loss" ? "loss" : net.tone === "surplus" ? "surplus" : undefined}
            testId="stmt-net"
          />
        </dl>
        <CollectionBar s={s} />
        <p className="text-[11px] text-text-muted">
          Net Match Result = Maximum Player Collection − Actual Match Fee Paid. Club sponsorship is already outside the player collection and isn't subtracted again; payment progress doesn't change it.
        </p>
        {s.cashPosition !== null && (
          <p className="text-xs text-text-secondary" data-testid="stmt-cash">
            Current cash position (collected − actual fee): <span className="font-bold tabular-nums">{inr(s.cashPosition)}</span>
          </p>
        )}
        {s.pendingAllocationCount > 0 && (
          <p className="text-xs text-blue-700">{s.pendingAllocationCount} subscription player(s) await allocation when their subscription period closes; their share isn&apos;t included yet.</p>
        )}
      </section>

      {/* Actual fee */}
      <section className="rounded-2xl border border-border bg-surface p-3 sm:p-4 flex flex-col gap-2" data-testid="finance-ground-fee">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-black text-text-primary">Actual Match Fee Paid</p>
            <p className="text-xs text-text-secondary">Ground / vendor expense{match.groundFeeSetByName ? ` · last set by ${match.groundFeeSetByName}` : ""}</p>
          </div>
          <p className="text-lg font-black tabular-nums text-text-primary">{s.actualFeePaid === null ? "Not recorded" : inr(s.actualFeePaid)}</p>
        </div>
        {canManageFees && (
          <button
            type="button"
            onClick={() => setSheet(closed ? "adjust" : "set")}
            className="self-start min-h-[44px] px-4 rounded-xl border border-brand/30 text-sm font-bold text-brand hover:bg-brand-surface cursor-pointer"
            data-testid="ground-fee-edit"
          >
            {closed ? "Adjust (authorised)" : s.actualFeePaid === null ? "Record actual fee" : "Correct actual fee"}
          </button>
        )}
        {(match.groundFeeHistory || []).length > 0 && (
          <ul className="mt-1 flex flex-col gap-1 text-[11px] text-text-secondary">
            {[...(match.groundFeeHistory || [])].reverse().map((h, i) => (
              <li key={i}>
                {fmtWhen(h.at)} · {h.byName}: {h.kind} {h.from === null ? "" : `${inr(h.from)} → `}{inr(h.to)}{h.reason ? ` — ${h.reason}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Payments received */}
      <section className="rounded-2xl border border-border bg-surface p-3 sm:p-4 flex flex-col gap-2" data-testid="finance-payments">
        <p className="text-sm font-black text-text-primary">Payments received ({received.length})</p>
        {received.length === 0 ? (
          <p className="text-xs text-text-secondary">No money collected yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {received.map((p) => (
              <li key={p.id} className="py-2 flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-text-primary">{playerName(p)}</span>
                  <span className="block text-[11px] text-text-secondary">
                    {p.paymentMethod === "razorpay" ? `Razorpay${p.razorpayPaymentId ? ` · ${p.razorpayPaymentId}` : ""}` : p.manualMethod === "deposited_directly" ? "Direct deposit" : "Cash"}
                    {p.manualBy ? ` · by ${p.manualBy}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-black tabular-nums">{inr(collectedMoney(p, match.fee))}</span>
                  {canManageFees && (
                    <button type="button" onClick={() => onReverse({ payment: p, playerName: playerName(p), removeFromSquad: false })} className="min-h-[40px] px-3 rounded-lg border border-border text-xs font-bold text-rose-700 hover:bg-rose-50 cursor-pointer" data-testid={`refund-${p.id}`}>
                      Refund
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Refunds */}
      {reversed.length > 0 && (
        <section className="rounded-2xl border border-border bg-surface p-3 sm:p-4 flex flex-col gap-2" data-testid="finance-reversals">
          <p className="text-sm font-black text-text-primary">Refunds / reversals</p>
          <ul className="flex flex-col gap-1.5 text-xs text-text-secondary">
            {reversed.flatMap((p) =>
              (p.reversals || []).map((r, i) => (
                <li key={`${p.id}-${i}`}>
                  <span className="font-bold text-text-primary">{playerName(p)}</span>: {inr(r.amount)} {r.method.replace("_", " ")} · ref {r.reference} · {r.reason} · {r.byName}, {fmtWhen(r.at)}
                  {r.original.razorpayPaymentId ? ` · original ${r.original.razorpayPaymentId}` : ""} → {r.resultStatus}
                </li>
              )),
            )}
          </ul>
        </section>
      )}

      {/* Finance history */}
      {(match.financeHistory || []).length > 0 && (
        <section className="rounded-2xl border border-border bg-surface p-3 sm:p-4 flex flex-col gap-2">
          <p className="text-sm font-black text-text-primary">Finance history</p>
          <ul className="flex flex-col gap-1 text-xs text-text-secondary">
            {[...(match.financeHistory || [])].reverse().map((h, i) => (
              <li key={i}>
                {fmtWhen(h.at)} · {h.byName}: {h.action}
                {h.reason ? ` — ${h.reason}` : ""}
                {h.statement && typeof h.statement.netResult === "number" ? ` (net ${inr(h.statement.netResult as number)})` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
