"use client";

/**
 * Weekend match operations — Admin persona prompts (`components/weekend-ops/WeekendPrompts.tsx`).
 *
 *  A. Enter Match Results           → POST /api/admin/weekend-results
 *  B. Select Player of the Weekend  → POST /api/admin/player-of-weekend
 *  D. Enter Actual Match Fee        → POST /api/finance/match-ledger {action: "setGroundFee"} (existing route)
 *
 * What is due, and for whom, comes from GET /api/admin/weekend-prompts (server
 * clock, verified roles, pending state held in the data). This component only
 * presents it; it holds no authority. Prompts render in Admin persona only.
 *
 * Session behaviour: each prompt opens automatically at most once per browser
 * session, one modal at a time (results → award → fees). "Skip for Later" only
 * hides it for this session; the work stays pending for every admin and the
 * task bar offers it again. Partial saves clear only the saved records.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trophy, ClipboardCheck, IndianRupee, X, Search, History, AlertTriangle, Check, Loader2 } from "lucide-react";
import type { Ground, Player } from "@/lib/types";
import { authedFetch } from "@/lib/authed-fetch";
import { RESULT_CHOICES, POTW_MESSAGE_MAX_CHARS, POTW_MESSAGE_MAX_LINES, validatePotwMessage } from "@/lib/weekend-ops";
import { formatMatchCardDate } from "@/lib/match-card-format";
import { formatMatchDisplayTime } from "@/lib/personal-match-payment";
import { PotwSlideBody } from "@/components/home/CampaignHeroBanner";

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
type PromptsResponse = {
  now: number;
  mode: "testing" | "recurring";
  results?: { items: MatchSummary[]; exceptions: { id: string; reason: string }[] };
  potw?: { weekendId: string; label: string; closesAt: number; awarded: { playerId: string; playerName: string } | null; matches: MatchSummary[] } | null;
  fees?: { from: string; to: string; items: MatchSummary[] };
  pending: { results: number; potw: number; fees: number };
};
type Kind = "results" | "potw" | "fees" | "backfill";

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

const SKIP_KEY = (uid: string) => `kavach:weekend-ops:shown:v1:${uid}`;
function readShown(uid: string): Record<string, boolean> {
  try {
    return JSON.parse(window.sessionStorage.getItem(SKIP_KEY(uid)) || "{}") || {};
  } catch {
    return {};
  }
}
function writeShown(uid: string, v: Record<string, boolean>) {
  try {
    window.sessionStorage.setItem(SKIP_KEY(uid), JSON.stringify(v));
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
};

export interface WeekendPromptsProps {
  uid: string;
  /** The signed-in user is an admin (any admin role). Drives the fetch for the indicator. */
  isAdmin: boolean;
  /** Admin persona is active: only then do prompts, the task bar and the backfill queue render. */
  active: boolean;
  activeTab: string;
  players: Player[];
  grounds: Ground[];
  onPendingChange?: (count: number) => void;
  onRecorded?: () => void;
}

export function WeekendPrompts({ uid, isAdmin, active, activeTab, players, grounds, onPendingChange, onRecorded }: WeekendPromptsProps) {
  const [data, setData] = useState<PromptsResponse | null>(null);
  const [open, setOpen] = useState<Kind | null>(null);
  const [backfill, setBackfill] = useState<{ items: MatchSummary[]; exceptions: MatchSummary[] } | null>(null);
  const shownRef = useRef<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/weekend-prompts");
      if (!res.ok) return setData(null);
      setData((await res.json()) as PromptsResponse);
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin || !uid) return;
    shownRef.current = readShown(uid);
    load();
  }, [isAdmin, uid, load]);

  const pending = data?.pending ?? { results: 0, potw: 0, fees: 0 };
  const total = pending.results + pending.potw + pending.fees;
  useEffect(() => onPendingChange?.(total), [total, onPendingChange]);

  // Auto-open: Admin persona only, one modal at a time, each kind once per session.
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
  const close = () => setOpen(null);
  const afterSave = async () => {
    await load();
    onRecorded?.();
  };

  const openBackfill = async () => {
    setOpen("backfill");
    setBackfill(null);
    try {
      const res = await apiFetch("/api/admin/weekend-prompts?view=backfill");
      const json = await res.json().catch(() => ({}));
      setBackfill(res.ok ? { items: json.items || [], exceptions: json.exceptions || [] } : { items: [], exceptions: [] });
    } catch {
      setBackfill({ items: [], exceptions: [] });
    }
  };

  if (!active || !data) return null;
  const canResults = Boolean(data.results);
  const showBar = total > 0 || (canResults && activeTab === "matches");

  return (
    <>
      {showBar && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2.5" data-testid="weekend-tasks-bar">
          <span className="text-xs font-bold uppercase tracking-wider text-text-secondary mr-1">Weekend tasks</span>
          {pending.results > 0 && (
            <TaskChip testId="weekend-task-results" icon={<ClipboardCheck className="w-4 h-4" />} label={`Match results (${pending.results})`} onClick={() => setOpen("results")} />
          )}
          {pending.potw > 0 && <TaskChip testId="weekend-task-potw" icon={<Trophy className="w-4 h-4" />} label="Player of the Weekend" onClick={() => setOpen("potw")} />}
          {pending.fees > 0 && (
            <TaskChip testId="weekend-task-fees" icon={<IndianRupee className="w-4 h-4" />} label={`Actual match fees (${pending.fees})`} onClick={() => setOpen("fees")} />
          )}
          {canResults && activeTab === "matches" && (
            <TaskChip testId="weekend-task-backfill" icon={<History className="w-4 h-4" />} label="Missing results (backfill)" onClick={openBackfill} subtle />
          )}
        </div>
      )}

      {open === "results" && data.results && (
        <ResultsModal
          title="Enter Match Results"
          intro="Record the result of each completed match. Matches you leave blank stay pending."
          items={data.results.items}
          exceptions={data.results.exceptions.length}
          source="prompt"
          groundName={groundName}
          onClose={close}
          onSaved={afterSave}
        />
      )}
      {open === "backfill" && (
        <ResultsModal
          title="Missing results — historical backfill"
          intro="Every completed match without a result, oldest first. Nothing is filled in automatically; choose and save only the results you know."
          items={backfill?.items ?? null}
          exceptions={backfill?.exceptions.length ?? 0}
          exceptionList={backfill?.exceptions}
          source="backfill"
          groundName={groundName}
          onClose={close}
          onSaved={async () => {
            await afterSave();
            await openBackfill();
          }}
        />
      )}
      {open === "potw" && data.potw && !data.potw.awarded && (
        <PotwModal weekendId={data.potw.weekendId} label={data.potw.label} players={players} onClose={close} onSaved={afterSave} />
      )}
      {open === "fees" && data.fees && <FeesModal items={data.fees.items} groundName={groundName} onClose={close} onSaved={afterSave} />}
    </>
  );
}

function TaskChip({ icon, label, onClick, testId, subtle }: { icon: React.ReactNode; label: string; onClick: () => void; testId: string; subtle?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`min-h-[40px] px-3 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition ${
        subtle ? "border border-border text-text-primary hover:bg-surface-hover" : "bg-brand/10 text-brand hover:bg-brand/15"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Shared modal shell ──────────────────────────────────────────────────────

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

// ── A. Results ──────────────────────────────────────────────────────────────

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
  items: MatchSummary[] | null;
  exceptions: number;
  exceptionList?: MatchSummary[];
  source: "prompt" | "backfill";
  groundName: (id: string | null) => string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const chosen = Object.entries(choice).filter(([, v]) => v);

  const save = async () => {
    setError(null);
    if (!chosen.length) return setError("Choose at least one result, or Skip for Later.");
    setSaving(true);
    try {
      const r = await postJson("/api/admin/weekend-results", { source, results: chosen.map(([matchId, result]) => ({ matchId, result })) });
      if (!r.ok) {
        setError(r.json?.error || "Could not save results.");
        return;
      }
      const n: Record<string, string> = {};
      let saved = 0;
      for (const o of r.json.outcomes || []) {
        if (o.status === "saved" || o.status === "unchanged") {
          saved++;
          if (o.waiver?.status === "failed") n[o.matchId] = "Saved as Abandoned, but waiving unpaid fees failed — save again to retry.";
        } else if (o.status === "conflict") n[o.matchId] = `Already recorded as “${o.existingResult}” by another admin.`;
        else n[o.matchId] = `Not saved: ${REASON_LABEL[o.reason] || o.reason || o.status}.`;
      }
      setNotes(n);
      setChoice({});
      await onSaved();
      if (Object.keys(n).length === 0 && saved > 0 && source === "prompt") onClose();
    } catch {
      setError("Could not save results. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

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
          <button type="button" className={PRIMARY} onClick={save} disabled={saving || !chosen.length} data-testid="weekend-results-save">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save Results{chosen.length ? ` (${chosen.length})` : ""}
          </button>
        </>
      }
    >
      <p className="text-sm text-text-secondary mb-3">{intro}</p>
      {items === null ? (
        <p className="py-6 text-center text-sm text-text-secondary">
          <Loader2 className="inline w-4 h-4 animate-spin mr-1" /> Loading…
        </p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary" data-testid="weekend-results-empty">
          No matches are waiting for a result.
        </p>
      ) : (
        groupByDate(items).map(([date, list]) => (
          <section key={date} className="mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">{date ? formatMatchCardDate(date) : "No date"}</h3>
            <div className="space-y-2.5">
              {list.map((m) => (
                <div key={m.id} className="rounded-2xl border border-border p-3" data-testid={`weekend-result-row-${m.id}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-black text-text-primary truncate">vs {m.opponent || "Opponent"}</p>
                    <p className="text-[11px] text-text-secondary shrink-0">{matchLine(m, groundName)}</p>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={`Result vs ${m.opponent}`}>
                    {RESULT_CHOICES.map((c) => {
                      const on = choice[m.id] === c.value;
                      return (
                        <button
                          key={c.key}
                          type="button"
                          role="radio"
                          aria-checked={on}
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
                  {choice[m.id] === "Abandoned" && (
                    <p className="mt-2 text-[11px] text-text-secondary">Unpaid match fees for this match will be waived automatically. Paid fees stay as recorded; no refunds are made.</p>
                  )}
                  {notes[m.id] && (
                    <p className="mt-2 text-[11px] font-semibold text-amber-700" data-testid={`weekend-result-note-${m.id}`}>
                      {notes[m.id]}
                    </p>
                  )}
                </div>
              ))}
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
      {error && <p className="mt-2 text-sm font-semibold text-red-600" role="alert">{error}</p>}
    </Modal>
  );
}

// ── B. Player of the Weekend ────────────────────────────────────────────────

function PotwModal({ weekendId, label, players, onClose, onSaved }: { weekendId: string; label: string; players: Player[]; onClose: () => void; onSaved: () => Promise<void> | void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Player | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligible = useMemo(
    () => players.filter((p) => p && p.name && !p.disabled && !p.mergedInto).sort((a, b) => a.name.localeCompare(b.name)),
    [players],
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? eligible.filter((p) => p.name.toLowerCase().includes(q)) : eligible).slice(0, 30);
  }, [eligible, query]);
  const msg = validatePotwMessage(message);
  const lines = message ? message.split("\n").length : 0;

  const grant = async () => {
    setError(null);
    if (!selected) return setError("Select a player.");
    if (!msg.ok) return setError(msg.error);
    setSaving(true);
    try {
      const r = await postJson("/api/admin/player-of-weekend", { weekendId, playerId: selected.id, message: msg.value });
      if (r.ok || r.json?.alreadyAwarded) {
        await onSaved();
        onClose();
        return;
      }
      setError(r.json?.error || "Could not grant the award.");
    } catch {
      setError("Could not grant the award. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Select Player of the Weekend"
      icon={<Trophy className="w-5 h-5" />}
      onClose={onClose}
      testId="weekend-potw-modal"
      footer={
        <>
          <button type="button" className={SECONDARY} onClick={onClose} data-testid="weekend-potw-skip">
            Skip
          </button>
          <button type="button" className={PRIMARY} onClick={grant} disabled={saving || !selected || !msg.ok} data-testid="weekend-potw-grant">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trophy className="w-4 h-4" />}
            Grant Award
          </button>
        </>
      }
    >
      <p className="text-sm text-text-secondary mb-3">
        Weekend of <span className="font-bold text-text-primary">{label}</span>. One award per weekend: the player receives the badge, a Home banner for 7 days and a notification.
      </p>
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
        rows={4}
        maxLength={POTW_MESSAGE_MAX_CHARS + 10}
        placeholder={"e.g. 82* off 51 balls and 2 catches"}
        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30"
        data-testid="weekend-potw-message"
      />
      <p className={`text-[11px] ${msg.ok ? "text-text-secondary" : "text-red-600 font-semibold"}`} data-testid="weekend-potw-counter">
        {message.trim().length}/{POTW_MESSAGE_MAX_CHARS} characters · {lines}/{POTW_MESSAGE_MAX_LINES} lines{msg.ok ? "" : ` — ${msg.error}`}
      </p>
      {selected && (
        <div className="mt-4" data-testid="weekend-potw-preview">
          <p className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-1">Banner preview</p>
          <div className="rounded-2xl p-4 text-white bg-gradient-to-br from-[#5E0718] via-[#A30F2D] to-[#B8862F]">
            <PotwSlideBody potw={{ playerName: selected.name, photoURL: selected.photoURL?.startsWith("https://") ? selected.photoURL : undefined, message: msg.ok ? msg.value : "", weekendLabel: label }} />
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-red-600" role="alert">{error}</p>}
    </Modal>
  );
}

// ── D. Actual match fee ─────────────────────────────────────────────────────

function FeesModal({ items, groundName, onClose, onSaved }: { items: MatchSummary[]; groundName: (id: string | null) => string; onClose: () => void; onSaved: () => Promise<void> | void }) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entered = Object.entries(amounts).filter(([, v]) => v.trim() !== "");
  const invalid = entered.filter(([, v]) => !/^\d+(\.\d{1,2})?$/.test(v.trim()) || Number(v) > 10_000_000);

  const save = async () => {
    setError(null);
    if (!entered.length) return setError("Enter at least one amount, or Skip for Later.");
    if (invalid.length) return setError("Amounts must be numbers of ₹0 or more.");
    setSaving(true);
    const n: Record<string, string> = {};
    let failed = 0;
    for (const [matchId, v] of entered) {
      try {
        // Existing Finance route: same validation, transaction, history and audit as Match → Finance.
        const r = await postJson("/api/finance/match-ledger", { action: "setGroundFee", matchId, amount: Number(v), reason: "" });
        if (!r.ok) {
          failed++;
          n[matchId] = r.json?.error || "Not saved.";
        }
      } catch {
        failed++;
        n[matchId] = "Not saved — check your connection.";
      }
    }
    setNotes(n);
    setAmounts((s) => Object.fromEntries(Object.entries(s).filter(([k]) => n[k])));
    setSaving(false);
    await onSaved();
    if (!failed) onClose();
  };

  return (
    <Modal
      title="Enter Actual Match Fee"
      icon={<IndianRupee className="w-5 h-5" />}
      onClose={onClose}
      testId="weekend-fees-modal"
      footer={
        <>
          <button type="button" className={SECONDARY} onClick={onClose} data-testid="weekend-fees-skip">
            Skip for Later
          </button>
          <button type="button" className={PRIMARY} onClick={save} disabled={saving || !entered.length || invalid.length > 0} data-testid="weekend-fees-save">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save Fees{entered.length ? ` (${entered.length})` : ""}
          </button>
        </>
      }
    >
      <p className="text-sm text-text-secondary mb-3">
        What the club actually paid the ground / vendor for each match. Player match fees are not changed. Corrections later go through Match → Finance with a reason.
      </p>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">All actual match fees are recorded.</p>
      ) : (
        <div className="space-y-2.5">
          {items.map((m) => {
            const v = amounts[m.id] ?? "";
            const bad = v.trim() !== "" && invalid.some(([k]) => k === m.id);
            return (
              <div key={m.id} className="rounded-2xl border border-border p-3" data-testid={`weekend-fee-row-${m.id}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-black text-text-primary truncate">vs {m.opponent || "Opponent"}</p>
                  <p className="text-[11px] text-text-secondary shrink-0">{m.date ? formatMatchCardDate(m.date) : ""}</p>
                </div>
                <p className="text-[11px] text-text-secondary">
                  {matchLine(m, groundName)}
                  {m.result === "Abandoned" ? " · Abandoned" : ""}
                </p>
                <div className="relative mt-2">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-text-secondary">₹</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={v}
                    onChange={(e) => setAmounts((s) => ({ ...s, [m.id]: e.target.value }))}
                    placeholder="Amount paid"
                    aria-label={`Actual fee paid vs ${m.opponent}`}
                    aria-invalid={bad}
                    className={`min-h-[48px] w-full rounded-xl border bg-surface pl-7 pr-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30 ${bad ? "border-red-600" : "border-border"}`}
                    data-testid={`weekend-fee-input-${m.id}`}
                  />
                </div>
                {bad && <p className="mt-1 text-[11px] font-semibold text-red-600">Enter ₹0 or more (numbers only).</p>}
                {notes[m.id] && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-700" data-testid={`weekend-fee-note-${m.id}`}>
                    {notes[m.id]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-red-600" role="alert">{error}</p>}
    </Modal>
  );
}
