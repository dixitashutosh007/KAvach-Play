"use client";

/**
 * Admin Club → Club Stats → Circuit Standings (`components/club/CircuitStandingsAdmin.tsx`).
 *
 * The club's own rank and total in each of the four circuits
 * (India / Bangalore × Most Wins / Most Played). Club Admins / Super Admins review
 * the saved values, set or change them, or clear a circuit. Every change goes
 * through /api/admin/circuit-standings, which re-validates, enforces the Club Admin
 * role and audits; Firestore rules deny all client writes to `circuitStandings`.
 */
import { useEffect, useState } from "react";
import { Medal, Loader2, Save, Trash2 } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { useCircuitStandings } from "@/hooks/useCircuitStandings";
import { useToast } from "@/components/ui/Toast";
import {
  CIRCUITS,
  formatStanding,
  standingsByCircuit,
  validateCircuitStandingInput,
  type CircuitKey,
  type CircuitStanding,
} from "@/lib/circuit-standings";

const API = "/api/admin/circuit-standings";

function apiFetch(init: RequestInit) {
  const synthetic = process.env.NODE_ENV !== "production" && typeof window !== "undefined" && (window as any).__KAVACH_TEST_USER__ !== undefined;
  return synthetic ? fetch(API, init) : authedFetch(API, init);
}

const inputCls =
  "w-full min-h-[44px] bg-surface border border-border rounded-xl px-3 py-2 text-lg font-black tabular-nums text-text-primary focus:outline-none focus:ring-2 focus:ring-scarlet/30 focus:border-scarlet disabled:opacity-60";
const labelCls = "text-[11px] font-bold uppercase tracking-wider text-text-muted";

export function CircuitStandingsAdmin() {
  const { standings, loading, error } = useCircuitStandings();
  const saved = standingsByCircuit(standings);
  return (
    <section className="bg-surface border border-border rounded-2xl p-4 sm:p-6 shadow-xs" data-testid="circuit-standings-admin" aria-labelledby="circuit-admin-title">
      <div className="flex items-center gap-2 mb-1">
        <Medal className="w-4 h-4 text-scarlet" aria-hidden="true" />
        <h2 id="circuit-admin-title" className="text-sm font-black uppercase tracking-wider text-text-primary font-heading">
          Circuit Standings
        </h2>
      </div>
      <p className="text-xs text-text-secondary mb-4">
        KAvach&apos;s all-time rank and total in each circuit. They appear on every member&apos;s Club screen.
      </p>
      {error && (
        <p role="alert" className="mb-3 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Saved standings could not be loaded. Refresh before editing.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {CIRCUITS.map((c) => (
          <CircuitCard key={c.key} circuit={c.key} saved={saved[c.key] ?? null} loading={loading} />
        ))}
      </div>
    </section>
  );
}

function CircuitCard({ circuit, saved, loading }: { circuit: CircuitKey; saved: CircuitStanding | null; loading: boolean }) {
  const info = CIRCUITS.find((c) => c.key === circuit)!;
  const { toast } = useToast();
  const [rank, setRank] = useState("");
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Show the saved values until the admin starts editing.
  useEffect(() => {
    if (!touched) {
      setRank(saved ? String(saved.rank) : "");
      setValue(saved ? String(saved.value) : "");
    }
  }, [saved, touched]);

  const v = validateCircuitStandingInput({ circuit, rank, value });
  const unchanged = v.ok && saved !== null && v.value.rank === saved.rank && v.value.value === saved.value;
  const t = `circuit-${circuit}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!v.ok) return setErr(v.error);
    if (unchanged || busy) return;
    setBusy("save");
    setErr(null);
    try {
      const res = await apiFetch({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v.value) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(json.error || "The standing could not be saved.");
      setTouched(false);
      toast(`${info.scope} – ${info.metric} saved`, "success");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "The standing could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy("clear");
    setErr(null);
    try {
      const res = await apiFetch({ method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ circuit }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(json.error || "The standing could not be cleared.");
      setTouched(false);
      toast(`${info.scope} – ${info.metric} cleared`, "success");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "The standing could not be cleared.");
    } finally {
      setBusy(null);
      setConfirmClear(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="rounded-xl border border-border p-3 sm:p-4 flex flex-col gap-3 min-w-0" data-testid={t}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-text-primary">{info.scope}</p>
          <p className="text-xs text-text-secondary">{info.metric}</p>
        </div>
        <span className="text-xs font-semibold text-right shrink-0" data-testid={`${t}-saved`}>
          {loading ? <span className="text-text-muted">Loading…</span> : saved ? <span className="text-text-primary">{formatStanding(saved)}</span> : <span className="text-text-muted">Not set</span>}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Rank (#)</span>
          <input
            className={inputCls}
            inputMode="numeric"
            pattern="[0-9]*"
            value={rank}
            disabled={loading}
            data-testid={`${t}-rank`}
            onChange={(e) => {
              setTouched(true);
              setErr(null);
              setRank(e.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{info.valueLabel}</span>
          <input
            className={inputCls}
            inputMode="numeric"
            pattern="[0-9]*"
            value={value}
            disabled={loading}
            data-testid={`${t}-value`}
            onChange={(e) => {
              setTouched(true);
              setErr(null);
              setValue(e.target.value);
            }}
          />
        </label>
      </div>
      {err && (
        <p role="alert" className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid={`${t}-error`}>
          {err}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {saved &&
          (confirmClear ? (
            <>
              <span className="text-xs text-text-secondary mr-auto">Clear this standing?</span>
              <button type="button" onClick={() => setConfirmClear(false)} className="min-h-[40px] px-3 rounded-lg text-xs font-semibold text-text-secondary cursor-pointer">
                Cancel
              </button>
              <button
                type="button"
                onClick={clear}
                disabled={busy !== null}
                data-testid={`${t}-confirm-clear`}
                className="min-h-[40px] px-3 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                {busy === "clear" && <Loader2 className="w-4 h-4 animate-spin" />}
                Clear
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              data-testid={`${t}-clear`}
              className="min-h-[40px] px-3 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer inline-flex items-center gap-1.5 mr-auto"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" /> Clear
            </button>
          ))}
        {!confirmClear && (
          <button
            type="submit"
            disabled={busy !== null || loading || unchanged}
            data-testid={`${t}-save`}
            className="min-h-[44px] px-4 rounded-xl bg-scarlet text-white text-sm font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" aria-hidden="true" />}
            Save
          </button>
        )}
      </div>
    </form>
  );
}
