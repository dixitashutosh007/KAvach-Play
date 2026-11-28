"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crown, Edit3, Plus, Trash2, Check, X, Sparkles } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { authedFetch } from "@/lib/authed-fetch";
import { useToast } from "@/components/ui/Toast";
import { potwWindow, validatePotwMessage, weekendLabel } from "@/lib/weekend-ops";
import { validateCatchInput, type CatchType } from "@/lib/catch-validation";
import { isEligibleForNewStats } from "@/lib/kavach-stats-validation";

interface PotwAwardItem {
  badgeId: string;
  weekendId: string;
  weekendLabel: string;
  playerId: string;
  playerName: string;
  message: string;
  photoURL: string;
  hasBannerPost: boolean;
  historical: boolean;
  awardedByName: string;
}

interface CatchLogItem {
  id: string;
  playerId: string;
  playerName: string;
  type: CatchType;
  count: number;
  matchId?: string;
  comment?: string;
  recordedBy: string;
}

export function ClubRecognitionAdmin({
  store,
  initialCatchId,
}: {
  store: ReturnType<typeof useStore>;
  initialCatchId?: string | null;
}) {
  const { toast } = useToast();
  const [subSection, setSubSection] = useState<"potw" | "catches">(initialCatchId ? "catches" : "potw");

  // POTW state
  const [awards, setAwards] = useState<PotwAwardItem[]>([]);
  const [loadingAwards, setLoadingAwards] = useState(true);
  const [editingWeekendId, setEditingWeekendId] = useState<string | null>(null);
  const [potwPlayerId, setPotwPlayerId] = useState("");
  const [potwMessage, setPotwMessage] = useState("");
  const [potwPhotoUrl, setPotwPhotoUrl] = useState("");
  const [savingPotw, setSavingPotw] = useState(false);
  const [retractingWeekendId, setRetractingWeekendId] = useState<string | null>(null);
  const [potwError, setPotwError] = useState<string | null>(null);

  // Catch state
  const [catchEntries, setCatchEntries] = useState<CatchLogItem[]>([]);
  const [loadingCatches, setLoadingCatches] = useState(true);
  const [catchPlayerId, setCatchPlayerId] = useState("");
  const [catchType, setCatchType] = useState<CatchType>("stunning");
  const [catchCount, setCatchCount] = useState("1");
  const [catchMatchId, setCatchMatchId] = useState("");
  const [catchComment, setCatchComment] = useState("");
  const [editingCatchId, setEditingCatchId] = useState<string | null>(initialCatchId || null);
  const [savingCatch, setSavingCatch] = useState(false);
  const [deletingCatchId, setDeletingCatchId] = useState<string | null>(null);
  const [catchError, setCatchError] = useState<string | null>(null);
  const pendingCatchKeyRef = useRef<string | null>(null);
  const catchInFlightRef = useRef(false);
  useEffect(() => {
    if (!initialCatchId) return;
    setSubSection("catches");
    if (loadingCatches) return;
    const target = catchEntries.find((c) => c.id === initialCatchId);
    if (target) {
      setEditingCatchId(target.id);
      setCatchPlayerId(target.playerId);
      setCatchType(target.type);
      setCatchCount(String(target.count));
      setCatchMatchId(target.matchId || "");
      setCatchComment(target.comment || "");
      setCatchError(null);
    } else {
      setEditingCatchId(null);
      setCatchError("The selected catch record was not found or has been removed.");
    }
  }, [initialCatchId, catchEntries, loadingCatches]);

  const openWindow = useMemo(() => potwWindow(Date.now()), []);

  const activePlayers = useMemo(
    () =>
      store.players
        .filter((p) => isEligibleForNewStats(p))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [store.players],
  );

  const loadAwards = useCallback(async () => {
    setLoadingAwards(true);
    try {
      const res = await authedFetch("/api/admin/player-of-weekend");
      const data = await res.json();
      if (res.ok && Array.isArray(data.awards)) {
        setAwards(data.awards);
      }
    } catch {
      // handled in UI state
    } finally {
      setLoadingAwards(false);
    }
  }, []);

  const loadCatches = useCallback(async () => {
    setLoadingCatches(true);
    try {
      const res = await authedFetch("/api/admin/catches");
      const data = await res.json();
      if (res.ok && Array.isArray(data.entries)) {
        setCatchEntries(data.entries);
      }
    } catch {
      // handled in UI state
    } finally {
      setLoadingCatches(false);
    }
  }, []);

  useEffect(() => {
    loadAwards();
    loadCatches();
  }, [loadAwards, loadCatches]);

  const resetPotwForm = () => {
    setEditingWeekendId(null);
    setPotwPlayerId("");
    setPotwMessage("");
    setPotwPhotoUrl("");
    setPotwError(null);
  };

  const handleEditAward = (award: PotwAwardItem) => {
    setEditingWeekendId(award.weekendId);
    setPotwPlayerId(award.playerId);
    setPotwMessage(award.message || "");
    setPotwPhotoUrl(award.photoURL || "");
    setPotwError(null);
  };

  const handleSavePotw = async (e: React.FormEvent) => {
    e.preventDefault();
    setPotwError(null);
    if (!potwPlayerId) {
      setPotwError("Select a player.");
      return;
    }
    const msgCheck = validatePotwMessage(potwMessage);
    if (!msgCheck.ok) {
      setPotwError(msgCheck.error);
      return;
    }
    if (potwPhotoUrl.trim() && !potwPhotoUrl.trim().startsWith("https://")) {
      setPotwError("Photo URL must start with https://.");
      return;
    }

    setSavingPotw(true);
    try {
      if (editingWeekendId) {
        const res = await authedFetch("/api/admin/player-of-weekend", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            weekendId: editingWeekendId,
            playerId: potwPlayerId,
            message: msgCheck.value,
            photoURL: potwPhotoUrl.trim() || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update award.");
        toast("Player of the Weekend updated.", "success");
      } else {
        if (!openWindow.open) {
          throw new Error("The Player of the Weekend award window is currently closed.");
        }
        const res = await authedFetch("/api/admin/player-of-weekend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            weekendId: openWindow.weekendId,
            playerId: potwPlayerId,
            message: msgCheck.value,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to grant award.");
        toast("Player of the Weekend awarded!", "success");
      }
      resetPotwForm();
      await loadAwards();
    } catch (err: any) {
      const msg = err?.message || "Could not save Player of the Weekend.";
      setPotwError(msg);
      toast(msg, "error");
    } finally {
      setSavingPotw(false);
    }
  };

  const handleRetractPotw = async (weekendId: string) => {
    setRetractingWeekendId(weekendId);
    try {
      const res = await authedFetch(
        `/api/admin/player-of-weekend?weekendId=${encodeURIComponent(weekendId)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to retract award.");
      toast("Player of the Weekend retracted.", "success");
      if (editingWeekendId === weekendId) resetPotwForm();
      await loadAwards();
    } catch (err: any) {
      toast(err?.message || "Could not retract award.", "error");
    } finally {
      setRetractingWeekendId(null);
    }
  };

  const resetCatchForm = () => {
    pendingCatchKeyRef.current = null;
    setEditingCatchId(null);
    setCatchPlayerId("");
    setCatchType("stunning");
    setCatchCount("1");
    setCatchMatchId("");
    setCatchComment("");
    setCatchError(null);
  };

  const handleEditCatch = (entry: CatchLogItem) => {
    setEditingCatchId(entry.id);
    setCatchPlayerId(entry.playerId);
    setCatchType(entry.type);
    setCatchCount(String(entry.count));
    setCatchMatchId(entry.matchId || "");
    setCatchComment(entry.comment || "");
    setCatchError(null);
  };

  const handleSaveCatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (catchInFlightRef.current) return;
    setCatchError(null);
    const parsed = validateCatchInput({
      playerId: catchPlayerId,
      type: catchType,
      count: catchCount,
      matchId: catchMatchId,
      comment: catchComment,
    });
    if (!parsed.ok) {
      setCatchError(parsed.error);
      return;
    }

    catchInFlightRef.current = true;
    setSavingCatch(true);
    try {
      if (editingCatchId) {
        const res = await authedFetch("/api/admin/catches", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryId: editingCatchId,
            type: parsed.value.type,
            count: parsed.value.count,
            comment: parsed.value.comment || "",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to correct catch entry.");
        toast("Catch entry corrected.", "success");
      } else {
        if (!pendingCatchKeyRef.current) {
          pendingCatchKeyRef.current = crypto.randomUUID();
        }
        await store.recordCatch({
          playerId: parsed.value.playerId,
          playerName: activePlayers.find((p) => p.id === parsed.value.playerId)?.name || "Player",
          type: parsed.value.type,
          count: parsed.value.count,
          matchId: parsed.value.matchId,
          comment: parsed.value.comment,
          recordedBy: "admin",
          idempotencyKey: pendingCatchKeyRef.current,
        });
        pendingCatchKeyRef.current = null;
        toast("Catch recorded.", "success");
      }
      resetCatchForm();
      await loadCatches();
    } catch (err: any) {
      const msg = err?.message || "Could not save catch entry.";
      setCatchError(msg);
      toast(msg, "error");
    } finally {
      catchInFlightRef.current = false;
      setSavingCatch(false);
    }
  };

  const handleDeleteCatch = async (entryId: string) => {
    setDeletingCatchId(entryId);
    try {
      const res = await authedFetch(`/api/admin/catches?entryId=${encodeURIComponent(entryId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove catch entry.");
      toast("Catch entry removed and totals updated.", "success");
      if (editingCatchId === entryId) resetCatchForm();
      await loadCatches();
    } catch (err: any) {
      toast(err?.message || "Could not remove catch entry.", "error");
    } finally {
      setDeletingCatchId(null);
    }
  };

  return (
    <section
      data-testid="admin-club-recognition"
      className="bg-surface border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-xs"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-text-primary flex items-center gap-2">
            <Crown className="w-5 h-5 text-scarlet" />
            Club Recognition Management
          </h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Manage Player of the Weekend awards (badge, announcement &amp; banner) and catch logs.
          </p>
        </div>
        <div className="flex bg-surface-hover p-1 rounded-xl border border-border self-start">
          <button
            type="button"
            data-testid="recognition-tab-potw"
            onClick={() => setSubSection("potw")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition ${
              subSection === "potw" ? "bg-scarlet text-white" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Player of Weekend
          </button>
          <button
            type="button"
            data-testid="recognition-tab-catches"
            onClick={() => setSubSection("catches")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition ${
              subSection === "catches" ? "bg-scarlet text-white" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Catch Logs
          </button>
        </div>
      </div>

      {subSection === "potw" ? (
        <div className="space-y-4">
          <form onSubmit={handleSavePotw} className="rounded-xl bg-surface-hover/60 border border-border p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                {editingWeekendId
                  ? `Edit Award (${editingWeekendId})`
                  : openWindow.open
                    ? `Grant Award · ${weekendLabel(openWindow.weekendId)}`
                    : "Grant Award (Window Closed — Select an existing award below to edit/retract)"}
              </p>
              {editingWeekendId && (
                <button
                  type="button"
                  onClick={resetPotwForm}
                  className="text-xs font-semibold text-text-secondary hover:text-text-primary flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-text-secondary mb-1">Player</label>
                <select
                  data-testid="potw-player-select"
                  value={potwPlayerId}
                  onChange={(e) => setPotwPlayerId(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-border bg-surface px-3 text-sm text-text-primary"
                >
                  <option value="">Select active player…</option>
                  {activePlayers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              {editingWeekendId && (
                <div>
                  <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                    Photo URL (optional, https://)
                  </label>
                  <input
                    type="url"
                    value={potwPhotoUrl}
                    onChange={(e) => setPotwPhotoUrl(e.target.value)}
                    placeholder="Uses player's profile photo if blank"
                    className="w-full min-h-[42px] rounded-xl border border-border bg-surface px-3 text-sm text-text-primary"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                Citation / Message (optional, ≤ 4 lines / 120 chars)
              </label>
              <textarea
                rows={2}
                data-testid="potw-message-input"
                value={potwMessage}
                onChange={(e) => setPotwMessage(e.target.value)}
                placeholder="e.g. 82* off 51 balls & 2 catches"
                className="w-full rounded-xl border border-border bg-surface p-2.5 text-sm text-text-primary"
              />
            </div>

            {potwError && (
              <p className="text-xs font-semibold text-red-600" role="alert">
                {potwError}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingPotw || (!editingWeekendId && !openWindow.open)}
                data-testid="potw-save-btn"
                className="min-h-[42px] px-4 rounded-xl bg-scarlet hover:bg-scarlet/90 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {editingWeekendId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {savingPotw ? "Saving…" : editingWeekendId ? "Update Award" : "Grant Award"}
              </button>
            </div>
          </form>

          {loadingAwards ? (
            <p className="text-xs text-text-secondary py-2">Loading awards…</p>
          ) : awards.length === 0 ? (
            <p className="text-xs text-text-secondary py-2">No Player of the Weekend awards recorded yet.</p>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
              {awards.map((a) => (
                <div
                  key={a.badgeId}
                  data-testid={`potw-award-row-${a.weekendId}`}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-surface text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-text-primary truncate">
                      {a.playerName}
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-surface-hover font-mono text-[10px] text-text-secondary">
                        {a.weekendLabel}
                      </span>
                      {a.hasBannerPost && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-scarlet/10 text-scarlet text-[10px] font-semibold">
                          Banner Post
                        </span>
                      )}
                    </p>
                    {a.message && <p className="text-[11px] text-text-secondary truncate mt-0.5">{a.message}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEditAward(a)}
                      aria-label={`Edit POTW ${a.weekendLabel}`}
                      className="min-w-[36px] min-h-[36px] rounded-lg border border-border hover:bg-surface-hover flex items-center justify-center text-text-primary cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={retractingWeekendId === a.weekendId}
                      onClick={() => handleRetractPotw(a.weekendId)}
                      aria-label={`Retract POTW ${a.weekendLabel}`}
                      className="min-w-[36px] min-h-[36px] rounded-lg border border-border hover:bg-red-50 text-red-600 flex items-center justify-center cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <form onSubmit={handleSaveCatch} className="rounded-xl bg-surface-hover/60 border border-border p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                {editingCatchId ? "Correct Catch Entry" : "Record Catch"}
              </p>
              {editingCatchId && (
                <button
                  type="button"
                  onClick={resetCatchForm}
                  className="text-xs font-semibold text-text-secondary hover:text-text-primary flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-text-secondary mb-1">Player</label>
                <select
                  data-testid="catch-player-select"
                  value={catchPlayerId}
                  disabled={Boolean(editingCatchId)}
                  onChange={(e) => {
                    pendingCatchKeyRef.current = null;
                    setCatchPlayerId(e.target.value);
                  }}
                  className="w-full min-h-[42px] rounded-xl border border-border bg-surface px-3 text-sm text-text-primary disabled:opacity-60"
                >
                  <option value="">Select active player…</option>
                  {activePlayers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-text-secondary mb-1">Type</label>
                <select
                  data-testid="catch-type-select"
                  value={catchType}
                  onChange={(e) => {
                    pendingCatchKeyRef.current = null;
                    setCatchType(e.target.value as CatchType);
                  }}
                  className="w-full min-h-[42px] rounded-xl border border-border bg-surface px-3 text-sm text-text-primary"
                >
                  <option value="stunning">Stunning Catch</option>
                  <option value="dropped">Dropped Catch</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-text-secondary mb-1">Count</label>
                <input
                  data-testid="catch-count-input"
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  value={catchCount}
                  onChange={(e) => {
                    pendingCatchKeyRef.current = null;
                    setCatchCount(e.target.value);
                  }}
                  className="w-full min-h-[42px] rounded-xl border border-border bg-surface px-3 text-sm text-text-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-text-secondary mb-1">Note (optional)</label>
              <input
                type="text"
                value={catchComment}
                onChange={(e) => {
                  pendingCatchKeyRef.current = null;
                  setCatchComment(e.target.value);
                }}
                placeholder="Match context or fielding note"
                className="w-full min-h-[40px] rounded-xl border border-border bg-surface px-3 text-sm text-text-primary"
              />
            </div>

            {catchError && (
              <p className="text-xs font-semibold text-red-600" role="alert">
                {catchError}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingCatch}
                data-testid="catch-save-btn"
                className="min-h-[42px] px-4 rounded-xl bg-scarlet hover:bg-scarlet/90 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                {savingCatch ? "Saving…" : editingCatchId ? "Save Correction" : "Record Catch"}
              </button>
            </div>
          </form>

          {loadingCatches ? (
            <p className="text-xs text-text-secondary py-2">Loading catch logs…</p>
          ) : catchEntries.length === 0 ? (
            <p className="text-xs text-text-secondary py-2">No catch log entries recorded yet.</p>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
              {catchEntries.map((c) => (
                <div
                  key={c.id}
                  data-testid={`catch-log-row-${c.id}`}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-surface text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-text-primary truncate">
                      {c.playerName}
                      <span
                        className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          c.type === "stunning"
                            ? "bg-emerald-500/10 text-emerald-700"
                            : "bg-red-500/10 text-red-700"
                        }`}
                      >
                        {c.count} {c.type}
                      </span>
                    </p>
                    {c.comment && <p className="text-[11px] text-text-secondary truncate mt-0.5">{c.comment}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEditCatch(c)}
                      aria-label={`Edit catch for ${c.playerName}`}
                      className="min-w-[36px] min-h-[36px] rounded-lg border border-border hover:bg-surface-hover flex items-center justify-center text-text-primary cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={deletingCatchId === c.id}
                      onClick={() => handleDeleteCatch(c.id)}
                      aria-label={`Delete catch for ${c.playerName}`}
                      className="min-w-[36px] min-h-[36px] rounded-lg border border-border hover:bg-red-50 text-red-600 flex items-center justify-center cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
