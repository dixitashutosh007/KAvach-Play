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
import { authedFetch } from "@/lib/authed-fetch";
import { Match, MatchComment, Player, FeePlan } from "@/lib/types";
import { isMatchBillable } from "@/lib/matchBillable";

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
  RefreshCw,
  AlertCircle,
  Shield,
  Info,
  LayoutList,
  Table2,
  ArrowLeft,
  CalendarDays,
} from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";
import { formatDate, dbToInputDate, inputToDbDate, normalizeIndianMobile, findExistingPlayer, computeLateFees } from "@/lib/utils";
import { resolvePlayerForUser } from "@/lib/player-identity";
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
import { useSessionState } from "@/hooks/useSessionState";
import { MatchCalendarView } from "./MatchCalendarView";
import { MatchToolbar } from "./MatchToolbar";
import { MatchSheetView } from "./MatchSheetView";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { PlayerMatchCenter } from "./matches/PlayerMatchCenter";
import { MatchesLoadError } from "./matches/MatchesLoadError";
import { MatchCardHeader, MatchCardTopBar, MatchCardStackedBody, MatchCornerTab } from "./matches/MatchCardHeader";
import { getMatchCardSurfaceClass } from "./matches/PlayerMatchCard";
import { MATCH_TYPES } from "@/lib/match-category";
import { DEFAULT_MARGIN_PCT, clampMargin, computeMatchFee, resolveGroundFee } from "@/lib/match-fee";
import { MatchDatePicker } from "./matches/MatchDatePicker";
import { MatchFeeCalculator } from "./matches/MatchFeeCalculator";
import { ChoiceGroup, FIELD_CLASS, FieldLabel, FormSection } from "./matches/MatchFormParts";
import { AdminMatchDateList } from "./matches/AdminMatchDateList";
import { MatchPaymentPanel } from "./matches/MatchPaymentPanel";
import { formatMatchDisplayTime } from "@/lib/personal-match-payment";

/** Admin Match Centre views, chosen from a dropdown (not tabs). */
export const MATCH_VIEW_OPTIONS = [
  { value: "list", label: "List View" },
  { value: "sheet", label: "Table View" },
  { value: "calendar", label: "Calendar View" },
] as const;
export type MatchViewMode = (typeof MATCH_VIEW_OPTIONS)[number]["value"];

export function MatchesTab({
  store,
  persona,
  isMatchAdmin,
  isSuperAdmin,
  defaultAction,
}: {
  store: ReturnType<typeof useStore>;
  persona?: "admin" | "player";
  isMatchAdmin?: boolean;
  isSuperAdmin?: boolean;
  defaultAction?: string | null;
}) {
  const { toast } = useToast();
  const { confirm: confirmAction } = useConfirm();
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
  const [playerFilter, setPlayerFilter] = useState<"all" | "upcoming" | "past" | "abandoned">("all");
  const [playerSearch, setPlayerSearch] = useState<string>("");
  // List View is the default; the chosen view is remembered for this tab
  // session (same convention as other Match Centre UI state). A deep link to
  // the calendar still opens the calendar.
  const [viewMode, setViewMode] = useSessionState<MatchViewMode>(
    "matches:viewMode",
    defaultAction === "calendar" ? "calendar" : "list",
  );
  useEffect(() => {
    if (defaultAction === "calendar") setViewMode("calendar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultAction]);

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
    } else if (defaultAction && defaultAction.startsWith("tournament_")) {
      const targetTournId = defaultAction.replace("tournament_", "");
      const tourn = store.tournaments.find(t => t.id === targetTournId);
      if (tourn) {
        setPlayerSearch(tourn.name || "");
      }
    } else if (defaultAction === "assign") {
      setSubTab("assign");
    }
  }, [defaultAction, store.matches, store.tournaments]);

  // Default per-player fee for a new (Practice) match on the first ground:
  // the existing rule, round(practiceFee / 12 × 1.05) — see lib/match-fee.
  const getInitialFee = () => {
     const ground = store.grounds[0];
     if (ground && ground.practiceFee) {
        return computeMatchFee(ground.practiceFee, DEFAULT_MARGIN_PCT).feePerPlayer;
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

  // Margin for the fee calculator. A form control only (the match stores just
  // the resulting per-player fee, as before); starts at the 5% default.
  const [feeMarginPct, setFeeMarginPct] = useState<number>(DEFAULT_MARGIN_PCT);

  const { user, hasAdminClaim } = useAuth();
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
    setFeeMarginPct(DEFAULT_MARGIN_PCT);
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
    // The saved fee is kept as-is; the margin control only recalculates when
    // the admin changes it (no margin is stored on existing matches).
    setFeeMarginPct(DEFAULT_MARGIN_PCT);
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
    setFeeMarginPct(DEFAULT_MARGIN_PCT);
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

  const userHasAdminPrivileges =
    isSuperAdmin ||
    isMatchAdmin ||
    hasAdminClaim ||
    currentUserObj?.isMatchAdmin ||
    currentUserObj?.isClubAdmin;

  const isPlayerView = persona === "player" || (!persona && !userHasAdminPrivileges);
  const isAdmin = !isPlayerView && Boolean(persona === "admin" || userHasAdminPrivileges);
  // Table View (sheet) stays Super Admin only, as before; a remembered "sheet"
  // choice falls back to the List View for other admins.
  const activeView: MatchViewMode = viewMode === "sheet" && !isSuperAdmin ? "list" : viewMode;

  // Admin Match Centre loads payments on demand (the page no longer preloads
  // every payment for this tab). Calendar View and the Assign sub-tab show
  // figures for many matches, so they attach the existing all-payments
  // listener; the edit form needs only the match being edited. The List View's
  // per-match "Payment Details" panels load their own match when expanded.
  useEffect(() => {
    if (!isAdmin) return;
    if (subTab === "assign" || (subTab === "matches" && activeView === "calendar")) store.ensurePayments?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, subTab, activeView, store.ensurePayments, store.refreshNonce]);
  useEffect(() => {
    if (isAdmin && editingId) store.ensureMatchPayments?.(editingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, editingId, store.ensureMatchPayments, store.refreshNonce]);

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
  // Fee context for the calculator: the ground / tournament per-match fee the
  // existing rule uses (see lib/match-fee).
  const formGround = store.grounds.find((g) => g.id === formData.groundId);
  const formTournament = formData.tournamentId
    ? store.tournaments.find((t) => t.id === formData.tournamentId)
    : undefined;
  const formFeeSource = resolveGroundFee(formGround, formData.matchType, formTournament);
  /** Recalculated standard fee for a candidate form state (keeps the current fee when no ground fee is configured). */
  const recalcFee = (next: typeof formData, marginPct: number): number | "" => {
    const ground = store.grounds.find((g) => g.id === next.groundId);
    const tournament = next.tournamentId ? store.tournaments.find((t) => t.id === next.tournamentId) : undefined;
    const { amount } = resolveGroundFee(ground, next.matchType, tournament);
    return amount > 0 ? computeMatchFee(amount, marginPct).feePerPlayer : next.fee;
  };
  const isPresetTime = formData.time === "07:00" || formData.time === "12:00";
  const closeMatchForm = () => {
    setIsAdding(false);
    setEditingId(null);
    resetForm();
  };

  // Edit-match modal is hoisted so both the matches list AND the
  // per-match screen (below early-return) can render it. Previously,
  // clicking Edit inside a match forced the screen to close + open
  // the modal over the parent list, so Back landed the user on the
  // list instead of the match they were reviewing.
  const editMatchModal = isAdmin && isAdding ? (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-form-title"
    >
      <div className="relative w-full sm:max-w-lg max-h-[100dvh] sm:max-h-[92vh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl bg-background shadow-xl">
        <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2.5 bg-surface border-b border-border">
          <button
            type="button"
            onClick={closeMatchForm}
            aria-label="Close"
            className="w-11 h-11 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-text-primary cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          </button>
          <h2 id="match-form-title" className="text-lg font-black font-heading text-text-primary">
            {editingId ? "Edit Match" : "Add Match"}
          </h2>
        </div>
        <form onSubmit={handleSubmit} data-testid="match-form" className="p-3 sm:p-4 flex flex-col gap-4">
          {/* ── A. Match basics ───────────────────────────────────────── */}
          <FormSection icon={<CalendarDays className="w-4 h-4" aria-hidden="true" />} title="Match Details" testId="match-form-basics">
            <div>
              <FieldLabel htmlFor="match-opponent" required>Opponent Team</FieldLabel>
              <input
                id="match-opponent"
                required
                type="text"
                value={formData.opponent}
                onChange={(e) => setFormData({ ...formData, opponent: e.target.value })}
                className={FIELD_CLASS}
                placeholder="e.g. Royal Challengers"
              />
            </div>

            <div>
              <FieldLabel required>Date</FieldLabel>
              <MatchDatePicker
                value={inputToDbDate(formData.date)}
                onChange={(key) => setFormData({ ...formData, date: key })}
              />
            </div>

            <div>
              <FieldLabel required>Time</FieldLabel>
              {/* 7:00 AM and 12:00 PM are the club's usual slots; Other opens a time picker. */}
              <div role="radiogroup" aria-label="Match time" className="flex gap-2" data-testid="match-time-presets">
                {([
                  ["07:00", "7:00 AM"],
                  ["12:00", "12:00 PM"],
                ] as const).map(([t, label]) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={formData.time === t}
                    onClick={() => setFormData({ ...formData, time: t })}
                    className={`flex-1 min-h-[44px] rounded-xl border text-sm font-bold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                      formData.time === t ? "bg-brand border-brand text-white" : "bg-surface border-border text-text-primary hover:border-brand/40"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={!isPresetTime}
                  onClick={() => setFormData({ ...formData, time: isPresetTime ? "" : formData.time })}
                  className={`flex-1 min-h-[44px] rounded-xl border text-sm font-bold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                    !isPresetTime ? "bg-brand border-brand text-white" : "bg-surface border-border text-text-primary hover:border-brand/40"
                  }`}
                >
                  Other
                </button>
              </div>
              {!isPresetTime && (
                <input
                  required
                  type="time"
                  aria-label="Custom match time"
                  data-testid="match-time-input"
                  value={formData.time}
                  onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                  className={`${FIELD_CLASS} mt-2`}
                />
              )}
            </div>

            <div>
              <FieldLabel htmlFor="match-ground" required>Ground</FieldLabel>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand" aria-hidden="true" />
                <select
                  id="match-ground"
                  required
                  value={formData.groundId}
                  onChange={(e) => {
                    const next = { ...formData, groundId: e.target.value };
                    setFormData({ ...next, fee: recalcFee(next, feeMarginPct) });
                  }}
                  className={`${FIELD_CLASS} appearance-none pl-9 pr-9`}
                >
                  <option value="" disabled>Select a ground</option>
                  {store.grounds.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" aria-hidden="true" />
              </div>
            </div>
          </FormSection>

          {/* ── B. Match configuration ────────────────────────────────── */}
          <FormSection icon={<Shield className="w-4 h-4" aria-hidden="true" />} title="Match Configuration" testId="match-form-config">
            <div>
              <FieldLabel required>Format</FieldLabel>
              <ChoiceGroup
                name="Format"
                options={["T20", "T30", "Other"] as const}
                value={formData.format}
                onChange={(format) => setFormData({ ...formData, format })}
                testId="match-format-choice"
              />
            </div>
            <div>
              <FieldLabel required>Match Type</FieldLabel>
              <ChoiceGroup
                name="Match Type"
                options={MATCH_TYPES}
                value={formData.matchType}
                onChange={(matchType) => {
                  // Switching away from Tournament wipes any linked
                  // tournamentId — otherwise a Practice match would carry a
                  // stale tournament link.
                  const next = {
                    ...formData,
                    matchType,
                    tournamentId: matchType === "Tournament" ? formData.tournamentId : "",
                  };
                  setFormData({ ...next, fee: recalcFee(next, feeMarginPct) });
                }}
                testId="match-type-choice"
              />
            </div>
            {/* Tournament link: optional (autofills ground / jersey / format /
                fee from the tournament, exactly as before). */}
            <div>
              <FieldLabel htmlFor="match-tournament">Tournament <span className="font-normal text-text-muted">(optional)</span></FieldLabel>
              <select
                id="match-tournament"
                value={formData.tournamentId || ""}
                onChange={(e) => {
                  const tId = e.target.value;
                  if (!tId) {
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
                className={FIELD_CLASS}
              >
                <option value="">None</option>
                {[...store.tournaments]
                  .filter((t) => t.status === "Ongoing" || t.status === "Upcoming")
                  .sort((a, b) => {
                    const r = (a.status === "Ongoing" ? 0 : 1) - (b.status === "Ongoing" ? 0 : 1);
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel htmlFor="match-squad-size" required>Max Squad Size</FieldLabel>
                <input
                  id="match-squad-size"
                  required
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={formData.maxSquadSize}
                  onChange={(e) => setFormData({ ...formData, maxSquadSize: parseInt(e.target.value) || 12 })}
                  className={FIELD_CLASS}
                />
              </div>
              <div>
                <FieldLabel required>Jersey Colour</FieldLabel>
                <ChoiceGroup
                  name="Jersey Colour"
                  options={["Scarlet Red", "Whites"] as const}
                  value={formData.jerseyColor}
                  onChange={(jerseyColor) => setFormData({ ...formData, jerseyColor })}
                  testId="match-jersey-choice"
                  renderLabel={(c) => (
                    <>
                      <span className={`w-3 h-3 rounded-full shrink-0 ${c === "Scarlet Red" ? "bg-scarlet" : "bg-[#e5e5e5] border border-slate-300"}`} aria-hidden="true" />
                      <span className="truncate">{c === "Scarlet Red" ? "Red" : "Whites"}</span>
                    </>
                  )}
                />
              </div>
            </div>
          </FormSection>

          {/* ── C. Match fee (compact, collapsible) ───────────────────── */}
          <MatchFeeCalculator
            groundFeePerMatch={formFeeSource.amount}
            source={formFeeSource.source}
            marginPct={feeMarginPct}
            onMarginChange={(pct) => {
              const margin = clampMargin(pct);
              setFeeMarginPct(margin);
              setFormData({ ...formData, fee: recalcFee(formData, margin) });
            }}
            fee={formData.fee}
            onFeeChange={(fee) => setFormData({ ...formData, fee })}
            tournamentPerPlayerFee={formTournament?.perPlayerFee}
          />

          {/* Tentative block only makes sense for FUTURE matches. */}
          {(() => {
            const dbDate = inputToDbDate(formData.date);
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
              <label className="flex items-center gap-3 min-h-[48px] rounded-2xl border border-orange-300/60 bg-orange-50 px-4 cursor-pointer">
                <input
                  type="checkbox"
                  id="tentative-block"
                  checked={formData.isTentative || false}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      isTentative: e.target.checked,
                      tentativelyBlockedBy: e.target.checked ? currentUserName : "",
                    })
                  }
                  className="accent-orange-500 w-5 h-5 cursor-pointer"
                />
                <span className="text-sm font-bold text-orange-800">Tentatively block this slot</span>
              </label>
            );
          })()}

          {/* ── Optional match info: links and result ─────────────────── */}
          <details className="group rounded-2xl border border-border bg-surface overflow-hidden" data-testid="match-form-optional">
            <summary className="flex items-center justify-between min-h-[48px] px-4 cursor-pointer list-none text-sm font-black font-heading text-text-primary">
              Links &amp; Result
              <ChevronDown className="w-4 h-4 text-text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="px-4 pb-4 flex flex-col gap-4">
              <div>
                <FieldLabel htmlFor="match-url">Match URL</FieldLabel>
                <input
                  id="match-url"
                  type="url"
                  value={formData.matchUrl}
                  onChange={(e) => setFormData({ ...formData, matchUrl: e.target.value })}
                  className={FIELD_CLASS}
                  placeholder="https://cricheroes.in/..."
                />
              </div>
              <div>
                <FieldLabel htmlFor="match-stream-url">Streaming URL</FieldLabel>
                <input
                  id="match-stream-url"
                  type="url"
                  value={formData.streamingUrl}
                  onChange={(e) => setFormData({ ...formData, streamingUrl: e.target.value })}
                  className={FIELD_CLASS}
                  placeholder="https://youtube.com/..."
                />
              </div>
              <div>
                <FieldLabel>Result</FieldLabel>
                {/* The result itself stays editable. Margin (runs / wickets),
                    Player of the Match, Top Performers and Best Batsman /
                    Bowler inputs were removed; any saved values are kept
                    untouched on the match document. */}
                <div role="radiogroup" aria-label="Result" className="flex flex-wrap gap-2" data-testid="match-result-choice">
                  {(["Pending", "KAvach Won", "KAvach Lost", "Draw", "Tie", "Abandoned"] as const).map((res) => (
                    <button
                      key={res}
                      type="button"
                      role="radio"
                      aria-checked={formData.result === res}
                      onClick={() => setFormData({ ...formData, result: res })}
                      className={`min-h-[40px] px-3 rounded-xl border text-xs font-bold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                        formData.result === res ? "bg-brand border-brand text-white" : "bg-surface border-border text-text-primary hover:border-brand/40"
                      }`}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </details>

          <div className="flex gap-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={closeMatchForm}
              className="min-h-[48px] px-5 rounded-xl border border-border bg-surface text-sm font-bold text-text-primary hover:bg-surface-hover cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="match-form-submit"
              className="flex-1 min-h-[48px] rounded-xl bg-brand text-white text-sm font-black hover:opacity-90 cursor-pointer"
            >
              {editingId ? "Save Changes" : "Create Match"}
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  if (isPlayerView) {
    return (
      <PlayerMatchCenter
        store={store}
        defaultAction={defaultAction}
        isAdmin={isAdmin}
      />
    );
  }

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
        // Mobile: the four sub-tabs scroll horizontally instead of forcing the
        // page wider than the viewport ("TOURNAMENTS" cannot shrink to 1/4 width).
        <div className="flex gap-1.5 sm:gap-2 mb-4 bg-surface-hover p-1.5 rounded-2xl border border-border overflow-x-auto no-scrollbar" data-testid="match-subtabs">
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
                className={`shrink-0 sm:shrink sm:flex-1 min-h-[40px] py-2 px-3 rounded-xl text-[11px] font-bold uppercase tracking-wide sm:tracking-wider whitespace-nowrap transition-all duration-200 text-center cursor-pointer ${
                  active
                    ? "bg-accent text-text-accent font-extrabold shadow-[0_2px_8px_rgba(16,185,129,0.3)]"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
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
      {subTab === "assign" && isAdmin && <AssignFeesAdmin store={store} isSuperAdmin={isSuperAdmin} />}
      {subTab === "tournaments" && isAdmin && <TournamentsTab store={store} />}

      {subTab === "matches" && (
        <>
          <div className="flex flex-col gap-3 mb-2">
            {/* One compact row: title left; view dropdown + Add Match right. */}
            <div className="flex items-center justify-between gap-2" data-testid="match-centre-header">
              <h2 className="min-w-0 truncate text-lg sm:text-xl font-bold tracking-tight text-text-primary font-heading">
                Match Centre
              </h2>
              <div className="flex items-center gap-2 shrink-0">
                {!isAdding && (
                  <label className="relative inline-flex items-center" data-testid="match-view-select-wrap">
                    <span className="sr-only">Match Centre view</span>
                    {activeView === "calendar" ? (
                      <Calendar className="pointer-events-none absolute left-2.5 w-4 h-4 text-brand" aria-hidden="true" />
                    ) : activeView === "sheet" ? (
                      <Table2 className="pointer-events-none absolute left-2.5 w-4 h-4 text-brand" aria-hidden="true" />
                    ) : (
                      <LayoutList className="pointer-events-none absolute left-2.5 w-4 h-4 text-brand" aria-hidden="true" />
                    )}
                    <select
                      value={activeView}
                      onChange={(e) => setViewMode(e.target.value as MatchViewMode)}
                      data-testid="match-view-select"
                      className="appearance-none h-10 pl-8 pr-7 sm:pl-9 sm:pr-9 rounded-xl border border-border bg-surface text-[13px] sm:text-sm font-bold text-text-primary shadow-xs cursor-pointer hover:border-brand/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      {MATCH_VIEW_OPTIONS.filter((o) => o.value !== "sheet" || isSuperAdmin).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 sm:right-3 w-4 h-4 text-text-muted" aria-hidden="true" />
                  </label>
                )}
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
                    aria-label={isAdding ? "Cancel" : "Add Match"}
                    data-testid="add-match-button"
                    className="inline-flex items-center justify-center gap-1 h-10 min-w-10 rounded-xl sm:rounded-full bg-accent px-2.5 sm:px-3 text-sm font-bold text-black shadow hover:bg-accent/90 transition"
                  >
                    {isAdding ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                    <span className={isAdding ? "" : "hidden sm:inline"}>{isAdding ? "Cancel" : "Add Match"}</span>
                  </button>
                )}
              </div>
            </div>

            <MatchesLoadError message={store.matchesError} />

            {isAdmin && !isAdding && (
              <MatchToolbar store={store} />
            )}
          </div>

          {editMatchModal}

          {activeView === "sheet" ? (
            <MatchSheetView store={store} />
          ) : activeView === "list" ? (
            <div className="space-y-4">
            {(() => {
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

              const renderMatchCard = (match: Match, cardIndex: number = 0) => {
                const ground = store.grounds.find(
                  (g) => g.id === match.groundId,
                );
                const isAlternateCard = cardIndex % 2 === 1;
                const tournamentForCard = match.tournamentId
                  ? store.tournaments.find((tt) => tt.id === match.tournamentId)
                  : undefined;
                // Existing delete workflow (explicit confirmation naming the
                // match, then store.deleteMatch); shared by the desktop icon
                // and the mobile action row.
                const deleteThisMatch = async () => {
                  const when = [formatDate(match.date), match.time ? formatMatchDisplayTime(match.time) : ""]
                    .filter(Boolean)
                    .join(" at ");
                  const ok = await confirmAction({
                    title: "Delete match?",
                    message: `Delete the ${match.isTentative ? "tentative block" : "match"} vs ${match.opponent || "TBC"}${
                      when ? ` on ${when}` : ""
                    }? This cannot be undone.`,
                    confirmLabel: "Delete match",
                    destructive: true,
                  });
                  if (!ok) return;
                  try {
                    await store.deleteMatch(match.id);
                    toast("Match deleted", "success");
                  } catch (err) {
                    console.error(err);
                    toast("The match could not be deleted.", "error");
                  }
                };
                return (
                  <div
                    key={match.id}
                    data-testid={`admin-match-card-${match.id}`}
                    data-variant={isAlternateCard ? "alternate" : "default"}
                    onClick={() => openMatch(match)}
                    className={`relative overflow-hidden rounded-[20px] border transition-all duration-200 cursor-pointer ${getMatchCardSurfaceClass({ isAlternate: isAlternateCard })}`}
                  >
                    <div className="p-3 sm:p-4">
                      <MatchCardTopBar
                        match={match}
                        // Mobile: format + jersey in the top-right corner tab
                        // (actions move to a labelled row at the card's foot).
                        corner={<MatchCornerTab match={match} className="md:hidden" />}
                        end={
                          isAdmin ? (
                          <div className="hidden md:flex gap-1 items-center shrink-0" data-testid={`admin-card-icon-actions-${match.id}`}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startDuplicate(match);
                              }}
                              className="w-8 h-8 rounded-full bg-surface-hover flex items-center justify-center hover:bg-surface-hover transition hover:text-text-primary"
                              title="Duplicate Match"
                              aria-label={`Duplicate match vs ${match.opponent}`}
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startEdit(match);
                              }}
                              className="w-8 h-8 rounded-full bg-surface-hover flex items-center justify-center hover:bg-surface-hover transition hover:text-text-primary"
                              title="Edit Match"
                              aria-label={`Edit match vs ${match.opponent}`}
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteThisMatch();
                              }}
                              title="Delete Match"
                              aria-label={`Delete match vs ${match.opponent}`}
                              data-testid={`admin-delete-match-${match.id}`}
                              className="w-8 h-8 rounded-full bg-surface-hover flex items-center justify-center hover:bg-red-500/20 text-red-400 transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          ) : null
                        }
                      />
                      {/* Mobile: stacked single-column body. Desktop: shared header (unchanged). */}
                      <div className="md:hidden">
                        <MatchCardStackedBody match={match} ground={ground} tournamentName={tournamentForCard?.name} />
                      </div>
                      <div className="hidden md:block">
                        <MatchCardHeader match={match} ground={ground} resultPlacement="inline" />
                      </div>

                      {(tournamentForCard || match.isTentative) && (
                        <div className={`flex gap-1.5 items-center mt-2.5 flex-wrap ${match.isTentative ? "" : "max-md:hidden"}`}>
                          {tournamentForCard && (
                            <span
                              className="hidden md:inline-block bg-gold/15 text-deep-wine border border-gold/40 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider truncate max-w-[160px]"
                              title={tournamentForCard.name}
                            >
                              🏆 {tournamentForCard.name}
                            </span>
                          )}
                          {match.isTentative && (
                            <span className="bg-orange-500 text-black px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider" title={`Blocked by ${match.tentativelyBlockedBy || "Admin"}`}>
                              Blocked{match.tentativelyBlockedBy ? ` · ${match.tentativelyBlockedBy}` : ""}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Ground fee comes from the match document itself (no payment
                          query). Player payment balances live in the lazily
                          loaded "Payment Details" panel below. */}
                      {isAdmin && match.isGroundFeePaid && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs flex-wrap">
                          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 px-2 py-0.5 rounded flex items-center gap-1 font-bold">
                            Ground Fee Paid (₹{match.groundFeePaidAmount})
                          </div>
                        </div>
                      )}

                      {(match.matchUrl || match.streamingUrl) && (
                        <div className="flex gap-4 mt-3 pt-3 border-t border-border">
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

                      {/* Performer highlights (won matches). The "Share Result on WhatsApp"
                          button was removed from Admin Match Centre cards; the block now
                          renders only when there is something to show. */}
                      {match.result && match.result !== "Pending" && (
                        match.result === "KAvach Won" &&
                        (match.potmId || match.playerOfTheMatch || match.bestBatsman || match.bestBowler || (match.topPerformerIds && match.topPerformerIds.length > 0))
                      ) && (
                        <div className="mt-3 pt-3 border-t border-border">
                          {(
                              <div className="grid grid-cols-2 gap-2 text-xs mt-2 relative z-10">
                                {(match.potmId || match.playerOfTheMatch) && (
                                  <div>
                                    <span className="text-text-muted font-mono text-[10px]">
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
                                    <span className="text-text-muted font-mono text-[10px]">
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
                                    <span className="text-text-muted font-mono text-[10px]">
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
                                    <span className="text-text-muted font-mono text-[10px]">
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


                        </div>
                      )}
                    </div>
                    {isAdmin && (
                      <MatchPaymentPanel
                        match={match}
                        players={store.players}
                        payments={store.payments}
                        status={store.matchPaymentsStatus?.[match.id]}
                        ensureMatchPayments={store.ensureMatchPayments}
                        refreshNonce={store.refreshNonce}
                      />
                    )}
                    {isAdmin && (
                      <div
                        className="md:hidden grid grid-cols-3 gap-2 px-3 py-3 border-t border-border bg-surface"
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`admin-card-actions-${match.id}`}
                      >
                        <button
                          type="button"
                          onClick={() => startEdit(match)}
                          aria-label={`Edit match vs ${match.opponent}`}
                          className="inline-flex items-center justify-center gap-1.5 min-w-0 h-11 rounded-xl border border-border bg-surface text-xs font-bold text-text-primary hover:bg-surface-hover cursor-pointer"
                        >
                          <Edit2 className="w-4 h-4 shrink-0 text-brand" aria-hidden="true" />
                          <span className="truncate">Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => startDuplicate(match)}
                          aria-label={`Duplicate match vs ${match.opponent}`}
                          className="inline-flex items-center justify-center gap-1.5 min-w-0 h-11 rounded-xl border border-border bg-surface text-xs font-bold text-text-primary hover:bg-surface-hover cursor-pointer"
                        >
                          <Copy className="w-4 h-4 shrink-0 text-brand" aria-hidden="true" />
                          <span className="truncate">Duplicate</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteThisMatch()}
                          aria-label={`Delete match vs ${match.opponent}`}
                          data-testid={`admin-delete-match-mobile-${match.id}`}
                          className="inline-flex items-center justify-center gap-1.5 min-w-0 h-11 rounded-xl border border-red-200 bg-red-50 text-xs font-bold text-red-700 hover:bg-red-100 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                          <span className="truncate">Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              };

              if (isAdmin) {
                // Regular admin listing (unchanged ordering: next 14 days, then
                // "Scheduled Later" and "Past Matches"). Always visible; the date
                // selector above only adds an optional selected-date panel.
                const now = new Date();
                const fourteenDaysFromNow = new Date(now);
                fourteenDaysFromNow.setDate(fourteenDaysFromNow.getDate() + 14);
                // Admins still need to edit recent results (result, POTM, stats,
                // fee assignments) for a while after the match. Keep the last
                // 10 days out of "Past Matches" so those cards stay right at
                // the top of the list.
                const pastCutoff = new Date(now);
                pastCutoff.setDate(pastCutoff.getDate() - 10);

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

                const regularList =
                  allMatches.length === 0 ? (
                    <div className="py-12 text-center text-sm text-text-muted bg-surface border-dashed rounded-xl">
                      No matches found.
                    </div>
                  ) : (
                       <div className="space-y-4">
                         {upcomingNear.length > 0 ? upcomingNear.map(renderMatchCard) : (
                           <div className="py-12 text-center text-sm text-text-muted bg-surface border-dashed rounded-xl">
                             No matches in the next 14 days.
                           </div>
                         )}
               
                         {upcomingLater.length > 0 && (
                            <div className="bg-surface p-4 rounded-xl mt-8">
                              <button
                                onClick={() => setIsLaterScheduledCollapsed(!isLaterScheduledCollapsed)}
                                className="flex w-full items-center justify-between text-text-primary hover:text-text-primary"
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
                            <div className="bg-surface p-4 rounded-xl mt-8">
                              <button
                                onClick={() => setIsPastListCollapsed(!isPastListCollapsed)}
                                className="flex w-full items-center justify-between text-text-primary hover:text-text-primary"
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

                return (
                  <div className="space-y-6">
                    <AdminMatchDateList
                      matches={allMatches}
                      loaded={store.isLoaded}
                      renderMatchCard={renderMatchCard}
                      onAddMatch={(dateKey: string) => {
                        setFormData((prev) => ({ ...prev, date: dbToInputDate(dateKey) }));
                        setEditingId(null);
                        setIsAdding(true);
                      }}
                    />
                    <section aria-labelledby="all-matches-heading" data-testid="regular-match-list">
                      <h3 id="all-matches-heading" className="mb-3 text-sm font-bold uppercase tracking-wider text-text-primary font-heading">
                        All Matches
                      </h3>
                      {regularList}
                    </section>
                  </div>
                );
              }

              if (allMatches.length === 0) {
                 return (
                   <div className="py-12 text-center text-sm text-text-muted bg-surface border-dashed rounded-xl">
                     No matches found.
                   </div>
                 );
              }

              if (!isAdmin) {
                const displayedMatches = allMatches.filter((m) => {
                  if (playerFilter === "upcoming" && m.result && m.result !== "Pending") return false;
                  if (playerFilter === "past" && (!m.result || m.result === "Pending" || m.result === "Abandoned")) return false;
                  if (playerFilter === "abandoned" && m.result !== "Abandoned") return false;

                  if (playerSearch.trim()) {
                    const q = playerSearch.toLowerCase().trim();
                    const groundName = store.grounds.find((g) => g.id === m.groundId)?.name?.toLowerCase() || "";
                    const opp = (m.opponent || "").toLowerCase();
                    const tourn = store.tournaments.find((tt) => tt.id === m.tournamentId);
                    const tournName = tourn?.name?.toLowerCase() || "";
                    if (!opp.includes(q) && !groundName.includes(q) && !tournName.includes(q)) return false;
                  }
                  return true;
                }).sort((a, b) => getMatchDate(b).getTime() - getMatchDate(a).getTime());

                return (
                  <div className="space-y-4">
                    {/* Search and Category Filter Bar (MOD-03A) */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-surface p-3.5 rounded-2xl border border-border shadow-xs">
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                        <button
                          type="button"
                          aria-pressed={playerFilter === "all"}
                          onClick={() => setPlayerFilter("all")}
                          className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                            playerFilter === "all" ? "bg-accent text-text-accent shadow-xs" : "bg-surface-hover text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          All Matches ({allMatches.length})
                        </button>
                        <button
                          type="button"
                          aria-pressed={playerFilter === "upcoming"}
                          onClick={() => setPlayerFilter("upcoming")}
                          className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                            playerFilter === "upcoming" ? "bg-accent text-text-accent shadow-xs" : "bg-surface-hover text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          Upcoming ({allMatches.filter(m => m.result === "Pending" || !m.result).length})
                        </button>
                        <button
                          type="button"
                          aria-pressed={playerFilter === "past"}
                          onClick={() => setPlayerFilter("past")}
                          className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                            playerFilter === "past" ? "bg-accent text-text-accent shadow-xs" : "bg-surface-hover text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          Past Results ({allMatches.filter(m => m.result && m.result !== "Pending" && m.result !== "Abandoned").length})
                        </button>
                        <button
                          type="button"
                          aria-pressed={playerFilter === "abandoned"}
                          onClick={() => setPlayerFilter("abandoned")}
                          className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                            playerFilter === "abandoned" ? "bg-accent text-text-accent shadow-xs" : "bg-surface-hover text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          Abandoned ({allMatches.filter(m => m.result === "Abandoned").length})
                        </button>
                      </div>

                      <div className="relative min-w-[200px]">
                        <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          aria-label="Search matches by opponent or venue"
                          placeholder="Search opponent or venue..."
                          value={playerSearch}
                          onChange={(e) => setPlayerSearch(e.target.value)}
                          className="w-full min-h-[44px] text-xs pl-9 pr-3 py-2 bg-surface rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-accent/30"
                        />
                      </div>
                    </div>

                    {displayedMatches.length > 0 ? (
                      <div className="space-y-4">
                        {displayedMatches.map(renderMatchCard)}
                      </div>
                    ) : (
                      <div className="py-12 text-center text-sm text-text-muted bg-surface border border-dashed border-border rounded-xl">
                        No matches match your filter criteria.
                      </div>
                    )}
                  </div>
                );
              }
               
              return null;
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
  const { toast } = useToast();
  const { confirm: confirmAction } = useConfirm();
  // Load this match's payments (the store skips it if this match's listener is already attached).
  useEffect(() => {
    store.ensureMatchPayments?.(match.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, store.ensureMatchPayments, store.refreshNonce]);
  const matchPayments = store.payments.filter(
    (p) =>
      p.matchId === match.id &&
      store.players.some((pl) => pl.id === p.playerId),
  );
  const isAdmin = persona === "admin" && isMatchAdmin !== false;
  const { user } = useAuth();

  // Link to AppUser
  const appUser = store.appUsers.find((u) => u.id === user?.uid);
  const mePlayer = resolvePlayerForUser(store.players, user?.uid, appUser);
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

  // Comprehensive Financial Accountability & Bifurcation
  const financials = useMemo(() => {
    const playing = matchPayments.filter((p) => p.status !== "Not Playing");
    const grossValue = playing.reduce((sum, p) => sum + (p.feeOverride !== undefined ? p.feeOverride : match.fee), 0);

    let directCollected = 0;
    let directPaidCount = 0;
    let monthlyPlanCovered = 0;
    let monthlyPaidCount = 0;
    let clubSponsoredTotal = 0;
    let sponsoredCount = 0;
    let pendingDues = 0;
    let unpaidCount = 0;

    for (const p of playing) {
      const effectiveFee = p.feeOverride !== undefined ? p.feeOverride : match.fee;

      if (p.status === "Paid") {
        if (p.manualMethod === "club_sponsored") {
          const offset = p.feeOffsetAmount !== undefined ? p.feeOffsetAmount : match.fee;
          clubSponsoredTotal += offset;
          sponsoredCount++;
        } else if (p.manualMethod === "part_of_plan") {
          const collected = p.feeCollectedAmount !== undefined ? p.feeCollectedAmount : match.fee;
          const offset = p.feeOffsetAmount || 0;
          monthlyPlanCovered += collected;
          monthlyPaidCount++;
          if (offset > 0) {
            clubSponsoredTotal += offset;
            sponsoredCount++;
          }
        } else {
          // Direct collection (Razorpay, cash, direct deposit)
          const collected = p.feeCollectedAmount !== undefined ? p.feeCollectedAmount : effectiveFee;
          const offset = p.feeOffsetAmount !== undefined ? p.feeOffsetAmount : (match.fee > effectiveFee ? match.fee - effectiveFee : 0);
          directCollected += collected;
          directPaidCount++;
          if (offset > 0) {
            clubSponsoredTotal += offset;
            sponsoredCount++;
          }
        }
      } else if (p.status === "Unpaid") {
        pendingDues += effectiveFee;
        unpaidCount++;
        const offset = p.feeOffsetAmount !== undefined ? p.feeOffsetAmount : (match.fee > effectiveFee ? match.fee - effectiveFee : 0);
        if (offset > 0) {
          clubSponsoredTotal += offset;
          sponsoredCount++;
        }
      }
    }

    const totalAccounted = directCollected + monthlyPlanCovered + clubSponsoredTotal + pendingDues;
    const isBalanced = totalAccounted === grossValue;

    return {
      playingCount: playing.length,
      grossValue,
      directCollected,
      directPaidCount,
      monthlyPlanCovered,
      monthlyPaidCount,
      clubSponsoredTotal,
      sponsoredCount,
      pendingDues,
      unpaidCount,
      totalAccounted,
      isBalanced,
    };
  }, [matchPayments, match.fee]);

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

  // Plan Bifurcation Modal State
  const [bifurcationModal, setBifurcationModal] = useState<{
    paymentId: string;
    player: Player;
    plan: FeePlan;
    standardFee: number;
    playerFeeInput: number;
    offsetInput: number;
    actualFeeInput: number;
    isSubmitting: boolean;
  } | null>(null);

  const handleConfirmPlanBifurcation = async () => {
    if (!bifurcationModal) return;
    const { paymentId, plan, standardFee, offsetInput, actualFeeInput } = bifurcationModal;
    setBifurcationModal((prev) => (prev ? { ...prev, isSubmitting: true } : null));

    try {
      if (plan.type === "fixed") {
        const feeAmount = plan.feeAmount ?? standardFee;
        const offset = Math.max(0, standardFee - feeAmount);
        await store.applyFeePlanToPayment(
          match.id,
          paymentId,
          feeAmount,
          plan.name,
          offset,
          undefined,
          "Unpaid",
        );
      } else if (plan.type === "monthly") {
        const actualFee = Number(actualFeeInput) || 0;
        const offset = Number(offsetInput) || 0;
        await store.applyFeePlanToPayment(
          match.id,
          paymentId,
          0,
          `${plan.name} (Subscription)`,
          offset,
          actualFee,
          "Paid",
          "manual",
          "part_of_plan",
          appUser?.name || "Admin",
        );
      } else if (plan.type === "sponsored") {
        await store.applyFeePlanToPayment(
          match.id,
          paymentId,
          0,
          plan.name,
          standardFee,
          0,
          "Paid",
          "manual",
          "club_sponsored",
          appUser?.name || "Admin",
        );
      }
      setBifurcationModal(null);
    } catch (err) {
      console.error("Failed to apply plan bifurcation:", err);
      toast("Failed to apply fee plan. Please try again.", "error");
      setBifurcationModal((prev) => (prev ? { ...prev, isSubmitting: false } : null));
    }
  };
  
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

  const matchLabel = `vs ${match.opponent || "Match"} (${formatDate(match.date)})`;
  const myLateFees = (() => {
    if (!myPayment || myPayment.status !== "Unpaid") return [];
    if (!isMatchBillable(match)) return [];
    if (myPayment.feeOverride === 0) return [];
    const exempted = store.otherFees.some(
      (f: any) =>
        f.playerId === myPayment.playerId &&
        f.title?.startsWith("Late Fee Exemption:") &&
        f.title?.includes(match.id) &&
        f.status !== "Cancelled",
    );
    if (exempted) return [];
    const alreadyPersisted = store.otherFees.some(
      (f: any) =>
        f.playerId === myPayment.playerId &&
        f.status !== "Cancelled" &&
        (
          (f.title?.startsWith("Late Fee") && (f.title?.includes(match.id) || f.title?.includes(matchLabel) || f.comment?.includes(match.id))) ||
          (f.templateId && f.templateId.includes(`latefee_${match.id}`))
        ),
    );
    if (alreadyPersisted) return [];
    return computeLateFees(match.date, match.id, myPayment.playerId, matchLabel);
  })();
  const myLateFeeTotal = myLateFees.reduce((s, f) => s + f.amount, 0);

  const handlePaySecure = async () => {
    if (!myPayment || !match.fee) return;
    if (store.appConfig?.features?.payments === false) {
      toast("This feature is currently not available. Contact Club Admin");
      return;
    }

    const baseFee = getPlayerFee(myPayment);
    const payableFee = baseFee + myLateFeeTotal;
    if (payableFee <= 0) {
      toast("Your fee is ₹0 (sponsored). No payment needed.");
      return;
    }

    setIsProcessingPayment(true);
    try {
      const rzpId =
        store.appConfig?.razorpayKeyId ||
        process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

      if (!rzpId) {
        toast("Razorpay keys are missing (Settings -> Payment Gateway)", "error");
        setIsProcessingPayment(false);
        return;
      }

      const res = await authedFetch("/api/razorpay/order", {
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
            playerId: myPayment.playerId,
            lateFeeItems: myLateFees.map(lf => ({
              playerId: myPayment.playerId,
              label: lf.label,
              amount: lf.amount,
              templateId: `latefee_${match.id}`,
            })),
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
        description: myLateFeeTotal > 0
          ? `Match Fee ₹${baseFee} + Late Fee ₹${myLateFeeTotal} for ${match.opponent}`
          : `Payment for Match Fee against ${match.opponent}`,
        order_id: data.id,
        handler: async function (response: any) {
          try {
            await store.updatePaymentStatus(myPayment.id, "Paid", match.id, undefined, "razorpay");
            // Late fees are created and marked Paid server-side by the webhook
            toast("Payment Successful!", "success");
            setIsProcessingPayment(false);
            if (typeof onBack === 'function') onBack();
          } catch (err) {
            console.error("Failed to update status", err);
            toast(
              "Payment successful but status update failed. Please contact admin.",
            "error");
            setIsProcessingPayment(false);
          }
        },
        prefill: {
          name: appUser?.name || mePlayer?.name || "Player",
          email: appUser?.email || mePlayer?.email || "",
          contact: appUser?.mobile || mePlayer?.mobile || "",
        },
        theme: {
          color: "#D51F43", // Primary action brand color
        },
        modal: {
          ondismiss: function () {
            setIsProcessingPayment(false);
            toast("Payment was cancelled or closed.", "error");
            if (typeof onBack === 'function') onBack();
          },
        },
      };

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.on("payment.failed", async function (response: any) {
        setIsProcessingPayment(false);
        toast("Payment failed: " + response.error.description, "error");
        try {
          await store.updatePaymentStatus(myPayment.id, "Failed", match.id);
        } catch (e) {
          console.error("Could not notify admin of failure");
        }
        if (typeof onBack === 'function') onBack();
      });
      paymentObject.open();
    } catch (err: any) {
      toast("Error: " + err.message, "error");
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
    if (await confirmAction({ message: "Delete this comment?", destructive: true })) {
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
              toast("This player is already in the squad.");
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
          className="min-h-[44px] min-w-[44px] text-[13px] font-bold uppercase tracking-wider text-text-muted flex items-center gap-1 hover:text-text-primary transition cursor-pointer"
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

      <div className="bg-surface rounded-xl p-4">
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
                if (!await confirmAction({ message: "Remove tentative block and make this a regular match?", destructive: true })) return;
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
            <label className="flex items-center gap-2 cursor-pointer bg-surface-hover border border-border px-3 py-1.5 rounded-lg hover:bg-surface-hover transition">
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
              <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">Archived</span>
            </label>
          )}
        </div>

        <div className="flex gap-3 text-sm text-text-secondary mb-4 font-mono flex-wrap items-center">
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

        <div className={`grid ${isAdmin ? "grid-cols-3" : "grid-cols-1"} gap-2 mb-4`}>
          <div className="bg-surface-hover border border-border rounded-lg p-3 text-center">
            <p className="text-3xl font-light">{played}</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-text-muted mt-1">
              Playing
            </p>
          </div>
          {isAdmin && (
            <>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
                <p className="text-3xl font-light text-accent">{paid}</p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-400/70 mt-1">
                  Paid
                </p>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center">
                <p className="text-3xl font-light text-red-400">{unpaid}</p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-red-400/70 mt-1">
                  Unpaid
                </p>
              </div>
            </>
          )}
        </div>

        {(match.matchUrl ||
          match.streamingUrl ||
          (match.result && match.result !== "Pending")) && (
          <div className="bg-surface-hover border border-border rounded-xl p-4 mb-4">
            <h4 className="text-[10px] uppercase tracking-widest text-text-muted font-bold mb-3">
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
              <div className="pt-3 border-t border-border">
                <p
                  className={`font-bold text-sm mb-3 ${match.result === "KAvach Won" ? "text-accent" : match.result === "KAvach Lost" ? "text-red-400" : "text-text-secondary"}`}
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
                        <div className="bg-surface-hover p-2 rounded-lg border border-border">
                          <span className="text-text-muted font-mono text-[10px] block mb-0.5">
                            POTM
                          </span>
                          <span className="font-bold text-xs">
                            {match.potmId ? store.players.find(p => p.id === match.potmId)?.name : match.playerOfTheMatch}
                          </span>
                        </div>
                      )}
                      {match.bestBatsman && (
                        <div className="bg-surface-hover p-2 rounded-lg border border-border">
                          <span className="text-text-muted font-mono text-[10px] block mb-0.5">
                            BEST BATSMAN
                          </span>
                          <span className="font-bold text-xs">
                            {match.bestBatsman}
                          </span>
                        </div>
                      )}
                      {match.bestBowler && (
                        <div className="bg-surface-hover p-2 rounded-lg border border-border">
                          <span className="text-text-muted font-mono text-[10px] block mb-0.5">
                            BEST BOWLER
                          </span>
                          <span className="font-bold text-xs">
                            {match.bestBowler}
                          </span>
                        </div>
                      )}
                      {match.topPerformerIds && match.topPerformerIds.length > 0 && (
                        <div className="sm:col-span-3 bg-surface-hover p-2 rounded-lg border border-border">
                          <span className="text-text-muted font-mono text-[10px] block mb-0.5">
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
                      toast("WhatsApp Report Copied to Clipboard!", "success");
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
          <div className="bg-surface rounded-xl p-4 my-4 border border-emerald-500/20 bg-gradient-to-br from-emerald-950/20 to-black/40">
            <div className="flex items-center justify-between pb-3 border-b border-border flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-text-primary">
                  Match Fee Financial Bifurcation
                </span>
              </div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-secondary bg-surface-hover px-2 py-0.5 rounded border border-border">
                {financials.playingCount} Playing • ₹{match.fee}/each
              </span>
            </div>

            {/* Financial breakdown metrics grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-3">
              {/* 1. Direct Collections */}
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/80">
                  Direct Collected
                </p>
                <p className="text-lg font-mono font-bold text-emerald-400 mt-0.5">
                  ₹{financials.directCollected}
                </p>
                <p className="text-[9px] text-text-muted mt-0.5 font-mono">
                  {financials.directPaidCount} player(s) paid
                </p>
              </div>

              {/* 2. Monthly Plans */}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400/80">
                  Monthly Plans
                </p>
                <p className="text-lg font-mono font-bold text-blue-400 mt-0.5">
                  ₹{financials.monthlyPlanCovered}
                </p>
                <p className="text-[9px] text-text-muted mt-0.5 font-mono">
                  {financials.monthlyPaidCount} sub allocation(s)
                </p>
              </div>

              {/* 3. Club Sponsored / Offset */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400/80">
                  Club Sponsored
                </p>
                <p className="text-lg font-mono font-bold text-amber-400 mt-0.5">
                  ₹{financials.clubSponsoredTotal}
                </p>
                <p className="text-[9px] text-text-muted mt-0.5 font-mono">
                  {financials.sponsoredCount} offset(s) absorbed
                </p>
              </div>

              {/* 4. Pending Dues */}
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-red-400/80">
                  Pending Dues
                </p>
                <p className="text-lg font-mono font-bold text-red-400 mt-0.5">
                  ₹{financials.pendingDues}
                </p>
                <p className="text-[9px] text-text-muted mt-0.5 font-mono">
                  {financials.unpaidCount} unpaid player(s)
                </p>
              </div>
            </div>

            {/* Bottom summary bar with full mathematical reconciliation */}
            <div className="pt-2.5 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px]">
              <div className="flex items-center gap-3 text-text-secondary font-mono flex-wrap">
                <span>
                  Gross Match Value: <strong className="text-text-primary font-mono">₹{financials.grossValue}</strong>
                </span>
                <span>•</span>
                <span>
                  Total Accounted:{" "}
                  <strong className={`font-mono ${financials.isBalanced ? "text-emerald-400" : "text-amber-400"}`}>
                    ₹{financials.totalAccounted}
                  </strong>
                </span>
                {match.matchFeeBudget ? (
                  <>
                    <span>•</span>
                    <span>
                      Budget: <strong className="text-text-primary font-mono">₹{match.matchFeeBudget}</strong>
                    </span>
                  </>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold shrink-0">
                {financials.isBalanced ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 100% Accounted
                  </span>
                ) : (
                  <span className="text-amber-400 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> ₹{Math.abs(financials.grossValue - financials.totalAccounted)} variance
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {(() => {
            const ground = store.grounds.find((g) => g.id === match.groundId);
            if (!ground) return null;
            return (
              <div className="mt-4 pt-4 border-t border-border">
                <a
                  href={ground.mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-text-primary hover:text-accent transition group"
                >
                  <MapPin className="w-4 h-4 text-accent shrink-0" />
                  <span className="group-hover:underline truncate">
                    {ground.name}
                  </span>
                  <span className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded font-bold uppercase ml-auto shrink-0 border border-accent/20">
                    Get Directions
                  </span>
                </a>
                <p className="text-[10px] text-text-muted mt-2 font-mono uppercase tracking-widest pl-6">
                  Approx time to reach if you start now: 35-45 mins
                </p>
              </div>
            );
          })()}
      </div>

      {!isAdmin &&
        myPayment?.status === "Unpaid" && (() => {
          const myFee = getPlayerFee(myPayment);
          const totalFee = myFee + myLateFeeTotal;
          return (
            <div className="bg-surface rounded-xl p-6 text-center space-y-4">
              <h3 className="text-lg font-bold">Your Match Fee is Pending</h3>
              {myLateFeeTotal > 0 ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm px-4">
                    <span className="text-text-secondary">Match Fee</span>
                    <span className="font-mono text-text-primary">₹{myFee}</span>
                  </div>
                  {myLateFees.map((lf, i) => (
                    <div key={i} className="flex justify-between text-sm px-4">
                      <span className="text-red-400">{lf.label}</span>
                      <span className="font-mono text-red-400">₹{lf.amount}</span>
                    </div>
                  ))}
                  <div className="border-t border-border pt-2 flex justify-between text-sm px-4 font-bold">
                    <span className="text-text-primary">Total</span>
                    <span className="text-accent text-2xl font-mono">₹{totalFee}</span>
                  </div>
                </div>
              ) : (
                <p className="text-accent text-3xl font-light font-mono">
                  ₹{myFee}
                </p>
              )}
              {myPayment.planTag && (
                <p className="text-[10px] text-amber-400 font-bold uppercase tracking-widest">
                  {myPayment.planTag}
                </p>
              )}
              <button
                disabled={isProcessingPayment}
                onClick={handlePaySecure}
                className="w-full bg-accent text-text-accent font-bold py-3 rounded-lg hover:bg-accent/90 disabled:opacity-50 transition shadow-lg flex items-center justify-center gap-2"
              >
                {isProcessingPayment ? "Processing..." : `Pay ₹${totalFee} Securely`}
              </button>
              <p className="text-[10px] text-text-muted uppercase tracking-widest">
                Settle your dues before the match
              </p>
            </div>
          );
        })()}

      {!isAdmin && mePlayer && store.appConfig?.matchConfiguration?.enablePlayerAvailability && (
        <div className="bg-surface rounded-xl p-4 text-center mt-4">
          {myPayment && myPayment.status === "Not Playing" && (
            <p className="text-text-secondary text-sm mb-4">
              You are not marked to play this match.
            </p>
          )}
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-3">
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
                    className={`flex-1 py-2 rounded-lg font-bold text-sm border transition ${isSelected ? (avStat === "Yes" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]" : avStat === "No" ? "bg-red-500/20 text-red-500 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]" : "bg-amber-500/20 text-amber-500 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]") : "bg-transparent text-text-primary border-border hover:bg-surface-hover"}`}
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
        <div className="bg-surface rounded-xl p-4 text-center mt-4 border border-red-500/20">
          <p className="text-text-secondary text-sm mb-2">
            You need to complete your player profile in the Account tab or ask
            an admin to link your profile before you can mark your availability.
          </p>
        </div>
      )}

      {store.appConfig?.matchConfiguration?.enablePlayerAvailability && (
        <div className="bg-surface sm:rounded-xl overflow-hidden -mx-4 sm:mx-0 pr-[calc(env(safe-area-inset-right))] pl-[calc(env(safe-area-inset-left))] mt-4 mb-4">
          <div className="px-4 py-3 bg-surface-hover border-b border-border font-bold text-[12px] uppercase tracking-widest text-text-primary">
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
                <div className="flex flex-wrap gap-2 text-sm text-text-primary">
                  {paymentsInStat.map((payment) => {
                    const p = store.players.find(pl => pl.id === payment.playerId);
                    if (!p) return null;
                    const isPaid = payment.status === "Paid";
                    return (
                      <span
                        key={payment.id}
                        className={`bg-surface-hover border px-2 py-1 rounded inline-flex items-center gap-1.5 max-w-[250px] ${isAdmin && isPaid ? "border-emerald-500/30" : "border-border"}`}
                      >
                        <span className="truncate flex items-center gap-1">
                          {payment.guestName || p.name}
                          {isAdmin && isPaid && <span className="text-[9px] uppercase tracking-widest text-emerald-400 font-bold ml-1">Paid</span>}
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
                            className="text-[9px] uppercase font-bold bg-transparent text-text-muted hover:text-text-primary border-none outline-none cursor-pointer  appearance-none text-right"
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
        <div className="bg-surface sm:rounded-xl overflow-hidden -mx-4 sm:mx-0 pr-[calc(env(safe-area-inset-right))] pl-[calc(env(safe-area-inset-left))]">
          <div className="px-4 py-3 bg-surface-hover border-b border-border font-bold text-[12px] uppercase tracking-widest text-text-primary flex items-center justify-between">
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
              className="p-4 bg-surface-hover border-b border-border space-y-3"
            >
              <div className="flex bg-surface-hover rounded-lg p-1 border border-border mb-3">
                <button
                  type="button"
                  onClick={() => setAddingNew(false)}
                  className={`flex-1 text-[11px] font-bold uppercase py-1.5 rounded-md transition ${!addingNew ? "bg-surface-hover text-text-primary" : "text-text-muted"}`}
                >
                  Existing
                </button>
                <button
                  type="button"
                  onClick={() => setAddingNew(true)}
                  className={`flex-1 text-[11px] font-bold uppercase py-1.5 rounded-md transition ${addingNew ? "bg-surface-hover text-text-primary" : "text-text-muted"}`}
                >
                  New
                </button>
              </div>

              {!addingNew ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type="text"
                      placeholder="Search players..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1 border border-border rounded-md p-1 bg-surface-hover custom-scrollbar">
                    {filteredPlayers.length === 0 ? (
                      <p className="text-center text-[10px] uppercase tracking-widest text-text-muted py-3">
                        No players found
                      </p>
                    ) : (
                      filteredPlayers.map((p) => (
                        <label
                          key={p.id}
                          className={`flex items-center gap-2 p-2 rounded cursor-pointer ${selectedPlayerIds.includes(p.id) ? "bg-accent/10 border-accent/50" : "hover:bg-surface-hover border-transparent"} border transition`}
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
                            className={`w-4 h-4 rounded shrink-0 flex items-center justify-center border transition ${selectedPlayerIds.includes(p.id) ? "bg-accent border-accent text-black" : "border-border"}`}
                          >
                            {selectedPlayerIds.includes(p.id) && (
                              <Check className="w-3 h-3" />
                            )}
                          </div>
                          <span className="text-sm font-medium">
                            {p.name}{" "}
                            {p.mobile && (
                              <span className="text-[10px] text-text-muted font-mono inline-block ml-1">
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
                    <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">
                      Name
                    </label>
                    <input
                      required
                      type="text"
                      value={newPlayerName}
                      onChange={(e) => setNewPlayerName(e.target.value)}
                      className="w-full rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1 block">
                      Mobile
                    </label>
                    <input
                      required
                      type="tel"
                      value={newPlayerMobile}
                      onChange={(e) => setNewPlayerMobile(e.target.value)}
                      className="w-full rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <button
                disabled={
                  isSubmitting || (!addingNew && selectedPlayerIds.length === 0)
                }
                type="submit"
                className={`w-full ${confirmSquadDuplicates ? "bg-red-500 text-white" : "bg-accent text-text-accent"} font-bold text-sm py-2 rounded shadow transition disabled:opacity-50`}
              >
                {isSubmitting
                  ? "Adding..."
                  : confirmSquadDuplicates
                  ? "Confirm Guest Assignment"
                  : "Add to Squad"}
              </button>
            </form>
          )}

          <div className="divide-y divide-border">
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
                  className="p-4 flex flex-col gap-2 hover:bg-surface-hover transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-text-primary truncate">
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
                        {payment.feeOffsetAmount ? (
                          <span className="ml-2 font-mono text-[10px] text-emerald-400/90 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                            Offset ₹{payment.feeOffsetAmount}
                          </span>
                        ) : null}
                      </p>
                      {isAdmin && (
                        <p className="text-xs font-mono text-text-muted mt-0.5">
                          {player.mobile}
                        </p>
                      )}
                      {payment.planTag && (
                        <p className="text-[10px] text-amber-400/80 font-bold uppercase tracking-wider mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span>{payment.planTag}</span>
                          {payment.manualMethod === "part_of_plan" && payment.feeCollectedAmount !== undefined && (
                            <span className="text-blue-400 font-mono text-[9px] lowercase font-normal">
                              (₹{payment.feeCollectedAmount} sub)
                            </span>
                          )}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      {isAdmin ? (
                        <>
                          <select
                            value={payment.status}
                            onChange={async (e) => {
                              const newStatus = e.target.value;
                              await store.updatePaymentStatus(
                                payment.id,
                                newStatus as any,
                                match.id,
                                undefined,
                                newStatus === "Paid" ? "manual" : undefined,
                                newStatus === "Paid" ? (appUser?.name || "Admin") : undefined,
                              );
                              if (newStatus === "Paid") {
                                const exempted = store.otherFees.some(
                                  (f: any) =>
                                    f.playerId === payment.playerId &&
                                    f.title?.startsWith("Late Fee Exemption:") &&
                                    f.title?.includes(match.id) &&
                                    f.status !== "Cancelled",
                                );
                                if (!exempted) {
                                  const existingLateFee = store.otherFees.some(
                                    (f: any) =>
                                      f.playerId === payment.playerId &&
                                      f.templateId === `latefee_${match.id}` &&
                                      f.status !== "Cancelled",
                                  );
                                  if (!existingLateFee) {
                                    const pLabel = `vs ${match.opponent || "Match"} (${formatDate(match.date)})`;
                                    const fees = computeLateFees(match.date, match.id, payment.playerId, pLabel);
                                    for (const lf of fees) {
                                      const feeId = await store.addOtherFee(payment.playerId, {
                                        title: lf.label,
                                        amount: lf.amount,
                                        comment: "Auto-levied late fee penalty (admin marked paid)",
                                        templateId: `latefee_${match.id}`,
                                      });
                                      if (feeId) await store.updateOtherFeeStatus(payment.playerId, feeId, "Paid", "manual");
                                    }
                                  }
                                }
                              }
                            }}
                            className={`text-[12px] font-bold uppercase tracking-widest rounded-md border py-2 px-2 focus:outline-none ${
                              payment.status === "Paid"
                                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                                : payment.status === "Unpaid"
                                  ? "bg-red-500/20 text-red-400 border-red-500/30"
                                  : "bg-surface-hover text-text-secondary border-border "
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
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {/* Plan quick-apply for unpaid players without override */}
                      {payment.status === "Unpaid" && !hasOverride && playerPlans.map((plan: FeePlan) => {
                        return (
                          <button
                            key={plan.id}
                            onClick={() => {
                              const feeAmount = plan.type === "fixed" ? (plan.feeAmount ?? match.fee) : 0;
                              const offset = plan.type === "sponsored" 
                                ? match.fee 
                                : plan.type === "fixed" 
                                  ? Math.max(0, match.fee - feeAmount) 
                                  : 0;
                              const actualFee = plan.type === "monthly" ? match.fee : 0;
                              setBifurcationModal({
                                paymentId: payment.id,
                                player,
                                plan,
                                standardFee: match.fee,
                                playerFeeInput: feeAmount,
                                offsetInput: offset,
                                actualFeeInput: actualFee,
                                isSubmitting: false,
                              });
                            }}
                            className={`text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded transition border ${
                              plan.type === "fixed"
                                ? "bg-amber-500/15 text-amber-400 border-amber-500/25 hover:bg-amber-500/25"
                                : plan.type === "monthly"
                                  ? "bg-blue-500/15 text-blue-400 border-blue-500/25 hover:bg-blue-500/25"
                                  : "bg-green-500/15 text-green-400 border-green-500/25 hover:bg-green-500/25"
                            }`}
                          >
                            {plan.name} {plan.type === "fixed" ? `(₹${plan.feeAmount})` : plan.type === "sponsored" ? "(₹0)" : `(₹${plan.monthlyAmount}/mo)`}
                          </button>
                        );
                      })}

                      {/* Dropdown for other active club plans not in playerPlans */}
                      {payment.status === "Unpaid" && !hasOverride && (() => {
                        const otherPlans = store.feePlans.filter(
                          (fp: FeePlan) => fp.isActive !== false && !playerPlans.some((pp) => pp.id === fp.id)
                        );
                        if (otherPlans.length === 0) return null;
                        return (
                          <select
                            onChange={(e) => {
                              const selectedId = e.target.value;
                              if (!selectedId) return;
                              const selectedPlan = store.feePlans.find((fp: FeePlan) => fp.id === selectedId);
                              if (selectedPlan) {
                                const feeAmount = selectedPlan.type === "fixed" ? (selectedPlan.feeAmount ?? match.fee) : 0;
                                const offset = selectedPlan.type === "sponsored" 
                                  ? match.fee 
                                  : selectedPlan.type === "fixed" 
                                    ? Math.max(0, match.fee - feeAmount) 
                                    : 0;
                                const actualFee = selectedPlan.type === "monthly" ? match.fee : 0;
                                setBifurcationModal({
                                  paymentId: payment.id,
                                  player,
                                  plan: selectedPlan,
                                  standardFee: match.fee,
                                  playerFeeInput: feeAmount,
                                  offsetInput: offset,
                                  actualFeeInput: actualFee,
                                  isSubmitting: false,
                                });
                              }
                              e.target.value = "";
                            }}
                            className="text-[9px] font-bold uppercase tracking-widest bg-surface-hover text-text-secondary border border-white/15 px-2 py-1 rounded hover:bg-surface-hover hover:text-text-primary transition cursor-pointer [&>option]:bg-surface"
                            defaultValue=""
                          >
                            <option value="" disabled>+ Match Fee Plan</option>
                            {otherPlans.map((op) => (
                              <option key={op.id} value={op.id}>
                                {op.name} ({op.type})
                              </option>
                            ))}
                          </select>
                        );
                      })()}

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

                      {/* Undo fee override / reset plan */}
                      {(hasOverride || payment.feeOffsetAmount !== undefined || payment.planTag) && (
                        <button
                          onClick={async () => {
                            if (!await confirmAction({ message: `Reset ${payment.guestName || player.name}'s fee back to standard ₹${match.fee} and clear all plan offsets?`, destructive: true })) return;
                            await store.clearFeeOverride(match.id, payment.id);
                          }}
                          className="text-[9px] font-bold uppercase tracking-widest bg-surface-hover text-text-secondary border border-white/15 px-2 py-1 rounded hover:bg-surface-hover hover:text-text-primary transition flex items-center gap-1"
                          title="Reset fee to standard and clear all offsets"
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
            className="w-full max-w-sm bg-surface rounded-xl border border-purple-500/30 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-bold text-text-primary text-sm">Change Fee Payer</h3>
                <p className="text-[10px] text-text-muted mt-0.5">
                  Who will pay <span className="text-purple-400 font-bold">{feePayerPicker.playerName}</span>&apos;s fee of ₹{feePayerPicker.fee}?
                </p>
              </div>
              <button onClick={() => setFeePayerPicker(null)} className="p-1.5 hover:bg-surface-hover rounded-full transition">
                <X className="w-4 h-4 text-text-muted" />
              </button>
            </div>
            <div className="p-3">
              <input
                type="text"
                placeholder="Search members..."
                value={feePayerPicker.search}
                onChange={(e) => setFeePayerPicker({ ...feePayerPicker, search: e.target.value })}
                className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-primary/30 focus:outline-none focus:border-purple-500/50 mb-2"
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
                          <span className="text-sm font-semibold text-text-primary group-hover:text-purple-300 transition">{pl.name}</span>
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

      {/* Plan Confirmation & Bifurcation Modal */}
      {bifurcationModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => !bifurcationModal.isSubmitting && setBifurcationModal(null)}
        >
          <div
            className="w-full max-w-md bg-surface rounded-2xl border border-border overflow-hidden shadow-2xl space-y-0"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 bg-surface-hover border-b border-border flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                      bifurcationModal.plan.type === "fixed"
                        ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                        : bifurcationModal.plan.type === "monthly"
                          ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                          : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    }`}
                  >
                    {bifurcationModal.plan.type === "fixed"
                      ? "Fixed / Flat Fee"
                      : bifurcationModal.plan.type === "monthly"
                        ? "Monthly Subscription"
                        : "Club Sponsored"}
                  </span>
                  <span className="text-[11px] font-mono text-text-muted">
                    Match: ₹{bifurcationModal.standardFee}
                  </span>
                </div>
                <h3 className="font-bold text-text-primary text-base mt-1">
                  Apply &ldquo;{bifurcationModal.plan.name}&rdquo;
                </h3>
                <p className="text-xs text-text-secondary">
                  Player: <strong className="text-text-primary">{bifurcationModal.player.name}</strong>
                </p>
              </div>
              <button
                disabled={bifurcationModal.isSubmitting}
                onClick={() => setBifurcationModal(null)}
                className="p-1.5 hover:bg-surface-hover rounded-full transition text-text-muted hover:text-text-primary disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 text-sm">
              {/* Scenario 1: Fixed / Flat Fee */}
              {bifurcationModal.plan.type === "fixed" && (() => {
                const feeAmount = bifurcationModal.plan.feeAmount ?? bifurcationModal.standardFee;
                const offset = Math.max(0, bifurcationModal.standardFee - feeAmount);
                return (
                  <div className="space-y-4">
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3.5 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-text-secondary">Standard Match Fee</span>
                        <span className="font-mono font-semibold text-text-primary">₹{bifurcationModal.standardFee}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm border-t border-amber-500/20 pt-2 font-bold">
                        <span className="text-amber-300">Player Due ({bifurcationModal.plan.name})</span>
                        <span className="font-mono text-amber-400 text-base">₹{feeAmount}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs border-t border-amber-500/20 pt-2">
                        <span className="text-emerald-400">Club Sponsored (Offset)</span>
                        <span className="font-mono font-bold text-emerald-400">₹{offset}</span>
                      </div>
                    </div>

                    <div className="bg-surface-hover border border-border rounded-lg p-3 text-xs text-text-secondary space-y-1.5">
                      <p className="flex items-center gap-1.5 text-text-primary font-medium">
                        <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        Accountability Notice:
                      </p>
                      <p>
                        The player will see <strong className="text-amber-300 font-mono">₹{feeAmount}</strong> due in the portal and remain marked as <span className="text-red-400 font-bold uppercase text-[10px]">Unpaid</span> until received.
                      </p>
                      <p>
                        The remaining <strong className="text-emerald-400 font-mono">₹{offset}</strong> is recorded as <span className="text-emerald-400 font-bold">Club Sponsored</span> for this match.
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* Scenario 2: Monthly Subscription */}
              {bifurcationModal.plan.type === "monthly" && (
                <div className="space-y-4">
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3.5 space-y-1.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-text-secondary">Subscription Plan</span>
                      <span className="font-bold text-blue-300">{bifurcationModal.plan.name}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-text-secondary">Subscription Amount</span>
                      <span className="font-mono text-text-primary">₹{bifurcationModal.plan.monthlyAmount ?? 0}/month</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-text-secondary">Standard Match Fee</span>
                      <span className="font-mono font-bold text-text-primary">₹{bifurcationModal.standardFee}</span>
                    </div>
                  </div>

                  <div className="space-y-3 bg-surface-hover border border-border rounded-xl p-3.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                      Fee Allocation for this Match:
                    </p>
                    <div>
                      <label className="text-xs text-text-primary font-medium block mb-1">
                        Actual Fee Covered from Subscription (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={bifurcationModal.actualFeeInput}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          const autoOffset = Math.max(0, bifurcationModal.standardFee - val);
                          setBifurcationModal((prev) =>
                            prev ? { ...prev, actualFeeInput: val, offsetInput: autoOffset } : null
                          );
                        }}
                        className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-primary font-medium block mb-1">
                        Club Sponsored / Offset Portion (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={bifurcationModal.offsetInput}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          setBifurcationModal((prev) =>
                            prev ? { ...prev, offsetInput: val } : null
                          );
                        }}
                        className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="bg-surface-hover border border-border rounded-lg p-3 text-xs text-text-secondary space-y-1.5">
                    <p className="flex items-center gap-1.5 text-text-primary font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      Status upon Confirmation:
                    </p>
                    <p>
                      Player will be automatically marked as <span className="text-emerald-400 font-bold uppercase text-[10px]">Paid</span> (Part of Monthly Plan).
                    </p>
                  </div>
                </div>
              )}

              {/* Scenario 3: 100% Club Sponsored */}
              {bifurcationModal.plan.type === "sponsored" && (
                <div className="space-y-4">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3.5 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-text-secondary">Standard Match Fee</span>
                      <span className="font-mono font-semibold text-text-primary">₹{bifurcationModal.standardFee}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm border-t border-emerald-500/20 pt-2 font-bold">
                      <span className="text-emerald-400">Total Club Sponsored</span>
                      <span className="font-mono text-emerald-400 text-base">₹{bifurcationModal.standardFee}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs border-t border-emerald-500/20 pt-2">
                      <span className="text-text-secondary">Player Liability</span>
                      <span className="font-mono font-bold text-text-primary">₹0</span>
                    </div>
                  </div>

                  <div className="bg-surface-hover border border-border rounded-lg p-3 text-xs text-text-secondary space-y-1.5">
                    <p className="flex items-center gap-1.5 text-text-primary font-medium">
                      <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      Confirmation Notice:
                    </p>
                    <p>
                      The entire <strong className="text-emerald-400 font-mono">₹{bifurcationModal.standardFee}</strong> will be absorbed by the club.
                    </p>
                    <p>
                      Player will be immediately marked as <span className="text-emerald-400 font-bold uppercase text-[10px]">Paid</span>.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-surface-hover border-t border-border flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={bifurcationModal.isSubmitting}
                onClick={() => setBifurcationModal(null)}
                className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider text-text-secondary hover:text-text-primary hover:bg-surface-hover transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bifurcationModal.isSubmitting}
                onClick={handleConfirmPlanBifurcation}
                className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-accent text-text-accent hover:bg-accent/90 transition shadow disabled:opacity-50 flex items-center gap-1.5 font-bold"
              >
                {bifurcationModal.isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Confirm & Apply Plan
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Match Comments Section */}
      <div className="bg-surface sm:rounded-xl overflow-hidden -mx-4 sm:mx-0 pr-[calc(env(safe-area-inset-right))] pl-[calc(env(safe-area-inset-left))] mt-4">
        <div className="px-4 py-3 bg-surface-hover border-b border-border font-bold text-[12px] uppercase tracking-widest text-text-primary flex items-center gap-2">
          <MessageSquare className="w-4 h-4" /> Discussion
        </div>

        <div className="p-4 space-y-4 max-h-[300px] overflow-y-auto custom-scrollbar">
          {comments.length === 0 ? (
            <div className="text-center text-xs text-text-muted italic py-4">
              No comments yet. Start the discussion!
            </div>
          ) : (
            comments.map((comment) => (
              <div
                key={comment.id}
                className={`flex flex-col ${comment.playerId === user?.uid ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2 ${comment.playerId === user?.uid ? "bg-accent text-text-accent rounded-tr-sm" : "bg-surface-hover text-text-primary rounded-tl-sm"}`}
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
                    className="text-[10px] text-text-muted hover:text-red-400 font-bold uppercase tracking-widest mt-1 mr-1 ml-1 transition"
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
          className="p-3 bg-surface-hover border-t border-border flex gap-2"
        >
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Discuss logistics, rides..."
            className="flex-1 bg-surface-hover border border-border rounded-full px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent transition"
            maxLength={1000}
          />
          <button
            type="submit"
            disabled={!newComment.trim() || isSubmittingComment}
            className="bg-accent text-text-accent px-4 py-2 rounded-full font-bold text-sm hover:bg-accent/90 transition disabled:opacity-50 shrink-0 flex items-center justify-center min-w-[70px]"
          >
            {isSubmittingComment ? "..." : "Send"}
          </button>
        </form>
      </div>

      {/* Group Remind Modal */}
      {isGroupRemindModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-xl w-full max-w-sm p-4 relative shadow-2xl animate-fade-in">
            <button
              onClick={() => setIsGroupRemindModalOpen(false)}
              className="absolute top-4 right-4 text-text-muted hover:text-text-primary transition"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-400 mb-2 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Remind Group
            </h3>
            <p className="text-xs text-text-secondary mb-4 leading-relaxed">
              This will open WhatsApp with the match details and squad list. You can select your club's WhatsApp group to send the message.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted block mb-1">
                  Optional Custom Message
                </label>
                <textarea
                  value={groupRemindCustomMsg}
                  onChange={(e) => setGroupRemindCustomMsg(e.target.value)}
                  className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50 text-text-primary placeholder-text-muted"
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
    <div className="bg-surface rounded-xl p-5 border border-border">
      <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent mb-4">
        Assign Players to Match Squad
      </h3>
      <form onSubmit={handleAssignMatch} className="space-y-4">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1 block">
            Select Match
          </label>
          <select
            value={selectedMatch}
            onChange={(e) => {
              setSelectedMatch(e.target.value);
              setConfirmDuplicates(false);
            }}
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-text-primary"
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
            <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
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
            className="w-full bg-surface-hover border border-border rounded-t-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-text-primary mb-0"
          />

          <div className="h-40 overflow-y-auto border border-t-0 border-border rounded-b-lg bg-surface-hover p-2 gap-1 flex flex-col hide-scrollbar">
            {filteredPlayers.length === 0 && (
              <div className="text-xs text-text-muted italic p-2 text-center">
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
                  className={`flex items-center gap-2 p-2 rounded cursor-pointer transition ${selectedPlayers.includes(p.id) ? "bg-accent/20 border border-accent/30 text-text-primary" : "hover:bg-surface-hover border border-transparent text-text-secondary"}`}
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
                  <span className="flex-shrink-0 text-text-primary w-24 truncate">{p?.name}</span>
                  <input 
                    type="text" 
                    placeholder="Guest Name (e.g., Rajeev)"
                    className="flex-1 bg-surface-hover border border-red-500/50 rounded px-2 py-1 text-xs text-text-primary"
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
          className={`w-full ${confirmDuplicates ? "bg-red-500 text-white" : "bg-accent text-text-accent"} font-bold py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition shadow text-sm mt-2`}
        >
          {confirmDuplicates
            ? "Confirm Duplicate Assignment"
            : `Assign ${selectedPlayers.length} Player(s) to Match`}
        </button>
      </form>
    </div>
  );
}

