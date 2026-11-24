"use client";

/**
 * Admin Club → Club Stats → Circuit Standings (`components/club/CircuitStandingsAdmin.tsx`).
 *
 * Club Admins / Super Admins review, add, edit and delete the standings shown on the
 * Player Club card (India / Bangalore × Most Wins / Most Played). Every change goes
 * through /api/admin/circuit-standings, which re-validates, enforces the Club Admin
 * role and audits; Firestore rules deny all client writes to `circuitStandings`.
 */
import { useMemo, useState } from "react";
import { Medal, Plus, Pencil, Trash2, Loader2, X } from "lucide-react";
import type { useStore } from "@/hooks/useStore";
import { authedFetch } from "@/lib/authed-fetch";
import { useCircuitStandings } from "@/hooks/useCircuitStandings";
import { useToast } from "@/components/ui/Toast";
import {
  CIRCUITS,
  CIRCUIT_RANK_MAX,
  CIRCUIT_VALUE_MAX,
  circuitInfo,
  clubToday,
  formatAsOf,
  formatStandingValue,
  isSelectablePlayer,
  standingsFor,
  validateCircuitStandingInput,
  type CircuitKey,
  type CircuitStanding,
} from "@/lib/circuit-standings";

const API = "/api/admin/circuit-standings";

function apiFetch(init: RequestInit) {
  const synthetic = process.env.NODE_ENV !== "production" && typeof window !== "undefined" && (window as any).__KAVACH_TEST_USER__ !== undefined;
  return synthetic ? fetch(API, init) : authedFetch(API, init);
}

interface Draft {
  id: string | null; // null = new record
  circuit: CircuitKey;
  playerId: string;
  rank: string;
  value: string;
  asOf: string;
}

const inputCls =
  "w-full min-h-[44px] bg-surface border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-scarlet/30 focus:border-scarlet disabled:opacity-60";
const labelCls = "text-[11px] font-bold uppercase tracking-wider text-text-muted";

export function CircuitStandingsAdmin({ store }: { store: ReturnType<typeof useStore> }) {
  const { standings, loading, error } = useCircuitStandings();
  const { toast } = useToast();
  const [circuit, setCircuit] = useState<CircuitKey>("india-wins");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [playerQuery, setPlayerQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const players = useMemo(
    () =>
      ((store.players || []) as any[])
        .filter((p) => p && p.id && isSelectablePlayer(p))
        .map((p) => ({ id: String(p.id), name: String(p.name || "Unnamed player") }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [store.players],
  );
  const rows = standingsFor(standings, circuit);
  const info = circuitInfo(draft?.circuit ?? circuit)!;
  const takenInDraftCircuit = new Set(standings.filter((s) => s.circuit === draft?.circuit && s.id !== draft?.id).map((s) => s.playerId));
  const playerOptions = players.filter((p) => !playerQuery.trim() || p.name.toLowerCase().includes(playerQuery.trim().toLowerCase()) || p.id === draft?.playerId);

  const openNew = () => {
    setDraft({ id: null, circuit, playerId: "", rank: String((rows.at(-1)?.rank ?? 0) + 1), value: "", asOf: clubToday() });
    setPlayerQuery("");
    setFormError(null);
  };
  const openEdit = (s: CircuitStanding) => {
    setDraft({ id: s.id, circuit: s.circuit, playerId: s.playerId, rank: String(s.rank), value: String(s.value), asOf: s.asOf });
    setPlayerQuery("");
    setFormError(null);
  };
  const close = () => {
    setDraft(null);
    setFormError(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || saving) return;
    const { id, ...fields } = draft;
    const v = validateCircuitStandingInput(fields);
    if (!v.ok) return setFormError(v.error);
    if (takenInDraftCircuit.has(v.value.playerId)) return setFormError("That player already has a standing in this circuit. Edit that record instead.");
    setSaving(true);
    setFormError(null);
    try {
      const res = await apiFetch({
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id, ...v.value } : v.value),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setFormError(json.error || "The standing could not be saved.");
      toast(id ? "Circuit standing updated" : "Circuit standing added", "success");
      setCircuit(v.value.circuit);
      setDraft(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "The standing could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: CircuitStanding) => {
    if (deleting) return;
    setDeleting(s.id);
    try {
      const res = await apiFetch({ method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "The standing could not be deleted.");
      toast("Circuit standing deleted", "success");
      if (draft?.id === s.id) setDraft(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "The standing could not be deleted.", "error");
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  };

  return (
    <section className="bg-surface border border-border rounded-2xl p-4 sm:p-6 shadow-xs" data-testid="circuit-standings-admin" aria-labelledby="circuit-admin-title">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Medal className="w-4 h-4 text-scarlet" aria-hidden="true" />
          <h2 id="circuit-admin-title" className="text-sm font-black uppercase tracking-wider text-text-primary font-heading">
            Circuit Standings
          </h2>
        </div>
        <button
          type="button"
          onClick={openNew}
          data-testid="circuit-add"
          className="min-h-[40px] inline-flex items-center gap-1.5 px-3 rounded-xl bg-scarlet text-white text-sm font-bold hover:opacity-90 cursor-pointer"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> Add standing
        </button>
      </div>
      <p className="text-xs text-text-secondary mb-4">
        Ranked players for each circuit. The top-ranked player appears on every member&apos;s Club screen; the full list is under Club → Stats.
      </p>

      <div role="tablist" aria-label="Circuits" className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 mb-3">
        {CIRCUITS.map((c) => {
          const n = standings.filter((s) => s.circuit === c.key).length;
          return (
            <button
              key={c.key}
              role="tab"
              type="button"
              aria-selected={circuit === c.key}
              data-testid={`circuit-tab-${c.key}`}
              onClick={() => setCircuit(c.key)}
              className={`shrink-0 min-h-[40px] px-3 rounded-full text-xs font-semibold border transition cursor-pointer ${
                circuit === c.key ? "bg-scarlet text-white border-scarlet" : "bg-surface text-text-primary border-border hover:bg-surface-hover"
              }`}
            >
              {c.scope} – {c.metric} <span className="opacity-80">({n})</span>
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mb-3 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Saved standings could not be loaded. Refresh before editing.
        </p>
      )}

      <div className="rounded-xl border border-border divide-y divide-border" data-testid="circuit-records">
        {loading ? (
          <p className="px-3 py-4 text-sm text-text-secondary">Loading standings…</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-4 text-sm text-text-secondary" data-testid="circuit-empty">
            No standings recorded for {circuitInfo(circuit)!.scope} – {circuitInfo(circuit)!.metric}. Players see &quot;Not available&quot;.
          </p>
        ) : (
          rows.map((s) => (
            <div key={s.id} className="px-3 py-2.5 flex items-center gap-3 min-w-0" data-testid={`circuit-row-${s.id}`}>
              <span className="w-9 shrink-0 text-sm font-black text-scarlet tabular-nums">#{s.rank}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-text-primary truncate">{s.playerName}</span>
                <span className="block text-xs text-text-secondary">
                  {formatStandingValue(s.circuit, s.value)} · as of {formatAsOf(s.asOf)}
                </span>
              </span>
              {confirmDelete === s.id ? (
                <span className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => remove(s)}
                    disabled={deleting === s.id}
                    data-testid={`circuit-confirm-delete-${s.id}`}
                    className="min-h-[40px] px-3 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                  >
                    {deleting === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(null)} className="min-h-[40px] px-2 rounded-lg text-xs font-semibold text-text-secondary cursor-pointer">
                    Cancel
                  </button>
                </span>
              ) : (
                <span className="flex items-center shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(s)}
                    aria-label={`Edit ${s.playerName}`}
                    data-testid={`circuit-edit-${s.id}`}
                    className="w-11 h-11 flex items-center justify-center rounded-lg text-text-secondary hover:bg-surface-hover cursor-pointer"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(s.id)}
                    aria-label={`Delete ${s.playerName}`}
                    data-testid={`circuit-delete-${s.id}`}
                    className="w-11 h-11 flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {draft && (
        <form onSubmit={save} noValidate className="mt-4 rounded-xl border border-scarlet/30 bg-brand-surface/30 p-3 sm:p-4 flex flex-col gap-3" data-testid="circuit-form">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-text-primary">{draft.id ? "Edit standing" : "Add standing"}</h3>
            <button type="button" onClick={close} aria-label="Close" className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-surface-hover cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Circuit</span>
            <select
              className={inputCls}
              value={draft.circuit}
              data-testid="circuit-form-circuit"
              onChange={(e) => setDraft({ ...draft, circuit: e.target.value as CircuitKey })}
            >
              {CIRCUITS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.scope} – {c.metric}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="circuit-player">
              Player
            </label>
            <input
              type="search"
              className={inputCls}
              placeholder="Search players…"
              value={playerQuery}
              onChange={(e) => setPlayerQuery(e.target.value)}
              aria-label="Search players"
              data-testid="circuit-form-player-search"
            />
            <select
              id="circuit-player"
              className={inputCls}
              value={draft.playerId}
              data-testid="circuit-form-player"
              onChange={(e) => setDraft({ ...draft, playerId: e.target.value })}
            >
              <option value="">Select a player</option>
              {playerOptions.map((p) => (
                <option key={p.id} value={p.id} disabled={takenInDraftCircuit.has(p.id)}>
                  {p.name}
                  {takenInDraftCircuit.has(p.id) ? " (already ranked)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelCls}>Rank</span>
              <input
                className={inputCls}
                inputMode="numeric"
                value={draft.rank}
                data-testid="circuit-form-rank"
                onChange={(e) => setDraft({ ...draft, rank: e.target.value })}
                aria-describedby="circuit-rank-hint"
              />
              <span id="circuit-rank-hint" className="text-[11px] text-text-muted">1–{CIRCUIT_RANK_MAX}</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>{info.valueLabel}</span>
              <input
                className={inputCls}
                inputMode="numeric"
                value={draft.value}
                data-testid="circuit-form-value"
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              />
              <span className="text-[11px] text-text-muted">0–{CIRCUIT_VALUE_MAX}</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>As of</span>
              <input
                type="date"
                className={inputCls}
                value={draft.asOf}
                max={clubToday()}
                data-testid="circuit-form-asof"
                onChange={(e) => setDraft({ ...draft, asOf: e.target.value })}
              />
            </label>
          </div>
          {formError && (
            <p role="alert" className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="circuit-form-error">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="min-h-[44px] px-4 rounded-xl border border-border text-sm font-semibold cursor-pointer">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              data-testid="circuit-form-save"
              className="min-h-[44px] px-4 rounded-xl bg-scarlet text-white text-sm font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {draft.id ? "Save changes" : "Add standing"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
