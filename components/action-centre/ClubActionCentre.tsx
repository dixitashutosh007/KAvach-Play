"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronRight,
  History,
  ChevronDown,
  X,
  ListChecks,
} from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import {
  getNextDuePopupAction,
  type ActionCentreItem,
  type ActionCentreStatus,
  type ActionCentreWeekSummary,
} from "@/lib/action-centre";

interface ActionCentreApiResponse {
  ok: boolean;
  now: number;
  currentWeek: ActionCentreWeekSummary;
  history: ActionCentreWeekSummary[];
  dismissedPopups: Record<string, string>;
}

const STATUS_STYLE: Record<ActionCentreStatus, string> = {
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  overdue: "bg-rose-50 text-rose-700 border-rose-200",
  due: "bg-amber-50 text-amber-800 border-amber-200",
  pending: "bg-surface-hover text-text-secondary border-border",
};

const STATUS_LABEL: Record<ActionCentreStatus, string> = {
  completed: "Completed",
  overdue: "Overdue",
  due: "Due Now",
  pending: "Pending",
};

export function ClubActionCentre({
  enabled,
  onNavigate,
  showPopup = true,
  compact = false,
  refreshTrigger,
}: {
  enabled: boolean;
  onNavigate: (tab: "matches" | "club" | "finance", action?: string) => void;
  showPopup?: boolean;
  compact?: boolean;
  refreshTrigger?: unknown;
}) {
  const [state, setState] = useState<ActionCentreApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await authedFetch("/api/admin/action-centre");
      if (res.ok) {
        const json = (await res.json()) as ActionCentreApiResponse;
        if (json?.ok && json.currentWeek) {
          setState(json);
        }
      }
    } catch {
      // Keep last known state
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load, refreshTrigger]);

  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, load]);

  if (!enabled || !state) {
    if (enabled && loading && !compact) {
      return (
        <section
          data-testid="club-action-centre-loading"
          className="rounded-2xl border border-border bg-surface p-4 text-xs text-text-muted"
        >
          Loading Weekly Action Centre…
        </section>
      );
    }
    return null;
  }

  const { currentWeek, history, dismissedPopups } = state;
  const popupAction: ActionCentreItem | null = showPopup
    ? getNextDuePopupAction(currentWeek, dismissedPopups)
    : null;

  const handleDismissPopup = async (item: ActionCentreItem) => {
    if (dismissing) return;
    setDismissing(true);
    setState((prev) =>
      prev
        ? {
            ...prev,
            dismissedPopups: {
              ...prev.dismissedPopups,
              [item.id]: currentWeek.weekId,
            },
          }
        : prev,
    );
    try {
      await authedFetch("/api/admin/action-centre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "dismiss_popup",
          actionId: item.id,
          weekId: currentWeek.weekId,
        }),
      });
    } finally {
      setDismissing(false);
    }
  };

  if (compact) {
    const outstanding = currentWeek.actions.filter((a) => !a.completed);
    if (outstanding.length === 0) return null;
    return (
      <div
        data-testid="action-centre-persistent-summary"
        className="rounded-2xl border border-brand/25 bg-brand-surface/35 p-4 space-y-2.5"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
            <h3 className="text-xs font-black uppercase tracking-wider text-brand">
              Club Admin Action Centre ({outstanding.length} Pending · {currentWeek.percent}% Done)
            </h3>
          </div>
          <span className="text-[11px] font-bold text-text-secondary">
            {currentWeek.label}
          </span>
        </div>
        <div className="space-y-1.5">
          {outstanding.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-xl bg-surface border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-bold text-text-primary truncate">{item.title}</p>
                <p className="text-[11px] text-text-secondary">{item.deadlineLabel}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${STATUS_STYLE[item.status]}`}
                >
                  {STATUS_LABEL[item.status]}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate(item.targetTab, item.targetAction)}
                  className="min-h-[30px] px-2.5 rounded-lg bg-[#A30F2D] text-white text-[11px] font-bold hover:bg-[#8B0D26] transition cursor-pointer"
                >
                  Open
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <section
        data-testid="club-action-centre"
        className="rounded-2xl border border-border bg-surface p-4 shadow-xs space-y-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
              <h2 className="text-xs font-black uppercase tracking-wider text-text-primary">
                Club Admin Weekly Action Centre
              </h2>
            </div>
            <p className="text-[11px] text-text-secondary mt-0.5">
              {currentWeek.label} (IST) · {currentWeek.completedCount} of {currentWeek.totalCount} completed
            </p>
          </div>
          <span
            data-testid="action-centre-percent"
            className={`px-2.5 py-1 rounded-full text-xs font-black tabular-nums border ${
              currentWeek.allCompleted
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-brand-surface text-brand border-brand/20"
            }`}
          >
            {currentWeek.percent}%
          </span>
        </div>

        {/* Progress Bar */}
        <div className="h-2 w-full rounded-full bg-surface-hover overflow-hidden border border-border/60">
          <div
            className={`h-full transition-all duration-300 ${
              currentWeek.allCompleted ? "bg-emerald-600" : "bg-[#A30F2D]"
            }`}
            style={{ width: `${currentWeek.percent}%` }}
          />
        </div>

        {currentWeek.allCompleted && (
          <div
            data-testid="action-centre-week-complete"
            className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-800"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            All 5 weekly Club Admin actions are complete for {currentWeek.label}.
          </div>
        )}

        <div className="space-y-2">
          {currentWeek.actions.map((item) => (
            <div
              key={item.id}
              data-testid={`action-centre-item-${item.id}`}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-border bg-surface-hover/50 px-3 py-2.5"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {item.completed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                  ) : item.status === "overdue" ? (
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
                  )}
                  <span className="text-xs font-bold text-text-primary">
                    {item.title}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${STATUS_STYLE[item.status]}`}
                  >
                    {STATUS_LABEL[item.status]}
                  </span>
                </div>
                <p className="text-[11px] text-text-secondary pl-6">
                  Deadline: {item.deadlineLabel} · {item.verificationNote}
                </p>
              </div>
              {!item.completed && (
                <button
                  type="button"
                  data-testid={`action-centre-go-${item.id}`}
                  onClick={() => onNavigate(item.targetTab, item.targetAction)}
                  className="min-h-[34px] px-3 rounded-lg bg-[#A30F2D] text-white text-xs font-bold inline-flex items-center justify-center gap-1 hover:bg-[#8B0D26] transition shrink-0 cursor-pointer"
                >
                  <span>Go</span>
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>

        {history.length > 0 && (
          <div className="pt-1 border-t border-border/60">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              data-testid="action-centre-history-toggle"
              className="flex items-center justify-between w-full text-xs font-bold text-text-secondary hover:text-text-primary py-1 cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" aria-hidden="true" />
                Previous Weeks History ({history.length})
              </span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${showHistory ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            {showHistory && (
              <div className="mt-2 space-y-1.5" data-testid="action-centre-history-list">
                {history.map((wk) => (
                  <div
                    key={wk.weekId}
                    className="flex items-center justify-between rounded-xl bg-surface-hover px-3 py-2 text-xs border border-border/60"
                  >
                    <span className="font-semibold text-text-primary">{wk.label}</span>
                    <span className="font-bold tabular-nums text-text-secondary">
                      {wk.completedCount}/{wk.totalCount} ({wk.percent}%)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {popupAction && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="action-centre-popup-title"
          data-testid="action-centre-popup"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-brand">
                  Club Admin Reminder · {STATUS_LABEL[popupAction.status]}
                </p>
                <h3
                  id="action-centre-popup-title"
                  className="text-base font-black font-heading text-text-primary mt-0.5"
                >
                  {popupAction.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => handleDismissPopup(popupAction)}
                aria-label="Dismiss reminder"
                className="min-h-[32px] min-w-[32px] rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-hover cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed">
              <strong>Deadline:</strong> {popupAction.deadlineLabel}
              <br />
              {popupAction.verificationNote}
            </p>
            <p className="text-[11px] text-text-muted">
              Dismissing hides this popup for you only; the task stays in your Action Centre, Notifications, and Profile until completed.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                data-testid="action-centre-popup-dismiss"
                onClick={() => handleDismissPopup(popupAction)}
                disabled={dismissing}
                className="min-h-[40px] px-3.5 rounded-xl border border-border bg-surface text-xs font-bold text-text-secondary hover:bg-surface-hover cursor-pointer"
              >
                Dismiss
              </button>
              <button
                type="button"
                data-testid="action-centre-popup-go"
                onClick={() => onNavigate(popupAction.targetTab, popupAction.targetAction)}
                className="min-h-[40px] px-4 rounded-xl bg-[#A30F2D] text-white text-xs font-bold hover:bg-[#8B0D26] transition cursor-pointer"
              >
                Complete Action
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
