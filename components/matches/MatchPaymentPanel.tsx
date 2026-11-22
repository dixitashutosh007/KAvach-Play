"use client";

/**
 * Admin Match Centre — collapsible "Payment Details" bar for one match
 * (`components/matches/MatchPaymentPanel.tsx`).
 *
 * Lazy: nothing is fetched until the admin expands the bar. Expanding calls the
 * store's existing match-scoped listener (`ensureMatchPayments(matchId)`, a
 * single query on matches/{matchId}/payments). The store de-duplicates
 * listeners per match and keeps the rows cached, so collapsing / re-opening
 * reuses them, and edits made through existing payment workflows arrive live
 * through the same listener.
 *
 * Figures come from `summarizeMatchFinance` — the same function the Finance →
 * Matches report uses — so the panel never runs a competing calculation.
 * Admin-only: rendered only inside the admin Match Centre, and Firestore rules
 * restrict reading other players' payment records to administrators.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Wallet } from "lucide-react";
import type { Match, MatchPayment, Player } from "@/lib/types";
import { financeReportPayments, summarizeMatchFinance } from "@/lib/match-finance";
import { isMatchBillable } from "@/lib/matchBillable";

export type MatchPaymentsLoadStatus = "loading" | "ready" | "error" | undefined;

export interface MatchPaymentPanelProps {
  match: Match;
  players: Player[];
  /** store.payments (rows for this match are picked out here). */
  payments: MatchPayment[];
  /** store.matchPaymentsStatus[match.id] */
  status: MatchPaymentsLoadStatus;
  /** store.ensureMatchPayments */
  ensureMatchPayments?: (matchId: string) => void;
  /** store.refreshNonce: re-attach after a pull-to-refresh / listener reset. */
  refreshNonce?: number;
  /** Test hook: start expanded. */
  defaultOpen?: boolean;
}

export const formatINR = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

interface PersonChip {
  key: string;
  name: string;
  photoURL?: string;
  detail: string;
}

export function MatchPaymentPanel({
  match,
  players,
  payments,
  status,
  ensureMatchPayments,
  refreshNonce = 0,
  defaultOpen = false,
}: MatchPaymentPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `payment-panel-${match.id}`;

  // Fetch (attach the match-scoped listener) only once expanded.
  useEffect(() => {
    if (open) ensureMatchPayments?.(match.id);
  }, [open, match.id, ensureMatchPayments, refreshNonce]);

  return (
    <div className="border-t border-border" data-testid={`payment-details-${match.id}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid={`payment-toggle-${match.id}`}
        className="w-full min-h-[44px] px-4 flex items-center justify-between gap-2 bg-surface-hover/60 hover:bg-surface-hover text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40"
      >
        <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-primary">
          <Wallet className="w-4 h-4 text-brand" aria-hidden="true" />
          Payment Details
        </span>
        <ChevronDown
          className={`w-4 h-4 text-text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={panelId} className="px-4 pt-3 pb-4" data-testid={`payment-body-${match.id}`}>
          <PaymentBody
            match={match}
            players={players}
            payments={payments}
            status={status}
            onRetry={() => ensureMatchPayments?.(match.id)}
          />
        </div>
      )}
    </div>
  );
}

function PaymentBody({
  match,
  players,
  payments,
  status,
  onRetry,
}: {
  match: Match;
  players: Player[];
  payments: MatchPayment[];
  status: MatchPaymentsLoadStatus;
  onRetry: () => void;
}) {
  const ready = status === "ready";
  const view = useMemo(() => {
    if (!ready) return null;
    const rows = financeReportPayments(match, payments, players);
    const summary = summarizeMatchFinance(match, rows, players);
    const byId = new Map(players.map((p) => [p.id, p]));
    // summarizeMatchFinance lists details in row order; pair them back to rows.
    const paidRows = rows.filter((p) => p.status === "Paid");
    const otherRows = rows.filter((p) => p.status !== "Paid");
    const paid: PersonChip[] = summary.paidPlayerDetails.map((d, i) => ({
      key: paidRows[i]?.id || `paid-${i}`,
      name: d.name,
      photoURL: byId.get(paidRows[i]?.playerId || "")?.photoURL,
      detail: `${formatINR(d.amount)} · ${d.method}`,
    }));
    const unpaid: PersonChip[] = [];
    const waived: PersonChip[] = [];
    summary.unpaidPlayerDetails.forEach((d, i) => {
      const row = otherRows[i];
      const chip = {
        key: row?.id || `other-${i}`,
        name: d.name,
        photoURL: byId.get(row?.playerId || "")?.photoURL,
        detail: row?.status === "Waived" ? "Waived" : row?.status === "Failed" ? `${formatINR(d.due)} · Failed` : `${formatINR(d.due)} due`,
      };
      (row?.status === "Waived" ? waived : unpaid).push(chip);
    });
    return { rows, summary, paid, unpaid, waived, billable: isMatchBillable(match) };
  }, [ready, match, payments, players]);

  if (status === "error") {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5" data-testid="payment-error">
        <p className="text-xs font-medium text-rose-800">Payment details couldn&apos;t be loaded.</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 min-h-[36px] px-3 rounded-lg border border-rose-300 bg-white text-xs font-bold text-rose-800 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  if (!view) {
    return (
      <p className="flex items-center gap-2 text-xs text-text-muted py-2" aria-busy="true" data-testid="payment-loading">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        Loading payment details…
      </p>
    );
  }

  if (view.rows.length === 0) {
    return (
      <p className="text-xs text-text-secondary py-2" data-testid="payment-empty">
        No payment records for this match yet.
      </p>
    );
  }

  const { summary } = view;
  return (
    <div className="flex flex-col gap-4" data-testid="payment-loaded">
      <div className="grid grid-cols-3 gap-2" data-testid="payment-summary">
        <Metric label="Collected" value={formatINR(summary.feeCollected)} tone="text-[#15803D]" testId="payment-collected" />
        <Metric label="KAvach Sponsored" value={formatINR(summary.feeOffset)} tone="text-[#B7791F]" testId="payment-sponsored" />
        <Metric
          label="Pending"
          value={formatINR(summary.totalDue)}
          tone="text-[#DC2626]"
          testId="payment-pending"
          note={view.billable ? undefined : "Not billable"}
        />
      </div>

      <PeopleRow title="Paid Players" count={view.paid.length} people={view.paid} empty="No players have paid yet." testId="paid-players" tone="paid" />
      <PeopleRow title="Unpaid Players" count={view.unpaid.length} people={view.unpaid} empty="No pending payments." testId="unpaid-players" tone="unpaid" />
      {view.waived.length > 0 && (
        <PeopleRow title="Waived" count={view.waived.length} people={view.waived} empty="" testId="waived-players" tone="waived" />
      )}
    </div>
  );
}

function Metric({ label, value, tone, testId, note }: { label: string; value: string; tone: string; testId: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-2.5 py-2 min-w-0" data-testid={testId}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted truncate">{label}</p>
      <p className={`mt-0.5 text-base sm:text-lg font-black font-heading tabular-nums leading-tight truncate ${tone}`}>{value}</p>
      {note && <p className="text-[10px] text-text-muted truncate">{note}</p>}
    </div>
  );
}

const TONE_RING = { paid: "ring-[#15803D]/40", unpaid: "ring-[#DC2626]/40", waived: "ring-border" } as const;

function PeopleRow({
  title,
  count,
  people,
  empty,
  testId,
  tone,
}: {
  title: string;
  count: number;
  people: PersonChip[];
  empty: string;
  testId: string;
  tone: keyof typeof TONE_RING;
}) {
  return (
    <div data-testid={testId}>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-secondary">
        {title} <span className="text-text-muted">({count})</span>
      </p>
      {people.length === 0 ? (
        <p className="text-xs text-text-muted">{empty}</p>
      ) : (
        <ul className="-mx-4 px-4 flex gap-2 overflow-x-auto overscroll-x-contain no-scrollbar pb-1" data-testid={`${testId}-list`}>
          {people.map((p) => (
            <li key={p.key} className="shrink-0 w-[5.5rem] flex flex-col items-center text-center">
              <Avatar name={p.name} photoURL={p.photoURL} ring={TONE_RING[tone]} />
              <span className="mt-1.5 w-full text-[11px] font-bold text-text-primary leading-tight line-clamp-2 break-words" title={p.name}>
                {p.name}
              </span>
              <span className="mt-0.5 w-full text-[10px] text-text-muted truncate" title={p.detail}>
                {p.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Avatar({ name, photoURL, ring }: { name: string; photoURL?: string; ring: string }) {
  const safe = typeof photoURL === "string" && /^https:\/\//i.test(photoURL) ? photoURL : null;
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return safe ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={safe} alt="" loading="lazy" referrerPolicy="no-referrer" className={`w-11 h-11 rounded-full object-cover ring-2 ${ring}`} />
  ) : (
    <span aria-hidden="true" className={`w-11 h-11 rounded-full flex items-center justify-center bg-deep-wine/10 text-deep-wine font-heading font-black text-sm ring-2 ${ring}`}>
      {initial}
    </span>
  );
}
