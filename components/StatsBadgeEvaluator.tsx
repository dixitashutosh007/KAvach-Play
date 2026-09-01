"use client";

import { useState, useMemo, useEffect } from "react";
import { serverTimestamp } from "firebase/firestore";
import { useStore } from "@/hooks/useStore";
import { Badge } from "@/lib/types";
import { getBadgeMeta } from "./BadgeIcon";
import { Award, CheckCircle, X, AlertTriangle } from "lucide-react";

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

const RUNS_MILESTONES = [
  { key: "runs_1k",  threshold: 1000 },
  { key: "runs_2k",  threshold: 2000 },
  { key: "runs_5k",  threshold: 5000 },
  { key: "runs_10k", threshold: 10000 },
] as const;

const WICKETS_MILESTONES = [
  { key: "wickets_100", threshold: 100 },
  { key: "wickets_200", threshold: 200 },
  { key: "wickets_300", threshold: 300 },
  { key: "wickets_500", threshold: 500 },
] as const;

const RUNS_BADGE_KEYS = RUNS_MILESTONES.map((m) => m.key);
const WICKETS_BADGE_KEYS = WICKETS_MILESTONES.map((m) => m.key);

/* ------------------------------------------------------------------ */
/*  Core logic                                                         */
/* ------------------------------------------------------------------ */

/**
 * Find the highest runs milestone the player qualifies for.
 * Grant only that one (if not already present).
 * Revoke all lower milestone badges that exist.
 */
function evaluateRunsBadges(
  totalRuns: number,
  existingBadges: Badge[],
): { grant: string[]; revoke: Badge[] } {
  const runsBadges = existingBadges.filter((b) =>
    (RUNS_BADGE_KEYS as readonly string[]).includes(b.badgeType),
  );

  // Find the highest qualifying milestone (iterate from highest to lowest)
  let targetKey: string | null = null;
  for (let i = RUNS_MILESTONES.length - 1; i >= 0; i--) {
    if (totalRuns >= RUNS_MILESTONES[i].threshold) {
      targetKey = RUNS_MILESTONES[i].key;
      break;
    }
  }

  const grant: string[] = [];
  const revoke: Badge[] = [];

  if (targetKey === null) {
    // No milestone reached -- revoke all existing runs badges
    revoke.push(...runsBadges);
  } else {
    const hasTarget = runsBadges.some((b) => b.badgeType === targetKey);
    if (!hasTarget) {
      grant.push(targetKey);
    }
    // Revoke every runs badge that is NOT the target
    for (const b of runsBadges) {
      if (b.badgeType !== targetKey) {
        revoke.push(b);
      }
    }
  }

  return { grant, revoke };
}

/**
 * Find the highest wickets milestone the player qualifies for.
 * Grant only that one (if not already present).
 * Revoke all lower milestone badges that exist.
 */
function evaluateWicketsBadges(
  totalWickets: number,
  existingBadges: Badge[],
): { grant: string[]; revoke: Badge[] } {
  const wicketsBadges = existingBadges.filter((b) =>
    (WICKETS_BADGE_KEYS as readonly string[]).includes(b.badgeType),
  );

  let targetKey: string | null = null;
  for (let i = WICKETS_MILESTONES.length - 1; i >= 0; i--) {
    if (totalWickets >= WICKETS_MILESTONES[i].threshold) {
      targetKey = WICKETS_MILESTONES[i].key;
      break;
    }
  }

  const grant: string[] = [];
  const revoke: Badge[] = [];

  if (targetKey === null) {
    revoke.push(...wicketsBadges);
  } else {
    const hasTarget = wicketsBadges.some((b) => b.badgeType === targetKey);
    if (!hasTarget) {
      grant.push(targetKey);
    }
    for (const b of wicketsBadges) {
      if (b.badgeType !== targetKey) {
        revoke.push(b);
      }
    }
  }

  return { grant, revoke };
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

  /** Apply all grants and revokes */
  async function handleApply() {
    setApplying(true);
    let totalGrants = 0;
    let totalRevokes = 0;

    try {
      for (const change of changes) {
        // Grants
        for (const badgeKey of change.grant) {
          await store.addBadge({
            playerId: change.playerId,
            playerName: change.playerName,
            badgeType: badgeKey,
            awardedBy: currentUserId,
            awardedByName: currentUserName,
            awardedAt: serverTimestamp(),
            redeemed: false,
          });
          totalGrants++;
        }

        // Revokes
        for (const badge of change.revoke) {
          await store.deleteBadge(badge.id);
          totalRevokes++;
        }
      }

      setApplySummary(
        `Applied ${totalGrants} grant${totalGrants !== 1 ? "s" : ""} and ${totalRevokes} revoke${totalRevokes !== 1 ? "s" : ""} across ${changes.length} player${changes.length !== 1 ? "s" : ""}.`,
      );
      setPhase("done");
    } catch (err) {
      console.error("Failed to apply changes", err);
      setApplySummary("An error occurred while applying changes. Some changes may have been partially applied.");
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
      <div className="relative bg-[#0f172a] rounded-xl border border-glass-border w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-glass-border shrink-0">
          <div className="flex items-center gap-2.5">
            <Award className="w-5 h-5 text-accent" />
            <h2 className="text-white font-bold text-lg">Stats Badge Evaluator</h2>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white transition p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* ============ PHASE: ENTRY ============ */}
          {phase === "entry" && (
            <>
              <p className="text-white/50 text-xs mb-4">
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
                  className="w-full bg-white/5 border border-glass-border rounded-lg text-white text-xs px-3 py-2 outline-none focus:border-accent/50 transition placeholder:text-white/30"
                />
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-lg border border-glass-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-white/5 text-white/60">
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
                          className="border-t border-glass-border hover:bg-white/[0.02] transition"
                        >
                          <td className="px-3 py-2.5 text-white font-medium">
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
                              className="w-full bg-white/5 border border-glass-border rounded-lg text-white text-xs px-2 py-1.5 outline-none focus:border-accent/50 transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                              className="w-full bg-white/5 border border-glass-border rounded-lg text-white text-xs px-2 py-1.5 outline-none focus:border-accent/50 transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </td>
                        </tr>
                      );
                    })}
                    {filteredPlayers.length === 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-3 py-8 text-center text-white/30"
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
                <div className="text-center py-12 text-white/40">
                  <CheckCircle className="w-10 h-10 mx-auto mb-3 text-green-400/60" />
                  <p className="text-sm font-medium">No changes needed</p>
                  <p className="text-xs mt-1">
                    All players already have the correct milestone badges.
                  </p>
                </div>
              ) : (
                <>
                  {/* Summary bar */}
                  <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-white/5 border border-glass-border">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <p className="text-white/70 text-xs">
                      <span className="text-green-400 font-bold">{totalGrants} grant{totalGrants !== 1 ? "s" : ""}</span>
                      {", "}
                      <span className="text-red-400 font-bold">{totalRevokes} revoke{totalRevokes !== 1 ? "s" : ""}</span>
                      {" across "}
                      <span className="text-white font-bold">{changes.length} player{changes.length !== 1 ? "s" : ""}</span>
                    </p>
                  </div>

                  {/* Change list */}
                  <div className="space-y-2">
                    {changes.map((c) => (
                      <div
                        key={c.playerId}
                        className="rounded-lg border border-glass-border bg-white/[0.02] p-3"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-white font-semibold text-sm">
                            {c.playerName}
                          </span>
                          <span className="text-white/40 text-xs">
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
              <p className="text-white font-bold text-lg mb-2">Changes Applied</p>
              <p className="text-white/50 text-sm">{applySummary}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="shrink-0 px-5 py-4 border-t border-glass-border flex items-center justify-between gap-3">
          {phase === "entry" && (
            <>
              <div className="text-white/30 text-xs">
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
                    className="bg-white/10 hover:bg-white/20 text-white font-semibold text-xs rounded-xl px-4 py-2 transition disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save Stats"}
                  </button>
                )}
                <button
                  onClick={handleEvaluate}
                  disabled={editCount > 0 && !statsSaved}
                  className="bg-accent text-black font-bold text-xs rounded-xl px-5 py-2 transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
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
                className="bg-accent text-black font-bold text-xs rounded-xl px-5 py-2 transition hover:brightness-110 disabled:opacity-50"
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
                className="bg-accent text-black font-bold text-xs rounded-xl px-5 py-2 transition hover:brightness-110"
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
