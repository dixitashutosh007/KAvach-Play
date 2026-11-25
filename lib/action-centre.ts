/**
 * Club Admin Weekly Action Centre (`lib/action-centre.ts`).
 *
 * Pure, deterministic weekly schedule and authoritative completion-verification
 * helpers using `Asia/Kolkata` (+05:30). Reuses `lib/weekend-ops.ts` calendar
 * and prompt primitives rather than introducing a separate scheduling engine.
 *
 * Operational week cycle: anchored on Friday 00:00 IST (`weekId` = Friday
 * `YYYY-MM-DD`) through Thursday 23:59 IST so that:
 *  - Add Players to the Squad                        → Friday, 6:00 PM IST
 *  - Share Match Details in the Group & Tag Players  → Friday, 6:00 PM IST
 *  - Add Results of Weekly Matches                   → Sunday, 7:00 PM IST
 *  - Add Player of the Week                          → After Sunday, 7:00 PM IST
 *  - Add Actual Match Fee                            → Monday, 6:00 PM IST
 * all fall within the same operational week.
 */
import {
  hasResult,
  istDate,
  istToMs,
  lastOccurrence,
  weekendOpsMode,
  type MatchLike,
  type WeekendOpsMode,
} from "./weekend-ops.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type ActionCentreId =
  | "add_squad"
  | "share_match"
  | "add_results"
  | "add_potw"
  | "add_actual_fee";

export type ActionCentreStatus = "completed" | "overdue" | "due" | "pending";

export interface ActionCentreItem {
  id: ActionCentreId;
  title: string;
  deadlineLabel: string;
  deadlineMs: number;
  status: ActionCentreStatus;
  completed: boolean;
  isDue: boolean;
  /** Target tab / action for direct navigation. */
  targetTab: "matches" | "club" | "finance";
  targetAction?: string;
  /** Transparent verification note (e.g. share initiated vs delivered). */
  verificationNote: string;
  affectedMatchIds: string[];
}

export interface ActionCentreWeekSummary {
  weekId: string;
  label: string;
  actions: ActionCentreItem[];
  completedCount: number;
  totalCount: number;
  percent: number;
  allCompleted: boolean;
}

export interface ActionCentreEvaluationInput {
  nowMs?: number;
  mode?: WeekendOpsMode;
  matches: readonly (MatchLike & {
    squadShareInitiatedAt?: unknown;
    squadCount?: number;
  })[];
  /** Map of matchId -> active squad count (`status !== "Not Playing"`). */
  squadCountByMatchId?: ReadonlyMap<string, number> | Record<string, number>;
  /** Set of weekendIds (Saturday YYYY-MM-DD) that have an awarded POTW. */
  awardedWeekendIds?: ReadonlySet<string> | readonly string[];
}

function getSquadCount(
  map: ActionCentreEvaluationInput["squadCountByMatchId"],
  match: MatchLike & { squadCount?: number },
): number {
  if (typeof match.squadCount === "number") return match.squadCount;
  if (!map) return 0;
  if (map instanceof Map) return map.get(match.id) ?? 0;
  return (map as Record<string, number>)[match.id] ?? 0;
}

function hasPotwAward(
  awarded: ActionCentreEvaluationInput["awardedWeekendIds"],
  weekendId: string,
): boolean {
  if (!awarded) return false;
  if (awarded instanceof Set) return awarded.has(weekendId);
  return Array.isArray(awarded) && awarded.includes(weekendId);
}

/**
 * Returns the operational week anchor (Friday 00:00 IST) for `nowMs`.
 */
export function getOperationalWeekStartMs(nowMs: number = Date.now()): number {
  return lastOccurrence(nowMs, 5, 0); // Friday 00:00 IST
}

export function getOperationalWeekId(nowMs: number = Date.now()): string {
  return istDate(getOperationalWeekStartMs(nowMs));
}

function evaluateWeek(
  weekStartMs: number,
  nowMs: number,
  mode: WeekendOpsMode,
  input: ActionCentreEvaluationInput,
): ActionCentreWeekSummary {
  const weekId = istDate(weekStartMs);
  const fridayDate = weekId;
  const saturdayDate = istDate(weekStartMs + DAY);
  const sundayDate = istDate(weekStartMs + 2 * DAY);
  const mondayDate = istDate(weekStartMs + 3 * DAY);
  const weekEndDate = istDate(weekStartMs + 6 * DAY);

  const deadlineSquadMs = istToMs(fridayDate, "18:00")!;
  const deadlineShareMs = istToMs(fridayDate, "18:00")!;
  const deadlineResultsMs = istToMs(sundayDate, "19:00")!;
  const deadlinePotwMs = istToMs(sundayDate, "19:00")!;
  const deadlineFeeMs = istToMs(mondayDate, "18:00")!;

  // Matches scheduled for this operational week (Friday..Thursday in IST)
  const weekMatches = input.matches.filter(
    (m) =>
      !m.isArchived &&
      m.result !== "Abandoned" &&
      typeof m.date === "string" &&
      m.date >= fridayDate &&
      m.date <= weekEndDate,
  );

  // 1. Add Players to the Squad (Friday 6:00 PM IST)
  const missingSquadMatches = weekMatches.filter(
    (m) => getSquadCount(input.squadCountByMatchId, m) === 0,
  );
  const squadCompleted =
    weekMatches.length === 0
      ? nowMs >= deadlineSquadMs
      : missingSquadMatches.length === 0;

  // 2. Share Match Details in the Group and Tag Players (Friday 6:00 PM IST)
  const unsharedMatches = weekMatches.filter((m) => !m.squadShareInitiatedAt);
  const shareCompleted =
    weekMatches.length === 0
      ? nowMs >= deadlineShareMs
      : unsharedMatches.length === 0;

  // 3. Add Results of Weekly Matches (Sunday 7:00 PM IST)
  const allWeekMatchesHaveResults =
    weekMatches.length > 0 && weekMatches.every((m) => hasResult(m));
  const pendingResults = weekMatches.filter((m) => !hasResult(m));
  const resultsCompleted =
    weekMatches.length === 0
      ? nowMs >= deadlineResultsMs
      : allWeekMatchesHaveResults;

  // 4. Add Player of the Week (After Sunday 7:00 PM IST) — reuses weekend-ops
  const weekendIdForWeek = saturdayDate;
  const potwAwarded = hasPotwAward(input.awardedWeekendIds, weekendIdForWeek);
  const potwCompleted =
    weekMatches.length === 0 ? nowMs >= deadlinePotwMs : potwAwarded;

  // 5. Add Actual Match Fee (Monday 6:00 PM IST)
  const allWeekMatchesHaveFees =
    weekMatches.length > 0 &&
    weekMatches.every(
      (m) =>
        m.result === "Abandoned" ||
        m.financeStatus === "closed" ||
        (m.groundFeePaidAmount !== undefined && m.groundFeePaidAmount !== null),
    );
  const pendingFees = weekMatches.filter(
    (m) =>
      m.result !== "Abandoned" &&
      m.financeStatus !== "closed" &&
      (m.groundFeePaidAmount === undefined || m.groundFeePaidAmount === null),
  );
  const feeCompleted =
    weekMatches.length === 0
      ? nowMs >= deadlineFeeMs
      : allWeekMatchesHaveFees;

  const statusFor = (completed: boolean, deadlineMs: number): ActionCentreStatus => {
    if (completed) return "completed";
    if (nowMs > deadlineMs + 2 * HOUR) return "overdue";
    if (nowMs >= deadlineMs) return "due";
    return "pending";
  };

  const actions: ActionCentreItem[] = [
    {
      id: "add_squad",
      title: "Add Players to the Squad",
      deadlineLabel: `Friday, 6:00 PM IST (${fridayDate})`,
      deadlineMs: deadlineSquadMs,
      status: statusFor(squadCompleted, deadlineSquadMs),
      completed: squadCompleted,
      isDue: !squadCompleted && nowMs >= deadlineSquadMs,
      targetTab: "matches",
      targetAction: missingSquadMatches[0] ? `match_${missingSquadMatches[0].id}` : undefined,
      verificationNote:
        weekMatches.length === 0
          ? "No matches scheduled this week."
          : squadCompleted
            ? `Squad selected for all ${weekMatches.length} match(es).`
            : `${missingSquadMatches.length} match(es) still have an empty squad.`,
      affectedMatchIds: missingSquadMatches.map((m) => m.id),
    },
    {
      id: "share_match",
      title: "Share Match Details in the Group & Tag Players",
      deadlineLabel: `Friday, 6:00 PM IST (${fridayDate})`,
      deadlineMs: deadlineShareMs,
      status: statusFor(shareCompleted, deadlineShareMs),
      completed: shareCompleted,
      isDue: !shareCompleted && nowMs >= deadlineShareMs,
      targetTab: "matches",
      verificationNote:
        weekMatches.length === 0
          ? "No matches scheduled this week."
          : shareCompleted
            ? "WhatsApp share initiated by admin for this week's match(es) (external delivery is confirmed manually in WhatsApp)."
            : `${unsharedMatches.length} match(es) awaiting WhatsApp Squad Notify share action.`,
      affectedMatchIds: unsharedMatches.map((m) => m.id),
    },
    {
      id: "add_results",
      title: "Add Results of Weekly Matches",
      deadlineLabel: `Sunday, 7:00 PM IST (${sundayDate})`,
      deadlineMs: deadlineResultsMs,
      status: statusFor(resultsCompleted, deadlineResultsMs),
      completed: resultsCompleted,
      isDue: !resultsCompleted && nowMs >= deadlineResultsMs,
      targetTab: "matches",
      verificationNote:
        weekMatches.length === 0
          ? "No matches scheduled this week."
          : resultsCompleted
            ? "All eligible weekly match results recorded."
            : `${pendingResults.length} match(es) awaiting result entry.`,
      affectedMatchIds: pendingResults.map((m) => m.id),
    },
    {
      id: "add_potw",
      title: "Add Player of the Week",
      deadlineLabel: `After Sunday, 7:00 PM IST (${sundayDate})`,
      deadlineMs: deadlinePotwMs,
      status: statusFor(potwCompleted, deadlinePotwMs),
      completed: potwCompleted,
      isDue: !potwCompleted && nowMs > deadlinePotwMs,
      targetTab: "club",
      targetAction: "announcements",
      verificationNote:
        weekMatches.length === 0
          ? "No matches scheduled this week."
          : potwCompleted
            ? "Player of the Week award recorded."
            : "No Player of the Week award recorded for this weekend yet.",
      affectedMatchIds: [],
    },
    {
      id: "add_actual_fee",
      title: "Add Actual Match Fee",
      deadlineLabel: `Monday, 6:00 PM IST (${mondayDate})`,
      deadlineMs: deadlineFeeMs,
      status: statusFor(feeCompleted, deadlineFeeMs),
      completed: feeCompleted,
      isDue: !feeCompleted && nowMs >= deadlineFeeMs,
      targetTab: "finance",
      targetAction: "matches",
      verificationNote:
        weekMatches.length === 0
          ? "No matches scheduled this week."
          : feeCompleted
            ? "Actual ground fee recorded for weekly matches."
            : `${pendingFees.length} match(es) awaiting actual ground fee.`,
      affectedMatchIds: pendingFees.map((m) => m.id),
    },
  ];

  const completedCount = actions.filter((a) => a.completed).length;
  const totalCount = actions.length;
  const percent = Math.round((completedCount / totalCount) * 100);

  return {
    weekId,
    label: `Week of ${fridayDate}`,
    actions,
    completedCount,
    totalCount,
    percent,
    allCompleted: completedCount === totalCount,
  };
}

/**
 * Evaluates the current operational week and up to `historyWeeks` preceding
 * weeks for the Club Admin Weekly Action Centre.
 */
export function evaluateWeeklyActionCentre(
  input: ActionCentreEvaluationInput,
  historyWeeks: number = 4,
): {
  currentWeek: ActionCentreWeekSummary;
  history: ActionCentreWeekSummary[];
} {
  const nowMs = input.nowMs ?? Date.now();
  const mode = input.mode ?? weekendOpsMode();
  const currentStartMs = getOperationalWeekStartMs(nowMs);

  const currentWeek = evaluateWeek(currentStartMs, nowMs, mode, input);
  const history: ActionCentreWeekSummary[] = [];

  for (let i = 1; i <= historyWeeks; i++) {
    const prevStartMs = currentStartMs - i * 7 * DAY;
    const prevSummary = evaluateWeek(prevStartMs, nowMs, mode, input);
    const hasMatches = input.matches.some(
      (m) =>
        !m.isArchived &&
        typeof m.date === "string" &&
        m.date >= prevSummary.weekId &&
        m.date <= istDate(prevStartMs + 6 * DAY),
    );
    if (hasMatches) {
      history.push(prevSummary);
    }
  }

  return { currentWeek, history };
}

/**
 * Returns the next due/overdue action that has NOT been dismissed by this
 * specific admin for the current week. Dismissing never marks the task complete.
 */
export function getNextDuePopupAction(
  currentWeek: ActionCentreWeekSummary,
  dismissedPopups: Record<string, string> | null | undefined,
): ActionCentreItem | null {
  return (
    currentWeek.actions.find(
      (a) =>
        !a.completed &&
        a.isDue &&
        dismissedPopups?.[a.id] !== currentWeek.weekId,
    ) || null
  );
}
