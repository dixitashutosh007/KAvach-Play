"use client";

/**
 * Admin Club → Leaderboard & Stats → Club Rankings (`components/club/CircuitStandingsAdmin.tsx`).
 *
 * Manages KAvach's two official rankings: Ranking in Bangalore and Ranking in India.
 * Every change goes through /api/admin/circuit-standings, which re-validates, enforces
 * Club Admin / Super Admin authority and audits; Firestore rules deny all client writes.
 */
import { useEffect, useState } from "react";
import { Medal, Loader2, Save, Trash2 } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { useCircuitStandings } from "@/hooks/useCircuitStandings";
import { useToast } from "@/components/ui/Toast";
import {
  CIRCUITS,
  standingsByCircuit,
  validateCircuitStandingInput,
  type CircuitKey,
  type CircuitStanding,
} from "@/lib/circuit-standings";

const API = "/api/admin/circuit-standings";

function apiFetch(init: RequestInit) {
  const synthetic =
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    (window as any).__KAVACH_TEST_USER__ !== undefined;
  return synthetic ? fetch(API, init) : authedFetch(API, init);
}

const inputCls =
  "w-full min-h-[44px] bg-surface border border-border rounded-xl px-3 py-2 text-lg font-black tabular-nums text-text-primary focus:outline-none focus:ring-2 focus:ring-scarlet/30 focus:border-scarlet disabled:opacity-60";
const labelCls = "text-[11px] font-bold uppercase tracking-wider text-text-muted";

export function CircuitStandingsAdmin() {
  const { standings, loading, error } = useCircuitStandings();
  const saved = standingsByCircuit(standings);
  const hasExactDoc = (key: CircuitKey) => standings.some((s) => s.circuit === key);

  return (
    <section
      className="bg-surface border border-border rounded-2xl p-4 sm:p-6 shadow-xs"
      data-testid="circuit-standings-admin"
      aria-labelledby="circuit-admin-title"
    >
      <div className="flex items-center gap-2 mb-1">
        <Medal className="w-4 h-4 text-scarlet" aria-hidden="true" />
        <h2
          id="circuit-admin-title"
          className="text-sm font-black uppercase tracking-wider text-text-primary font-heading"
        >
          Club Rankings
        </h2>
      </div>
      <p className="text-xs text-text-secondary mb-4">
        KAvach&apos;s ranking in Bangalore and India. These appear in the Club Stats window on every member&apos;s Club screen.
      </p>
      {error && (
        <p
          role="alert"
          className="mb-3 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
        >
          Saved rankings could not be loaded. Refresh before editing.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {CIRCUITS.map((c) => (
          <RankingCard
            key={c.key}
            circuit={c.key}
            saved={saved[c.key] ?? null}
            canClear={hasExactDoc(c.key)}
            loading={loading}
          />
        ))}
      </div>
    </section>
  );
}

function RankingCard({
  circuit,
  saved,
  canClear,
  loading,
}: {
  circuit: CircuitKey;
  saved: CircuitStanding | null;
  canClear: boolean;
  loading: boolean;
}) {
  const info = CIRCUITS.find((c) => c.key === circuit)!;
  const { toast } = useToast();
  const [rank, setRank] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!touched) {
      setRank(saved ? String(saved.rank) : "");
    }
  }, [saved, touched]);

  const v = validateCircuitStandingInput({ circuit, rank });
  const unchanged = v.ok && canClear && saved !== null && v.value.rank === saved.rank;
  const t = `circuit-${circuit}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!v.ok) return setErr(v.error);
    if (unchanged || busy) return;
    setBusy("save");
    setErr(null);
    try {
      const res = await apiFetch({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v.value),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(json.error || "The ranking could not be saved.");
      setTouched(false);
      toast(`${info.metric} saved`, "success");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "The ranking could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy("clear");
    setErr(null);
    try {
      const res = await apiFetch({
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ circuit }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(json.error || "The ranking could not be cleared.");
      setTouched(false);
      toast(`${info.metric} cleared`, "success");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "The ranking could not be cleared.");
    } finally {
      setBusy(null);
      setConfirmClear(false);
    }
  };

  return (
    <form
      onSubmit={save}
      data-testid={t}
      className="rounded-xl border border-border bg-surface-hover/40 p-4 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black text-text-primary">{info.metric}</p>
          <p className="text-xs text-text-secondary">{info.scope}</p>
        </div>
        <span
          className="text-xs font-semibold text-text-muted tabular-nums"
          data-testid={`${t}-saved`}
        >
          {loading ? "Loading…" : saved ? `#${saved.rank.toLocaleString("en-IN")}` : "Not set"}
        </span>
      </div>

      <label className="flex flex-col gap-1">
        <span className={labelCls}>Rank (#)</span>
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          placeholder="e.g. 20"
          value={rank}
          onChange={(e) => {
            setTouched(true);
            setRank(e.target.value);
            setErr(null);
          }}
          data-testid={`${t}-rank`}
          className={inputCls}
        />
      </label>

      {err && (
        <p role="alert" data-testid={`${t}-error`} className="text-xs font-semibold text-rose-600">
          {err}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {canClear ? (
          confirmClear ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={clear}
                disabled={Boolean(busy)}
                data-testid={`${t}-clear-confirm`}
                className="min-h-[40px] px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {busy === "clear" ? "Clearing…" : "Confirm clear"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="min-h-[40px] px-2.5 rounded-xl border border-border text-xs font-semibold text-text-secondary cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={Boolean(busy)}
              data-testid={`${t}-clear`}
              className="min-h-[40px] px-3 rounded-xl border border-border text-xs font-bold text-text-secondary hover:text-rose-600 flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          )
        ) : (
          <span />
        )}

        <button
          type="submit"
          disabled={Boolean(busy) || unchanged}
          data-testid={`${t}-save`}
          className="min-h-[40px] px-4 rounded-xl bg-scarlet hover:bg-deep-wine text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          {busy === "save" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {busy === "save" ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
