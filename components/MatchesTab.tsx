/**
 * Matches & Grounds Manager (`components/MatchesTab.tsx`)
 *
 * High-level component controlling the scheduling, managing, and viewing
 * of sporting matches. For Admins, it includes features to create/edit/score
 * matches, and manage the underlying grounds/locations. For standard Players,
 * it provides views to mark availability and see match history.
 * It contains sub-components for assigning match outcomes and viewing venues.
 */
import { useStore } from "@/hooks/useStore";
import { authedFetch } from "@/lib/authed-fetch";
import { Match, MatchPayment } from "@/lib/types";
import { isMatchBillable } from "@/lib/matchBillable";

import {
  Plus,
  Edit2,
  Copy,
  ChevronRight,
  ChevronDown,
  Calendar,
  MapPin,
  Search,
  MessageSquare,
  Trash2,
  X,
  ArrowRightLeft,
  Shield,
  LayoutList,
  Table2,
  ArrowLeft,
  CalendarDays,
  Trophy,
} from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";
import { formatDate, dbToInputDate, inputToDbDate, normalizeIndianMobile, findExistingPlayer, computeLateFees, getClubCalendarDate } from "@/lib/utils";
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
import { DEFAULT_MARGIN_PCT, clampMargin, computeMatchFee, resolveFormFee, resolveGroundFee } from "@/lib/match-fee";
import { MatchDatePicker, formatPickerDate } from "./matches/MatchDatePicker";
import { MatchFeeCalculator } from "./matches/MatchFeeCalculator";
import { ChoiceGroup, FIELD_CLASS, FieldLabel, FormSection } from "./matches/MatchFormParts";
import { AdminMatchDateList } from "./matches/AdminMatchDateList";
import { MatchPaymentPanel } from "./matches/MatchPaymentPanel";
import { SquadPicker } from "./matches/SquadPicker";
import { FeePlanApplyDialog } from "./matches/FeePlanApplyDialog";
import { MatchDetailsSummary } from "./matches/MatchDetailsSummary";
import { cricHeroesHref } from "@/lib/weekend-ops";
import { FeeOverrideSheet } from "./matches/FeeOverrideSheet";
import { MatchInfoCard } from "./matches/MatchInfoCard";
import { SquadList, type SquadRow } from "./matches/SquadList";
import { MatchFinancialsCard } from "./matches/MatchFinancials";
import { MatchFinanceTab, ReversalSheet, type ReversalTarget } from "./matches/MatchFinanceTab";
import { buildMatchFinancialStatement } from "@/lib/match-finance";
import { matchStatus, type RowActionContext, type RowActionId } from "@/lib/match-squad";
import { buildMatchPlanApplication } from "@/lib/match-plan-application";
import { useFinancePlanAssignments } from "@/hooks/useFinancePlanAssignments";
import { callMatchPlans } from "@/hooks/useMatchFinancePlans";
import { formatMatchDisplayTime } from "@/lib/personal-match-payment";
import { computeMatchAvailabilityReadiness, hasExplicitAvailabilityResponse, resolveCanonicalPlayerPaymentRecord } from "@/lib/match-readiness";
import { runBulkOperations } from "@/lib/bulk-operations";
import { CaptainSelector } from "./matches/CaptainSelector";
import { SquadNotifyModal } from "./matches/SquadNotifyModal";
import {
  getUpcomingMatchesMissingCaptain,
  resolveMatchCaptain,
  shouldShowFridayCaptainReminder,
} from "@/lib/match-captain";
import {
  formatMatchDateTimeKolkata,
  getMatchesWithinNext48Hours,
} from "@/lib/squad-notify";

/** Admin Match Centre views, chosen from a dropdown (not tabs). */
export const MATCH_VIEW_OPTIONS = [
  { value: "list", label: "List View" },
  { value: "sheet", label: "Table View" },
  { value: "calendar", label: "Calendar View" },
] as const;
export type MatchViewMode = (typeof MATCH_VIEW_OPTIONS)[number]["value"];

/** Add / Edit Match wizard steps (nothing is saved before Review). */
type MatchFormStep = 1 | 2 | 3 | 4;
const MATCH_FORM_STEPS = ["Details", "Schedule", "Fee", "Review"] as const;

/** What blocks leaving a wizard step (null = fine). Squad size is no longer in the form. */
export function matchFormStepProblem(
  step: MatchFormStep,
  data: { groundId?: string; date?: string; time?: string; fee?: number | string },
): string | null {
  if (step === 1 && !data.groundId) return "Select a ground to continue.";
  if (step === 2 && !data.date) return "Pick a match date to continue.";
  if (step === 2 && !/^\d{1,2}:\d{2}/.test(data.time || "")) return "Choose a time, or enter one under Other.";
  if (step === 3 && (data.fee === "" || data.fee === undefined || Number(data.fee) < 0)) {
    return "Enter the match fee per player (0 if there is no fee).";
  }
  return null;
}

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
  // Match Center sections (D-18): Matches, Tournaments, Grounds. The former
  // Assign section is retired (D-19); an old "assign" link opens Matches.
  // Deep links may open a section directly ("grounds", "tournaments",
  // "grounds:<x>" from the legacy Grounds tab alias).
  const sectionFromAction = (a?: string | null): "matches" | "grounds" | "tournaments" => {
    const s = (a || "").split(":")[0];
    return s === "grounds" || s === "tournaments" ? s : "matches";
  };
  const [subTab, setSubTab] = useState<"matches" | "grounds" | "tournaments">(
    sectionFromAction(defaultAction)
  );
  useEffect(() => {
    if (defaultAction) setSubTab(sectionFromAction(defaultAction));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultAction]);
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
    } else if (defaultAction && defaultAction.startsWith("edit_")) {
      const targetMatchId = defaultAction.replace("edit_", "");
      const match = store.matches.find((m) => m.id === targetMatchId);
      if (match) {
        startEdit(match);
      }
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
    captainId: "",
  });

  // Margin for the fee calculator. A form control only (the match stores just
  // the resulting per-player fee, as before); starts at the 5% default.
  const [feeMarginPct, setFeeMarginPct] = useState<number>(DEFAULT_MARGIN_PCT);
  // Add / Edit Match is a 3-step wizard: 1 Details, 2 Schedule & type, 3 Fee.
  const [formStep, setFormStep] = useState<MatchFormStep>(1);
  const [formStepError, setFormStepError] = useState<string | null>(null);

  const { user, hasAdminClaim } = useAuth();
  const currentUserObj = store.appUsers.find(u => u.id === user?.uid);
  const currentUserName = currentUserObj?.name || "Admin";

  useEffect(() => {
    if (store.grounds.length > 0 && !formData.groundId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData((prev) => ({ ...prev, groundId: store.grounds[0].id, fee: getInitialFee() }));
    }
  }, [store.grounds, formData.groundId]);

  const [notifyModalMatch, setNotifyModalMatch] = useState<Match | null>(null);
  // Match finances closed (Manage Match → Finance): the fee basis is locked
  // (also enforced by Firestore rules); other match details stay editable.
  const editingFinanceClosed = !!editingId && store.matches.find((m) => m.id === editingId)?.financeStatus === "closed";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Only the Review step saves; Enter on earlier steps moves forward.
    if (formStep < 4) {
      goToFormStep((formStep + 1) as MatchFormStep);
      return;
    }
    const { captainId: selectedCaptainId, ...matchFields } = formData;
    const processedData = {
      ...matchFields,
      // Opponent is optional; an empty one is saved as "TBD".
      opponent: formData.opponent.trim() || "TBD",
      fee: Number(formData.fee) || 0,
      date: inputToDbDate(formData.date),
      // Remember the margin used, so editing reopens with it.
      feeMarginPct: clampMargin(feeMarginPct),
    };
    if (editingId) {
      const before = store.matches.find((m) => m.id === editingId);
      if (before && before.financeStatus === "closed") processedData.fee = Number(before.fee) || 0;
      const matchId = editingId;
      const feeOrDateChanged = !!before && (Number(before.fee) !== processedData.fee || before.date !== processedData.date);
      const captainChanged = (selectedCaptainId || "") !== (before?.captainId || "");
      Promise.resolve(store.updateMatch({ ...processedData, id: editingId } as Match)).then(async () => {
        if (captainChanged) {
          try {
            await store.assignMatchCaptain(matchId, selectedCaptainId || null);
          } catch (err: any) {
            toast(err?.message || "Match saved, but captain assignment failed.", "error");
          }
        }
        // Keep automatically applied Finance Plans in step with the new fee /
        // date. Only payments still exactly as the last automatic application
        // left them change; paid, overridden or hand-edited ones never do.
        if (!feeOrDateChanged) return;
        const r = await callMatchPlans({ action: "apply", matchId, scope: "refresh" });
        if (r.ok && "written" in r.data && r.data.written) {
          toast(`Finance Plans updated for ${r.data.written} player${r.data.written === 1 ? "" : "s"} after the fee/date change`, "success");
        } else if (!r.ok && r.status !== 403 && r.status !== 409) {
          toast("Match saved, but Finance Plans could not be updated. Open the match and use Finance Plans.", "error");
        }
      });
      setEditingId(null);
    } else {
      Promise.resolve(store.addMatch(processedData)).then(async (newMatchId) => {
        if (newMatchId && selectedCaptainId) {
          try {
            await store.assignMatchCaptain(newMatchId, selectedCaptainId);
          } catch (err: any) {
            toast(err?.message || "Match created, but captain assignment failed.", "error");
          }
        }
      });
    }
    setIsAdding(false);
    resetForm();
  };

  const resetForm = () => {
    setFeeMarginPct(DEFAULT_MARGIN_PCT);
    setFormStep(1);
    setFormStepError(null);
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
      captainId: "",
    });
  };

  const startEdit = (match: Match) => {
    // Reopen with the margin saved on the match (older matches: 5%). The saved
    // fee is kept as-is; it only recalculates when the admin changes something.
    setFeeMarginPct(match.feeMarginPct !== undefined ? clampMargin(match.feeMarginPct) : DEFAULT_MARGIN_PCT);
    // Editing uses the same wizard from step 1 (labels jump between steps).
    setFormStep(1);
    setFormStepError(null);
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
      captainId: match.captainId || "",
    });
    setEditingId(match.id);
    setIsAdding(true);
  };

  const startDuplicate = (match: Match) => {
    setFeeMarginPct(match.feeMarginPct !== undefined ? clampMargin(match.feeMarginPct) : DEFAULT_MARGIN_PCT);
    setFormStep(1);
    setFormStepError(null);
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
      captainId: "",
    });
    setEditingId(null);
    setIsAdding(true);
  };

  const userHasAdminPrivileges =
    isSuperAdmin ||
    isMatchAdmin ||
    hasAdminClaim ||
    currentUserObj?.isClubAdmin; // D-22: retired Match Admin flag grants nothing

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
    if (subTab === "matches" && activeView === "calendar") store.ensurePayments?.();
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
  /**
   * Per-player fee for a candidate form state. Precedence: linked tournament's
   * fee (Tournaments page) → ground fee for the match type → keep the current
   * (manually entered) fee. The fee field stays editable either way.
   */
  const recalcFee = (next: typeof formData, marginPct: number, fromMarginChange = false): number | "" => {
    const ground = store.grounds.find((g) => g.id === next.groundId);
    const tournament = next.tournamentId ? store.tournaments.find((t) => t.id === next.tournamentId) : undefined;
    const fee = resolveFormFee({ ground, matchType: next.matchType, tournament, marginPct, fromMarginChange });
    return fee === null ? next.fee : fee;
  };
  const isPresetTime = formData.time === "07:00" || formData.time === "12:00";
  const closeMatchForm = () => {
    setIsAdding(false);
    setEditingId(null);
    resetForm();
  };
  /** Moves between wizard steps; moving forward checks the steps in between. */
  function goToFormStep(target: MatchFormStep) {
    if (target > formStep) {
      for (let st = formStep; st < target; st++) {
        const problem = matchFormStepProblem(st as MatchFormStep, formData);
        if (problem) {
          setFormStep(st as MatchFormStep);
          setFormStepError(problem);
          return;
        }
      }
    }
    setFormStepError(null);
    setFormStep(target);
  }
  const selectBtn = (active: boolean) =>
    `flex-1 min-w-0 min-h-[44px] rounded-xl border text-sm font-bold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
      active ? "bg-brand border-brand text-white" : "bg-surface border-border text-text-primary hover:border-brand/40"
    }`;

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
      <form
        onSubmit={handleSubmit}
        data-testid="match-form"
        data-step={formStep}
        className="relative w-full sm:max-w-lg max-h-[100dvh] sm:max-h-[92vh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl bg-background shadow-xl flex flex-col"
      >
        {/* Header: back goes to the previous step (closes on step 1) */}
        <div className="sticky top-0 z-10 bg-surface border-b border-border">
          <div className="flex items-center gap-2 px-3 py-2">
            <button
              type="button"
              onClick={() => (formStep > 1 ? goToFormStep((formStep - 1) as MatchFormStep) : closeMatchForm())}
              aria-label={formStep > 1 ? "Previous step" : "Close"}
              data-testid="match-form-back"
              className="w-11 h-11 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-text-primary cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </button>
            <h2 id="match-form-title" className="flex-1 text-lg font-black font-heading text-text-primary">
              {editingId ? "Edit Match" : "Add Match"}
            </h2>
            <button
              type="button"
              onClick={closeMatchForm}
              aria-label="Close"
              className="w-11 h-11 rounded-full flex items-center justify-center text-text-muted hover:bg-surface-hover hover:text-text-primary cursor-pointer"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          {/* Progress: tap a step to jump (forward jumps validate first) */}
          <div className="px-4 pb-3 flex flex-col gap-2">
            <p className="text-xs font-semibold text-text-secondary">
              Step {formStep} of 4 · <span className="text-text-primary">{MATCH_FORM_STEPS[formStep - 1]}</span>
            </p>
            <div className="grid grid-cols-4 gap-1.5" data-testid="match-form-progress">
              {MATCH_FORM_STEPS.map((label, i) => {
                const st = (i + 1) as MatchFormStep;
                const reached = st <= formStep;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => goToFormStep(st)}
                    aria-current={st === formStep ? "step" : undefined}
                    className="flex flex-col gap-1.5 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
                  >
                    <span className={`h-1.5 rounded-full ${reached ? "bg-brand" : "bg-border"}`} />
                    <span className={`text-[11px] font-bold ${reached ? "text-brand" : "text-text-muted"}`}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex-1 p-3 sm:p-4 flex flex-col gap-4">
          {formStepError && (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800" data-testid="match-form-step-error">
              {formStepError}
            </p>
          )}

          {/* ── Step 1 · Match details ─────────────────────────────── */}
          {formStep === 1 && (
            <>
              <FormSection icon={<Trophy className="w-4 h-4" aria-hidden="true" />} title="Tournament" testId="match-form-tournament">
                <div>
                  <FieldLabel htmlFor="match-tournament">
                    Tournament <span className="font-normal text-text-muted">(optional — pick first)</span>
                  </FieldLabel>
                  <select
                    id="match-tournament"
                    value={formData.tournamentId || ""}
                    onChange={(e) => {
                      const tId = e.target.value;
                      if (!tId) {
                        // Unlinking falls back to the ground fee (or keeps a manual fee).
                        const next = { ...formData, tournamentId: "" };
                        setFormData({ ...next, fee: recalcFee(next, feeMarginPct) });
                        return;
                      }
                      const t = store.tournaments.find((x) => x.id === tId);
                      if (!t) {
                        setFormData({ ...formData, tournamentId: tId });
                        return;
                      }
                      // A tournament fills ground, format, jersey and type, and its
                      // fee takes precedence over the ground fee.
                      const next = {
                        ...formData,
                        tournamentId: tId,
                        groundId: t.groundId,
                        jerseyColor: t.jerseyColor,
                        format: t.format || "T30",
                        matchType: "Tournament" as const,
                      };
                      setFormData({ ...next, fee: recalcFee(next, feeMarginPct) });
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
                  {formTournament && (
                    <p className="mt-2 text-xs font-semibold text-emerald-700" data-testid="match-form-tournament-filled">
                      Ground, format, jersey and match fee filled from {formTournament.name}.
                    </p>
                  )}
                </div>
              </FormSection>

              <FormSection icon={<CalendarDays className="w-4 h-4" aria-hidden="true" />} title="Match Details" testId="match-form-basics">
                <div>
                  <FieldLabel htmlFor="match-ground" required>Ground</FieldLabel>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand" aria-hidden="true" />
                    <select
                      id="match-ground"
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
                  {formTournament && formTournament.groundId === formData.groundId && (
                    <p className="mt-1 text-[11px] font-bold text-brand">From tournament</p>
                  )}
                </div>
                <div>
                  <FieldLabel htmlFor="match-opponent">
                    Opponent Team <span className="font-normal text-text-muted">(optional)</span>
                  </FieldLabel>
                  <input
                    id="match-opponent"
                    type="text"
                    value={formData.opponent}
                    onChange={(e) => setFormData({ ...formData, opponent: e.target.value })}
                    className={FIELD_CLASS}
                    placeholder="Leave empty to show TBD"
                  />
                  <p className="mt-1 text-[11px] text-text-secondary">If left empty, the match is saved as “vs TBD”.</p>
                </div>
                <div>
                  <FieldLabel htmlFor="match-captain">
                    Captain <span className="font-normal text-text-muted">(optional — any active club player)</span>
                  </FieldLabel>
                  <CaptainSelector
                    players={store.players}
                    value={formData.captainId || ""}
                    onChange={(captainId) => setFormData({ ...formData, captainId })}
                  />
                </div>
              </FormSection>
            </>
          )}

          {/* ── Step 2 · Schedule & type ───────────────────────────── */}
          {formStep === 2 && (
            <FormSection icon={<CalendarDays className="w-4 h-4" aria-hidden="true" />} title="Schedule & Type" testId="match-form-schedule">
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
                      className={selectBtn(formData.time === t)}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!isPresetTime}
                    onClick={() => setFormData({ ...formData, time: isPresetTime ? "" : formData.time })}
                    className={selectBtn(!isPresetTime)}
                  >
                    Other
                  </button>
                </div>
                {!isPresetTime && (
                  <input
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
                {formTournament && (
                  <p className="mt-1 text-[11px] text-text-secondary">Set to Tournament because {formTournament.name} is selected.</p>
                )}
              </div>
              <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
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
                  <FieldLabel required>Jersey</FieldLabel>
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
          )}

          {/* ── Step 3 · Match fee ─────────────────────────────────── */}
          {formStep === 3 && (
            <>
              <p className="text-sm text-text-secondary" data-testid="match-form-fee-intro">
                {formTournament
                  ? `Fee comes from ${formTournament.name} (it takes priority over the ground fee).`
                  : formFeeSource.amount > 0
                    ? `Fee is calculated from ${formGround?.name || "the ground"}'s ${formData.matchType === "Tournament" ? "tournament" : "practice"} fee.`
                    : "No tournament or ground fee is configured — enter the fee per player."}{" "}
                You can always edit the final fee.
              </p>
              {editingFinanceClosed ? (
                <div className="rounded-xl border border-border bg-surface-hover p-3" data-testid="match-form-fee-locked">
                  <p className="text-sm font-bold text-text-primary">
                    Match fee ₹{Number(store.matches.find((m) => m.id === editingId)?.fee || 0).toLocaleString("en-IN")} per player
                  </p>
                  <p className="text-xs text-text-secondary">Match finances are closed, so the fee can&apos;t change. Reopen them in Manage Match → Finance first.</p>
                </div>
              ) : (
              <MatchFeeCalculator
                groundFeePerMatch={formFeeSource.amount}
                source={formFeeSource.source}
                marginPct={feeMarginPct}
                onMarginChange={(pct) => {
                  const margin = clampMargin(pct);
                  setFeeMarginPct(margin);
                  setFormData({ ...formData, fee: recalcFee(formData, margin, true) });
                }}
                fee={formData.fee}
                onFeeChange={(fee) => setFormData({ ...formData, fee })}
                tournamentPerPlayerFee={formTournament?.perPlayerFee}
                defaultOpen
              />
              )}
            </>
          )}

          {/* ── Step 4 · Review & save ─────────────────────────────── */}
          {formStep === 4 && (
            <>
              <section className="rounded-2xl border border-border bg-surface overflow-hidden" data-testid="match-form-summary">
                <div className="px-4 py-3 bg-brand-surface/50 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-black font-heading text-brand">Review match</h3>
                  <span className="text-[11px] font-semibold text-text-secondary">Nothing is saved until you tap Save</span>
                </div>
                <dl className="divide-y divide-border text-sm">
                  {[
                    { step: 1 as MatchFormStep, label: "Opponent", value: `vs ${formData.opponent.trim() || "TBD"}` },
                    { step: 1 as MatchFormStep, label: "Tournament", value: formTournament?.name || "None" },
                    { step: 1 as MatchFormStep, label: "Ground", value: formGround?.name || "—" },
                    {
                      step: 2 as MatchFormStep,
                      label: "Date & time",
                      value: [formatPickerDate(inputToDbDate(formData.date)), formData.time ? formatMatchDisplayTime(formData.time) : ""].filter(Boolean).join(" · ") || "—",
                    },
                    { step: 2 as MatchFormStep, label: "Type & format", value: `${formData.matchType} · ${formData.format}` },
                    { step: 2 as MatchFormStep, label: "Jersey", value: formData.jerseyColor },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center gap-3 px-4 py-2.5">
                      <dt className="w-28 shrink-0 text-text-secondary">{row.label}</dt>
                      <dd className="flex-1 min-w-0 font-bold text-text-primary break-words">{row.value}</dd>
                      <button
                        type="button"
                        onClick={() => goToFormStep(row.step)}
                        aria-label={`Edit ${row.label.toLowerCase()}`}
                        className="shrink-0 min-h-[36px] px-2 text-xs font-bold text-brand hover:underline cursor-pointer"
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 px-4 py-3 bg-brand-surface/40" data-testid="match-form-review-fee">
                    <dt className="w-28 shrink-0 font-bold text-brand">Match fee</dt>
                    <dd className="flex-1 min-w-0">
                      <span className="text-lg font-black font-heading text-brand tabular-nums">₹{Number(formData.fee) || 0}</span>
                      <span className="ml-1 text-xs text-text-secondary">per player · {feeMarginPct}% margin</span>
                    </dd>
                    <button
                      type="button"
                      onClick={() => goToFormStep(3)}
                      aria-label="Edit match fee"
                      className="shrink-0 min-h-[36px] px-2 text-xs font-bold text-brand hover:underline cursor-pointer"
                    >
                      Edit
                    </button>
                  </div>
                </dl>
              </section>

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

              {/* Links & Result: only when editing an existing match. */}
              {editingId && (
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
              )}
            </>
          )}
        </div>

        {/* Footer: in the form's own scroll container, so it never hides a field */}
        <div className="sticky bottom-0 z-10 bg-surface border-t border-border px-3 sm:px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-2">
          {formStep > 1 ? (
            <button
              type="button"
              onClick={() => goToFormStep((formStep - 1) as MatchFormStep)}
              className="min-h-[48px] px-5 rounded-xl border-2 border-brand/50 bg-surface text-sm font-black text-brand hover:bg-brand-surface cursor-pointer"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={closeMatchForm}
              className="min-h-[48px] px-5 rounded-xl border border-border bg-surface text-sm font-bold text-text-primary hover:bg-surface-hover cursor-pointer"
            >
              Cancel
            </button>
          )}
          {formStep < 4 ? (
            <button
              key="wizard-next"
              type="button"
              onClick={(e) => {
                // Never submit from Next: React would otherwise reuse this
                // element as the Save (submit) button mid-click on step 2.
                e.preventDefault();
                goToFormStep((formStep + 1) as MatchFormStep);
              }}
              data-testid="match-form-next"
              className="flex-1 min-h-[48px] rounded-xl bg-brand text-white text-sm font-black hover:opacity-90 cursor-pointer"
            >
              Next: {MATCH_FORM_STEPS[formStep as 1 | 2 | 3]}
            </button>
          ) : (
            <button
              key="wizard-save"
              type="submit"
              data-testid="match-form-submit"
              className="flex-1 min-h-[48px] rounded-xl bg-brand text-white text-sm font-black hover:opacity-90 cursor-pointer"
            >
              {editingId ? "Save Changes" : "Save Match"}
            </button>
          )}
        </div>
      </form>
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
          match={store.matches.find((m) => m.id === selectedMatch.id) || selectedMatch}
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
          {["matches", "tournaments", "grounds"].map((tab) => {
            const active = subTab === tab;
            const labels: Record<string, string> = {
              matches: "Matches",
              tournaments: "Tournaments",
              grounds: "Grounds",
            };
            return (
              <button
                key={tab}
                onClick={() => setSubTab(tab as any)}
                className={`shrink-0 sm:shrink sm:flex-1 min-h-[40px] py-2 px-3 rounded-xl text-[11px] font-bold uppercase tracking-wide sm:tracking-wider whitespace-nowrap transition-all duration-200 text-center cursor-pointer ${
                  active
                    ? "bg-accent text-text-accent font-extrabold shadow-[0_2px_8px_rgba(213,31,67,0.25)]"
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
                    className="inline-flex items-center justify-center gap-1 h-10 min-w-10 rounded-xl sm:rounded-full bg-accent px-2.5 sm:px-3 text-sm font-bold text-text-accent shadow hover:bg-accent/90 transition"
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

            {isAdmin && !isAdding && shouldShowFridayCaptainReminder(store.matches, isAdmin) && (() => {
              const missingCap = getUpcomingMatchesMissingCaptain(store.matches);
              return (
                <div
                  data-testid="friday-captain-reminder"
                  className="rounded-2xl border border-amber-300 bg-amber-50/80 p-3.5 shadow-xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-black uppercase tracking-wider text-amber-900">
                      Friday Captain Reminder ({missingCap.length} match{missingCap.length === 1 ? "" : "es"} missing captain)
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {missingCap.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-2 rounded-xl bg-white/80 border border-amber-200 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-text-primary truncate">vs {m.opponent || "TBD"}</p>
                          <p className="text-[11px] text-text-secondary">
                            {formatMatchDateTimeKolkata(m.date, m.time)} (IST)
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => startEdit(m)}
                          data-testid={`assign-captain-btn-${m.id}`}
                          className="min-h-[34px] px-3 rounded-lg bg-[#A30F2D] text-white text-xs font-bold hover:bg-[#8B0D26] transition shrink-0 cursor-pointer"
                        >
                          Assign Captain
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {isAdmin && !isAdding && (() => {
              const next48h = getMatchesWithinNext48Hours(store.matches);
              if (next48h.length === 0) return null;
              return (
                <div
                  data-testid="match-center-notify-48h"
                  className="rounded-2xl border border-brand/20 bg-brand-surface/35 p-3.5 shadow-xs space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-black uppercase tracking-wider text-brand">
                      Next 48 Hours — Squad Notifications ({next48h.length})
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {next48h.map((m) => {
                      const cap = resolveMatchCaptain(m, store.players);
                      return (
                        <div
                          key={m.id}
                          className="flex items-center justify-between gap-2 rounded-xl bg-surface border border-border px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-extrabold text-text-primary truncate">
                              vs {m.opponent || "TBD"}
                            </p>
                            <p className="text-[11px] text-text-secondary truncate">
                              {formatMatchDateTimeKolkata(m.date, m.time)} (IST)
                              {cap ? ` · Cap: ${cap.name}` : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setNotifyModalMatch(m)}
                            data-testid={`notify-squad-btn-${m.id}`}
                            className="min-h-[36px] px-3 rounded-lg bg-[#A30F2D] text-white text-xs font-bold hover:bg-[#8B0D26] transition shrink-0 cursor-pointer"
                          >
                            Notify Squad
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
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

                      {(cricHeroesHref(match.matchUrl) || match.streamingUrl) && (
                        <div className="flex gap-4 mt-3 pt-3 border-t border-border">
                          {cricHeroesHref(match.matchUrl) && (
                            <a
                              href={cricHeroesHref(match.matchUrl)!}
                              target="_blank"
                              rel="noopener noreferrer"
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
      <SquadNotifyModal
        open={Boolean(notifyModalMatch)}
        match={notifyModalMatch}
        ground={notifyModalMatch ? store.grounds.find((g) => g.id === notifyModalMatch.groundId) : undefined}
        players={store.players}
        payments={store.payments}
        onClose={() => setNotifyModalMatch(null)}
      />
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
  const { user, hasAdminClaim } = useAuth();

  // Link to AppUser
  const appUser = store.appUsers.find((u) => u.id === user?.uid);
  // Finance Plans: Club/Finance/Super Admins apply plans; only Finance/Super
  // Admins override a fee. The server re-checks both (/api/finance/match-plans).
  const canOverrideFees = isAdmin && Boolean(hasAdminClaim || appUser?.isFinanceAdmin);
  const canApplyPlans = isAdmin && Boolean(hasAdminClaim || appUser?.isFinanceAdmin || appUser?.isClubAdmin);
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
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [confirmSquadDuplicates, setConfirmSquadDuplicates] = useState(false);
  // "Apply Finance Plans": server-computed breakdown + application.
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [overrideFor, setOverrideFor] = useState<{ payment: MatchPayment; playerName: string; mode?: "plan" | "regular" } | null>(null);
  const [manageTab, setManageTab] = useState<"squad" | "finance">("squad");
  const [reversalFor, setReversalFor] = useState<ReversalTarget | null>(null);
  const { assignments: planAssignments } = useFinancePlanAssignments(isAdmin);
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
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [feePayerPicker, setFeePayerPicker] = useState<{ paymentId: string; playerName: string; fee: number; search: string } | null>(null);

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

  // The match Discussion (comments) was removed from Match Details. Existing
  // comment documents and their Firestore rules are left untouched.

  const handleAddToSquad = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      {
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
      setSearchQuery("");
      setConfirmSquadDuplicates(false);
    } catch (err) {
      console.error("Error adding to squad:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Finance Plans that would change for this squad (same rules as the server;
  // used for the button count only — the dialog shows the server's breakdown).
  const planApplication = buildMatchPlanApplication({
    match,
    payments: matchPayments,
    players: store.players,
    plans: store.feePlans || [],
    assignments: planAssignments,
  });
  const squadCount = matchPayments.filter((p) => p.status !== "Not Playing").length;

  // ── Manage Match: one financial statement for the squad rows, summary and
  // Finance tab (lib/match-finance); actions re-checked by rules / server.
  const statement = useMemo(() => buildMatchFinancialStatement(match, matchPayments), [match, matchPayments]);
  const rowCtx: RowActionContext = useMemo(
    () => ({ canManageFees: canOverrideFees, canManageSquad: canApplyPlans, financeClosed: statement.financeClosed, matchFee: match.fee }),
    [canOverrideFees, canApplyPlans, statement.financeClosed, match.fee],
  );
  const squadRows: SquadRow[] = matchPayments
    .filter((p) => p.status !== "Not Playing")
    .map((p) => {
      const pl = store.players.find((x) => x.id === p.playerId);
      return {
        payment: p,
        name: p.guestName || pl?.name || "Player",
        photoURL: p.guestName ? undefined : pl?.photoURL,
        isYou: !!mePlayer && pl?.id === mePlayer.id && !p.guestName,
        isCaptain: Boolean(match.captainId && !p.guestName && p.playerId === match.captainId),
      };
    });
  const paymentName = (p: MatchPayment) => p.guestName || store.players.find((x) => x.id === p.playerId)?.name || "Player";

  /** Existing manual "mark paid" workflow (cash), including the automatic late fee. */
  const markPaidCash = async (payment: MatchPayment) => {
    await store.updatePaymentStatus(payment.id, "Paid", match.id, undefined, "manual", appUser?.name || "Admin");
    const exempted = store.otherFees.some(
      (f: any) => f.playerId === payment.playerId && f.title?.startsWith("Late Fee Exemption:") && f.title?.includes(match.id) && f.status !== "Cancelled",
    );
    if (exempted) return;
    const existingLateFee = store.otherFees.some((f: any) => f.playerId === payment.playerId && f.templateId === `latefee_${match.id}` && f.status !== "Cancelled");
    if (existingLateFee) return;
    const pLabel = `vs ${match.opponent || "Match"} (${formatDate(match.date)})`;
    for (const lf of computeLateFees(match.date, match.id, payment.playerId, pLabel)) {
      const feeId = await store.addOtherFee(payment.playerId, { title: lf.label, amount: lf.amount, comment: "Auto-levied late fee penalty (admin marked paid)", templateId: `latefee_${match.id}` });
      if (feeId) await store.updateOtherFeeStatus(payment.playerId, feeId, "Paid", "manual");
    }
  };

  const [bulkRemovingSquad, setBulkRemovingSquad] = useState(false);
  const [bulkAvailOpen, setBulkAvailOpen] = useState(false);
  const [bulkAvailSelectedIds, setBulkAvailSelectedIds] = useState<string[]>([]);
  const [bulkAvailTarget, setBulkAvailTarget] = useState<"Confirmed" | "Tentative" | "No">("Confirmed");
  const [bulkAvailAllowOverwrite, setBulkAvailAllowOverwrite] = useState(false);
  const [bulkAvailSaving, setBulkAvailSaving] = useState(false);
  const bulkRemoveLockRef = useRef(false);
  const bulkAvailLockRef = useRef(false);

  const handleBulkRemoveSquad = async (targets: SquadRow[]) => {
    if (bulkRemoveLockRef.current || bulkRemovingSquad || targets.length === 0) return;
    bulkRemoveLockRef.current = true;
    try {
      const confirmed = await confirmAction({
        message: `Remove ${targets.length} selected player(s) from the squad? Their payment records are kept (marked Not Playing); Finance Plan assignments remain unchanged.`,
        destructive: true,
      });
      if (!confirmed) return;

      setBulkRemovingSquad(true);
      const { succeeded, failed } = await runBulkOperations(targets, async (row) => {
        await store.updatePaymentStatus(row.payment.id, "Not Playing", match.id);
      });
      if (failed.length === 0) {
        toast(`Removed ${succeeded.length} player(s) from the squad.`, "success");
      } else {
        toast(`Removed ${succeeded.length} player(s); ${failed.length} failed. Check permissions or payment state.`, "error");
      }
    } finally {
      setBulkRemovingSquad(false);
      bulkRemoveLockRef.current = false;
    }
  };

  const readiness = useMemo(
    () => computeMatchAvailabilityReadiness(store.players, matchPayments),
    [store.players, matchPayments],
  );

  const eligibleAvailabilityPlayers = useMemo(() => {
    const active = store.players
      .filter((p) => !p.disabled && p.inviteStatus !== "Rejected" && p.inviteStatus !== "Pending")
      .sort((a, b) => a.name.localeCompare(b.name));
    return active.map((player) => {
      const payment = resolveCanonicalPlayerPaymentRecord(player.id, matchPayments);
      const hasResponded = hasExplicitAvailabilityResponse(payment?.availability);
      return { player, payment, hasResponded };
    });
  }, [store.players, matchPayments]);

  const handleBulkAvailabilitySubmit = async () => {
    if (bulkAvailLockRef.current || bulkAvailSaving || bulkAvailSelectedIds.length === 0) return;
    bulkAvailLockRef.current = true;
    try {
      const targets = eligibleAvailabilityPlayers.filter(
        (item) =>
          bulkAvailSelectedIds.includes(item.player.id) &&
          (bulkAvailAllowOverwrite || !item.hasResponded),
      );
      if (targets.length === 0) {
        toast("No eligible players selected.", "error");
        return;
      }
      const overwriteCount = targets.filter((t) => t.hasResponded).length;
      const warning =
        overwriteCount > 0
          ? ` Warning: ${overwriteCount} player(s) already submitted a response that will be overwritten.`
          : "";
      const ok = await confirmAction({
        message: `Set administrative availability to "${bulkAvailTarget === "No" ? "Not Playing" : bulkAvailTarget}" for ${targets.length} player(s)?${warning}`,
      });
      if (!ok) return;

      setBulkAvailSaving(true);
      const { succeeded, failed } = await runBulkOperations(targets, async (item) => {
        if (item.payment) {
          await store.updateMatchAvailability(item.payment.id, bulkAvailTarget, match.id);
        } else {
          await store.addPaymentStatus(match.id, item.player.id, "Not Playing", bulkAvailTarget);
        }
      });
      if (failed.length === 0) {
        setBulkAvailSelectedIds([]);
        toast(`Updated availability for ${succeeded.length} player(s).`, "success");
        setBulkAvailOpen(false);
      } else {
        const failedIds = new Set(failed.map((f) => f.item.player.id));
        setBulkAvailSelectedIds((prev) => prev.filter((id) => failedIds.has(id)));
        toast(`Updated ${succeeded.length} player(s); ${failed.length} failed.`, "error");
      }
    } finally {
      setBulkAvailSaving(false);
      bulkAvailLockRef.current = false;
    }
  };

  const handleRowAction = async (id: RowActionId, row: SquadRow) => {
    const p = row.payment;
    try {
      switch (id) {
        case "plan":
        case "regular":
          setOverrideFor({ payment: p, playerName: row.name, mode: id });
          return;
        case "markPaid":
          if (!(await confirmAction({ message: `Mark ${row.name} as paid in cash (₹${getPlayerFee(p)})?` }))) return;
          await markPaidCash(p);
          toast(`${row.name} marked paid`, "success");
          return;
        case "refund":
        case "refundRemove":
          setReversalFor({ payment: p, playerName: row.name, removeFromSquad: id === "refundRemove" });
          return;
        case "remove":
          if (!(await confirmAction({ message: `Remove ${row.name} from the squad? Their payment record is kept (marked Not Playing); their Finance Plan assignment is unchanged.`, destructive: true }))) return;
          await store.updatePaymentStatus(p.id, "Not Playing", match.id);
          toast(`${row.name} removed from the squad`, "success");
          return;
        case "feePayer":
          setFeePayerPicker({ paymentId: p.id, playerName: row.name, fee: getPlayerFee(p), search: "" });
          return;
        case "undoFeePayer":
          if (!(await confirmAction({ message: `Undo the fee payer for ${row.name} and reset their fee to ₹${match.fee}?`, destructive: true }))) return;
          await store.clearFeeOverride(match.id, p.id);
          return;
        case "remind":
          await store.notifyPlayerPayment(p.playerId, match.id);
          toast(`Reminder sent to ${row.name}`, "success");
          return;
      }
    } catch (err) {
      console.error("Squad action failed:", err);
      toast("That change was refused. Check the payment state and your permissions.", "error");
    }
  };

  return (
    <div className="space-y-4">
      {planDialogOpen && (
        <FeePlanApplyDialog
          matchId={match.id}
          canApply={canApplyPlans}
          onClose={() => setPlanDialogOpen(false)}
          onApplied={(written, sponsorship) => {
            setPlanDialogOpen(false);
            toast(
              written
                ? `Finance Plans applied to ${written} player${written === 1 ? "" : "s"} · club sponsors ₹${sponsorship.toLocaleString("en-IN")} for this match`
                : "Nothing needed changing",
              "success",
            );
          }}
        />
      )}
      {overrideFor && (
        <FeeOverrideSheet
          matchId={match.id}
          payment={overrideFor.payment}
          playerName={overrideFor.playerName}
          matchFee={match.fee}
          plans={store.feePlans || []}
          initialMode={overrideFor.mode || "plan"}
          onClose={() => setOverrideFor(null)}
          onDone={(msg) => {
            setOverrideFor(null);
            toast(msg, "success");
          }}
        />
      )}
      {reversalFor && (
        <ReversalSheet
          target={reversalFor}
          matchId={match.id}
          matchFee={match.fee}
          onClose={() => setReversalFor(null)}
          onDone={(msg) => {
            setReversalFor(null);
            toast(msg, "success");
          }}
        />
      )}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button
          onClick={onBack}
          className="min-h-[44px] min-w-[44px] text-[13px] font-bold uppercase tracking-wider text-text-muted flex items-center gap-1 hover:text-text-primary transition cursor-pointer"
        >
          <ChevronRight className="w-4 h-4 rotate-180" /> Back
        </button>
        <div className="flex items-center gap-2 flex-wrap">
        </div>
      </div>

      {isAdmin ? (
        <>
        {match.isTentative && (
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
                  await store.updateMatch(match.id, { isTentative: false, tentativelyBlockedBy: "" });
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
          <MatchInfoCard
            match={match}
            ground={store.grounds.find((g) => g.id === match.groundId)}
            tournamentName={match.tournamentId ? store.tournaments.find((t) => t.id === match.tournamentId)?.name : undefined}
            status={matchStatus(match, getClubCalendarDate().dateString)}
            financeClosed={statement.financeClosed}
            onEdit={onEdit}
            canArchive={canArchive}
            onToggleArchive={async (archived) => {
              try {
                await store.updateMatch(match.id, { isArchived: archived });
              } catch (err) {
                console.error("Failed to update archive status", err);
              }
            }}
          />
        </>
      ) : (
        <div className="rounded-2xl border border-border bg-surface p-4 flex flex-col gap-4" data-testid="match-details-card">
          <MatchDetailsSummary
            match={match}
            ground={store.grounds.find((g) => g.id === match.groundId)}
            tournamentName={match.tournamentId ? store.tournaments.find((t) => t.id === match.tournamentId)?.name : undefined}
            playing={played}
            paid={paid}
            unpaid={unpaid}
            showPaymentCounts={false}
          />
        </div>
      )}

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

      {isAdmin ? (
        <div className="flex flex-col gap-3" data-testid="manage-match">
          <div className="flex border-b border-border" role="tablist" aria-label="Manage match">
            {([
              ["squad", `Squad (${played})`],
              ["finance", "Finance"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={manageTab === value}
                onClick={() => setManageTab(value)}
                data-testid={`manage-tab-${value}`}
                className={`flex-1 min-h-[48px] text-base font-black border-b-[3px] -mb-px cursor-pointer ${manageTab === value ? "border-brand text-brand" : "border-transparent text-text-secondary hover:text-text-primary"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {manageTab === "squad" && (
            <div className="flex flex-col gap-3" data-testid="details-squad">
              <div className="flex items-center justify-end gap-2 flex-wrap">
                {canApplyPlans && (
                  <button
                    type="button"
                    onClick={() => setPlanDialogOpen(true)}
                    disabled={statement.financeClosed}
                    title={statement.financeClosed ? "Match finances are closed" : undefined}
                    data-testid="apply-fee-plans"
                    className="min-h-[44px] px-3 rounded-xl border border-border bg-surface text-sm font-bold text-text-primary hover:bg-surface-hover disabled:opacity-50 cursor-pointer"
                  >
                    Finance Plans{!statement.financeClosed && planApplication.changes.length > 0 ? ` (${planApplication.changes.length})` : ""}
                  </button>
                )}
                {canApplyPlans && (
                  <button
                    type="button"
                    onClick={() => setAddingSquad(!addingSquad)}
                    disabled={statement.financeClosed && !addingSquad}
                    title={statement.financeClosed ? "Match finances are closed — no new players" : undefined}
                    data-testid="add-squad-players"
                    className="min-h-[44px] px-4 rounded-xl border border-brand text-brand bg-surface text-sm font-black hover:bg-brand-surface disabled:opacity-50 cursor-pointer"
                  >
                    {addingSquad ? "Close" : "+ Add Players"}
                  </button>
                )}
              </div>
              {statement.financeClosed && (
                <p className="rounded-xl bg-surface-hover px-3 py-2 text-xs text-text-secondary" data-testid="squad-closed-note">
                  Match finances are closed: no new players, plan or fee changes. Outstanding fees can still be collected; refunds go through the Finance tab.
                </p>
              )}
              {addingSquad && !statement.financeClosed && (
                <div className="rounded-2xl border border-border overflow-hidden">
                  <SquadPicker
                    players={filteredPlayers}
                    selectedIds={selectedPlayerIds}
                    onToggle={(id) =>
                      setSelectedPlayerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
                    }
                    onSetSelected={setSelectedPlayerIds}
                    search={searchQuery}
                    onSearch={setSearchQuery}
                    squadCount={squadCount}
                    maxSquadSize={match.maxSquadSize}
                    standardFee={match.fee}
                    matchDate={match.date}
                    feePlans={store.feePlans || []}
                    assignments={planAssignments}
                    submitting={isSubmitting}
                    confirmDuplicates={confirmSquadDuplicates}
                    onSubmit={handleAddToSquad}
                    onCancel={() => {
                      setAddingSquad(false);
                      setSelectedPlayerIds([]);
                      setConfirmSquadDuplicates(false);
                    }}
                  />
                </div>
              )}

              <SquadList
                rows={squadRows}
                plans={store.feePlans || []}
                ctx={rowCtx}
                onAction={handleRowAction}
                onBulkRemove={canApplyPlans ? handleBulkRemoveSquad : undefined}
                bulkRemoving={bulkRemovingSquad}
              />

              <MatchFinancialsCard s={statement} onOpenFinance={() => setManageTab("finance")} />

      {store.appConfig?.matchConfiguration?.enablePlayerAvailability && (
              <div className="bg-surface overflow-hidden rounded-2xl border border-border" data-testid="match-availability-section">
                <div className="px-4 py-3 bg-surface-hover border-b border-border flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-bold text-[12px] uppercase tracking-widest text-text-primary">
                    Player Availability &amp; Readiness
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      data-testid="toggle-bulk-availability"
                      onClick={() => {
                        setBulkAvailOpen((v) => !v);
                        setBulkAvailSelectedIds([]);
                      }}
                      className="min-h-[34px] px-3 rounded-lg bg-brand-surface text-brand text-xs font-bold hover:bg-brand-surface/80 transition cursor-pointer"
                    >
                      {bulkAvailOpen ? "Close Bulk Update" : "Bulk Update Availability"}
                    </button>
                  )}
                </div>

                {/* 4-state Readiness Summary */}
                <div className="p-4 border-b border-border grid grid-cols-4 gap-2 text-center" data-testid="match-readiness-summary">
                  <div className="rounded-xl bg-emerald-50 border border-emerald-200/70 py-2 px-1">
                    <span className="block text-base font-black text-emerald-700 tabular-nums">{readiness.confirmedCount}</span>
                    <span className="block text-[10px] font-bold uppercase text-emerald-800">Confirmed</span>
                  </div>
                  <div className="rounded-xl bg-amber-50 border border-amber-200/70 py-2 px-1">
                    <span className="block text-base font-black text-amber-700 tabular-nums">{readiness.tentativeCount}</span>
                    <span className="block text-[10px] font-bold uppercase text-amber-800">Tentative</span>
                  </div>
                  <div className="rounded-xl bg-rose-50 border border-rose-200/70 py-2 px-1">
                    <span className="block text-base font-black text-rose-700 tabular-nums">{readiness.notPlayingCount}</span>
                    <span className="block text-[10px] font-bold uppercase text-rose-800">Not Playing</span>
                  </div>
                  <div className="rounded-xl bg-surface-hover border border-border py-2 px-1">
                    <span className="block text-base font-black text-text-muted tabular-nums">{readiness.unrespondedCount}</span>
                    <span className="block text-[10px] font-bold uppercase text-text-secondary">Unresponded</span>
                  </div>
                </div>

                {/* Bulk Availability Panel (Admin only) */}
                {isAdmin && bulkAvailOpen && (() => {
                  const selectable = eligibleAvailabilityPlayers.filter(
                    (item) => bulkAvailAllowOverwrite || !item.hasResponded,
                  );
                  const selectableIds = selectable.map((i) => i.player.id);
                  const allSel = selectableIds.length > 0 && selectableIds.every((id) => bulkAvailSelectedIds.includes(id));
                  return (
                    <div className="p-4 bg-surface-hover/60 border-b border-border space-y-3" data-testid="bulk-availability-panel">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <label className="inline-flex items-center gap-2 text-xs font-semibold text-text-primary cursor-pointer">
                          <input
                            type="checkbox"
                            checked={bulkAvailAllowOverwrite}
                            onChange={(e) => {
                              setBulkAvailAllowOverwrite(e.target.checked);
                              setBulkAvailSelectedIds([]);
                            }}
                            className="accent-brand"
                          />
                          Allow overwriting player-submitted responses
                        </label>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setBulkAvailSelectedIds(allSel ? [] : selectableIds)
                            }
                            disabled={selectableIds.length === 0}
                            className="text-xs font-bold text-brand hover:underline disabled:opacity-40 cursor-pointer"
                          >
                            {allSel ? "Deselect all" : `Select all (${selectableIds.length})`}
                          </button>
                          {bulkAvailSelectedIds.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setBulkAvailSelectedIds([])}
                              className="text-xs font-bold text-text-secondary hover:underline cursor-pointer"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>

                      {selectable.length === 0 ? (
                        <p className="text-xs text-text-secondary py-2">
                          All eligible players have already submitted availability. Check &ldquo;Allow overwriting&rdquo; above to adjust existing responses.
                        </p>
                      ) : (
                        <div className="max-h-48 overflow-y-auto rounded-xl border border-border bg-surface divide-y divide-border">
                          {selectable.map(({ player, payment, hasResponded }) => {
                            const checked = bulkAvailSelectedIds.includes(player.id);
                            return (
                              <label
                                key={player.id}
                                className="flex items-center justify-between gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-surface-hover"
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() =>
                                      setBulkAvailSelectedIds((prev) =>
                                        prev.includes(player.id)
                                          ? prev.filter((x) => x !== player.id)
                                          : [...prev, player.id],
                                      )
                                    }
                                    className="accent-brand"
                                  />
                                  <span className="font-bold text-text-primary truncate">{player.name}</span>
                                </span>
                                <span
                                  className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    hasResponded
                                      ? "bg-amber-50 text-amber-800 border border-amber-200"
                                      : "bg-surface-hover text-text-muted"
                                  }`}
                                >
                                  {hasResponded ? `Player: ${payment?.availability}` : "Unresponded"}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          aria-label="Availability status"
                          value={bulkAvailTarget}
                          onChange={(e) => setBulkAvailTarget(e.target.value as any)}
                          className="min-h-[38px] rounded-xl border border-border bg-surface px-3 text-xs font-bold text-text-primary"
                        >
                          <option value="Confirmed">Admin-mark: Confirmed</option>
                          <option value="Tentative">Admin-mark: Tentative</option>
                          <option value="No">Admin-mark: Not Playing</option>
                        </select>
                        <button
                          type="button"
                          disabled={bulkAvailSaving || bulkAvailSelectedIds.length === 0}
                          onClick={handleBulkAvailabilitySubmit}
                          data-testid="bulk-availability-apply"
                          className="min-h-[38px] px-4 rounded-xl bg-accent text-text-accent text-xs font-bold hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
                        >
                          {bulkAvailSaving
                            ? "Updating…"
                            : `Apply to ${bulkAvailSelectedIds.length} Player(s)`}
                        </button>
                      </div>
                    </div>
                  );
                })()}

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
            </div>
          )}

          {manageTab === "finance" && (
            <MatchFinanceTab
              match={match}
              statement={statement}
              payments={matchPayments}
              playerName={paymentName}
              canManageFees={canOverrideFees}
              onReverse={setReversalFor}
              toast={toast}
              confirm={confirmAction}
            />
          )}
        </div>
      ) : (
        <>
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

        </>
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

