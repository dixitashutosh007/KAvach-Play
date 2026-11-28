"use client";

import { useState, useMemo, useEffect } from "react";
import { useStore } from "@/hooks/useStore";
import { Badge } from "@/lib/types";
import { getBadgeMeta, DEFAULT_BADGE_DEFS } from "./BadgeIcon";
import { Award, Calendar, CheckCircle, X, AlertTriangle } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import {
  computeTenureYears as computeTenureYearsShared,
  evaluateCumulativeMilestones,
  TENURE_MILESTONES,
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

type JoiningEdit = { month: string; year: string };

type PlayerChange = {
  playerId: string;
  playerName: string;
  tenureYears: number;
  grant: string[];        // badge type keys to create
  revoke: Badge[];        // existing Badge objects to delete
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const YEAR_BADGE_KEYS = ["year_1", "year_2", "year_3", "year_4", "year_5"] as const;
const MAX_YEAR_BADGE = 5;

const MONTHS = [
  { value: "01", label: "Jan" },
  { value: "02", label: "Feb" },
  { value: "03", label: "Mar" },
  { value: "04", label: "Apr" },
  { value: "05", label: "May" },
  { value: "06", label: "Jun" },
  { value: "07", label: "Jul" },
  { value: "08", label: "Aug" },
  { value: "09", label: "Sep" },
  { value: "10", label: "Oct" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dec" },
];

/** Generate year options from 2015 to current year */
function yearOptions(): string[] {
  const cur = new Date().getFullYear();
  const years: string[] = [];
  for (let y = cur; y >= 2015; y--) years.push(String(y));
  return years;
}

/* ------------------------------------------------------------------ */
/*  Core logic                                                         */
/* ------------------------------------------------------------------ */

/**
 * Takes "MM/YYYY", compares with today's date.
 * Returns the number of complete years since that month/year.
 * If the joining string is invalid, returns 0.
 */
function computeTenureYears(joiningStr: string): number {
  return computeTenureYearsShared(joiningStr);
}

/**
 * Evaluate a single player cumulatively: grant all newly qualified year
 * milestones while preserving lower milestones and historical awards.
 */
function evaluatePlayer(
  playerId: string,
  playerName: string,
  badges: Badge[],
  tenureYears: number,
): PlayerChange {
  const existing = new Set(
    badges.filter((b) => b.playerId === playerId).map((b) => b.badgeType),
  );
  const { missing } = evaluateCumulativeMilestones(tenureYears, TENURE_MILESTONES, existing);
  return { playerId, playerName, tenureYears, grant: missing, revoke: [] };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function TenureBadgeEvaluator({
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
  const [edits, setEdits] = useState<Record<string, JoiningEdit>>({});
  const [saving, setSaving] = useState(false);
  const [datesSaved, setDatesSaved] = useState(false);
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

  const YEARS = useMemo(() => yearOptions(), []);

  /* ----- Parse existing joining date into month/year ----- */
  function parseJoining(str?: string): JoiningEdit | null {
    if (!str) return null;
    const parts = str.split("/");
    if (parts.length !== 2) return null;
    const m = parts[0].padStart(2, "0");
    const y = parts[1];
    if (!MONTHS.find((mo) => mo.value === m)) return null;
    return { month: m, year: y };
  }

  /* ----- Handlers ----- */

  function handleEditMonth(playerId: string, month: string) {
    setEdits((prev) => {
      const existing = prev[playerId] || parseJoining(
        activePlayers.find((p) => p.id === playerId)?.kavachJoining,
      ) || { month: "", year: "" };
      return { ...prev, [playerId]: { ...existing, month } };
    });
    setDatesSaved(false);
  }

  function handleEditYear(playerId: string, year: string) {
    setEdits((prev) => {
      const existing = prev[playerId] || parseJoining(
        activePlayers.find((p) => p.id === playerId)?.kavachJoining,
      ) || { month: "", year: "" };
      return { ...prev, [playerId]: { ...existing, year } };
    });
    setDatesSaved(false);
  }

  /** Persist all changed joining dates to Firestore via store.updatePlayer */
  async function handleSaveDates() {
    setSaving(true);
    try {
      const updates: { id: string; joining: string }[] = [];
      for (const [playerId, edit] of Object.entries(edits)) {
        if (edit.month && edit.year) {
          const joining = `${edit.month}/${edit.year}`;
          const player = activePlayers.find((p) => p.id === playerId);
          // Only save if different from existing
          if (player && player.kavachJoining !== joining) {
            updates.push({ id: playerId, joining });
          }
        }
      }

      for (const u of updates) {
        await store.updatePlayer(u.id, { kavachJoining: u.joining });
      }

      setDatesSaved(true);
    } catch (err) {
      console.error("Failed to save dates", err);
    } finally {
      setSaving(false);
    }
  }

  /** Compute proposed badge changes for all players that have a joining date */
  function handleEvaluate() {
    const results: PlayerChange[] = [];

    for (const player of activePlayers) {
      // Use the edited value if present, otherwise the stored value
      const edit = edits[player.id];
      let joiningStr = player.kavachJoining || "";
      if (edit && edit.month && edit.year) {
        joiningStr = `${edit.month}/${edit.year}`;
      }

      if (!joiningStr) continue;

      const tenure = computeTenureYears(joiningStr);
      const change = evaluatePlayer(
        player.id,
        player.name,
        store.badges,
        tenure,
      );

      // Only include players where something actually changes
      if (change.grant.length > 0 || change.revoke.length > 0) {
        results.push(change);
      }
    }

    setChanges(results);
    setPhase("preview");
  }

  /** Apply cumulative tenure milestone grants via server-authoritative evaluation */
  async function handleApply() {
    setApplying(true);
    try {
      const res = await authedFetch("/api/admin/badges/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: "tenure" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Evaluation failed (${res.status}).`);
      }
      const grantedCount = typeof data?.grantedCount === "number" ? data.grantedCount : 0;
      const skippedCount = typeof data?.skippedCount === "number" ? data.skippedCount : 0;
      const failedCount = typeof data?.failedCount === "number" ? data.failedCount : 0;
      setApplySummary(
        `Granted ${grantedCount} cumulative tenure milestone${grantedCount !== 1 ? "s" : ""}${
          skippedCount > 0 ? ` (${skippedCount} already awarded)` : ""
        }${failedCount > 0 ? ` · ${failedCount} failed (safe to retry)` : ""}. Historical awards preserved.`,
      );
      setPhase("done");
    } catch (err) {
      console.error("Failed to apply tenure milestones", err);
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
    if (!e.month || !e.year) return false;
    const joining = `${e.month}/${e.year}`;
    return player.kavachJoining !== joining;
  }).length;

  /* ----- Render ----- */

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative bg-surface rounded-xl border border-border w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <Award className="w-5 h-5 text-accent" />
            <h2 className="text-text-primary font-bold text-lg">Tenure Badge Evaluator</h2>
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
                Set or update KAvach joining dates for players, then evaluate
                which year badges should be granted or revoked.
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
                      <th className="text-left px-3 py-2.5 font-semibold w-28">Current</th>
                      <th className="text-left px-3 py-2.5 font-semibold w-56">Set Joining Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlayers.map((player) => {
                      const parsed = parseJoining(player.kavachJoining);
                      const edit = edits[player.id];
                      const currentMonth = edit?.month ?? parsed?.month ?? "";
                      const currentYear = edit?.year ?? parsed?.year ?? "";

                      return (
                        <tr
                          key={player.id}
                          className="border-t border-border hover:bg-white/[0.02] transition"
                        >
                          <td className="px-3 py-2.5 text-text-primary font-medium">
                            {player.name}
                          </td>
                          <td className="px-3 py-2.5 text-text-muted">
                            {player.kavachJoining ? (
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {player.kavachJoining}
                              </span>
                            ) : (
                              <span className="text-text-primary/20">Not set</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <select
                                value={currentMonth}
                                onChange={(e) =>
                                  handleEditMonth(player.id, e.target.value)
                                }
                                className="bg-surface-hover border border-border rounded-lg text-text-primary text-xs px-2 py-1.5 outline-none focus:border-accent/50 transition appearance-none cursor-pointer"
                              >
                                <option value="" className="bg-surface">Month</option>
                                {MONTHS.map((m) => (
                                  <option
                                    key={m.value}
                                    value={m.value}
                                    className="bg-surface"
                                  >
                                    {m.label}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={currentYear}
                                onChange={(e) =>
                                  handleEditYear(player.id, e.target.value)
                                }
                                className="bg-surface-hover border border-border rounded-lg text-text-primary text-xs px-2 py-1.5 outline-none focus:border-accent/50 transition appearance-none cursor-pointer"
                              >
                                <option value="" className="bg-surface">Year</option>
                                {YEARS.map((y) => (
                                  <option
                                    key={y}
                                    value={y}
                                    className="bg-surface"
                                  >
                                    {y}
                                  </option>
                                ))}
                              </select>
                            </div>
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
                &larr; Back to date entry
              </button>

              {changes.length === 0 ? (
                <div className="text-center py-12 text-text-muted">
                  <CheckCircle className="w-10 h-10 mx-auto mb-3 text-green-400/60" />
                  <p className="text-sm font-medium">No changes needed</p>
                  <p className="text-xs mt-1">
                    All players already have the correct year badges.
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
                            {c.tenureYears} year{c.tenureYears !== 1 ? "s" : ""} tenure
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
                {editCount > 0 && !datesSaved && (
                  <span>{editCount} unsaved change{editCount !== 1 ? "s" : ""}</span>
                )}
                {datesSaved && (
                  <span className="text-green-400 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Dates saved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {editCount > 0 && (
                  <button
                    onClick={handleSaveDates}
                    disabled={saving}
                    className="bg-surface-hover hover:bg-surface-hover text-text-primary font-semibold text-xs rounded-xl px-4 py-2 transition disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save Dates"}
                  </button>
                )}
                <button
                  onClick={handleEvaluate}
                  disabled={editCount > 0 && !datesSaved}
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
