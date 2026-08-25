/**
 * Matches & Grounds Manager (`components/MatchesTab.tsx`)
 *
 * High-level component controlling the scheduling, managing, and viewing
 * of sporting matches. For Admins, it includes features to create/edit/score
 * matches, and manage the underlying grounds/locations. For standard Players,
 * it provides views to mark availability, see match history, and post comments.
 * It contains sub-components for assigning match outcomes and viewing venues.
 */
import { useStore } from "@/hooks/useStore";
import { Match, MatchComment, Player, FeePlan } from "@/lib/types";

/**
 * sessionStorage-backed useState. Lets accordions and filters
 * survive an in-tab navigation (e.g. open a match → hit Back →
 * the past-matches list is still expanded, filters preserved).
 * SSR-safe: first render always matches `initial`; hydration
 * happens in the mount effect. Value is dropped when the tab
 * closes so we don't pollute the user's browser forever.
 */
function useSessionState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // Broken/blocked sessionStorage — silently fall through.
    }
    setHydrated(true);
  }, [key]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Same silent fallback: state simply doesn't persist.
    }
  }, [key, value, hydrated]);
  return [value, setValue] as const;
}
import {
  Plus,
  Edit2,
  Copy,
  ChevronRight,
  ChevronDown,
  Calendar,
  Users,
  MapPin,
  Search,
  Check,
  CheckCircle2,
  MessageSquare,
  Trash2,
  X,
  Undo2,
  ArrowRightLeft,
} from "lucide-react";
import { useState, useEffect, useMemo, useRef, FC } from "react";
import { formatDate, dbToInputDate, inputToDbDate, normalizeIndianMobile, findExistingPlayer } from "@/lib/utils";
import { db } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  doc,
  deleteDoc,
  serverTimestamp,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { handleFirestoreError, OperationType } from "@/lib/errorHandling";
import { GroundsTab } from "./GroundsTab";
import { AssignFeesAdmin } from "./AssignFeesAdmin";
import { TournamentsTab } from "./TournamentsTab";
import { EditPlayerInline } from "./EditPlayerInline";
import { useAuth } from "./AuthProvider";

export function MatchesTab({
  store,
  persona,
  isMatchAdmin,
  defaultAction,
}: {
  store: ReturnType<typeof useStore>;
  persona?: "admin" | "player";
  isMatchAdmin?: boolean;
  defaultAction?: string | null;
}) {
  const [subTab, setSubTab] = useState<"matches" | "grounds" | "assign" | "tournaments">(
    defaultAction === "assign" ? "assign" : "matches"
  );
  const [isAdding, setIsAdding] = useState(defaultAction === "add_match");
  const [isLaterScheduledCollapsed, setIsLaterScheduledCollapsed] = useSessionState(
    "matches:isLaterScheduledCollapsed",
    true,
  );
  const [isPastListCollapsed, setIsPastListCollapsed] = useSessionState(
    "matches:isPastListCollapsed",
    true,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [matchToDelete, setMatchToDelete] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "calendar">(
    defaultAction === "calendar" ? "calendar" : (persona === "admin" ? "calendar" : "list")
  );

  // Remember where the user scrolled to before opening a match, so
  // Back lands them at the same row instead of the top of the list.
  const scrollBeforeMatchRef = useRef<number>(0);
  const openMatch = (m: Match) => {
    scrollBeforeMatchRef.current =
      typeof window !== "undefined"
        ? window.scrollY || document.documentElement.scrollTop || 0
        : 0;
    setSelectedMatch(m);
  };
  useEffect(() => {
    // Restore only on the match → list transition, and only if we
    // actually captured something (i.e. the user came from the list).
    if (selectedMatch === null && scrollBeforeMatchRef.current > 0) {
      const y = scrollBeforeMatchRef.current;
      // rAF twice gives the list DOM time to mount + layout before we
      // scroll; scrollTo before layout is a no-op.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.scrollTo({ top: y, behavior: "auto" });
        });
      });
      scrollBeforeMatchRef.current = 0;
    }
  }, [selectedMatch]);

  useEffect(() => {
    if (defaultAction && defaultAction.startsWith("match_")) {
      const targetMatchId = defaultAction.replace("match_", "");
      const match = store.matches.find(m => m.id === targetMatchId);
      if (match) {
        setSelectedMatch(match);
      }
    } else if (defaultAction === "assign") {
      setSubTab("assign");
    }
  }, [defaultAction, store.matches]);

  const getInitialFee = () => {
     const ground = store.grounds[0];
     if (ground && ground.practiceFee) {
        return Math.round((ground.practiceFee / 12) * 1.05);
     }
     return "";
  };

  const [formData, setFormData] = useState<
    Omit<Match, "id" | "createdAt" | "updatedAt" | "fee"> & { fee: number | "" }
  >({
    groundId: store.grounds[0]?.id || "",
    format: "T30",
    jerseyColor: "Scarlet Red",
    opponent: "",
    matchType: "Practice",
    fee: getInitialFee(),
    date: dbToInputDate(new Date().toISOString().split("T")[0]),
    time: "09:00",
    maxSquadSize: 12,
    matchUrl: "",
    streamingUrl: "",
    result: "Pending",
    resultMarginType: "runs",
    resultMarginAmount: 0,
    playerOfTheMatch: "",
    potmId: "",
    topPerformerIds: [],
    bestBatsman: "",
    bestBowler: "",
    isTentative: false,
    tentativelyBlockedBy: "",
    tournamentId: "",
  });

  const { user } = useAuth();
  const currentUserObj = store.appUsers.find(u => u.id === user?.uid);
  const currentUserName = currentUserObj?.name || "Admin";

  useEffect(() => {
    if (store.grounds.length > 0 && !formData.groundId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData((prev) => ({ ...prev, groundId: store.grounds[0].id, fee: getInitialFee() }));
    }
  }, [store.grounds, formData.groundId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const processedData = {
      ...formData,
      fee: Number(formData.fee) || 0,
      date: inputToDbDate(formData.date),
    };
    if (editingId) {
      store.updateMatch({ ...processedData, id: editingId } as Match);
      setEditingId(null);
    } else {
      store.addMatch(processedData);
    }
    setIsAdding(false);
    resetForm();
  };

  const resetForm = () => {
    setFormData({
      groundId: store.grounds[0]?.id || "",
      format: "T30",
      jerseyColor: "Scarlet Red",
      opponent: "",
      matchType: "Practice",
      fee: getInitialFee(),
      date: dbToInputDate(new Date().toISOString().split("T")[0]),
      time: "09:00",
      maxSquadSize: 12,
      matchUrl: "",
      streamingUrl: "",
      result: "Pending",
      resultMarginType: "runs",
      resultMarginAmount: 0,
      playerOfTheMatch: "",
      potmId: "",
      topPerformerIds: [],
      bestBatsman: "",
      bestBowler: "",
      isTentative: false,
      tentativelyBlockedBy: "",
      tournamentId: "",
    });
  };

  const startEdit = (match: Match) => {
    setFormData({
      groundId: match.groundId,
      format: match.format,
      jerseyColor: match.jerseyColor,
      opponent: match.opponent,
      matchType: match.matchType,
      fee: match.fee === 0 ? "" : match.fee,
      date: dbToInputDate(match.date),
      time: match.time || "09:00",
      maxSquadSize: match.maxSquadSize || 12,
      matchUrl: match.matchUrl || "",
      streamingUrl: match.streamingUrl || "",
      result: match.result || "Pending",
      resultMarginType: match.resultMarginType || "runs",
      resultMarginAmount: match.resultMarginAmount || 0,
      playerOfTheMatch: match.playerOfTheMatch || "",
      potmId: match.potmId || "",
      topPerformerIds: match.topPerformerIds || [],
      bestBatsman: match.bestBatsman || "",
      bestBowler: match.bestBowler || "",
      isTentative: match.isTentative || false,
      tentativelyBlockedBy: match.tentativelyBlockedBy || "",
      tournamentId: match.tournamentId || "",
    });
    setEditingId(match.id);
    setIsAdding(true);
  };

  const startDuplicate = (match: Match) => {
    setFormData({
      groundId: match.groundId,
      format: match.format,
      jerseyColor: match.jerseyColor,
      opponent: `${match.opponent} (Copy)`,
      matchType: match.matchType,
      fee: match.fee === 0 ? "" : match.fee,
      date: dbToInputDate(match.date),
      time: match.time || "09:00",
      maxSquadSize: match.maxSquadSize || 12,
      matchUrl: match.matchUrl || "",
      streamingUrl: match.streamingUrl || "",
      result: "Pending", // Reset result
      resultMarginType: "runs",
      resultMarginAmount: 0,
      playerOfTheMatch: "",
      potmId: "",
      topPerformerIds: [],
      bestBatsman: "",
      bestBowler: "",
      isTentative: false,
      tentativelyBlockedBy: "",
      tournamentId: match.tournamentId || "",
    });
    setEditingId(null);
    setIsAdding(true);
  };

  const isAdmin = persona === "admin" && isMatchAdmin !== false;

  useEffect(() => {
    if (!isAdmin && subTab !== "matches") {
      setSubTab("matches");
    }
  }, [isAdmin, subTab]);

  // Edit-match modal is hoisted so both the matches list AND the
  // per-match screen (below early-return) can render it. Previously,
  // clicking Edit inside a match forced the screen to close + open
  // the modal over the parent list, so Back landed the user on the
  // list instead of the match they were reviewing.
  const editMatchModal = isAdmin && isAdding ? (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-md my-8">
        <div className="sticky top-0 bg-[#0f172a] p-4 flex justify-between items-center rounded-t-xl z-10 border-b border-glass-border">
          <h2 className="text-xl font-bold text-white">{editingId ? "Edit Match" : "Add Match"}</h2>
          <button type="button" onClick={() => { setIsAdding(false); setEditingId(null); resetForm(); }} className="text-white/50 hover:text-white"><X className="w-6 h-6"/></button>
        </div>
        <form
          onSubmit={handleSubmit}
          className="bg-[#0f172a] p-4 rounded-b-xl space-y-3 max-h-[80vh] overflow-y-auto custom-scrollbar"
        >
          <div className="grid grid-cols-2 gap-3">
            {/* Tentative block only makes sense for FUTURE matches — no
                point marking a past match tentative. Today's match is
                also treated as past for this check (you've either
                played it or you're about to; tentative is off the table). */}
            {(() => {
              const dbDate = inputToDbDate(formData.date);
              // dbDate is YYYY-MM-DD after conversion.
              const parts = dbDate.split("-");
              let matchDay: Date | null = null;
              if (parts.length === 3) {
                matchDay = new Date(`${parts[0]}-${parts[1]}-${parts[2]}T00:00:00`);
              }
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const isFuture = !!matchDay && matchDay.getTime() > today.getTime();
              if (!isFuture) return null;
              return (
                <div className="col-span-2 flex items-center gap-2 bg-orange-500/10 p-3 rounded-lg border border-orange-500/30">
                  <input
                    type="checkbox"
                    id="tentative-block"
                    checked={formData.isTentative || false}
                    onChange={(e) => setFormData({
                      ...formData,
                      isTentative: e.target.checked,
                      tentativelyBlockedBy: e.target.checked ? currentUserName : ""
                    })}
                    className="accent-orange-500 w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="tentative-block" className="text-orange-400 font-bold text-sm cursor-pointer select-none">
                    Tentatively Block Slot
                  </label>
                </div>
              );
            })()}
            {/* Tournament dropdown is always shown — admins may want to
                link a Practice or friendly match to a tournament for
                reporting even if it isn't formally counted as one. */}
            <div className="col-span-2">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Tournament{" "}
                <span className="text-white/40 normal-case tracking-normal font-normal text-[10px]">
                  (optional — autofills ground / jersey / fee)
                </span>
              </label>
                <select
                  value={formData.tournamentId || ""}
                  onChange={(e) => {
                    const tId = e.target.value;
                    if (!tId) {
                      // Cleared — leave everything else alone; admin
                      // may want to keep the autofilled values.
                      setFormData({ ...formData, tournamentId: "" });
                      return;
                    }
                    const t = store.tournaments.find((x) => x.id === tId);
                    if (!t) {
                      setFormData({ ...formData, tournamentId: tId });
                      return;
                    }
                    setFormData({
                      ...formData,
                      tournamentId: tId,
                      groundId: t.groundId,
                      jerseyColor: t.jerseyColor,
                      format: t.format || "T30",
                      fee: t.perPlayerFee,
                    });
                  }}
                  className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
                >
                  <option value="">— None (fill manually) —</option>
                  {[...store.tournaments]
                    .filter(
                      (t) => t.status === "Ongoing" || t.status === "Upcoming",
                    )
                    .sort((a, b) => {
                      // Ongoing first, then Upcoming, then by name
                      const r =
                        (a.status === "Ongoing" ? 0 : 1) -
                        (b.status === "Ongoing" ? 0 : 1);
                      if (r !== 0) return r;
                      return (a.name || "").localeCompare(b.name || "");
                    })
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.status} · ₹{t.perPlayerFee}/player
                      </option>
                    ))}
                </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Select Ground <span className="text-red-400">*</span>
              </label>
              <select
                required
                value={formData.groundId}
                onChange={(e) => {
                  const newGroundId = e.target.value;
                  const ground = store.grounds.find(g => g.id === newGroundId);
                  let newFee = formData.fee;
                  if (ground) {
                    const groundFee = formData.matchType === "Practice" ? (ground.practiceFee || 0) : (ground.tournamentFee || 0);
                    if (groundFee > 0) {
                      newFee = Math.round((groundFee / 12) * 1.05);
                    }
                  }
                  setFormData({ ...formData, groundId: newGroundId, fee: newFee });
                }}
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
              >
                <option value="" disabled>
                  Select a ground
                </option>
                {store.grounds.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Opponent Team <span className="text-red-400">*</span>
              </label>
              <input
                required
                type="text"
                value={formData.opponent}
                onChange={(e) =>
                  setFormData({ ...formData, opponent: e.target.value })
                }
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                placeholder="e.g. Royal Challengers"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Date <span className="text-red-400">*</span>
              </label>
              <input
                required
                type="date"
                value={inputToDbDate(formData.date)}
                onChange={(e) =>
                  setFormData({ ...formData, date: e.target.value })
                }
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Time <span className="text-red-400">*</span>
              </label>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, time: "07:00" })}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition ${
                      formData.time === "07:00"
                        ? "bg-accent/20 border-accent/50 text-accent"
                        : "bg-white/5 border-glass-border text-white/70 hover:bg-white/10"
                    }`}
                  >
                    07:00 AM
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, time: "12:00" })}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition ${
                      formData.time === "12:00"
                        ? "bg-accent/20 border-accent/50 text-accent"
                        : "bg-white/5 border-glass-border text-white/70 hover:bg-white/10"
                    }`}
                  >
                    12:00 PM
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, time: formData.time === "07:00" || formData.time === "12:00" ? "" : formData.time })}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition ${
                      formData.time !== "07:00" && formData.time !== "12:00"
                        ? "bg-accent/20 border-accent/50 text-accent"
                        : "bg-white/5 border-glass-border text-white/70 hover:bg-white/10"
                    }`}
                  >
                    Other
                  </button>
                </div>
                {formData.time !== "07:00" && formData.time !== "12:00" && (
                <input
                  required={formData.time !== "07:00" && formData.time !== "12:00"}
                  type="time"
                  value={formData.time}
                  onChange={(e) =>
                    setFormData({ ...formData, time: e.target.value })
                  }
                  className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&::-webkit-calendar-picker-indicator]:invert"
                />
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Max Squad Size <span className="text-red-400">*</span>
              </label>
              <input
                required
                type="number"
                min="1"
                value={formData.maxSquadSize}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    maxSquadSize: parseInt(e.target.value) || 12,
                  })
                }
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/70">
                <span>Match Fee (₹)</span><span className="text-white/40 normal-case tracking-normal font-normal text-[10px]">(Optional)</span>
              </label>
              <input
                type="number"
                min="0"
                value={formData.fee}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    fee: e.target.value === "" ? "" : parseInt(e.target.value) || 0,
                  })
                }
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Format <span className="text-red-400">*</span>
              </label>
              <div className="flex gap-2">
                {["T20", "T30", "Other"].map((fmt) => (
                  <label
                    key={fmt}
                    className={`flex-1 text-center py-2 border rounded-lg text-sm cursor-pointer select-none transition ${formData.format === fmt ? "bg-accent text-black font-bold border-accent" : "bg-transparent text-white border-glass-border hover:bg-white/5"}`}
                  >
                    <input
                      type="radio"
                      className="hidden"
                      name="format"
                      value={fmt}
                      checked={formData.format === fmt}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          format: e.target.value as Match["format"],
                        })
                      }
                    />
                    {fmt}
                  </label>
                ))}
              </div>
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Type <span className="text-red-400">*</span>
              </label>
              <div className="flex gap-2">
                {["Practice", "Tournament"].map((type) => (
                  <label
                    key={type}
                    className={`flex-1 text-center py-2 border rounded-lg text-sm cursor-pointer select-none transition ${formData.matchType === type ? "bg-accent text-black font-bold border-accent" : "bg-transparent text-white border-glass-border hover:bg-white/5"}`}
                  >
                    <input
                      type="radio"
                      className="hidden"
                      name="matchType"
                      value={type}
                      checked={formData.matchType === type}
                      onChange={(e) => {
                        const newMatchType = e.target.value as Match["matchType"];
                        const ground = store.grounds.find(g => g.id === formData.groundId);
                        let newFee = formData.fee;
                        if (ground) {
                          const groundFee = newMatchType === "Practice" ? (ground.practiceFee || 0) : (ground.tournamentFee || 0);
                          if (groundFee > 0) {
                            newFee = Math.round((groundFee / 12) * 1.05);
                          }
                        }
                        setFormData({
                          ...formData,
                          matchType: newMatchType,
                          fee: newFee,
                          // Switching away from Tournament wipes any
                          // linked tournamentId — otherwise a Practice
                          // match would carry a stale tournament link.
                          tournamentId:
                            newMatchType === "Tournament"
                              ? formData.tournamentId
                              : "",
                        });
                      }}
                    />
                    {type}
                  </label>
                ))}
              </div>
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Jersey Color <span className="text-red-400">*</span>
              </label>
              <div className="flex gap-2">
                {["Scarlet Red", "Whites"].map((color) => (
                  <label
                    key={color}
                    className={`flex-1 text-center py-2 border rounded-lg text-sm cursor-pointer select-none transition flex items-center justify-center gap-2 ${formData.jerseyColor === color ? "bg-accent text-black font-bold border-accent" : "bg-transparent text-white border-glass-border hover:bg-white/5"}`}
                  >
                    <input
                      type="radio"
                      className="hidden"
                      name="jerseyColor"
                      value={color}
                      checked={formData.jerseyColor === color}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          jerseyColor: e.target
                            .value as Match["jerseyColor"],
                        })
                      }
                    />
                    <div
                      className={`w-3 h-3 rounded-full ${color === "Scarlet Red" ? "bg-red-500" : "bg-[#e5e5e5] border border-slate-300"}`}
                    />
                    {color}
                  </label>
                ))}
              </div>
            </div>

            <div className="col-span-2 border-t border-glass-border pt-4 mt-2">
              <h3 className="text-sm font-bold text-accent mb-3">
                Optional Match Info
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                    Match URL
                  </label>
                  <input
                    type="url"
                    value={formData.matchUrl}
                    onChange={(e) =>
                      setFormData({ ...formData, matchUrl: e.target.value })
                    }
                    className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                    placeholder="https://cricheroes.in/..."
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                    Streaming URL
                  </label>
                  <input
                    type="url"
                    value={formData.streamingUrl}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        streamingUrl: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                    placeholder="https://youtube.com/..."
                  />
                </div>

                <div className="col-span-2">
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                    Result
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      "Pending",
                      "KAvach Won",
                      "KAvach Lost",
                      "Draw",
                      "Tie",
                      "Abandoned",
                    ].map((res) => (
                      <label
                        key={res}
                        className={`px-3 py-1.5 border rounded-lg text-xs cursor-pointer select-none transition ${formData.result === res ? "bg-accent text-black font-bold border-accent" : "bg-transparent text-white border-glass-border hover:bg-white/5"}`}
                      >
                        <input
                          type="radio"
                          className="hidden"
                          name="result"
                          value={res}
                          checked={formData.result === res}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              result: e.target.value as any,
                            })
                          }
                        />
                        {res}
                      </label>
                    ))}
                  </div>
                </div>

                {(formData.result === "KAvach Won" ||
                  formData.result === "KAvach Lost") && (
                  <div className="col-span-2 flex gap-4 mt-2 p-3 bg-black/20 rounded-lg border border-glass-border">
                    <div className="flex-1">
                      <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                        Margin Type
                      </label>
                      <div className="flex gap-2">
                        {["runs", "wickets"].map((type) => (
                          <label
                            key={type}
                            className={`flex-1 text-center py-2 border rounded-lg text-xs cursor-pointer select-none transition ${formData.resultMarginType === type ? "bg-accent text-black font-bold border-accent" : "bg-transparent text-white border-glass-border hover:bg-white/5"}`}
                          >
                            <input
                              type="radio"
                              className="hidden"
                              name="marginType"
                              value={type}
                              checked={formData.resultMarginType === type}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  resultMarginType: e.target.value as
                                    | "runs"
                                    | "wickets",
                                })
                              }
                            />
                            By {type}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="w-1/3">
                      <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                        Amount
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={formData.resultMarginAmount || ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            resultMarginAmount:
                              parseInt(e.target.value) || 0,
                          })
                        }
                        className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                        placeholder="e.g. 5"
                      />
                    </div>
                  </div>
                )}

                {formData.result === "KAvach Won" && (
                  <>
                    <div className="col-span-2">
                      <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                        Player of the Match
                      </label>
                      <div className="flex gap-2">
                        <select
                          value={formData.potmId || ""}
                          onChange={(e) =>
                            setFormData({ ...formData, potmId: e.target.value })
                          }
                          className="w-1/2 rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
                        >
                          <option value="">Select (Optional)</option>
                          {store.players.filter(p => !p.disabled && (!editingId || store.payments.some(pay => pay.matchId === editingId && pay.playerId === p.id && pay.status !== "Not Playing"))).map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={formData.playerOfTheMatch}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              playerOfTheMatch: e.target.value,
                            })
                          }
                          className="w-1/2 rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                          placeholder="Or manual name"
                        />
                      </div>
                    </div>
                    <div className="col-span-2 border border-glass-border p-3 rounded-lg bg-white/5">
                      <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                        Top Performers (Max 3)
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 overflow-y-auto max-h-32 pr-2 custom-scrollbar">
                        {store.players.filter(p => !p.disabled && (!editingId || store.payments.some(pay => pay.matchId === editingId && pay.playerId === p.id && pay.status !== "Not Playing"))).map((p) => {
                            const isSelected = formData.topPerformerIds?.includes(p.id);
                            return (
                              <label key={p.id} className={`flex items-center gap-2 text-xs p-1.5 rounded cursor-pointer transition ${isSelected ? "bg-accent/20 text-accent font-bold" : "hover:bg-white/10 text-white/80"}`}>
                                <input
                                  type="checkbox"
                                  className="accent-accent"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    const current = formData.topPerformerIds || [];
                                    if (e.target.checked) {
                                      if (current.length < 3) {
                                        setFormData({ ...formData, topPerformerIds: [...current, p.id] });
                                      } else {
                                        alert("Maximum 3 top performers allowed.");
                                      }
                                    } else {
                                      setFormData({ ...formData, topPerformerIds: current.filter(id => id !== p.id) });
                                    }
                                  }}
                                />
                                <span className="truncate">{p.name}</span>
                              </label>
                            );
                        })}
                      </div>
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                        Best Batsman
                      </label>
                      <input
                        type="text"
                        value={formData.bestBatsman}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            bestBatsman: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                        placeholder="Player Name"
                      />
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                        Best Bowler
                      </label>
                      <input
                        type="text"
                        value={formData.bestBowler}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            bestBowler: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                        placeholder="Player Name"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="w-full rounded-lg bg-accent py-2.5 text-sm font-bold text-black hover:bg-accent/90 transition"
            >
              {editingId ? "Save Changes" : "Create Match"}
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  if (selectedMatch) {
    return (
      <>
        <MatchPayments
          match={selectedMatch}
          store={store}
          persona={persona}
          isMatchAdmin={isMatchAdmin}
          onBack={() => setSelectedMatch(null)}
          onEdit={() => startEdit(selectedMatch)}
        />
        {editMatchModal}
      </>
    );
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex gap-2 mb-4 bg-white/5 p-1.5 rounded-2xl border border-glass-border">
          {["matches", "tournaments", "grounds", "assign"].map((tab) => {
            const active = subTab === tab;
            const labels: Record<string, string> = {
              matches: "Matches",
              tournaments: "Tournaments",
              grounds: "Grounds",
              assign: "Assign",
            };
            return (
              <button
                key={tab}
                onClick={() => setSubTab(tab as any)}
                className={`flex-1 py-2 px-3 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all duration-200 text-center cursor-pointer ${
                  active
                    ? "bg-accent text-black font-extrabold shadow-[0_2px_8px_rgba(16,185,129,0.3)]"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>
      )}

      {subTab === "grounds" && isAdmin && (
        <GroundsTab store={store} persona={persona || "player"} />
      )}
      {subTab === "assign" && isAdmin && <AssignFeesAdmin store={store} />}
      {subTab === "tournaments" && isAdmin && <TournamentsTab store={store} />}

      {subTab === "matches" && (
        <>
          <div className="flex flex-col gap-3 mb-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold tracking-tight text-white">
                Match Schedule
              </h2>
              {isAdmin && (
                <button
                  onClick={() => {
                    if (isAdding) {
                      setIsAdding(false);
                      setEditingId(null);
                      resetForm();
                    } else {
                      setIsAdding(true);
                      resetForm();
                    }
                  }}
                  className="flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-sm font-bold text-black shadow hover:bg-accent/90 transition"
                >
                  <Plus className="h-4 w-4" />
                  {isAdding ? "Cancel" : "Add Match"}
                </button>
              )}
            </div>

            {!isAdding && (
              <div className="flex bg-white/5 p-1 rounded-xl border border-glass-border">
                <button
                  onClick={() => setViewMode("list")}
                  className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition ${
                    viewMode === "list" ? "bg-accent text-black shadow" : "text-white/40 hover:text-white"
                  }`}
                >
                  List View
                </button>
                <button
                  onClick={() => setViewMode("calendar")}
                  className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition ${
                    viewMode === "calendar" ? "bg-accent text-black shadow" : "text-white/40 hover:text-white"
                  }`}
                >
                  Calendar View
                </button>
              </div>
            )}
          </div>

          {editMatchModal}

          {viewMode === "list" ? (
            <div className="space-y-4">
            {(() => {
              const now = new Date();
              const fourteenDaysFromNow = new Date(now);
              fourteenDaysFromNow.setDate(fourteenDaysFromNow.getDate() + 14);
              // Admins still need to edit recent results (result, POTM, stats,
              // fee assignments) for a while after the match. Keep the last
              // 10 days out of "Past Matches" so those cards stay right at
              // the top of the list.
              const pastCutoff = new Date(now);
              pastCutoff.setDate(pastCutoff.getDate() - 10);

              const getMatchDate = (match: Match) => {
                const parts = dbToInputDate(match.date).split("/"); // returns DD/MM/YYYY
                let d = new Date();
                if (parts.length === 3) {
                  d = new Date(
                    parseInt(parts[2]),
                    parseInt(parts[1]) - 1,
                    parseInt(parts[0]),
                  );
                } else {
                  d = new Date(match.date);
                }
                if (match.time) {
                  const [hours, mins] = match.time.split(":");
                  d.setHours(
                    parseInt(hours) || 23,
                    parseInt(mins) || 59,
                    59,
                    999,
                  );
                } else {
                  d.setHours(23, 59, 59, 999); // If no time, assume it's upcoming until end of day
                }
                return d;
              };

              const allMatches = store.matches.filter(m => !m.isArchived && (isAdmin || !m.isTentative));

              const renderMatchCard = (match: Match) => {
                const ground = store.grounds.find(
                  (g) => g.id === match.groundId,
                );
                const paymentsForMatch = store.payments.filter(
                  (p) => p.matchId === match.id,
                );
                const paidCount = paymentsForMatch.filter(
                  (p) => p.status === "Paid",
                ).length;
                const unpaidCount = paymentsForMatch.filter(
                  (p) => p.status === "Unpaid",
                ).length;
                const cardPaidTotal = paymentsForMatch
                  .filter((p) => p.status === "Paid")
                  .reduce((s, p) => s + (p.feeOverride !== undefined ? p.feeOverride : match.fee), 0);
                const cardUnpaidTotal = paymentsForMatch
                  .filter((p) => p.status === "Unpaid")
                  .reduce((s, p) => s + (p.feeOverride !== undefined ? p.feeOverride : match.fee), 0);
                return (
                  <div
                    key={match.id}
                    onClick={() => openMatch(match)}
                    className="cursor-pointer glass p-0 rounded-xl hover:-translate-y-0.5 hover:shadow-lg transition overflow-hidden"
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex gap-2 items-center mb-1 flex-wrap">
                            <span className="bg-white/10 text-white/80 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                              {match.matchType}
                            </span>
                            <span className="bg-accent/20 text-accent px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                              {match.format}
                            </span>
                            {match.tournamentId && (() => {
                              const t = store.tournaments.find(
                                (tt) => tt.id === match.tournamentId,
                              );
                              if (!t) return null;
                              return (
                                <span
                                  className="bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider truncate max-w-[160px]"
                                  title={t.name}
                                >
                                  🏆 {t.name}
                                </span>
                              );
                            })()}
                            {match.isTentative && (
                              <span className="bg-orange-500 text-black px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider animate-pulse" title={`Blocked by ${match.tentativelyBlockedBy || "Admin"}`}>
                                Blocked{match.tentativelyBlockedBy ? ` · ${match.tentativelyBlockedBy}` : ""}
                              </span>
                            )}
                          </div>
                          {getMatchDate(match) < now &&
                          !isAdmin &&
                          (match.result === "KAvach Won" ||
                            match.result === "KAvach Lost") ? (
                            <h3 className="font-bold text-lg">
                              vs {match.opponent}{" "}
                              <span
                                className={
                                  match.result === "KAvach Won"
                                    ? "text-accent text-base font-medium"
                                    : "text-red-400 text-base font-medium"
                                }
                              >
                                (
                                {match.result === "KAvach Won" ? "Won" : "Lost"}{" "}
                                {match.resultMarginAmount
                                  ? `by ${match.resultMarginAmount} ${match.resultMarginType === "wickets" ? "wickets" : "runs"}`
                                  : ""}
                                )
                              </span>
                            </h3>
                          ) : (
                            <h3 className="font-bold text-lg">vs {match.opponent}</h3>
                          )}
                          <div className="text-white/60 text-sm mt-0.5">
                            {match.date} • {match.time}
                          </div>
                        </div>
                        {isAdmin && (
                          <div className="flex gap-1 items-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startDuplicate(match);
                              }}
                              className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/20 transition hover:text-white"
                              title="Duplicate Match"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startEdit(match);
                              }}
                              className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/20 transition hover:text-white"
                              title="Edit Match"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            {matchToDelete === match.id ? (
                              <div className="flex items-center gap-1 bg-black/40 rounded-lg px-2 border border-red-500/30">
                                <span className="text-[10px] text-red-400 uppercase font-bold tracking-wider">
                                  Sure?
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    store
                                      .deleteMatch(match.id)
                                      .then(() => setMatchToDelete(null))
                                      .catch((err) => {
                                        console.error(err);
                                        setMatchToDelete(null);
                                      });
                                  }}
                                  className="text-red-400 hover:text-red-300 p-1 transition"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMatchToDelete(null);
                                  }}
                                  className="text-white/40 hover:text-white p-1 transition text-xs font-bold px-1.5"
                                >
                                  X
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMatchToDelete(match.id);
                                }}
                                className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-red-500/20 text-red-400 transition"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-sm mt-3 pt-3 border-t border-glass-border">
                        <div className="flex items-center text-white/70 mb-2 sm:mb-0">
                          <MapPin className="w-4 h-4 mr-1.5 shrink-0" />
                          <span className="truncate max-w-[150px] sm:max-w-[200px]">
                            {ground?.name || "Unknown Ground"}
                          </span>
                        </div>
                        {isAdmin && (
                          <div className="flex items-center gap-1.5 text-xs">
                            {match.isGroundFeePaid && (
                               <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded flex items-center gap-1 font-bold">
                                   Ground Fee Paid (₹{match.groundFeePaidAmount})
                               </div>
                            )}
                            <div className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-bold">
                              ₹{cardPaidTotal}
                            </div>
                            <div className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded font-bold">
                              ₹{cardUnpaidTotal}
                            </div>
                          </div>
                        )}
                      </div>

                      {(match.matchUrl || match.streamingUrl) && (
                        <div className="flex gap-4 mt-3 pt-3 border-t border-glass-border">
                          {match.matchUrl && (
                            <a
                              href={match.matchUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-accent text-xs font-bold hover:underline py-1 flex items-center gap-1.5"
                            >
                              <span>🔗</span> Match Link
                            </a>
                          )}
                          {match.streamingUrl && (
                            <a
                              href={match.streamingUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-emerald-400 text-xs font-bold hover:underline py-1 flex items-center gap-1.5"
                            >
                              <span>▶️</span> Watch Live
                            </a>
                          )}
                        </div>
                      )}

                      {match.result && match.result !== "Pending" && (
                        <div className="mt-3 pt-3 border-t border-glass-border">
                          <p
                            className={`font-bold text-sm mb-1 ${match.result === "KAvach Won" ? "text-accent" : match.result === "KAvach Lost" ? "text-red-400" : "text-white/60"}`}
                          >
                            Result: {match.result}{" "}
                            {match.resultMarginAmount
                              ? `by ${match.resultMarginAmount} ${match.resultMarginType === "wickets" ? "wickets" : "runs"}`
                              : ""}
                          </p>
                          {match.result === "KAvach Won" &&
                            (match.potmId || match.playerOfTheMatch ||
                              match.bestBatsman ||
                              match.bestBowler || (match.topPerformerIds && match.topPerformerIds.length > 0)) && (
                              <div className="grid grid-cols-2 gap-2 text-xs mt-2 relative z-10">
                                {(match.potmId || match.playerOfTheMatch) && (
                                  <div>
                                    <span className="text-white/40 font-mono text-[10px]">
                                      POTM:
                                    </span>
                                    <br />
                                    <span className="font-bold">
                                      {match.potmId ? store.players.find(p => p.id === match.potmId)?.name : match.playerOfTheMatch}
                                    </span>
                                  </div>
                                )}
                                {match.bestBatsman && (
                                  <div>
                                    <span className="text-white/40 font-mono text-[10px]">
                                      BEST BAT:
                                    </span>
                                    <br />
                                    <span className="font-bold">
                                      {match.bestBatsman}
                                    </span>
                                  </div>
                                )}
                                {match.bestBowler && (
                                  <div>
                                    <span className="text-white/40 font-mono text-[10px]">
                                      BEST BALL:
                                    </span>
                                    <br />
                                    <span className="font-bold">
                                      {match.bestBowler}
                                    </span>
                                  </div>
                                )}
                                {match.topPerformerIds && match.topPerformerIds.length > 0 && (
                                  <div className="col-span-2 mt-1">
                                    <span className="text-white/40 font-mono text-[10px]">
                                      TOP PERFORMERS:
                                    </span>
                                    <br />
                                    <span className="font-bold text-emerald-400">
                                      {match.topPerformerIds.map(id => store.players.find(p => p.id === id)?.name).filter(Boolean).join(", ")}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const groundName = store.grounds.find((g) => g.id === match.groundId)?.name || 'Unknown Ground';
                                let text = `*Match Result*\n${formatDate(match.date)} | ${match.matchType} | ${groundName}\n\nKAvach vs ${match.opponent}\n*Result:* ${match.result}`;
                                if (match.result === "KAvach Won" || match.result === "KAvach Lost") {
                                  if (match.resultMarginAmount) {
                                    text += ` by ${match.resultMarginAmount} ${match.resultMarginType === "wickets" ? "wickets" : "runs"}\n`;
                                  } else {
                                    text += `\n`;
                                  }
                                } else {
                                  text += `\n`;
                                }
                                const potmStr = match.potmId ? store.players.find(p => p.id === match.potmId)?.name : match.playerOfTheMatch;
                                if (potmStr) text += `*MVP:* ${potmStr}\n`;
                                if (match.bestBatsman) text += `*Best Batsman:* ${match.bestBatsman}\n`;
                                if (match.bestBowler) text += `*Best Bowler:* ${match.bestBowler}\n`;
                                if (match.topPerformerIds && match.topPerformerIds.length > 0) {
                                  const tpStr = match.topPerformerIds.map(id => store.players.find(p => p.id === id)?.name).filter(Boolean).join(", ");
                                  if (tpStr) text += `*Top Performers:* ${tpStr}\n`;
                                }
                                navigator.clipboard.writeText(text);
                                alert("WhatsApp Report Copied to Clipboard!");
                              }}
                              className="mt-3 w-full flex justify-center items-center gap-2 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition border border-emerald-500/30 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg"
                            >
                              Share Result on WhatsApp
                            </button>

                        </div>
                      )}
                    </div>
                    <div className="bg-white/5 px-4 py-3 border-t border-glass-border flex items-center justify-between text-sm">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                          Paid: {paidCount}
                        </div>
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-[10px] font-bold uppercase tracking-wider text-red-500">
                          Pending: {unpaidCount}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              };

              if (allMatches.length === 0) {
                 return (
                   <div className="py-12 text-center text-sm text-white/50 glass border-dashed rounded-xl">
                     No matches found.
                   </div>
                 );
              }
               
              const pastMatches = allMatches.filter(m => getMatchDate(m) < pastCutoff).sort((a,b) => getMatchDate(b).getTime() - getMatchDate(a).getTime());
              const upcomingMatches = allMatches.filter(m => getMatchDate(m) >= pastCutoff).sort((a,b) => getMatchDate(a).getTime() - getMatchDate(b).getTime());

              const upcomingNear = upcomingMatches.filter(m => {
                 const date = getMatchDate(m);
                 return date <= fourteenDaysFromNow;
              });
               
              const upcomingLater = upcomingMatches.filter(m => {
                 const date = getMatchDate(m);
                 return date > fourteenDaysFromNow;
              });
               
              return (
                 <div className="space-y-4">
                   {upcomingNear.length > 0 ? upcomingNear.map(renderMatchCard) : (
                     <div className="py-12 text-center text-sm text-white/50 glass border-dashed rounded-xl">
                       No matches in the next 14 days.
                     </div>
                   )}
               
                   {upcomingLater.length > 0 && (
                      <div className="glass p-4 rounded-xl mt-8">
                        <button
                          onClick={() => setIsLaterScheduledCollapsed(!isLaterScheduledCollapsed)}
                          className="flex w-full items-center justify-between text-white/80 hover:text-white"
                        >
                          <h2 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                            Scheduled Later ({upcomingLater.length})
                          </h2>
                          {isLaterScheduledCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </button>
                        {!isLaterScheduledCollapsed && (
                          <div className="mt-4 space-y-4">
                            {upcomingLater.map(renderMatchCard)}
                          </div>
                        )}
                      </div>
                   )}

                   {pastMatches.length > 0 && (
                      <div className="glass p-4 rounded-xl mt-8">
                        <button
                          onClick={() => setIsPastListCollapsed(!isPastListCollapsed)}
                          className="flex w-full items-center justify-between text-white/80 hover:text-white"
                        >
                          <h2 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                            <Calendar className="w-4 h-4" /> Past Matches ({pastMatches.length})
                          </h2>
                          {isPastListCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </button>
                        {!isPastListCollapsed && (
                          <div className="mt-4 space-y-4">
                            {pastMatches.map(renderMatchCard)}
                          </div>
                        )}
                      </div>
                   )}
                 </div>
              );

            })()}
          </div>
          ) : (
            <MatchCalendarView
              store={store}
              matches={store.matches.filter(m => isAdmin || !m.isTentative)}
              grounds={store.grounds}
              isAdmin={isAdmin}
              onMatchClick={(m: Match) => {
                openMatch(m);
              }}
              onEditMatch={(m: Match) => {
                startEdit(m);
              }}
              onAddMatch={(dateStr: string) => {
                setFormData((prev) => ({
                  ...prev,
                  date: dateStr,
                }));
                setEditingId(null);
                setIsAdding(true);
              }}
              onDuplicateMatch={(m: Match) => startDuplicate(m)}
              onDeleteMatch={(m: Match) => setMatchToDelete(m.id)}
              matchToDelete={matchToDelete}
              onCancelDelete={() => setMatchToDelete(null)}
              onConfirmDelete={(mId: string) => {
                store.deleteMatch(mId).then(() => setMatchToDelete(null)).catch((err) => {
                  console.error(err);
                  setMatchToDelete(null);
                });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

export function MatchPayments({
  match,
  store,
  onBack,
  onEdit,
  persona,
  isMatchAdmin,
}: {
  match: Match;
  store: ReturnType<typeof useStore>;
  onBack: () => void;
  onEdit?: () => void;
  persona?: "admin" | "player";
  isMatchAdmin?: boolean;
}) {
  const matchPayments = store.payments.filter(
    (p) =>
      p.matchId === match.id &&
      store.players.some((pl) => pl.id === p.playerId),
  );
  const isAdmin = persona === "admin" && isMatchAdmin !== false;
  const { user } = useAuth();

  // Link to AppUser
  const appUser = store.appUsers.find((u) => u.id === user?.uid);
  const mePlayer =
    store.players.find((p) => p.id === user?.uid || p.authUid === user?.uid) ||
    (appUser?.mobile
      ? store.players.find((p) => p.mobile === appUser.mobile)
      : null);
  const myPayment = mePlayer
    ? matchPayments.find((p) => p.playerId === mePlayer.id)
    : null;
  const IHavePaid = myPayment?.status === "Paid";

  const getPlayerFee = (payment: typeof matchPayments[number]) =>
    payment.feeOverride !== undefined ? payment.feeOverride : match.fee;

  // Stats
  const played = matchPayments.filter((p) => p.status !== "Not Playing").length;
  const paid = matchPayments.filter((p) => p.status === "Paid").length;
  const unpaid = matchPayments.filter((p) => p.status === "Unpaid").length;
  const totalCollected = matchPayments
    .filter((p) => p.status === "Paid")
    .reduce((sum, p) => sum + getPlayerFee(p), 0);
  const totalExpected = matchPayments
    .filter((p) => p.status !== "Not Playing")
    .reduce((sum, p) => sum + getPlayerFee(p), 0);

  let matchDateObj = new Date();
  const matchDateParts = dbToInputDate(match.date).split("/");
  if (matchDateParts.length === 3) {
    matchDateObj = new Date(parseInt(matchDateParts[2]), parseInt(matchDateParts[1]) - 1, parseInt(matchDateParts[0]));
  } else {
    matchDateObj = new Date(match.date);
  }
  const diffDays = (new Date().getTime() - matchDateObj.getTime()) / (1000 * 3600 * 24);
  const canArchive = diffDays >= 3;

  const [addingSquad, setAddingSquad] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPlayerMobile, setNewPlayerMobile] = useState("");
  const [confirmSquadDuplicates, setConfirmSquadDuplicates] = useState(false);
  const [editingSquadPlayerId, setEditingSquadPlayerId] = useState<string | null>(null);

  const filteredPlayers = store.players.filter(
    (p) =>
      !p.disabled &&
      p.inviteStatus !== "Rejected" &&
      p.inviteStatus !== "Pending" &&
      (p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.mobile?.includes(searchQuery)),
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [comments, setComments] = useState<MatchComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [feePayerPicker, setFeePayerPicker] = useState<{ paymentId: string; playerName: string; fee: number; search: string } | null>(null);
  
  const [isGroupRemindModalOpen, setIsGroupRemindModalOpen] = useState(false);
  const [groupRemindCustomMsg, setGroupRemindCustomMsg] = useState("");

  useEffect(() => {
    // Dynamically load Razorpay SDK
    if (!document.getElementById("razorpay-checkout-js")) {
      const script = document.createElement("script");
      script.id = "razorpay-checkout-js";
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  const handleGroupRemind = () => {
    const ground = store.grounds.find(g => g.id === match.groundId);
    
    let text = `🏏 *Upcoming Match Reminder* 🏏\n`;
    text += `*Date*: ${formatDate(match.date)}\n`;
    text += `*Time*: ${match.time || 'TBD'}\n`;
    text += `*Ground*: ${ground?.name || 'TBD'}\n`;
    if (ground?.mapUrl) {
       text += `*Location*: ${ground.mapUrl}\n`;
    }
    
    if (groupRemindCustomMsg.trim()) {
       text += `\n${groupRemindCustomMsg.trim()}\n`;
    }
    
    text += `\n*Squad*:\n`;
    
    const playing = matchPayments.filter(p => p.status !== "Not Playing");
    playing.forEach(p => {
       const player = store.players.find(pl => pl.id === p.playerId);
       if (player?.mobile) {
           let mob = player.mobile.replace(/\D/g, '');
           if (mob.startsWith('0') && mob.length === 11) mob = "91" + mob.substring(1);
           else if (mob.length === 10) mob = "91" + mob;
           text += `@+${mob} `;
       } else if (player) {
           text += `${player.name} `;
       }
    });
    
    const encoded = encodeURIComponent(text);
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
    setIsGroupRemindModalOpen(false);
  };

  const handlePaySecure = async () => {
    if (!myPayment || !match.fee) return;
    if (store.appConfig?.features?.payments === false) {
      alert("This feature is currently not available. Contact Club Admin");
      return;
    }

    const payableFee = getPlayerFee(myPayment);
    if (payableFee <= 0) {
      alert("Your fee is ₹0 (sponsored). No payment needed.");
      return;
    }

    setIsProcessingPayment(true);
    try {
      const rzpId =
        store.appConfig?.razorpayKeyId ||
        process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

      if (!rzpId) {
        alert("Razorpay keys are missing (Settings -> Payment Gateway)");
        setIsProcessingPayment(false);
        return;
      }

      const res = await fetch("/api/razorpay/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: payableFee,
          intentData: {
            type: "match",
            matchId: match.id,
            paymentId: myPayment.id,
            playerId: myPayment.playerId
          }
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create order");

      const options = {
        key: rzpId,
        amount: data.amount,
        currency: data.currency,
        name: "Kavach Play",
        description: `Payment for Match Fee against ${match.opponent}`,
        order_id: data.id,
        handler: async function (response: any) {
          try {
            await store.updatePaymentStatus(myPayment.id, "Paid", match.id, undefined, "razorpay");
            alert("Payment Successful!");
            setIsProcessingPayment(false);
            if (typeof onBack === 'function') onBack();
          } catch (err) {
            console.error("Failed to update status", err);
            alert(
              "Payment successful but status update failed. Please contact admin.",
            );
            setIsProcessingPayment(false);
          }
        },
        prefill: {
          name: appUser?.name || mePlayer?.name || "Player",
          email: appUser?.email || mePlayer?.email || "",
          contact: appUser?.mobile || mePlayer?.mobile || "",
        },
        theme: {
          color: "#10b981", // Accent color
        },
        modal: {
          ondismiss: function () {
            setIsProcessingPayment(false);
            alert("Payment was cancelled or closed.");
            if (typeof onBack === 'function') onBack();
          },
        },
      };

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.on("payment.failed", async function (response: any) {
        setIsProcessingPayment(false);
        alert("Payment failed: " + response.error.description);
        try {
          await store.updatePaymentStatus(myPayment.id, "Failed", match.id);
        } catch (e) {
          console.error("Could not notify admin of failure");
        }
        if (typeof onBack === 'function') onBack();
      });
      paymentObject.open();
    } catch (err: any) {
      alert("Error: " + err.message);
      setIsProcessingPayment(false);
    }
  };

  useEffect(() => {
    const q = query(
      collection(db, "matches", match.id, "comments"),
      orderBy("createdAt", "asc"),
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setComments(
          snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as MatchComment),
        );
      },
      (err) =>
        handleFirestoreError(
          err,
          OperationType.LIST,
          `matches/${match.id}/comments`,
        ),
    );
    return () => unsub();
  }, [match.id]);

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || isSubmittingComment || !user) return;
    setIsSubmittingComment(true);
    try {
      const id = crypto.randomUUID();
      await setDoc(doc(db, "matches", match.id, "comments", id), {
        id,
        matchId: match.id,
        playerId: user.uid,
        playerName: appUser?.name || "Player",
        text: newComment.trim(),
        createdAt: serverTimestamp(),
      });
      setNewComment("");
    } catch (err) {
      console.error("Failed to post comment", err);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (
      !isAdmin &&
      comments.find((c) => c.id === commentId)?.playerId !== user?.uid
    )
      return;
    if (confirm("Delete this comment?")) {
      try {
        await deleteDoc(doc(db, "matches", match.id, "comments", commentId));
      } catch (err) {
        console.error("Failed to delete comment", err);
      }
    }
  };

  const handleAddToSquad = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      if (addingNew) {
        const normalizedNewMobile = normalizeIndianMobile(newPlayerMobile);
        const dupResult = findExistingPlayer(store.players, newPlayerMobile);
        let pId = "";
        if (dupResult) {
          pId = dupResult.player.id;
        } else {
          pId =
            (await store.addPlayer({
              name: newPlayerName,
              mobile: normalizedNewMobile,
            })) || "";
        }
        if (pId) {
          const existingPayment = matchPayments.find((p) => p.playerId === pId);
          if (existingPayment) {
            if (existingPayment.status === "Not Playing") {
              await store.updatePaymentStatus(
                existingPayment.id,
                "Unpaid",
                match.id,
                "Confirmed"
              );
            } else {
              alert("This player is already in the squad.");
            }
          } else {
            await store.addPaymentStatus(match.id, pId, "Unpaid", "Confirmed");
          }
        }
      } else {
        let duplicateIds: string[] = [];
        for (const pId of selectedPlayerIds) {
          const existingPayments = matchPayments.filter((p) => p.playerId === pId && p.status !== "Not Playing");
          if (existingPayments.length > 0) {
             duplicateIds.push(pId);
          }
        }
        if (duplicateIds.length > 0 && !confirmSquadDuplicates) {
            setConfirmSquadDuplicates(true);
            setIsSubmitting(false);
            return;
        }
        
        for (const pId of selectedPlayerIds) {
          const existingPayments = matchPayments.filter((p) => p.playerId === pId && p.status !== "Not Playing");
          if (existingPayments.length > 0) {
            const hostPlayer = store.players.find(p => p.id === pId);
            await store.addPaymentStatus(match.id, pId, "Unpaid", "Confirmed", `Guest of ${hostPlayer?.name || 'Player'}`);
          } else {
            const notPlayingPayment = matchPayments.find((p) => p.playerId === pId && p.status === "Not Playing");
            if (notPlayingPayment) {
              await store.updatePaymentStatus(
                notPlayingPayment.id,
                "Unpaid",
                match.id,
                "Confirmed"
              );
            } else {
              await store.addPaymentStatus(match.id, pId, "Unpaid", "Confirmed");
            }
          }
        }
      }

      setAddingSquad(false);
      setSelectedPlayerIds([]);
      setAddingNew(false);
      setSearchQuery("");
      setNewPlayerName("");
      setNewPlayerMobile("");
      setConfirmSquadDuplicates(false);
    } catch (err) {
      console.error("Error adding to squad:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button
          onClick={onBack}
          className="text-[13px] font-bold uppercase tracking-wider text-white/50 flex items-center gap-1 hover:text-white transition"
        >
          <ChevronRight className="w-4 h-4 rotate-180" /> Back
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <button
              onClick={() => setIsGroupRemindModalOpen(true)}
              className="text-[11px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-lg hover:bg-emerald-500/20 transition flex items-center gap-1 border border-emerald-500/20"
            >
              <MessageSquare className="w-3.5 h-3.5" /> Remind Group
            </button>
          )}
          {isAdmin && onEdit && (
            <button
              onClick={onEdit}
              className="text-[11px] font-bold uppercase tracking-widest text-accent bg-accent/10 px-3 py-1.5 rounded-lg hover:bg-accent/20 transition"
            >
              Edit Match
            </button>
          )}
        </div>
      </div>

      <div className="glass rounded-xl p-4">
        {match.isTentative && isAdmin && (
          <div className="mb-4 bg-orange-500/10 border border-orange-500/30 p-3 rounded-lg text-orange-400 text-sm font-bold flex items-center justify-between">
            <div className="flex items-center gap-2 animate-pulse">
              <span className="bg-orange-500 text-black px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                Tentatively
              </span>
              <span>Blocked by {match.tentativelyBlockedBy || "Admin"}</span>
            </div>
            <button
              onClick={async () => {
                if (!confirm("Remove tentative block and make this a regular match?")) return;
                try {
                  await store.updateMatch({ ...match, isTentative: false, tentativelyBlockedBy: "" });
                } catch (err) {
                  console.error("Failed to unblock", err);
                }
              }}
              className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 text-[9px] font-bold uppercase tracking-widest px-3 py-1.5 rounded border border-orange-500/30 transition whitespace-nowrap"
            >
              Unblock
            </button>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 flex-wrap mb-1">
          <h2 className="text-xl font-bold">vs {match.opponent}</h2>
          {isAdmin && canArchive && (
            <label className="flex items-center gap-2 cursor-pointer bg-white/5 border border-glass-border px-3 py-1.5 rounded-lg hover:bg-white/10 transition">
              <input
                type="checkbox"
                checked={!!match.isArchived}
                onChange={async (e) => {
                  try {
                    await store.updateMatch({ ...match, isArchived: e.target.checked });
                  } catch(err) {
                    console.error("Failed to update archive status", err);
                  }
                }}
                className="accent-accent"
              />
              <span className="text-xs font-bold uppercase tracking-wider text-white/70">Archived</span>
            </label>
          )}
        </div>

        <div className="flex gap-3 text-sm text-white/60 mb-4 font-mono flex-wrap items-center">
          <span>{formatDate(match.date)}</span>
          <span>•</span>
          <span>
            {match.format} {match.matchType}
          </span>
          <span>•</span>
          <span className="text-accent font-bold">Fee: ₹{match.fee}</span>
          {match.isGroundFeePaid && (
              <>
                  <span>•</span>
                  <span className="text-[10px] font-bold tracking-widest uppercase text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Ground Fee Paid (₹{match.groundFeePaidAmount})
                  </span>
              </>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-white/5 border border-glass-border rounded-lg p-3 text-center">
            <p className="text-3xl font-light">{played}</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-white/50 mt-1">
              Playing
            </p>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
            <p className="text-3xl font-light text-accent">{paid}</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-400/70 mt-1">
              Paid
            </p>
          </div>
          {(isAdmin || (!isAdmin && myPayment?.status === "Unpaid")) && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center">
              <p className="text-3xl font-light text-red-400">{unpaid}</p>
              <p className="text-[9px] font-bold uppercase tracking-widest text-red-400/70 mt-1">
                Unpaid
              </p>
            </div>
          )}
        </div>

        {(match.matchUrl ||
          match.streamingUrl ||
          (match.result && match.result !== "Pending")) && (
          <div className="bg-white/5 border border-glass-border rounded-xl p-4 mb-4">
            <h4 className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-3">
              Match Details
            </h4>

            {(match.matchUrl || match.streamingUrl) && (
              <div className="flex flex-wrap gap-4 mb-4">
                {match.matchUrl && (
                  <a
                    href={match.matchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 transition flex items-center gap-1 font-bold"
                  >
                    <span>🔗</span> View Match Center
                  </a>
                )}
                {match.streamingUrl && (
                  <a
                    href={match.streamingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-red-400 hover:text-red-300 transition flex items-center gap-1 font-bold"
                  >
                    <span>▶️</span> Watch Live Stream
                  </a>
                )}
              </div>
            )}

            {match.result && match.result !== "Pending" && (
              <div className="pt-3 border-t border-glass-border">
                <p
                  className={`font-bold text-sm mb-3 ${match.result === "KAvach Won" ? "text-accent" : match.result === "KAvach Lost" ? "text-red-400" : "text-white/60"}`}
                >
                  Result: {match.result}{" "}
                  {match.resultMarginAmount
                    ? `by ${match.resultMarginAmount} ${match.resultMarginType === "wickets" ? "wickets" : "runs"}`
                    : ""}
                </p>
                {match.result === "KAvach Won" &&
                  (match.potmId || match.playerOfTheMatch ||
                    match.bestBatsman ||
                    match.bestBowler || (match.topPerformerIds && match.topPerformerIds.length > 0)) && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {(match.potmId || match.playerOfTheMatch) && (
                        <div className="bg-black/20 p-2 rounded-lg border border-glass-border">
                          <span className="text-white/40 font-mono text-[10px] block mb-0.5">
                            POTM
                          </span>
                          <span className="font-bold text-xs">
                            {match.potmId ? store.players.find(p => p.id === match.potmId)?.name : match.playerOfTheMatch}
                          </span>
                        </div>
                      )}
                      {match.bestBatsman && (
                        <div className="bg-black/20 p-2 rounded-lg border border-glass-border">
                          <span className="text-white/40 font-mono text-[10px] block mb-0.5">
                            BEST BATSMAN
                          </span>
                          <span className="font-bold text-xs">
                            {match.bestBatsman}
                          </span>
                        </div>
                      )}
                      {match.bestBowler && (
                        <div className="bg-black/20 p-2 rounded-lg border border-glass-border">
                          <span className="text-white/40 font-mono text-[10px] block mb-0.5">
                            BEST BOWLER
                          </span>
                          <span className="font-bold text-xs">
                            {match.bestBowler}
                          </span>
                        </div>
                      )}
                      {match.topPerformerIds && match.topPerformerIds.length > 0 && (
                        <div className="sm:col-span-3 bg-black/20 p-2 rounded-lg border border-glass-border">
                          <span className="text-white/40 font-mono text-[10px] block mb-0.5">
                            TOP PERFORMERS
                          </span>
                          <span className="font-bold text-xs text-emerald-400">
                            {match.topPerformerIds.map(id => store.players.find(p => p.id === id)?.name).filter(Boolean).join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const groundName = store.grounds.find((g) => g.id === match.groundId)?.name || 'Unknown Ground';
                      let text = `*Match Result*\n${formatDate(match.date)} | ${match.matchType} | ${groundName}\n\nKAvach vs ${match.opponent}\n*Result:* ${match.result}`;
                      if (match.result === "KAvach Won" || match.result === "KAvach Lost") {
                        if (match.resultMarginAmount) {
                          text += ` by ${match.resultMarginAmount} ${match.resultMarginType === "wickets" ? "wickets" : "runs"}\n`;
                        } else {
                          text += `\n`;
                        }
                      } else {
                        text += `\n`;
                      }
                      const potmStr = match.potmId ? store.players.find(p => p.id === match.potmId)?.name : match.playerOfTheMatch;
                      if (potmStr) text += `*MVP:* ${potmStr}\n`;
                      if (match.bestBatsman) text += `*Best Batsman:* ${match.bestBatsman}\n`;
                      if (match.bestBowler) text += `*Best Bowler:* ${match.bestBowler}\n`;
                      if (match.topPerformerIds && match.topPerformerIds.length > 0) {
                        const tpStr = match.topPerformerIds.map(id => store.players.find(p => p.id === id)?.name).filter(Boolean).join(", ");
                        if (tpStr) text += `*Top Performers:* ${tpStr}\n`;
                      }
                      navigator.clipboard.writeText(text);
                      alert("WhatsApp Report Copied to Clipboard!");
                    }}
                    className="mt-4 w-full flex justify-center items-center gap-2 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition border border-emerald-500/30 text-[10px] font-bold uppercase tracking-widest px-3 py-3 rounded-xl"
                  >
                    Share Result on WhatsApp
                  </button>

              </div>
            )}
          </div>
        )}

        {isAdmin && (
          <div className="mt-4 mb-4 text-center text-[13px] text-white/70">
            Collected:{" "}
            <span className="font-mono text-accent font-bold text-[15px]">
              ₹{totalCollected}
            </span>{" "}
            <span className="opacity-50">/ ₹{totalExpected}</span>
          </div>
        )}

        {(() => {
            const ground = store.grounds.find((g) => g.id === match.groundId);
            if (!ground) return null;
            return (
              <div className="mt-4 pt-4 border-t border-glass-border">
                <a
                  href={ground.mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition group"
                >
                  <MapPin className="w-4 h-4 text-accent shrink-0" />
                  <span className="group-hover:underline truncate">
                    {ground.name}
                  </span>
                  <span className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded font-bold uppercase ml-auto shrink-0 border border-accent/20">
                    Get Directions
                  </span>
                </a>
                <p className="text-[10px] text-white/40 mt-2 font-mono uppercase tracking-widest pl-6">
                  Approx time to reach if you start now: 35-45 mins
                </p>
              </div>
            );
          })()}
      </div>

      {!isAdmin &&
        myPayment?.status === "Unpaid" && (() => {
          const myFee = getPlayerFee(myPayment);
          return (
            <div className="glass rounded-xl p-6 text-center space-y-4">
              <h3 className="text-lg font-bold">Your Match Fee is Pending</h3>
              <p className="text-accent text-3xl font-light font-mono">
                ₹{myFee}
              </p>
              {myPayment.planTag && (
                <p className="text-[10px] text-amber-400 font-bold uppercase tracking-widest">
                  {myPayment.planTag}
                </p>
              )}
              <button
                disabled={isProcessingPayment}
                onClick={handlePaySecure}
                className="w-full bg-accent text-black font-bold py-3 rounded-lg hover:bg-accent/90 disabled:opacity-50 transition shadow-lg flex items-center justify-center gap-2"
              >
                {isProcessingPayment ? "Processing..." : `Pay ₹${myFee} Securely`}
              </button>
              <p className="text-[10px] text-white/50 uppercase tracking-widest">
                Settle your dues before the match
              </p>
            </div>
          );
        })()}

      {!isAdmin && mePlayer && store.appConfig?.matchConfiguration?.enablePlayerAvailability && (
        <div className="glass rounded-xl p-4 text-center mt-4">
          {myPayment && myPayment.status === "Not Playing" && (
            <p className="text-white/70 text-sm mb-4">
              You are not marked to play this match.
            </p>
          )}
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/70 mb-3">
            {(() => {
              const matchDateParts = dbToInputDate(match.date).split("/");
              let matchDateObj = new Date();
              if (matchDateParts.length === 3) {
                matchDateObj = new Date(
                  parseInt(matchDateParts[2]),
                  parseInt(matchDateParts[1]) - 1,
                  parseInt(matchDateParts[0]),
                );
              } else {
                matchDateObj = new Date(match.date);
              }
              const isPast =
                matchDateObj.getTime() < new Date().getTime() ||
                (match.result && match.result !== "Pending");

              if (isPast) return "Did you play this match?";
              return myPayment && myPayment.status !== "Not Playing"
                ? "Mark Your Availability"
                : "Mark Your Availability Anyway";
            })()}
          </h3>
          <div className="flex gap-2">
            {(() => {
              const matchDateParts = dbToInputDate(match.date).split("/");
              let matchDateObj = new Date();
              if (matchDateParts.length === 3) {
                matchDateObj = new Date(
                  parseInt(matchDateParts[2]),
                  parseInt(matchDateParts[1]) - 1,
                  parseInt(matchDateParts[0]),
                );
              } else {
                matchDateObj = new Date(match.date);
              }
              const isPast =
                matchDateObj.getTime() < new Date().getTime() ||
                (match.result && match.result !== "Pending");
              const options = ["Yes", "No"];

              return options.map((avStat) => {
                let effectiveAvailability = myPayment?.availability;
                if (effectiveAvailability === "Pending" || !effectiveAvailability) {
                  if (myPayment && myPayment.status === "Not Playing") effectiveAvailability = "Unmarked" as any;
                  else effectiveAvailability = "Yes";
                }
                if (effectiveAvailability === "Confirmed" || effectiveAvailability === "Waitlist" || effectiveAvailability === "Tentative") {
                  if (myPayment && myPayment.status !== "Not Playing") effectiveAvailability = "Yes";
                  else effectiveAvailability = "No";
                }

                const isSelected = effectiveAvailability === avStat;
                return (
                  <button
                    key={avStat}
                    onClick={async () => {
                      let finalAvStat = avStat as any;

                      if (myPayment) {
                        await store.updateMatchAvailability(
                          myPayment.id,
                          finalAvStat,
                          match.id,
                        );
                        if (
                          finalAvStat === "Yes" &&
                          myPayment.status === "Not Playing"
                        ) {
                          await store.updatePaymentStatus(
                            myPayment.id,
                            "Unpaid",
                            match.id,
                          );
                        } else if (
                          finalAvStat === "No" &&
                          myPayment.status === "Unpaid"
                        ) {
                          await store.updatePaymentStatus(
                            myPayment.id,
                            "Not Playing",
                            match.id,
                          );
                        }
                      } else {
                        await store.addPaymentWithAvailability(
                          match.id,
                          mePlayer.id,
                          finalAvStat,
                        );
                      }
                    }}
                    className={`flex-1 py-2 rounded-lg font-bold text-sm border transition ${isSelected ? (avStat === "Yes" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]" : avStat === "No" ? "bg-red-500/20 text-red-500 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]" : "bg-amber-500/20 text-amber-500 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]") : "bg-transparent text-white border-glass-border hover:bg-white/5"}`}
                  >
                    {avStat}
                  </button>
                );
              });
            })()}
          </div>
        </div>
      )}

      {!isAdmin && !mePlayer && store.appConfig?.matchConfiguration?.enablePlayerAvailability && (
        <div className="glass rounded-xl p-4 text-center mt-4 border border-red-500/20">
          <p className="text-white/70 text-sm mb-2">
            You need to complete your player profile in the Account tab or ask
            an admin to link your profile before you can mark your availability.
          </p>
        </div>
      )}

      {store.appConfig?.matchConfiguration?.enablePlayerAvailability && (
        <div className="glass sm:rounded-xl overflow-hidden -mx-4 sm:mx-0 pr-[calc(env(safe-area-inset-right))] pl-[calc(env(safe-area-inset-left))] mt-4 mb-4">
          <div className="px-4 py-3 bg-white/5 border-b border-glass-border font-bold text-[12px] uppercase tracking-widest text-white/80">
            Player Availability
          </div>

        <div className="p-4 space-y-4">
          {["Yes", "No"].map((avStat) => {
            const paymentsInStat = matchPayments.filter((pay) => {
              let effectiveAvailability = pay?.availability;
              
              if (!effectiveAvailability || effectiveAvailability === "Pending" || effectiveAvailability === "Confirmed" || effectiveAvailability === "Waitlist" || effectiveAvailability === "Tentative") {
                if (pay.status !== "Not Playing") {
                  effectiveAvailability = "Yes";
                } else {
                  return false; // Skip if not explicitly marked No
                }
              }
              
              return effectiveAvailability === avStat;
            });

            if (paymentsInStat.length === 0) return null;

            return (
              <div key={avStat}>
                <h4
                  className={`text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center gap-2 ${avStat === "Yes" ? "text-emerald-400" : "text-red-400"}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${avStat === "Yes" ? "bg-emerald-400" : "bg-red-400"}`}
                  />
                  {avStat} ({paymentsInStat.length})
                </h4>
                <div className="flex flex-wrap gap-2 text-sm text-white/80">
                  {paymentsInStat.map((payment) => {
                    const p = store.players.find(pl => pl.id === payment.playerId);
                    if (!p) return null;
                    const isPaid = payment.status === "Paid";
                    return (
                      <span
                        key={payment.id}
                        className={`bg-white/5 border px-2 py-1 rounded inline-flex items-center gap-1.5 max-w-[250px] ${isPaid ? "border-emerald-500/30" : "border-glass-border"}`}
                      >
                        <span className="truncate flex items-center gap-1">
                          {payment.guestName || p.name}
                          {isPaid && <span className="text-[9px] uppercase tracking-widest text-emerald-400 font-bold ml-1">Paid</span>}
                        </span>
                        {isAdmin && (
                          <select
                            value={avStat}
                            onChange={async (e) => {
                              const newAv = e.target.value as any;
                              await store.updateMatchAvailability(
                                payment.id,
                                newAv,
                                match.id,
                              );
                              if (
                                newAv === "Yes" &&
                                payment.status === "Not Playing"
                              ) {
                                await store.updatePaymentStatus(
                                  payment.id,
                                  "Unpaid",
                                  match.id,
                                );
                              } else if (
                                newAv === "No" &&
                                payment.status === "Unpaid"
                              ) {
                                await store.updatePaymentStatus(
                                  payment.id,
                                  "Not Playing",
                                  match.id,
                                );
                              }
                            }}
                            className="text-[9px] uppercase font-bold bg-transparent text-white/50 hover:text-white border-none outline-none cursor-pointer [&>option]:bg-emerald-950 appearance-none text-right"
                          >
                            <option value="Yes">Yes</option>
                            <option value="No">No</option>
                          </select>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {isAdmin && (
        <div className="glass sm:rounded-xl overflow-hidden -mx-4 sm:mx-0 pr-[calc(env(safe-area-inset-right))] pl-[calc(env(safe-area-inset-left))]">
          <div className="px-4 py-3 bg-white/5 border-b border-glass-border font-bold text-[12px] uppercase tracking-widest text-white/80 flex items-center justify-between">
            <span>Squad & Payments</span>
            {isAdmin && (
              <button
                onClick={() => setAddingSquad(!addingSquad)}
                className="text-accent underline hover:text-accent/80 text-[10px]"
              >
                + Add Player
              </button>
            )}
          </div>

          {isAdmin && addingSquad && (
            <form
              onSubmit={handleAddToSquad}
              className="p-4 bg-white/5 border-b border-glass-border space-y-3"
            >
              <div className="flex bg-black/40 rounded-lg p-1 border border-glass-border mb-3">
                <button
                  type="button"
                  onClick={() => setAddingNew(false)}
                  className={`flex-1 text-[11px] font-bold uppercase py-1.5 rounded-md transition ${!addingNew ? "bg-white/10 text-white" : "text-white/50"}`}
                >
                  Existing
                </button>
                <button
                  type="button"
                  onClick={() => setAddingNew(true)}
                  className={`flex-1 text-[11px] font-bold uppercase py-1.5 rounded-md transition ${addingNew ? "bg-white/10 text-white" : "text-white/50"}`}
                >
                  New
                </button>
              </div>

              {!addingNew ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                    <input
                      type="text"
                      placeholder="Search players..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 rounded-md border border-glass-border bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1 border border-glass-border rounded-md p-1 bg-black/20 custom-scrollbar">
                    {filteredPlayers.length === 0 ? (
                      <p className="text-center text-[10px] uppercase tracking-widest text-white/50 py-3">
                        No players found
                      </p>
                    ) : (
                      filteredPlayers.map((p) => (
                        <label
                          key={p.id}
                          className={`flex items-center gap-2 p-2 rounded cursor-pointer ${selectedPlayerIds.includes(p.id) ? "bg-accent/10 border-accent/50" : "hover:bg-white/5 border-transparent"} border transition`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedPlayerIds.includes(p.id)}
                            onChange={(e) => {
                              if (e.target.checked)
                                setSelectedPlayerIds((prev) => [...prev, p.id]);
                              else
                                setSelectedPlayerIds((prev) =>
                                  prev.filter((id) => id !== p.id),
                                );
                            }}
                            className="hidden"
                          />
                          <div
                            className={`w-4 h-4 rounded shrink-0 flex items-center justify-center border transition ${selectedPlayerIds.includes(p.id) ? "bg-accent border-accent text-black" : "border-glass-border"}`}
                          >
                            {selectedPlayerIds.includes(p.id) && (
                              <Check className="w-3 h-3" />
                            )}
                          </div>
                          <span className="text-sm font-medium">
                            {p.name}{" "}
                            {p.mobile && (
                              <span className="text-[10px] text-white/50 font-mono inline-block ml-1">
                                ({p.mobile})
                              </span>
                            )}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
                      Name
                    </label>
                    <input
                      required
                      type="text"
                      value={newPlayerName}
                      onChange={(e) => setNewPlayerName(e.target.value)}
                      className="w-full rounded-md border border-glass-border bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
                      Mobile
                    </label>
                    <input
                      required
                      type="tel"
                      value={newPlayerMobile}
                      onChange={(e) => setNewPlayerMobile(e.target.value)}
                      className="w-full rounded-md border border-glass-border bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <button
                disabled={
                  isSubmitting || (!addingNew && selectedPlayerIds.length === 0)
                }
                type="submit"
                className={`w-full ${confirmSquadDuplicates ? "bg-red-500 text-white" : "bg-accent text-black"} font-bold text-sm py-2 rounded shadow transition disabled:opacity-50`}
              >
                {isSubmitting
                  ? "Adding..."
                  : confirmSquadDuplicates
                  ? "Confirm Guest Assignment"
                  : "Add to Squad"}
              </button>
            </form>
          )}

          <div className="divide-y divide-glass-border">
            {matchPayments.map((payment) => {
              const player = store.players.find(p => p.id === payment.playerId);
              if (!player || payment.status === "Not Playing") return null;

              const playerPlans = (player.feePlanIds || [])
                .map((id: string) => store.feePlans.find((fp: FeePlan) => fp.id === id))
                .filter((fp): fp is FeePlan => !!fp && fp.isActive !== false);
              const fee = getPlayerFee(payment);
              const hasOverride = payment.feeOverride !== undefined;

              return (
                <div
                  key={payment.id}
                  className="p-4 flex flex-col gap-2 hover:bg-white/5 transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">
                        {payment.guestName || player.name}
                        {mePlayer && player.id === mePlayer.id && !payment.guestName && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-accent/20 text-accent text-[10px] font-bold uppercase">
                            You
                          </span>
                        )}
                        {hasOverride && (
                          <span className="ml-2 font-mono text-[11px] text-amber-400">
                            ₹{fee}
                          </span>
                        )}
                      </p>
                      {isAdmin && (
                        <p className="text-xs font-mono text-white/50 mt-0.5">
                          {player.mobile}
                        </p>
                      )}
                      {payment.planTag && (
                        <p className="text-[10px] text-amber-400/80 font-bold uppercase tracking-wider mt-0.5">
                          {payment.planTag}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      {isAdmin ? (
                        <>
                          <select
                            value={payment.status}
                            onChange={(e) =>
                              store.updatePaymentStatus(
                                payment.id,
                                e.target.value as any,
                                match.id,
                                undefined,
                                e.target.value === "Paid" ? "manual" : undefined,
                                e.target.value === "Paid" ? (appUser?.name || "Admin") : undefined,
                              )
                            }
                            className={`text-[12px] font-bold uppercase tracking-widest rounded-md border py-2 px-2 focus:outline-none ${
                              payment.status === "Paid"
                                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                                : payment.status === "Unpaid"
                                  ? "bg-red-500/20 text-red-400 border-red-500/30"
                                  : "bg-white/5 text-white/70 border-glass-border [&>option]:bg-emerald-950"
                            }`}
                          >
                            <option value="Not Playing">Out</option>
                            <option value="Unpaid">Unpaid</option>
                            <option value="Paid">Paid</option>
                          </select>

                          {payment.status === "Unpaid" && (
                            <button
                              onClick={() =>
                                store.notifyPlayerPayment(player.id, match.id)
                              }
                              className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 font-bold text-[9px] uppercase tracking-widest px-2 py-1 rounded transition whitespace-nowrap ml-2 h-[34px]"
                              title="Send WhatsApp Reminder"
                            >
                              Remind
                            </button>
                          )}
                        </>
                      ) : (
                        <span
                          className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border ${
                            payment.status === "Paid"
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : "bg-red-500/20 text-red-400 border-red-500/30"
                          }`}
                        >
                          {payment.status}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Admin fee actions: plan quick-apply, change fee payer, undo */}
                  {isAdmin && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {/* Plan quick-apply for unpaid players without override */}
                      {payment.status === "Unpaid" && !hasOverride && playerPlans.map((plan: FeePlan) => {
                        if (plan.type === "fixed") {
                          return (
                            <button
                              key={plan.id}
                              onClick={() =>
                                store.applyFeePlanToPayment(
                                  match.id,
                                  payment.id,
                                  plan.feeAmount ?? match.fee,
                                  plan.name,
                                )
                              }
                              className="text-[9px] font-bold uppercase tracking-widest bg-amber-500/15 text-amber-400 border border-amber-500/25 px-2 py-1 rounded hover:bg-amber-500/25 transition"
                            >
                              {plan.name} (₹{plan.feeAmount})
                            </button>
                          );
                        }
                        if (plan.type === "sponsored") {
                          return (
                            <button
                              key={plan.id}
                              onClick={() =>
                                store.applyFeePlanToPayment(
                                  match.id,
                                  payment.id,
                                  0,
                                  plan.name,
                                )
                              }
                              className="text-[9px] font-bold uppercase tracking-widest bg-green-500/15 text-green-400 border border-green-500/25 px-2 py-1 rounded hover:bg-green-500/25 transition"
                            >
                              {plan.name} (₹0)
                            </button>
                          );
                        }
                        if (plan.type === "monthly") {
                          return (
                            <button
                              key={plan.id}
                              onClick={() =>
                                store.applyFeePlanToPayment(
                                  match.id,
                                  payment.id,
                                  0,
                                  `${plan.name} (Subscription)`,
                                )
                              }
                              className="text-[9px] font-bold uppercase tracking-widest bg-blue-500/15 text-blue-400 border border-blue-500/25 px-2 py-1 rounded hover:bg-blue-500/25 transition"
                            >
                              {plan.name} (Sub ₹{plan.monthlyAmount}/mo)
                            </button>
                          );
                        }
                        return null;
                      })}

                      {/* Universal: Change Fee Payer (sponsorship) */}
                      {payment.status === "Unpaid" && !payment.sponsoredBy && (
                        <button
                          onClick={() => setFeePayerPicker({ paymentId: payment.id, playerName: player.name, fee, search: "" })}
                          className="text-[9px] font-bold uppercase tracking-widest bg-purple-500/15 text-purple-400 border border-purple-500/25 px-2 py-1 rounded hover:bg-purple-500/25 transition flex items-center gap-1"
                        >
                          <ArrowRightLeft className="w-3 h-3" />
                          Change Fee Payer
                        </button>
                      )}

                      {/* Undo fee override */}
                      {hasOverride && (
                        <button
                          onClick={() => {
                            if (!confirm(`Reset ${player.name}'s fee back to standard ₹${match.fee}?`)) return;
                            store.clearFeeOverride(match.id, payment.id);
                          }}
                          className="text-[9px] font-bold uppercase tracking-widest bg-white/10 text-white/60 border border-white/15 px-2 py-1 rounded hover:bg-white/20 hover:text-white transition flex items-center gap-1"
                        >
                          <Undo2 className="w-3 h-3" />
                          Reset Fee
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Fee Payer Picker Modal */}
      {feePayerPicker && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setFeePayerPicker(null)}
        >
          <div
            className="w-full max-w-sm bg-[#0f172a] rounded-xl border border-purple-500/30 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-glass-border flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-sm">Change Fee Payer</h3>
                <p className="text-[10px] text-white/50 mt-0.5">
                  Who will pay <span className="text-purple-400 font-bold">{feePayerPicker.playerName}</span>&apos;s fee of ₹{feePayerPicker.fee}?
                </p>
              </div>
              <button onClick={() => setFeePayerPicker(null)} className="p-1.5 hover:bg-white/10 rounded-full transition">
                <X className="w-4 h-4 text-white/50" />
              </button>
            </div>
            <div className="p-3">
              <input
                type="text"
                placeholder="Search members..."
                value={feePayerPicker.search}
                onChange={(e) => setFeePayerPicker({ ...feePayerPicker, search: e.target.value })}
                className="w-full bg-white/5 border border-glass-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500/50 mb-2"
                autoFocus
              />
              <div className="max-h-[280px] overflow-y-auto custom-scrollbar space-y-1">
                {store.players
                  .filter((pl) => {
                    const payment = matchPayments.find((mp) => mp.playerId === pl.id);
                    const sourcePayment = matchPayments.find((mp) => mp.id === feePayerPicker.paymentId);
                    if (!sourcePayment || pl.id === sourcePayment.playerId) return false;
                    if (pl.disabled) return false;
                    if (feePayerPicker.search) {
                      return pl.name.toLowerCase().includes(feePayerPicker.search.toLowerCase());
                    }
                    return true;
                  })
                  .sort((a, b) => {
                    const aInMatch = matchPayments.some((mp) => mp.playerId === a.id && mp.status !== "Not Playing");
                    const bInMatch = matchPayments.some((mp) => mp.playerId === b.id && mp.status !== "Not Playing");
                    if (aInMatch && !bInMatch) return -1;
                    if (!aInMatch && bInMatch) return 1;
                    return a.name.localeCompare(b.name);
                  })
                  .map((pl) => {
                    const inMatch = matchPayments.some((mp) => mp.playerId === pl.id && mp.status !== "Not Playing");
                    return (
                      <button
                        key={pl.id}
                        onClick={() => {
                          const sourcePayment = matchPayments.find((mp) => mp.id === feePayerPicker.paymentId);
                          if (!sourcePayment) return;
                          const sourcePlayer = store.players.find((p) => p.id === sourcePayment.playerId);
                          store.assignProxyPayment(
                            match.id,
                            feePayerPicker.paymentId,
                            sourcePlayer?.name || feePayerPicker.playerName,
                            pl.id,
                            pl.name,
                            feePayerPicker.fee,
                            match.fee,
                          );
                          setFeePayerPicker(null);
                        }}
                        className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-purple-500/15 transition flex items-center justify-between group"
                      >
                        <div>
                          <span className="text-sm font-semibold text-white group-hover:text-purple-300 transition">{pl.name}</span>
                          {inMatch && (
                            <span className="ml-2 text-[9px] font-bold uppercase tracking-widest text-emerald-400/70 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                              In Match
                            </span>
                          )}
                        </div>
                        <ArrowRightLeft className="w-3.5 h-3.5 text-purple-400/0 group-hover:text-purple-400/100 transition" />
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Match Comments Section */}
      <div className="glass sm:rounded-xl overflow-hidden -mx-4 sm:mx-0 pr-[calc(env(safe-area-inset-right))] pl-[calc(env(safe-area-inset-left))] mt-4">
        <div className="px-4 py-3 bg-white/5 border-b border-glass-border font-bold text-[12px] uppercase tracking-widest text-white/80 flex items-center gap-2">
          <MessageSquare className="w-4 h-4" /> Discussion
        </div>

        <div className="p-4 space-y-4 max-h-[300px] overflow-y-auto custom-scrollbar">
          {comments.length === 0 ? (
            <div className="text-center text-xs text-white/40 italic py-4">
              No comments yet. Start the discussion!
            </div>
          ) : (
            comments.map((comment) => (
              <div
                key={comment.id}
                className={`flex flex-col ${comment.playerId === user?.uid ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2 ${comment.playerId === user?.uid ? "bg-accent text-black rounded-tr-sm" : "bg-white/10 text-white rounded-tl-sm"}`}
                >
                  <div className="flex justify-between items-baseline gap-3 mb-1">
                    <span className="text-[10px] font-bold opacity-70 truncate">
                      {comment.playerId === user?.uid
                        ? "You"
                        : comment.playerName}
                    </span>
                    <span className="text-[9px] opacity-50 shrink-0">
                      {comment.createdAt?.seconds
                        ? new Date(
                            comment.createdAt.seconds * 1000,
                          ).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "..."}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap break-words leading-snug">
                    {comment.text}
                  </p>
                </div>
                {(isAdmin || comment.playerId === user?.uid) && (
                  <button
                    onClick={() => handleDeleteComment(comment.id)}
                    className="text-[10px] text-white/40 hover:text-red-400 font-bold uppercase tracking-widest mt-1 mr-1 ml-1 transition"
                  >
                    Delete
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <form
          onSubmit={handlePostComment}
          className="p-3 bg-black/20 border-t border-glass-border flex gap-2"
        >
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Discuss logistics, rides..."
            className="flex-1 bg-white/5 border border-glass-border rounded-full px-4 py-2 text-sm text-white focus:outline-none focus:border-accent transition"
            maxLength={1000}
          />
          <button
            type="submit"
            disabled={!newComment.trim() || isSubmittingComment}
            className="bg-accent text-black px-4 py-2 rounded-full font-bold text-sm hover:bg-accent/90 transition disabled:opacity-50 shrink-0 flex items-center justify-center min-w-[70px]"
          >
            {isSubmittingComment ? "..." : "Send"}
          </button>
        </form>
      </div>

      {/* Group Remind Modal */}
      {isGroupRemindModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0f172a] border border-glass-border rounded-xl w-full max-w-sm p-4 relative shadow-2xl animate-fade-in">
            <button
              onClick={() => setIsGroupRemindModalOpen(false)}
              className="absolute top-4 right-4 text-white/50 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-400 mb-2 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Remind Group
            </h3>
            <p className="text-xs text-white/60 mb-4 leading-relaxed">
              This will open WhatsApp with the match details and squad list. You can select your club's WhatsApp group to send the message.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 block mb-1">
                  Optional Custom Message
                </label>
                <textarea
                  value={groupRemindCustomMsg}
                  onChange={(e) => setGroupRemindCustomMsg(e.target.value)}
                  className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50 text-white placeholder-white/30"
                  placeholder="e.g., Please reach 15 mins early!"
                  rows={3}
                />
              </div>
              <button
                onClick={handleGroupRemind}
                className="w-full bg-emerald-500 text-black font-bold py-2.5 rounded-lg hover:bg-emerald-400 transition shadow flex items-center justify-center gap-2"
              >
                Continue to WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function AssignMatchAdmin({ store }: { store: ReturnType<typeof useStore> }) {
  const [selectedMatch, setSelectedMatch] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [searchPlayer, setSearchPlayer] = useState("");

  const filteredPlayers = store.players.filter(
    (p) =>
      !p.disabled &&
      p.inviteStatus !== "Rejected" &&
      p.inviteStatus !== "Pending" &&
      (p.name.toLowerCase().includes(searchPlayer.toLowerCase()) ||
        p.mobile?.includes(searchPlayer)),
  );

  const togglePlayer = (id: string) => {
    if (selectedPlayers.includes(id)) {
      setSelectedPlayers((prev) => prev.filter((pid) => pid !== id));
    } else {
      setSelectedPlayers((prev) => [...prev, id]);
    }
  };

  const [confirmDuplicates, setConfirmDuplicates] = useState(false);
  const [guestNames, setGuestNames] = useState<Record<string, string>>({});

  const handleAssignMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMatch || selectedPlayers.length === 0) return;

    // Check duplicacy
    const matchPayments = store.payments.filter(
      (p) => p.matchId === selectedMatch && p.status !== "Not Playing",
    );
    const duplicates = selectedPlayers.filter((pid) =>
      matchPayments.some((mp) => mp.playerId === pid),
    );
    if (duplicates.length > 0 && !confirmDuplicates) {
      setConfirmDuplicates(true);
      return;
    }

    try {
      for (const pId of selectedPlayers) {
        const existingPayments = matchPayments.filter(
          (p) => p.playerId === pId
        );
        
        if (existingPayments.length > 0) {
          const gName = guestNames[pId];
          const hostPlayer = store.players.find(p => p.id === pId);
          const fullGuestName = gName?.trim() && hostPlayer ? `${gName.trim()} (Guest of ${hostPlayer.name})` : undefined;
          await store.addPaymentStatus(selectedMatch, pId, "Unpaid", "Yes", fullGuestName || `Guest of ${hostPlayer?.name || 'Player'}`);
        } else {
          const notPlayingPayment = store.payments.find(
             (p) => p.playerId === pId && p.matchId === selectedMatch && p.status === "Not Playing"
          );
          if (notPlayingPayment) {
            await store.updatePaymentStatus(notPlayingPayment.id, "Unpaid", selectedMatch, "Yes");
          } else {
            await store.addPaymentStatus(selectedMatch, pId, "Unpaid", "Yes");
          }
        }
      }
      setSelectedPlayers([]);
      setConfirmDuplicates(false);
      setGuestNames({});
    } catch (err) {
      console.error("Assign Error:", err);
    }
  };

  return (
    <div className="glass rounded-xl p-5 border border-glass-border">
      <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent mb-4">
        Assign Players to Match Squad
      </h3>
      <form onSubmit={handleAssignMatch} className="space-y-4">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">
            Select Match
          </label>
          <select
            value={selectedMatch}
            onChange={(e) => {
              setSelectedMatch(e.target.value);
              setConfirmDuplicates(false);
            }}
            className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white"
            required
          >
            <option value="">-- Choose a Match --</option>
            {[...store.matches]
              .sort(
                (a, b) =>
                  new Date(b.date).getTime() - new Date(a.date).getTime(),
              )
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.opponent} ({m.date}) - ₹{m.fee}
                </option>
              ))}
          </select>
        </div>

        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-white/50">
              Select Players ({selectedPlayers.length} selected)
            </label>
            <button
              type="button"
              onClick={() =>
                setSelectedPlayers(
                  selectedPlayers.length === filteredPlayers.length
                    ? []
                    : filteredPlayers.map((p) => p.id),
                )
              }
              className="text-accent text-[10px] uppercase font-bold tracking-wider hover:underline"
            >
              {selectedPlayers.length === filteredPlayers.length &&
              filteredPlayers.length > 0
                ? "Deselect All"
                : "Select All Filtered"}
            </button>
          </div>

          <input
            type="text"
            placeholder="Search players to assign..."
            value={searchPlayer}
            onChange={(e) => setSearchPlayer(e.target.value)}
            className="w-full bg-black/40 border border-glass-border rounded-t-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white mb-0"
          />

          <div className="h-40 overflow-y-auto border border-t-0 border-glass-border rounded-b-lg bg-black/20 p-2 gap-1 flex flex-col hide-scrollbar">
            {filteredPlayers.length === 0 && (
              <div className="text-xs text-white/40 italic p-2 text-center">
                No players found.
              </div>
            )}
            {filteredPlayers.map((p) => {
              const isAlreadyAssigned = selectedMatch
                ? store.payments.some(
                    (mp) =>
                      mp.matchId === selectedMatch &&
                      mp.playerId === p.id &&
                      mp.status !== "Not Playing",
                  )
                : false;
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-2 p-2 rounded cursor-pointer transition ${selectedPlayers.includes(p.id) ? "bg-accent/20 border border-accent/30 text-white" : "hover:bg-white/5 border border-transparent text-white/70"}`}
                >
                  <input
                    type="checkbox"
                    onChange={() => togglePlayer(p.id)}
                    checked={selectedPlayers.includes(p.id)}
                    className="accent-accent flex-shrink-0"
                  />
                  <span
                    className={`text-xs truncate font-medium flex items-center justify-between w-full p-0.5`}
                  >
                    <span className="truncate pr-2">
                      {p.name}{" "}
                      {p.mobile && (
                        <span className="opacity-50 text-[10px] ml-1">
                          ({p.mobile})
                        </span>
                      )}
                    </span>
                    {isAlreadyAssigned && (
                      <span className="text-[9px] uppercase tracking-widest text-accent bg-accent/10 px-1 py-0.5 rounded shrink-0">
                        Assigned
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {confirmDuplicates && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3 text-xs text-red-200 mt-2">
            <div>
              Some selected players are already assigned to this match. Are you
              sure you want to add them anyway? (e.g., for a guest)
            </div>
            {selectedPlayers.filter((pid) =>
              store.payments.some((mp) => mp.matchId === selectedMatch && mp.playerId === pid && mp.status !== "Not Playing")
            ).map(pid => {
              const p = store.players.find(p => p.id === pid);
              return (
                <div key={pid} className="flex items-center gap-2 mt-2">
                  <span className="flex-shrink-0 text-white w-24 truncate">{p?.name}</span>
                  <input 
                    type="text" 
                    placeholder="Guest Name (e.g., Rajeev)"
                    className="flex-1 bg-black/40 border border-red-500/50 rounded px-2 py-1 text-xs text-white"
                    value={guestNames[pid] || ""}
                    onChange={e => setGuestNames({...guestNames, [pid]: e.target.value})}
                  />
                </div>
              );
            })}
          </div>
        )}
        <button
          type="submit"
          disabled={!selectedMatch || selectedPlayers.length === 0}
          className={`w-full ${confirmDuplicates ? "bg-red-500 text-white" : "bg-accent text-black"} font-bold py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition shadow text-sm mt-2`}
        >
          {confirmDuplicates
            ? "Confirm Duplicate Assignment"
            : `Assign ${selectedPlayers.length} Player(s) to Match`}
        </button>
      </form>
    </div>
  );
}

interface MatchCalendarViewProps {
  store: ReturnType<typeof useStore>;
  matches: Match[];
  grounds: ReturnType<typeof useStore>["grounds"];
  isAdmin: boolean;
  onMatchClick: (match: Match) => void;
  onEditMatch?: (match: Match) => void;
  onAddMatch: (dateStr: string) => void;
  onDuplicateMatch?: (match: Match) => void;
  onDeleteMatch?: (match: Match) => void;
  matchToDelete?: string | null;
  onConfirmDelete?: (matchId: string) => void;
  onCancelDelete?: () => void;
}

export const MatchCalendarView: FC<MatchCalendarViewProps> = ({
  store,
  matches,
  grounds,
  isAdmin,
  onMatchClick,
  onEditMatch,
  onAddMatch,
  onDuplicateMatch,
  onDeleteMatch,
  matchToDelete,
  onConfirmDelete,
  onCancelDelete,
}) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const [isPastCollapsed, setIsPastCollapsed] = useSessionState(
    "matches:calendar:isPastCollapsed",
    true,
  );
  const [filterGround, setFilterGround] = useSessionState<string>(
    "matches:calendar:filterGround",
    "all",
  );
  const [filterOpenSlots, setFilterOpenSlots] = useSessionState<boolean>(
    "matches:calendar:filterOpenSlots",
    false,
  );

  const getMatchDateObj = (match: Match) => {
    const parts = dbToInputDate(match.date).split("/");
    let d = new Date();
    if (parts.length === 3) {
      d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    } else {
      d = new Date(match.date);
    }
    if (match.time) {
      const [hours, mins] = match.time.split(":");
      d.setHours(parseInt(hours, 10) || 23, parseInt(mins, 10) || 59, 59, 999);
    } else {
      d.setHours(23, 59, 59, 999);
    }
    return d;
  };

  const { pastCalendarData, upcomingCalendarData } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Admins still need to edit recent match cards for a while after the
    // game (result, POTM, stats, fee assignments). Anchor the past /
    // upcoming split 10 days back so recent matches keep showing up in
    // the main calendar area instead of collapsing into Past Matches.
    const pastCutoff = new Date(today);
    pastCutoff.setDate(pastCutoff.getDate() - 10);

    const upcomingStart = new Date(pastCutoff);
    const currentDay = upcomingStart.getDay();
    const dist = currentDay === 0 ? 6 : currentDay - 1; // get to monday
    upcomingStart.setDate(upcomingStart.getDate() - dist);

    const upcomingEnd = new Date(today);
    upcomingEnd.setMonth(upcomingEnd.getMonth() + 8);

    const nonArchivedMatches = matches.filter(m => !m.isArchived).filter(m => {
       if (filterGround !== "all" && m.groundId !== filterGround) return false;
       return true;
    });

    const isMatchOpen = (m: Match) => m.format === "Other" || m.opponent === "TBD" || m.opponent.toLowerCase().includes("open") || m.format.toLowerCase().includes("open");

    // Compute earliest past match (older than the 10-day editable window)
    const pastMatches = nonArchivedMatches.filter(m => getMatchDateObj(m) < pastCutoff);
    let earliestPastDate = new Date(today);
    if (pastMatches.length > 0) {
      earliestPastDate = new Date(Math.min(...pastMatches.map(m => getMatchDateObj(m).getTime())));
    }
    
    const pastStart = new Date(earliestPastDate);
    pastStart.setHours(0, 0, 0, 0);
    const pCurrentDay = pastStart.getDay();
    const pDist = pCurrentDay === 0 ? 6 : pCurrentDay - 1;
    pastStart.setDate(pastStart.getDate() - pDist);

    // up to the week before upcomingStart
    const pastEnd = new Date(upcomingStart);
    pastEnd.setDate(pastEnd.getDate() - 1);

    const generateWeeks = (startData: Date, endData: Date) => {
      const weeks: { weekLabel: string; monthLabel: string; days: any[] }[] = [];
      let current = new Date(startData);
      while (current <= endData) {
        const weekStart = new Date(current);
        const days = [];

        for (let i = 0; i < 7; i++) {
          const d = new Date(current);
          d.setDate(d.getDate() + i);

          const pYear = d.getFullYear();
          const pMonth = String(d.getMonth() + 1).padStart(2, "0");
          const pDate = String(d.getDate()).padStart(2, "0");
          const dateStr = `${pYear}-${pMonth}-${pDate}`;

          const dayMatches = nonArchivedMatches.filter((m) => {
             const parts = dbToInputDate(m.date).split("/"); 
             if (parts.length === 3) {
               const mDateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
               return mDateStr === dateStr;
             }
             return m.date === dateStr;
          });
          const dayOfWeek = d.getDay();

          let includeDay = false;
          let appendMatches = dayMatches;

          if (filterOpenSlots) {
             const hasTournamentMatch = dayMatches.some(m => m.matchType === "Tournament");
             if (!hasTournamentMatch && (dayOfWeek === 0 || dayOfWeek === 6)) {
               includeDay = true;
             }
          } else {
             if (dayOfWeek === 0 || dayOfWeek === 6 || dayMatches.length > 0) {
               includeDay = true;
             }
          }

          if (includeDay) {
            days.push({
              date: d,
              dateStr,
              dayOfWeek,
              matches: appendMatches,
            });
          }
        }

        const monthLabel = weekStart.toLocaleString("en-US", {
          month: "long",
          year: "numeric",
        });
        
        let includeWeek = false;
        if (filterOpenSlots) {
            includeWeek = days.length > 0;
        } else {
            includeWeek = days.some(d => d.matches.length > 0) || endData === upcomingEnd;
        }

        // Only include week in past data if it has any matches, or if it's upcoming (unless filtering open slots)
        if (includeWeek) {
             weeks.push({
              weekLabel: `Week of ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric"})}`,
              monthLabel,
              days,
            });
        }

        current.setDate(current.getDate() + 7);
      }
      return weeks;
    };

    let pastCalendarData: any[] = [];
    if (pastMatches.length > 0 && pastStart < pastEnd) {
      pastCalendarData = generateWeeks(pastStart, pastEnd);
    }
    const upcomingCalendarData = generateWeeks(upcomingStart, upcomingEnd);

    return { pastCalendarData, upcomingCalendarData };
  }, [matches, filterGround, filterOpenSlots]);

  const groupWeeksByMonth = (calendarData: any[]) => {
    const grouped: { [month: string]: any[] } = {};
    calendarData.forEach((week) => {
      if (!grouped[week.monthLabel]) {
        grouped[week.monthLabel] = [];
      }
      grouped[week.monthLabel].push(week);
    });
    return grouped;
  };

  const upcomingGrouped = groupWeeksByMonth(upcomingCalendarData);
  const pastGrouped = groupWeeksByMonth(pastCalendarData);

  if (!isMounted) {
    return <div className="p-4 text-center text-white/50 animate-pulse mt-4">Loading calendar view...</div>;
  }

  return (
    <div className="space-y-8 pb-12 mt-4 text-left">
      {isAdmin && (
        <div className="glass p-4 rounded-xl flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] uppercase font-bold text-white/50 tracking-widest block mb-1">Ground</label>
            <select
              value={filterGround}
              onChange={(e) => setFilterGround(e.target.value)}
              className="w-full bg-black/30 border border-glass-border rounded-lg text-sm px-3 py-2 text-white focus:outline-none focus:border-accent"
            >
              <option value="all">All Grounds</option>
              {grounds.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-none pt-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-white/80 hover:text-white transition">
              <input
                type="checkbox"
                checked={filterOpenSlots}
                onChange={(e) => setFilterOpenSlots(e.target.checked)}
                className="w-4 h-4 accent-accent"
              />
              Show Open Slots
            </label>
          </div>
        </div>
      )}

      {Object.keys(pastGrouped).length > 0 && (
        <div className="glass p-4 rounded-xl">
          <button
            onClick={() => setIsPastCollapsed(!isPastCollapsed)}
            className="flex w-full items-center justify-between text-white/80 hover:text-white"
          >
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Calendar className="w-5 h-5" /> Past Matches
            </h2>
            {isPastCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
          {!isPastCollapsed && (
            <div className="mt-4 space-y-6">
              {Object.entries(pastGrouped).reverse().map(([monthName, weeks]) => (
                <div key={monthName} className="space-y-4">
                  <h3 className="text-sm font-bold border-b border-glass-border pb-2 text-white/50 shrink-0">
                    {monthName}
                  </h3>
                  <div className="space-y-4">
                    {weeks.slice().reverse().map((week, idx) => (
                      <div
                        key={idx}
                        className="bg-white/5 border border-glass-border rounded-xl p-4 overflow-x-auto custom-scrollbar"
                      >
                        <div className="flex gap-4 min-w-max flex-row-reverse justify-end">
                          {week.days.slice().reverse().map((day: any, dIdx: number) => (
                            <div
                              key={dIdx}
                              className="w-40 shrink-0 flex flex-col space-y-2"
                            >
                              <div className="text-center pb-2 border-b border-glass-border">
                                <div className="text-[10px] uppercase font-bold tracking-widest text-white/50">
                                  {day.date.toLocaleDateString("en-US", {
                                    weekday: "short",
                                  })}
                                </div>
                                <div className="text-2xl font-bold font-mono flex flex-col items-center">
                                  <span>{day.date.getDate()}</span>
                                  <span className="text-[10px] font-sans text-white/40 uppercase tracking-widest leading-none mt-1">{day.date.toLocaleDateString("en-US", { month: "short" })}</span>
                                </div>
                              </div>
                              <div className="space-y-2 pt-1 flex flex-col justify-start h-full min-h-[5rem]">
                                {day.matches.length > 0 && day.matches.map((m: Match) => {
                                  return (
                                    <div
                                      key={m.id}
                                      onClick={() => onMatchClick(m)}
                                      className={`p-2.5 rounded-lg border flex flex-col gap-1 cursor-pointer transition shadow-sm relative group overflow-hidden ${
                                        m.matchType === "Tournament"
                                          ? "bg-red-500/10 border-red-500/30 hover:bg-red-500/20"
                                          : "bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/20"
                                      }`}
                                    >
                                      <div className="flex justify-between items-start">
                                        <div className="text-[10px] uppercase font-bold tracking-wider text-white opacity-70">
                                          {m.matchType} • {m.time}
                                        </div>
                                        {m.isTentative && (
                                          <span className="bg-orange-500 text-black px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider animate-pulse ml-1 shrink-0" title={`Blocked by ${m.tentativelyBlockedBy || "Admin"}`}>
                                            Blocked{m.tentativelyBlockedBy ? ` · ${m.tentativelyBlockedBy}` : ""}
                                          </span>
                                        )}
                                      </div>
                                      <div className="font-bold text-sm leading-tight">
                                        vs {m.opponent}
                                      </div>
                                      <div className="text-[10px] text-white/50">
                                        {grounds.find((g) => g.id === m.groundId)?.name}
                                      </div>
                                      {isAdmin && m.isGroundFeePaid && (
                                        <div className="mt-1 text-[9px] uppercase tracking-widest font-bold text-emerald-400 flex items-center">
                                          <CheckCircle2 className="w-3 h-3 mr-1" /> Ground Fee Paid
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                                {day.matches.length === 0 && (
                                  <div className="flex-1 flex items-center justify-center text-white/10 text-xs italic">
                                    No Match
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {Object.entries(upcomingGrouped).map(([monthName, weeks]) => (
        <div key={monthName} className="space-y-4">
          <h2 className="text-xl font-bold border-b border-glass-border pb-2 text-white/80 shrink-0">
            {monthName}
          </h2>
          <div className="space-y-4">
            {weeks.map((week, idx) => (
              <div
                key={idx}
                className="bg-white/5 border border-glass-border rounded-xl p-4 overflow-x-auto custom-scrollbar"
              >
                <div className="flex gap-4 min-w-max">
                  {week.days.map((day: any, dIdx: number) => (
                    <div
                      key={dIdx}
                      className="w-40 shrink-0 flex flex-col space-y-2"
                    >
                      <div className="text-center pb-2 border-b border-glass-border">
                        <div className="text-[10px] uppercase font-bold tracking-widest text-white/50">
                          {day.date.toLocaleDateString("en-US", {
                            weekday: "short",
                          })}
                        </div>
                        <div className="text-2xl font-bold font-mono flex flex-col items-center">
                          <span>{day.date.getDate()}</span>
                          <span className="text-[10px] font-sans text-white/40 uppercase tracking-widest leading-none mt-1">{day.date.toLocaleDateString("en-US", { month: "short" })}</span>
                        </div>
                      </div>

                      <div className="space-y-2 pt-1 flex flex-col justify-start h-full min-h-[5rem]">
                        {day.matches.length > 0 && day.matches.map((m: Match) => {
                          const matchPayments = store.payments.filter(p => p.matchId === m.id && store.players.some((pl) => pl.id === p.playerId));
                          const paidCount = matchPayments.filter(p => p.status === "Paid").length;
                          const unpaidCount = matchPayments.filter(p => p.status === "Unpaid").length;
                          return (
                          <div
                            key={m.id}
                            onClick={() => onMatchClick(m)}
                            className={`p-2.5 rounded-lg border flex flex-col gap-1 cursor-pointer transition shadow-sm relative group overflow-hidden ${
                              m.matchType === "Tournament"
                                ? "bg-red-500/10 border-red-500/30 hover:bg-red-500/20"
                                : "bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/20"
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <div className="text-[10px] uppercase font-bold tracking-wider text-white opacity-70">
                                {m.matchType} • {m.time}
                              </div>
                              {m.isTentative && (
                                <span className="bg-orange-500 text-black px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider animate-pulse ml-1 shrink-0" title={`Blocked by ${m.tentativelyBlockedBy || "Admin"}`}>
                                  Blocked{m.tentativelyBlockedBy ? ` · ${m.tentativelyBlockedBy}` : ""}
                                </span>
                              )}
                            </div>
                            {m.tournamentId && (() => {
                              const t = store.tournaments.find(
                                (tt) => tt.id === m.tournamentId,
                              );
                              if (!t) return null;
                              return (
                                <div
                                  className="text-[9px] font-bold text-purple-300 uppercase tracking-wider truncate flex items-center gap-1"
                                  title={t.name}
                                >
                                  🏆 {t.name}
                                </div>
                              );
                            })()}
                            
                            {matchToDelete === m.id ? (
                              <div className="mt-1 flex items-center justify-between gap-1 bg-black/60 rounded-lg px-2 py-1 border border-red-500/50">
                                <span className="text-[9px] text-red-400 uppercase font-bold tracking-wider">
                                  Sure?
                                </span>
                                <div className="flex gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onConfirmDelete?.(m.id);
                                    }}
                                    className="text-red-400 hover:bg-red-500/20 rounded p-1 transition"
                                  >
                                    <Check className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onCancelDelete?.();
                                    }}
                                    className="text-white/60 hover:bg-white/10 rounded p-1 transition"
                                  >
                                    <span className="text-[10px] font-bold px-0.5">X</span>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="font-bold text-sm leading-tight text-white/90">
                                  vs {m.opponent}
                                </div>
                                {m.groundId && (
                                  <div className="text-[9px] uppercase tracking-widest text-white/60 truncate mt-0.5">
                                    {grounds.find((g) => g.id === m.groundId)?.name || "Unknown Ground"}
                                  </div>
                                )}
                                
                                {isAdmin && m.isGroundFeePaid && (
                                  <div className="mt-1 text-[9px] uppercase tracking-widest font-bold text-emerald-400 flex items-center">
                                    <CheckCircle2 className="w-3 h-3 mr-1" /> Ground Fee Paid
                                  </div>
                                )}
                                
                                {isAdmin && (
                                  <div className="mt-1 flex gap-2 text-[9px] font-bold uppercase tracking-wider">
                                    <span className="text-emerald-400">{paidCount} Paid</span>
                                    {unpaidCount > 0 && <span className="text-red-400">{unpaidCount} Unpaid</span>}
                                  </div>
                                )}

                                {isAdmin && (
                                  <div className="flex items-center justify-between gap-1 mt-2 pt-2 border-t border-glass-border/50 transition-opacity">
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onEditMatch?.(m);
                                        }}
                                        className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 rounded-lg bg-black/20 border border-white/5 transition"
                                        title="Edit Match"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onDuplicateMatch?.(m);
                                        }}
                                        className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 rounded-lg bg-black/20 border border-white/5 transition"
                                        title="Duplicate Match"
                                      >
                                        <Copy className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onDeleteMatch?.(m);
                                        }}
                                        className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg bg-black/20 border border-white/5 transition"
                                        title="Delete Match"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                    {m.matchUrl && (
                                      <a
                                        href={m.matchUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[9px] bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded px-1.5 py-0.5 hover:bg-blue-500 hover:text-white transition uppercase font-bold tracking-wider"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        Share
                                      </a>
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                        })}
                        
                        {(isAdmin || day.matches.length === 0) && (
                          <div
                            onClick={() => isAdmin ? onAddMatch(day.dateStr) : undefined}
                            className={`${day.matches.length === 0 ? "flex-1 min-h-[5rem]" : "py-2 mt-1"} rounded-lg flex items-center justify-center border-2 border-dashed border-emerald-500/30 bg-emerald-500/5 transition ${isAdmin ? "cursor-pointer hover:bg-emerald-500/10 hover:border-emerald-500/50" : ""}`}
                          >
                            <span className="text-emerald-400 font-bold text-[10px] uppercase tracking-wider">
                              {day.matches.length > 0 ? "+ Add" : "Open Slot"}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
