"use client";

import { useState, useMemo, useEffect } from "react";
import { useStore } from "@/hooks/useStore";
import { Badge } from "@/lib/types";
import { getBadgeMeta } from "./BadgeIcon";
import { Award, CheckCircle, X, AlertTriangle } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import {
  evaluateCumulativeMilestones,
  RUNS_MILESTONES,
  WICKETS_MILESTONES,
} from "@/lib/badge-milestones";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Props = {
  store: ReturnType<typeof useStore>;
  currentUserId: string;
  currentUserName: string;
  onClose: () => void;
};

type StatsEdit = { runs: number; wickets: number };

type PlayerChange = {
  playerId: string;
  playerName: string;
  totalRuns: number;
  totalWickets: number;
  grant: string[];        // badge type keys to create
  revoke: Badge[];        // existing Badge objects to delete
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

function evaluateRunsBadges(
  totalRuns: number,
  existingBadges: Badge[],
): { grant: string[]; revoke: Badge[] } {
  const existing = new Set(existingBadges.map((b) => b.badgeType));
  const { missing } = evaluateCumulativeMilestones(totalRuns, RUNS_MILESTONES, existing);
  return { grant: missing, revoke: [] };
}

function evaluateWicketsBadges(
  totalWickets: number,
  existingBadges: Badge[],
): { grant: string[]; revoke: Badge[] } {
  const existing = new Set(existingBadges.map((b) => b.badgeType));
  const { missing } = evaluateCumulativeMilestones(totalWickets, WICKETS_MILESTONES, existing);
  return { grant: missing, revoke: [] };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function StatsBadgeEvaluator({
  store,
  currentUserId,
  currentUserName,
  onClose,
}: Props) {
  // Ensure badges are loaded
  useEffect(() => {
    store.ensureBadges();
  }, [store]);

  /* ----- Local state ----- */
  const [edits, setEdits] = useState<Record<string, StatsEdit>>({});
  const [saving, setSaving] = useState(false);
  const [statsSaved, setStatsSaved] = useState(false);
  const [phase, setPhase] = useState<"entry" | "preview" | "done">("entry");
  const [changes, setChanges] = useState<PlayerChange[]>([]);
  const [applying, setApplying] = useState(false);
  const [applySummary, setApplySummary] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Active (non-disabled) players sorted by name
  const activePlayers = useMemo(
    () =>
      store.players
        .filter((p) => !p.disabled && !p.mergedInto)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [store.players],
  );

  const filteredPlayers = useMemo(() => {
    if (!searchQuery.trim()) return activePlayers;
    const q = searchQuery.toLowerCase();
    return activePlayers.filter((p) => p.name.toLowerCase().includes(q));
  }, [activePlayers, searchQuery]);

  /* ----- Handlers ----- */

  function handleEditRuns(playerId: string, value: string) {
    const runs = value === "" ? 0 : parseInt(value, 10);
    if (isNaN(runs) || runs < 0) return;
    setEdits((prev) => {
      const existing = prev[playerId] || {
        runs: activePlayers.find((p) => p.id === playerId)?.totalRuns ?? 0,
        wickets: activePlayers.find((p) => p.id === playerId)?.totalWickets ?? 0,
      };
      return { ...prev, [playerId]: { ...existing, runs } };
    });
    setStatsSaved(false);
  }

  function handleEditWickets(playerId: string, value: string) {
    const wickets = value === "" ? 0 : parseInt(value, 10);
    if (isNaN(wickets) || wickets < 0) return;
    setEdits((prev) => {
      const existing = prev[playerId] || {
        runs: activePlayers.find((p) => p.id === playerId)?.totalRuns ?? 0,
        wickets: activePlayers.find((p) => p.id === playerId)?.totalWickets ?? 0,
      };
      return { ...prev, [playerId]: { ...existing, wickets } };
    });
    setStatsSaved(false);
  }

  /** Persist all changed stats to Firestore via store.updatePlayer */
  async function handleSaveStats() {
    setSaving(true);
    try {
      const updates: { id: string; totalRuns: number; totalWickets: number }[] = [];
      for (const [playerId, edit] of Object.entries(edits)) {
        const player = activePlayers.find((p) => p.id === playerId);
        if (!player) continue;
        const runsChanged = (player.totalRuns ?? 0) !== edit.runs;
        const wicketsChanged = (player.totalWickets ?? 0) !== edit.wickets;
        if (runsChanged || wicketsChanged) {
          updates.push({ id: playerId, totalRuns: edit.runs, totalWickets: edit.wickets });
        }
      }

      for (const u of updates) {
        await store.updatePlayer(u.id, { totalRuns: u.totalRuns, totalWickets: u.totalWickets });
      }

      setStatsSaved(true);
    } catch (err) {
      console.error("Failed to save stats", err);
    } finally {
      setSaving(false);
    }
  }

  /** Compute proposed badge changes for all players */
  function handleEvaluate() {
    const results: PlayerChange[] = [];

    for (const player of activePlayers) {
      const edit = edits[player.id];
      const totalRuns = edit?.runs ?? player.totalRuns ?? 0;
      const totalWickets = edit?.wickets ?? player.totalWickets ?? 0;

      const playerBadges = store.badges.filter((b) => b.playerId === player.id);

      const runsResult = evaluateRunsBadges(totalRuns, playerBadges);
      const wicketsResult = evaluateWicketsBadges(totalWickets, playerBadges);

      const grant = [...runsResult.grant, ...wicketsResult.grant];
      const revoke = [...runsResult.revoke, ...wicketsResult.revoke];

      if (grant.length > 0 || revoke.length > 0) {
        results.push({
          playerId: player.id,
          playerName: player.name,
          totalRuns,
          totalWickets,
          grant,
          revoke,
        });
      }
    }

    setChanges(results);
    setPhase("preview");
  }

  /** Apply cumulative runs & wickets milestone grants via server-authoritative evaluation */
  async function handleApply() {
    setApplying(true);
    try {
      const res = await authedFetch("/api/admin/badges/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: "stats" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Evaluation failed (${res.status}).`);
      }
      const grantedCount = typeof data?.grantedCount === "number" ? data.grantedCount : 0;
      const skippedCount = typeof data?.skippedCount === "number" ? data.skippedCount : 0;
      const failedCount = typeof data?.failedCount === "number" ? data.failedCount : 0;
      setApplySummary(
        `Granted ${grantedCount} cumulative stats milestone${grantedCount !== 1 ? "s" : ""}${
          skippedCount > 0 ? ` (${skippedCount} already awarded)` : ""
        }${failedCount > 0 ? ` · ${failedCount} failed (safe to retry)` : ""}. Historical awards preserved.`,
      );
      setPhase("done");
    } catch (err) {
      console.error("Failed to apply stats milestones", err);
      setApplySummary(err instanceof Error ? err.message : "An error occurred while applying changes.");
      setPhase("done");
    } finally {
      setApplying(false);
    }
  }

  /* ----- Counts for preview ----- */
  const totalGrants = changes.reduce((s, c) => s + c.grant.length, 0);
  const totalRevokes = changes.reduce((s, c) => s + c.revoke.length, 0);
  const editCount = Object.entries(edits).filter(([pid, e]) => {
    const player = activePlayers.find((p) => p.id === pid);
    if (!player) return false;
    const runsChanged = (player.totalRuns ?? 0) !== e.runs;
    const wicketsChanged = (player.totalWickets ?? 0) !== e.wickets;
    return runsChanged || wicketsChanged;
  }).length;

  /* ----- Render ----- */

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative bg-surface rounded-xl border border-border w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <Award className="w-5 h-5 text-accent" />
            <h2 className="text-text-primary font-bold text-lg">Stats Badge Evaluator</h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* ============ PHASE: ENTRY ============ */}
          {phase === "entry" && (
            <>
              <p className="text-text-muted text-xs mb-4">
                Update player career stats (runs and wickets), then evaluate
                which milestone badges should be granted or revoked.
              </p>

              {/* Search */}
              <div className="mb-3">
                <input
                  type="text"
                  placeholder="Search players..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-surface-hover border border-border rounded-lg text-text-primary text-xs px-3 py-2 outline-none focus:border-accent/50 transition placeholder:text-text-primary/30"
                />
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-hover text-text-secondary">
                      <th className="text-left px-3 py-2.5 font-semibold">Player</th>
                      <th className="text-left px-3 py-2.5 font-semibold w-36">Total Runs</th>
                      <th className="text-left px-3 py-2.5 font-semibold w-36">Total Wickets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlayers.map((player) => {
                      const edit = edits[player.id];
                      const currentRuns = edit?.runs ?? player.totalRuns ?? 0;
                      const currentWickets = edit?.wickets ?? player.totalWickets ?? 0;

                      return (
                        <tr
                          key={player.id}
                          className="border-t border-border hover:bg-white/[0.02] transition"
                        >
                          <td className="px-3 py-2.5 text-text-primary font-medium">
                            {player.name}
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="number"
                              min={0}
                              value={currentRuns}
                              onChange={(e) =>
                                handleEditRuns(player.id, e.target.value)
                              }
                              className="w-full bg-surface-hover border border-border rounded-lg text-text-primary text-xs px-2 py-1.5 outline-none focus:border-accent/50 transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="number"
                              min={0}
                              value={currentWickets}
                              onChange={(e) =>
                                handleEditWickets(player.id, e.target.value)
                              }
                              className="w-full bg-surface-hover border border-border rounded-lg text-text-primary text-xs px-2 py-1.5 outline-none focus:border-accent/50 transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </td>
                        </tr>
                      );
                    })}
                    {filteredPlayers.length === 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-3 py-8 text-center text-text-primary/30"
                        >
                          No players found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ============ PHASE: PREVIEW ============ */}
          {phase === "preview" && (
            <>
              <button
                onClick={() => setPhase("entry")}
                className="text-accent text-xs mb-4 hover:underline"
              >
                &larr; Back to stats entry
              </button>

              {changes.length === 0 ? (
                <div className="text-center py-12 text-text-muted">
                  <CheckCircle className="w-10 h-10 mx-auto mb-3 text-green-400/60" />
                  <p className="text-sm font-medium">No changes needed</p>
                  <p className="text-xs mt-1">
                    All players already have the correct milestone badges.
                  </p>
                </div>
              ) : (
                <>
                  {/* Summary bar */}
                  <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-surface-hover border border-border">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <p className="text-text-secondary text-xs">
                      <span className="text-green-400 font-bold">{totalGrants} grant{totalGrants !== 1 ? "s" : ""}</span>
                      {", "}
                      <span className="text-red-400 font-bold">{totalRevokes} revoke{totalRevokes !== 1 ? "s" : ""}</span>
                      {" across "}
                      <span className="text-text-primary font-bold">{changes.length} player{changes.length !== 1 ? "s" : ""}</span>
                    </p>
                  </div>

                  {/* Change list */}
                  <div className="space-y-2">
                    {changes.map((c) => (
                      <div
                        key={c.playerId}
                        className="rounded-lg border border-border bg-white/[0.02] p-3"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-text-primary font-semibold text-sm">
                            {c.playerName}
                          </span>
                          <span className="text-text-muted text-xs">
                            {c.totalRuns} runs, {c.totalWickets} wickets
                          </span>
                        </div>

                        {c.grant.map((key) => {
                          const meta = getBadgeMeta(key);
                          return (
                            <div
                              key={key}
                              className="flex items-center gap-2 text-xs py-1 text-green-400"
                            >
                              <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                Grant <strong>{key}</strong> ({meta.label})
                              </span>
                            </div>
                          );
                        })}

                        {c.revoke.map((badge) => {
                          const meta = getBadgeMeta(badge.badgeType);
                          return (
                            <div
                              key={badge.id}
                              className="flex items-center gap-2 text-xs py-1 text-red-400"
                            >
                              <X className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                Revoke <strong>{badge.badgeType}</strong> ({meta.label})
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* ============ PHASE: DONE ============ */}
          {phase === "done" && (
            <div className="text-center py-12">
              <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-400" />
              <p className="text-text-primary font-bold text-lg mb-2">Changes Applied</p>
              <p className="text-text-muted text-sm">{applySummary}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="shrink-0 px-5 py-4 border-t border-border flex items-center justify-between gap-3">
          {phase === "entry" && (
            <>
              <div className="text-text-primary/30 text-xs">
                {editCount > 0 && !statsSaved && (
                  <span>{editCount} unsaved change{editCount !== 1 ? "s" : ""}</span>
                )}
                {statsSaved && (
                  <span className="text-green-400 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Stats saved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {editCount > 0 && (
                  <button
                    onClick={handleSaveStats}
                    disabled={saving}
                    className="bg-surface-hover hover:bg-surface-hover text-text-primary font-semibold text-xs rounded-xl px-4 py-2 transition disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save Stats"}
                  </button>
                )}
                <button
                  onClick={handleEvaluate}
                  disabled={editCount > 0 && !statsSaved}
                  className="bg-accent text-text-accent font-bold text-xs rounded-xl px-5 py-2 transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Evaluate Awards
                </button>
              </div>
            </>
          )}

          {phase === "preview" && changes.length > 0 && (
            <>
              <div />
              <button
                onClick={handleApply}
                disabled={applying}
                className="bg-accent text-text-accent font-bold text-xs rounded-xl px-5 py-2 transition hover:brightness-110 disabled:opacity-50"
              >
                {applying ? "Applying..." : "Confirm & Apply"}
              </button>
            </>
          )}

          {phase === "done" && (
            <>
              <div />
              <button
                onClick={onClose}
                className="bg-accent text-text-accent font-bold text-xs rounded-xl px-5 py-2 transition hover:brightness-110"
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
