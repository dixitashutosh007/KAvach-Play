"use client";

/**
 * Weekend match operations — Admin persona tasks (`components/weekend-ops/WeekendPrompts.tsx`).
 *
 * Recurring prompts (server schedule, Asia/Kolkata):
 *  A. Enter Match Results           → POST /api/admin/weekend-results
 *  B. Select Player of the Weekend  → POST /api/admin/player-of-weekend
 *  D. Enter Actual Match Fee        → POST /api/finance/match-ledger {action: "setGroundFee"} (existing route)
 *
 * Match Center task panel: every pending recurring task (so a skipped or
 * closed popup stays reachable) and the persistent Historical Data
 * Completion lists (results, actual fees, Player of the Weekend weekends).
 *
 * What is pending, and for whom, comes only from GET /api/admin/weekend-prompts
 * (server clock, verified roles, pending state held in the data), so it is the
 * same across refreshes, sessions and admin accounts. This component holds no
 * authority. It renders in Admin persona only.
 *
 * Saving: the submit button shows "Saving…", is disabled (and guarded against
 * double clicks) only while its request runs; the window closes as soon as the
 * server confirms success, a toast confirms it, and the task lists refresh in
 * the background. On failure the window stays open with the entered values and
 * a Retry action.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trophy, ClipboardCheck, IndianRupee, X, Search, History, AlertTriangle, Check, Loader2, RotateCcw, ChevronRight, CheckCircle2 } from "lucide-react";
import type { Ground, Player } from "@/lib/types";
import { authedFetch } from "@/lib/authed-fetch";
import { RESULT_CHOICES, POTW_MESSAGE_MAX_CHARS, POTW_MESSAGE_MAX_LINES, validatePotwMessage } from "@/lib/weekend-ops";
import { formatMatchCardDate } from "@/lib/match-card-format";
import { formatMatchDisplayTime } from "@/lib/personal-match-payment";
import { PotwSlideBody } from "@/components/home/CampaignHeroBanner";
import { useToast } from "@/components/ui/Toast";

type MatchSummary = {
  id: string;
  date: string | null;
  time: string | null;
  format: string | null;
  opponent: string;
  groundId: string | null;
  matchType: string | null;
  result: string | null;
  fee?: number | null;
  reason?: string;
};
type WeekendSummary = { weekendId: string; label: string; matches: MatchSummary[] };
type PromptsResponse = {
  now: number;
  mode: "testing" | "recurring";
  results?: { items: MatchSummary[]; exceptions: { id: string; reason: string }[] };
  potw?: { weekendId: string; label: string; closesAt: number; awarded: { playerId: string; playerName: string } | null; matches: MatchSummary[] } | null;
  fees?: { from: string; to: string; items: MatchSummary[] };
  pending: { results: number; potw: number; fees: number };
};
type HistoryResponse = {
  results?: { count: number; items: MatchSummary[]; exceptions: MatchSummary[] };
  fees?: { count: number; items: MatchSummary[] };
  potw?: { count: number; from: string; items: WeekendSummary[] };
};
type Kind = "results" | "potw" | "fees" | "h-results" | "h-fees" | "h-potw";

/** Real requests carry the ID token; the local synthetic test session (non-production only) has none. */
function apiFetch(url: string, init: RequestInit = {}) {
  const synthetic = process.env.NODE_ENV !== "production" && typeof window !== "undefined" && (window as any).__KAVACH_TEST_USER__ !== undefined;
  return synthetic ? fetch(url, init) : authedFetch(url, init);
}
async function postJson(url: string, body: unknown) {
  const res = await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

const SHOWN_KEY = (uid: string) => `kavach:weekend-ops:shown:v1:${uid}`;
function readShown(uid: string): Record<string, boolean> {
  try {
    return JSON.parse(window.sessionStorage.getItem(SHOWN_KEY(uid)) || "{}") || {};
  } catch {
    return {};
  }
}
function writeShown(uid: string, v: Record<string, boolean>) {
  try {
    window.sessionStorage.setItem(SHOWN_KEY(uid), JSON.stringify(v));
  } catch {
    /* session-only convenience */
  }
}

const REASON_LABEL: Record<string, string> = {
  missing_or_invalid_start: "start date/time missing",
  missing_or_unknown_format: "format missing",
  not_yet: "not finished yet",
  has_result: "result already recorded",
  archived: "archived",
  error: "could not save — try again",
};

/** One in-flight request per form: blocks double clicks even before React re-renders. */
function useSubmit() {
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await fn();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, []);
  return { saving, run };
}

export interface WeekendPromptsProps {
  uid: string;
  /** The signed-in user is an admin (any admin role). Drives the fetch for the indicator. */
  isAdmin: boolean;
  /** Admin persona is active: only then do prompts, task bar and Match Center panel render. */
  active: boolean;
  activeTab: string;
  players: Player[];
  grounds: Ground[];
  onPendingChange?: (count: number) => void;
}

export function WeekendPrompts({ uid, isAdmin, active, activeTab, players, grounds, onPendingChange }: WeekendPromptsProps) {
  const { toast } = useToast();
  const [data, setData] = useState<PromptsResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [open, setOpen] = useState<Kind | null>(null);
  const shownRef = useRef<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/weekend-prompts");
      if (res.ok) setData((await res.json()) as PromptsResponse);
    } catch {
      /* keep the last known state */
    }
  }, []);
  const loadHistory = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/weekend-prompts?view=history");
      if (!res.ok) throw new Error();
      setHistory((await res.json()) as HistoryResponse);
      setHistoryError(false);
    } catch {
      setHistoryError(true);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin || !uid) return;
    shownRef.current = readShown(uid);
    load();
  }, [isAdmin, uid, load]);

  const inMatchCenter = active && activeTab === "matches";
  useEffect(() => {
    if (inMatchCenter) loadHistory();
  }, [inMatchCenter, loadHistory]);

  const pending = data?.pending ?? { results: 0, potw: 0, fees: 0 };
  const total = pending.results + pending.potw + pending.fees;
  useEffect(() => onPendingChange?.(total), [total, onPendingChange]);

  // Auto-open: Admin persona only, one window at a time, each kind once per session.
  useEffect(() => {
    if (!active || open || !data) return;
    const next = (["results", "potw", "fees"] as const).find((k) => pending[k] > 0 && !shownRef.current[k]);
    if (!next) return;
    shownRef.current = { ...shownRef.current, [next]: true };
    writeShown(uid, shownRef.current);
    setOpen(next);
  }, [active, open, data, pending, uid]);

  useEffect(() => {
    if (!active) setOpen(null);
  }, [active]);

  const groundName = useCallback((id: string | null) => grounds.find((g) => g.id === id)?.name || "", [grounds]);
  const close = useCallback(() => setOpen(null), []);

  /** After a confirmed save: drop the saved records locally at once, then refresh from the server in the background. */
  const afterSave = useCallback(
    (kind: "results" | "fees" | "potw", savedIds: string[]) => {
      const drop = (list: MatchSummary[] = []) => list.filter((m) => !savedIds.includes(m.id));
      setData((d) => {
        if (!d) return d;
        const n = { ...d, pending: { ...d.pending } };
        if (kind === "results" && d.results) {
          n.results = { ...d.results, items: drop(d.results.items) };
          n.pending.results = n.results.items.length;
        }
        if (kind === "fees" && d.fees) {
          n.fees = { ...d.fees, items: drop(d.fees.items) };
          n.pending.fees = n.fees.items.length;
        }
        if (kind === "potw" && d.potw && savedIds.includes(d.potw.weekendId)) {
          n.potw = { ...d.potw, awarded: { playerId: "", playerName: "" } };
          n.pending.potw = 0;
        }
        return n;
      });
      setHistory((h) => {
        if (!h) return h;
        const n = { ...h };
        if (kind === "results" && h.results) {
          const items = drop(h.results.items);
          n.results = { ...h.results, items, count: items.length };
        }
        if (kind === "fees" && h.fees) {
          const items = drop(h.fees.items);
          n.fees = { ...h.fees, items, count: items.length };
        }
        if (kind === "potw" && h.potw) {
          const items = h.potw.items.filter((w) => !savedIds.includes(w.weekendId));
          n.potw = { ...h.potw, items, count: items.length };
        }
        return n;
      });
      void load();
      if (inMatchCenter) void loadHistory();
    },
    [load, loadHistory, inMatchCenter],
  );

  if (!active || !data) return null;
  const canResults = Boolean(data.results);
  const canFees = Boolean(data.fees);
  const canPotw = data.potw !== undefined;

  const recurringChips = (
    <>
      {pending.results > 0 && (
        <TaskChip testId="weekend-task-results" icon={<ClipboardCheck className="w-4 h-4" />} label={`Match results (${pending.results})`} onClick={() => setOpen("results")} />
      )}
      {pending.potw > 0 && <TaskChip testId="weekend-task-potw" icon={<Trophy className="w-4 h-4" />} label="Player of the Weekend" onClick={() => setOpen("potw")} />}
      {pending.fees > 0 && (
        <TaskChip testId="weekend-task-fees" icon={<IndianRupee className="w-4 h-4" />} label={`Actual match fees (${pending.fees})`} onClick={() => setOpen("fees")} />
      )}
    </>
  );

  return (
    <>
      {inMatchCenter ? (
        <section className="mb-4 rounded-2xl border border-border bg-surface p-3 sm:p-4" data-testid="match-center-tasks" aria-label="Match Center tasks">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-text-secondary mr-1">Weekend tasks</span>
            {total > 0 ? recurringChips : <span className="text-xs text-text-secondary" data-testid="weekend-tasks-none">Nothing pending this week</span>}
          </div>
          {(canResults || canFees || canPotw) && (
            <div className="mt-3 pt-3 border-t border-border" data-testid="historical-completion">
              <div className="flex items-center gap-2 mb-2">
                <History className="w-4 h-4 text-brand" aria-hidden="true" />
                <h2 className="text-sm font-black text-text-primary">Historical Data Completion</h2>
              </div>
              {historyError && !history ? (
                <p className="text-xs text-red-600">
                  Could not load historical tasks.{" "}
                  <button type="button" className="underline font-bold cursor-pointer" onClick={loadHistory}>
                    Retry
                  </button>
                </p>
              ) : !history ? (
                <p className="text-xs text-text-secondary">
                  <Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1" /> Counting outstanding records…
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-3">
                  {history.results && (
                    <HistoryRow testId="history-results" label="Match Results" count={history.results.count} unit="pending" onOpen={() => setOpen("h-results")} />
                  )}
                  {history.fees && (
                    <HistoryRow testId="history-fees" label="Actual Match Fee Paid" count={history.fees.count} unit="pending" onOpen={() => setOpen("h-fees")} />
                  )}
                  {history.potw && (
                    <HistoryRow
                      testId="history-potw"
                      label="Player of the Weekend"
                      count={history.potw.count}
                      unit={history.potw.count === 1 ? "weekend pending" : "weekends pending"}
                      onOpen={() => setOpen("h-potw")}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      ) : (
        total > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2.5" data-testid="weekend-tasks-bar">
            <span className="text-xs font-bold uppercase tracking-wider text-text-secondary mr-1">Weekend tasks</span>
            {recurringChips}
          </div>
        )
      )}

      {open === "results" && data.results && (
        <ResultsModal
          title="Enter Match Results"
          intro="Choose the result of each completed match. Matches you leave blank stay pending."
          items={data.results.items}
          exceptions={data.results.exceptions.length}
          source="prompt"
          groundName={groundName}
          onClose={close}
          onSaved={(ids) => {
            afterSave("results", ids);
            toast(`${ids.length} result${ids.length === 1 ? "" : "s"} saved`, "success");
          }}
        />
      )}
      {open === "h-results" && history?.results && (
        <ResultsModal
          title="Historical results"
          intro="Completed matches without a result. Nothing is filled in automatically — choose only the results you know, then Save. Saved matches leave this list."
          items={history.results.items}
          exceptions={history.results.exceptions.length}
          exceptionList={history.results.exceptions}
          source="backfill"
          groundName={groundName}
          onClose={close}
          onSaved={(ids) => {
            afterSave("results", ids);
            toast(`${ids.length} historical result${ids.length === 1 ? "" : "s"} saved`, "success");
          }}
        />
      )}
      {open === "potw" && data.potw && !data.potw.awarded && (
        <PotwModal
          weekends={[{ weekendId: data.potw.weekendId, label: data.potw.label, matches: data.potw.matches }]}
          source="prompt"
          players={players}
          onClose={close}
          onSaved={(weekendId, name) => {
            afterSave("potw", [weekendId]);
            toast(`Player of the Weekend awarded to ${name}`, "success");
          }}
        />
      )}
      {open === "h-potw" && history?.potw && (
        <PotwModal
          weekends={history.potw.items}
          source="history"
          players={players}
          onClose={close}
          onSaved={(weekendId, name) => {
            afterSave("potw", [weekendId]);
            toast(`Player of the Weekend awarded to ${name}`, "success");
          }}
        />
      )}
      {open === "fees" && data.fees && (
        <FeesModal
          title="Enter Actual Match Fee"
          items={data.fees.items}
          source="prompt"
          groundName={groundName}
          onClose={close}
          onSaved={(ids) => {
            afterSave("fees", ids);
            toast(`Actual fee saved for ${ids.length} match${ids.length === 1 ? "" : "es"}`, "success");
          }}
        />
      )}
      {open === "h-fees" && history?.fees && (
        <FeesModal
          title="Historical actual match fees"
          items={history.fees.items}
          source="history"
          groundName={groundName}
          onClose={close}
          onSaved={(ids) => {
            afterSave("fees", ids);
            toast(`Actual fee saved for ${ids.length} match${ids.length === 1 ? "" : "es"}`, "success");
          }}
        />
      )}
    </>
  );
}

function TaskChip({ icon, label, onClick, testId }: { icon: React.ReactNode; label: string; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="min-h-[44px] px-3 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition bg-brand/10 text-brand hover:bg-brand/15"
    >
      {icon}
      {label}
    </button>
  );
}

function HistoryRow({ label, count, unit, onOpen, testId }: { label: string; count: number; unit: string; onOpen: () => void; testId: string }) {
  const done = count === 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={done}
      data-testid={testId}
      className="min-h-[56px] w-full rounded-xl border border-border px-3 py-2 text-left flex items-center gap-2 cursor-pointer hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent"
    >
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold text-text-primary">{label}</span>
        <span className={`block text-xs ${done ? "text-emerald-700" : "text-text-secondary"}`} data-testid={`${testId}-count`}>
          {done ? "All complete" : `${count} ${unit}`}
        </span>
      </span>
      {done ? <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 text-text-secondary" aria-hidden="true" />}
    </button>
  );
}

// ── Shared window shell (non-blocking: Close/Skip always work, even while saving) ──

function Modal({ title, icon, onClose, children, footer, testId }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; testId: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <div className="w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-surface shadow-2xl">
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <span className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0">{icon}</span>
          <h2 className="flex-1 text-lg font-black font-heading text-text-primary">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-hover cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-3">{children}</div>
        <div className="flex gap-2 px-5 py-4 border-t border-border">{footer}</div>
      </div>
    </div>
  );
}
const PRIMARY = "flex-1 min-h-[48px] rounded-xl bg-brand text-white text-sm font-black inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer";
const SECONDARY = "min-h-[48px] px-5 rounded-xl border border-border text-sm font-bold text-text-primary hover:bg-surface-hover cursor-pointer";

function SubmitButton({ saving, failed, disabled, onClick, label, testId, icon }: { saving: boolean; failed: boolean; disabled: boolean; onClick: () => void; label: string; testId: string; icon: React.ReactNode }) {
  return (
    <button type="button" className={PRIMARY} onClick={onClick} disabled={saving || disabled} aria-busy={saving} data-testid={testId}>
      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : failed ? <RotateCcw className="w-4 h-4" /> : icon}
      {saving ? "Saving…" : failed ? "Retry" : label}
    </button>
  );
}

const matchLine = (m: MatchSummary, groundName: (id: string | null) => string) =>
  [m.time ? formatMatchDisplayTime(m.time) : null, m.format, groundName(m.groundId)].filter(Boolean).join(" · ");

function groupByDate(items: MatchSummary[]) {
  const map = new Map<string, MatchSummary[]>();
  for (const m of items) {
    const k = m.date || "";
    map.set(k, [...(map.get(k) || []), m]);
  }
  return [...map.entries()];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthKey = (date: string | null) => (date && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "");
const monthLabel = (k: string) => (k ? `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}` : "No date");

/** Month filter for long historical lists. */
function MonthFilter({ dates, value, onChange }: { dates: (string | null)[]; value: string; onChange: (v: string) => void }) {
  const months = useMemo(() => [...new Set(dates.map(monthKey))].sort().reverse(), [dates]);
  if (months.length < 2) return null;
  return (
    <label className="flex items-center gap-2 mb-3 text-xs font-bold text-text-secondary">
      Show
      <select value={value} onChange={(e) => onChange(e.target.value)} className="min-h-[40px] rounded-xl border border-border bg-surface px-2 text-sm text-text-primary" data-testid="history-month-filter">
        <option value="all">All months</option>
        {months.map((m) => (
          <option key={m || "none"} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── A. Results (recurring prompt and historical backfill) ──────────────────

function ResultsModal({
  title,
  intro,
  items,
  exceptions,
  exceptionList,
  source,
  groundName,
  onClose,
  onSaved,
}: {
  title: string;
  intro: string;
  items: MatchSummary[];
  exceptions: number;
  exceptionList?: MatchSummary[];
  source: "prompt" | "backfill";
  groundName: (id: string | null) => string;
  onClose: () => void;
  onSaved: (savedIds: string[]) => void;
}) {
  const { saving, run } = useSubmit();
  // The list shown is frozen when the window opens, so saved rows can show "Saved" in place.
  const [rows] = useState(items);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [month, setMonth] = useState("all");
  const chosen = Object.entries(choice).filter(([id, v]) => v && !saved[id]);
  const visible = rows.filter((m) => month === "all" || monthKey(m.date) === month);
  const pendingCount = rows.filter((m) => !saved[m.id]).length;

  const save = () =>
    run(async () => {
      setError(null);
      if (!chosen.length) return setError("Choose at least one result.");
      let r;
      try {
        r = await postJson("/api/admin/weekend-results", { source, results: chosen.map(([matchId, result]) => ({ matchId, result })) });
      } catch {
        return setError("Could not reach the server. Your choices are kept — Retry.");
      }
      if (!r.ok) return setError(r.json?.error || "Could not save results. Your choices are kept — Retry.");
      const n: Record<string, string> = {}; // rows that still need attention
      const done: Record<string, string> = {}; // rows finished (shown as Saved)
      const recorded: string[] = []; // results now stored (no longer pending anywhere)
      for (const o of r.json.outcomes || []) {
        if (o.status === "saved" || o.status === "unchanged") {
          recorded.push(o.matchId);
          // A failed waiver keeps the row open: choosing Abandoned again retries it safely.
          if (o.waiver?.status === "failed") n[o.matchId] = "Saved as Abandoned, but waiving unpaid fees failed — Retry.";
          else done[o.matchId] = o.result;
        } else if (o.status === "conflict") {
          recorded.push(o.matchId);
          done[o.matchId] = o.existingResult;
          n[o.matchId] = `Already recorded as “${o.existingResult}” by another admin — not changed.`;
        } else n[o.matchId] = `Not saved: ${REASON_LABEL[o.reason] || REASON_LABEL[o.status] || o.reason || o.status}.`;
      }
      if (recorded.length) onSaved(recorded);
      setNotes(n);
      setSaved((s) => ({ ...s, ...done }));
      setChoice((c) => Object.fromEntries(Object.entries(c).filter(([id]) => !done[id])));
      const attention = Object.keys(n);
      // Recurring prompt: everything saved → close. Historical list: stay open for the next batch.
      if (!attention.length && source === "prompt") onClose();
      else if (attention.length) setError(`${attention.length} need${attention.length === 1 ? "s" : ""} attention — see the notes below.`);
    });

  return (
    <Modal
      title={title}
      icon={<ClipboardCheck className="w-5 h-5" />}
      onClose={onClose}
      testId={source === "backfill" ? "weekend-backfill-modal" : "weekend-results-modal"}
      footer={
        <>
          <button type="button" className={SECONDARY} onClick={onClose} data-testid="weekend-results-skip">
            {source === "backfill" ? "Close" : "Skip for Later"}
          </button>
          <SubmitButton
            saving={saving}
            failed={Boolean(error) && chosen.length > 0}
            disabled={!chosen.length}
            onClick={save}
            label={`Save Results${chosen.length ? ` (${chosen.length})` : ""}`}
            icon={<Check className="w-4 h-4" />}
            testId="weekend-results-save"
          />
        </>
      }
    >
      <p className="text-sm text-text-secondary mb-2">{intro}</p>
      {source === "backfill" && (
        <p className="text-xs font-bold text-text-primary mb-2" data-testid="history-progress">
          {Object.keys(saved).length} completed · {pendingCount} pending
        </p>
      )}
      {source === "backfill" && <MonthFilter dates={rows.map((m) => m.date)} value={month} onChange={setMonth} />}
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary" data-testid="weekend-results-empty">
          No matches are waiting for a result.
        </p>
      ) : (
        groupByDate(visible).map(([date, list]) => (
          <section key={date} className="mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">{date ? formatMatchCardDate(date) : "No date"}</h3>
            <div className="space-y-2.5">
              {list.map((m) => {
                const done = Boolean(saved[m.id]);
                return (
                  <div key={m.id} className={`rounded-2xl border p-3 ${done ? "border-emerald-200 bg-emerald-50/60" : "border-border"}`} data-testid={`weekend-result-row-${m.id}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-black text-text-primary truncate">vs {m.opponent || "Opponent"}</p>
                      <p className="text-[11px] text-text-secondary shrink-0">{matchLine(m, groundName)}</p>
                    </div>
                    {done ? (
                      <p className="mt-2 text-xs font-bold text-emerald-700 flex items-center gap-1" data-testid={`weekend-result-saved-${m.id}`}>
                        <CheckCircle2 className="w-4 h-4" /> Saved · {saved[m.id]}
                      </p>
                    ) : (
                      <div className="mt-2 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={`Result vs ${m.opponent}`}>
                        {RESULT_CHOICES.map((c) => {
                          const on = choice[m.id] === c.value;
                          return (
                            <button
                              key={c.key}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              disabled={saving}
                              onClick={() => setChoice((s) => ({ ...s, [m.id]: on ? "" : c.value }))}
                              data-testid={`weekend-result-${m.id}-${c.key}`}
                              className={`min-h-[44px] rounded-xl text-xs font-bold border cursor-pointer transition ${
                                on ? "bg-brand text-white border-brand" : "border-border text-text-primary hover:bg-surface-hover"
                              }`}
                            >
                              {c.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {!done && choice[m.id] === "Abandoned" && (
                      <p className="mt-2 text-[11px] text-text-secondary">Unpaid match fees for this match will be waived automatically. Paid fees stay as recorded; no refunds are made.</p>
                    )}
                    {notes[m.id] && (
                      <p className="mt-2 text-[11px] font-semibold text-amber-700" data-testid={`weekend-result-note-${m.id}`}>
                        {notes[m.id]}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
      {exceptions > 0 && (
        <div className="mt-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex gap-2" data-testid="weekend-results-exceptions">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <div>
            {exceptions} match{exceptions > 1 ? "es" : ""} can’t be listed because the start time or format is missing. Fix the match details in Match Center first.
            {exceptionList && exceptionList.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {exceptionList.slice(0, 20).map((m) => (
                  <li key={m.id}>
                    vs {m.opponent || "Opponent"} {m.date ? `(${m.date})` : ""} — {REASON_LABEL[m.reason || ""] || m.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm font-semibold text-red-600" role="alert" data-testid="weekend-results-error">
          {error}
        </p>
      )}
    </Modal>
  );
}

// ── B. Player of the Weekend (current weekend, or an explicit historical decision) ──

function PotwModal({
  weekends,
  source,
  players,
  onClose,
  onSaved,
}: {
  weekends: WeekendSummary[];
  source: "prompt" | "history";
  players: Player[];
  onClose: () => void;
  onSaved: (weekendId: string, playerName: string) => void;
}) {
  const { saving, run } = useSubmit();
  const [rows] = useState(weekends);
  const [weekendId, setWeekendId] = useState(source === "prompt" ? weekends[0]?.weekendId ?? "" : "");
  const [awarded, setAwarded] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Player | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState("all");
  const weekend = rows.find((w) => w.weekendId === weekendId) || null;
  const eligible = useMemo(() => players.filter((p) => p && p.name && !p.disabled && !p.mergedInto).sort((a, b) => a.name.localeCompare(b.name)), [players]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? eligible.filter((p) => p.name.toLowerCase().includes(q)) : eligible).slice(0, 30);
  }, [eligible, query]);
  const msg = validatePotwMessage(message);
  const lines = message ? message.split("\n").length : 0;

  const grant = () =>
    run(async () => {
      setError(null);
      if (!weekend) return setError("Choose a weekend.");
      if (!selected) return setError("Select a player.");
      if (!msg.ok) return setError(msg.error);
      let r;
      try {
        r = await postJson("/api/admin/player-of-weekend", { weekendId: weekend.weekendId, playerId: selected.id, message: msg.value, source });
      } catch {
        return setError("Could not reach the server. Your choice is kept — Retry.");
      }
      if (r.ok || r.json?.alreadyAwarded) {
        const name = r.ok ? selected.name : r.json?.award?.playerName || "another player";
        onSaved(weekend.weekendId, name);
        if (source === "prompt") return onClose();
        setAwarded((a) => ({ ...a, [weekend.weekendId]: name }));
        setWeekendId("");
        setSelected(null);
        setQuery("");
        setMessage("");
        return;
      }
      setError(r.json?.error || "Could not grant the award. Your choice is kept — Retry.");
    });

  const visibleWeekends = rows.filter((w) => month === "all" || monthKey(w.weekendId) === month);
  const pendingCount = rows.filter((w) => !awarded[w.weekendId]).length;

  return (
    <Modal
      title={source === "history" ? "Historical Player of the Weekend" : "Select Player of the Weekend"}
      icon={<Trophy className="w-5 h-5" />}
      onClose={onClose}
      testId={source === "history" ? "history-potw-modal" : "weekend-potw-modal"}
      footer={
        <>
          <button type="button" className={SECONDARY} onClick={onClose} data-testid="weekend-potw-skip">
            {source === "history" ? "Close" : "Skip"}
          </button>
          <SubmitButton
            saving={saving}
            failed={Boolean(error) && Boolean(selected)}
            disabled={!weekend || !selected || !msg.ok}
            onClick={grant}
            label="Grant Award"
            icon={<Trophy className="w-4 h-4" />}
            testId="weekend-potw-grant"
          />
        </>
      }
    >
      {source === "prompt" ? (
        <p className="text-sm text-text-secondary mb-3">
          Weekend of <span className="font-bold text-text-primary">{weekend?.label}</span>. One award per weekend: the player receives the badge, a Home banner for 7 days and a notification.
        </p>
      ) : (
        <>
          <p className="text-sm text-text-secondary mb-2">
            Past weekends with a played match and no award. Nothing is awarded automatically — choose a weekend only if you want to award it. Historical awards add the badge and notify the player; they do not appear in the Home banner.
          </p>
          <p className="text-xs font-bold text-text-primary mb-2" data-testid="history-progress">
            {Object.keys(awarded).length} completed · {pendingCount} pending
          </p>
          <MonthFilter dates={rows.map((w) => w.weekendId)} value={month} onChange={setMonth} />
          <div className="space-y-1.5 mb-4" role="radiogroup" aria-label="Weekend">
            {visibleWeekends.length === 0 && <p className="text-sm text-text-secondary">No weekends are waiting for an award.</p>}
            {visibleWeekends.map((w) =>
              awarded[w.weekendId] ? (
                <div key={w.weekendId} className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm" data-testid={`history-weekend-${w.weekendId}`}>
                  <span className="font-bold">{w.label}</span>
                  <span className="ml-2 text-xs font-bold text-emerald-700">Saved · {awarded[w.weekendId]}</span>
                </div>
              ) : (
                <button
                  key={w.weekendId}
                  type="button"
                  role="radio"
                  aria-checked={weekendId === w.weekendId}
                  onClick={() => setWeekendId(w.weekendId)}
                  data-testid={`history-weekend-${w.weekendId}`}
                  className={`w-full min-h-[48px] rounded-xl border px-3 py-2 text-left cursor-pointer ${weekendId === w.weekendId ? "border-brand bg-brand/5" : "border-border hover:bg-surface-hover"}`}
                >
                  <span className="block text-sm font-bold text-text-primary">{w.label}</span>
                  <span className="block text-[11px] text-text-secondary truncate">{w.matches.map((m) => `vs ${m.opponent}${m.result ? ` (${m.result.replace("KAvach ", "")})` : ""}`).join(" · ")}</span>
                </button>
              ),
            )}
          </div>
        </>
      )}
      {weekend && (
        <>
          <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-1">Player</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              value={selected ? selected.name : query}
              onChange={(e) => {
                setSelected(null);
                setQuery(e.target.value);
              }}
              placeholder="Search players"
              className="min-h-[48px] w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30"
              data-testid="weekend-potw-search"
            />
          </div>
          {!selected && (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-border divide-y divide-border" role="listbox" aria-label="Players">
              {matches.map((p) => (
                <li key={p.id}>
                  <button type="button" role="option" aria-selected={false} onClick={() => setSelected(p)} className="w-full min-h-[44px] px-3 text-left text-sm text-text-primary hover:bg-surface-hover cursor-pointer" data-testid={`weekend-potw-option-${p.id}`}>
                    {p.name}
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="px-3 py-3 text-sm text-text-secondary">No players found.</li>}
            </ul>
          )}
          <label className="block mt-4 text-xs font-bold uppercase tracking-wider text-text-secondary mb-1" htmlFor="potw-message">
            Message (optional)
          </label>
          <textarea
            id="potw-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            maxLength={POTW_MESSAGE_MAX_CHARS + 10}
            placeholder={"e.g. 82* off 51 balls and 2 catches"}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30"
            data-testid="weekend-potw-message"
          />
          <p className={`text-[11px] ${msg.ok ? "text-text-secondary" : "text-red-600 font-semibold"}`} data-testid="weekend-potw-counter">
            {message.trim().length}/{POTW_MESSAGE_MAX_CHARS} characters · {lines}/{POTW_MESSAGE_MAX_LINES} lines{msg.ok ? "" : ` — ${msg.error}`}
          </p>
          {selected && source === "prompt" && (
            <div className="mt-4" data-testid="weekend-potw-preview">
              <p className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-1">Banner preview</p>
              <div className="rounded-2xl p-4 text-white bg-gradient-to-br from-[#5E0718] via-[#A30F2D] to-[#B8862F]">
                <PotwSlideBody potw={{ playerName: selected.name, photoURL: selected.photoURL?.startsWith("https://") ? selected.photoURL : undefined, message: msg.ok ? msg.value : "", weekendLabel: weekend.label }} />
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="mt-2 text-sm font-semibold text-red-600" role="alert" data-testid="weekend-potw-error">
          {error}
        </p>
      )}
    </Modal>
  );
}

// ── D. Actual match fee (recurring prompt and historical backfill) ─────────

function FeesModal({
  title,
  items,
  source,
  groundName,
  onClose,
  onSaved,
}: {
  title: string;
  items: MatchSummary[];
  source: "prompt" | "history";
  groundName: (id: string | null) => string;
  onClose: () => void;
  onSaved: (savedIds: string[]) => void;
}) {
  const { saving, run } = useSubmit();
  const [rows] = useState(items);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState("all");
  const entered = Object.entries(amounts).filter(([id, v]) => v.trim() !== "" && saved[id] === undefined);
  const invalid = entered.filter(([, v]) => !/^\d+(\.\d{1,2})?$/.test(v.trim()) || Number(v) > 10_000_000);
  const visible = rows.filter((m) => month === "all" || monthKey(m.date) === month);
  const pendingCount = rows.filter((m) => saved[m.id] === undefined).length;

  const save = () =>
    run(async () => {
      setError(null);
      if (!entered.length) return setError("Enter at least one amount.");
      if (invalid.length) return setError("Amounts must be numbers of ₹0 or more.");
      // One request per match to the existing Finance route (same validation,
      // transaction, history and audit as Match → Finance); independent matches
      // are sent together instead of one after another.
      const results = await Promise.all(
        entered.map(async ([matchId, v]) => {
          try {
            const r = await postJson("/api/finance/match-ledger", { action: "setGroundFee", matchId, amount: Number(v), reason: "" });
            return { matchId, ok: r.ok, amount: Number(v), error: r.ok ? "" : r.json?.error || "Not saved." };
          } catch {
            return { matchId, ok: false, amount: Number(v), error: "Not saved — check your connection." };
          }
        }),
      );
      const ok = results.filter((r) => r.ok);
      const bad = results.filter((r) => !r.ok);
      setNotes(Object.fromEntries(bad.map((r) => [r.matchId, r.error])));
      if (ok.length) {
        setSaved((s) => ({ ...s, ...Object.fromEntries(ok.map((r) => [r.matchId, r.amount])) }));
        onSaved(ok.map((r) => r.matchId));
      }
      if (!bad.length && source === "prompt") return onClose();
      if (bad.length) setError(`${bad.length} not saved — amounts are kept. Retry saves only those.`);
    });

  return (
    <Modal
      title={title}
      icon={<IndianRupee className="w-5 h-5" />}
      onClose={onClose}
      testId={source === "history" ? "history-fees-modal" : "weekend-fees-modal"}
      footer={
        <>
          <button type="button" className={SECONDARY} onClick={onClose} data-testid="weekend-fees-skip">
            {source === "history" ? "Close" : "Skip for Later"}
          </button>
          <SubmitButton
            saving={saving}
            failed={Boolean(error) && entered.length > 0}
            disabled={!entered.length || invalid.length > 0}
            onClick={save}
            label={`Save Fees${entered.length ? ` (${entered.length})` : ""}`}
            icon={<Check className="w-4 h-4" />}
            testId="weekend-fees-save"
          />
        </>
      }
    >
      <p className="text-sm text-text-secondary mb-2">
        What the club actually paid the ground / vendor for each match. Player match fees are not changed. Corrections later go through Match → Finance with a reason.
      </p>
      {source === "history" && (
        <>
          <p className="text-xs font-bold text-text-primary mb-2" data-testid="history-progress">
            {Object.keys(saved).length} completed · {pendingCount} pending
          </p>
          <MonthFilter dates={rows.map((m) => m.date)} value={month} onChange={setMonth} />
        </>
      )}
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">All actual match fees are recorded.</p>
      ) : (
        <div className="space-y-2.5">
          {visible.map((m) => {
            const v = amounts[m.id] ?? "";
            const done = saved[m.id] !== undefined;
            const bad = !done && v.trim() !== "" && invalid.some(([k]) => k === m.id);
            return (
              <div key={m.id} className={`rounded-2xl border p-3 ${done ? "border-emerald-200 bg-emerald-50/60" : "border-border"}`} data-testid={`weekend-fee-row-${m.id}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-black text-text-primary truncate">vs {m.opponent || "Opponent"}</p>
                  <p className="text-[11px] text-text-secondary shrink-0">{m.date ? formatMatchCardDate(m.date) : ""}</p>
                </div>
                <p className="text-[11px] text-text-secondary">
                  {matchLine(m, groundName)}
                  {m.result === "Abandoned" ? " · Abandoned" : ""}
                </p>
                {done ? (
                  <p className="mt-2 text-xs font-bold text-emerald-700 flex items-center gap-1" data-testid={`weekend-fee-saved-${m.id}`}>
                    <CheckCircle2 className="w-4 h-4" /> Saved · ₹{saved[m.id].toLocaleString("en-IN")}
                  </p>
                ) : (
                  <div className="relative mt-2">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-text-secondary">₹</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={v}
                      disabled={saving}
                      onChange={(e) => setAmounts((s) => ({ ...s, [m.id]: e.target.value }))}
                      placeholder="Amount paid"
                      aria-label={`Actual fee paid vs ${m.opponent}`}
                      aria-invalid={bad}
                      className={`min-h-[48px] w-full rounded-xl border bg-surface pl-7 pr-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30 ${bad ? "border-red-600" : "border-border"}`}
                      data-testid={`weekend-fee-input-${m.id}`}
                    />
                  </div>
                )}
                {bad && <p className="mt-1 text-[11px] font-semibold text-red-600">Enter ₹0 or more (numbers only).</p>}
                {notes[m.id] && !done && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-700" data-testid={`weekend-fee-note-${m.id}`}>
                    {notes[m.id]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm font-semibold text-red-600" role="alert" data-testid="weekend-fees-error">
          {error}
        </p>
      )}
    </Modal>
  );
}
