/**
 * Weekend match operations — schedule and eligibility rules (owner-approved
 * plan, 2026-11-24). Pure: no Firebase, no DOM. Shared by the server routes,
 * the prompt UI and the tests so every caller applies the same rules.
 *
 * Timezone: all calendar logic is Asia/Kolkata (UTC+05:30, no DST).
 *
 * Schedules (prompts become available on the first admin visit after these
 * times; no device needs to be open at the scheduled minute):
 *  - Match results:          Sunday 19:00 IST
 *  - Player of the Weekend:  Monday 08:00 IST, open until Friday 23:59 IST
 *  - Actual match fee paid:  Tuesday 08:00 IST
 *
 * Match completion (no end-time field exists): estimated end = start + 4 h
 * (T20) / 5 h (T30) / 6 h (Other). A match is eligible for the result prompt
 * 6 h after its estimated end. Eligibility never assigns a result — an admin
 * selects and confirms it. Records with a missing/invalid start or format are
 * excluded and reported as exceptions (never guessed).
 */

export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const FORMAT_DURATION_HOURS: Readonly<Record<string, number>> = { T20: 4, T30: 5, Other: 6 };
export const RESULT_GRACE_HOURS = 6;

/**
 * Look-back configuration. "testing" (initial validation, owner-approved): 14
 * days for results and actual-fee prompts. "recurring" (after validation): 7
 * days for results; the preceding weekend only for actual fees. Older matches
 * with no result are handled only by the explicit Admin backfill queue.
 * Switch by setting WEEKEND_OPS_MODE=recurring on the server (default testing).
 */
export type WeekendOpsMode = "testing" | "recurring";
export function weekendOpsMode(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): WeekendOpsMode {
  return env.WEEKEND_OPS_MODE === "recurring" ? "recurring" : "testing";
}
export const RESULTS_LOOKBACK_DAYS: Readonly<Record<WeekendOpsMode, number>> = { testing: 14, recurring: 7 };
export const FEES_LOOKBACK_DAYS_TESTING = 14;

export interface MatchLike {
  id: string;
  date?: string;
  time?: string;
  format?: string;
  result?: string;
  isArchived?: boolean;
  groundFeePaidAmount?: number | null;
  financeStatus?: string;
  opponent?: string;
  groundId?: string;
  matchUrl?: string;
}

// ── IST calendar ────────────────────────────────────────────────────────────

/** Calendar fields of `ms` in IST. dow: 0 = Sunday … 6 = Saturday. */
export function istParts(ms: number) {
  const d = new Date(ms + IST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    dow: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of `ms` in IST. */
export function istDate(ms: number): string {
  const p = istParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** UTC ms of an IST wall-clock time; null for malformed input. */
export function istToMs(date: string | undefined, time: string | undefined = "00:00"): number | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (typeof time !== "string" || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  const ms = Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MS;
  // Reject overflowed dates such as 2026-02-31.
  return istDate(ms) === date ? ms : null;
}

/** Start of the IST day containing `ms`. */
function istMidnight(ms: number): number {
  return istToMs(istDate(ms))!;
}

/** Most recent instant ≤ now that is weekday `dow` at `hour`:00 IST. */
export function lastOccurrence(nowMs: number, dow: number, hour: number): number {
  const p = istParts(nowMs);
  let candidate = istMidnight(nowMs) - ((p.dow - dow + 7) % 7) * DAY + hour * HOUR;
  if (candidate > nowMs) candidate -= 7 * DAY;
  return candidate;
}

// ── Match timing ────────────────────────────────────────────────────────────

export type TimingIssue = "missing_or_invalid_start" | "missing_or_unknown_format";

/** Estimated end (ms) or the reason it can't be estimated. */
export function estimatedEnd(match: MatchLike): { ms: number } | { issue: TimingIssue } {
  const start = istToMs(match.date, match.time);
  if (start === null) return { issue: "missing_or_invalid_start" };
  const hours = match.format ? FORMAT_DURATION_HOURS[match.format] : undefined;
  if (!hours) return { issue: "missing_or_unknown_format" };
  return { ms: start + hours * HOUR };
}

export function hasResult(match: MatchLike): boolean {
  return typeof match.result === "string" && match.result !== "" && match.result !== "Pending";
}

/** UI result choices → stored `matches.result` values (rules `isValidMatch`). */
export const RESULT_CHOICES = [
  { key: "won", label: "Won", value: "KAvach Won" },
  { key: "loss", label: "Loss", value: "KAvach Lost" },
  { key: "tie", label: "Tie", value: "Tie" },
  { key: "abandoned", label: "Abandoned", value: "Abandoned" },
] as const;
export type ResultValue = (typeof RESULT_CHOICES)[number]["value"];
export function isResultValue(v: unknown): v is ResultValue {
  return RESULT_CHOICES.some((c) => c.value === v);
}

/** Result-recordable now: no result yet and estimated end + 6 h has passed. */
export function resultEligibility(match: MatchLike, nowMs: number): { eligible: true; readyAt: number } | { eligible: false; reason: "has_result" | "archived" | "not_yet" | TimingIssue } {
  if (hasResult(match)) return { eligible: false, reason: "has_result" };
  if (match.isArchived) return { eligible: false, reason: "archived" };
  const end = estimatedEnd(match);
  if ("issue" in end) return { eligible: false, reason: end.issue };
  const readyAt = end.ms + RESULT_GRACE_HOURS * HOUR;
  return readyAt <= nowMs ? { eligible: true, readyAt } : { eligible: false, reason: "not_yet" };
}

// ── Prompt windows ──────────────────────────────────────────────────────────

/**
 * Match results prompt: matches that had become eligible by the most recent
 * Sunday 19:00 IST and started within the look-back window. Matches outside
 * the window go to the backfill queue, never the recurring prompt.
 */
export function resultsPrompt(matches: readonly MatchLike[], nowMs: number, mode: WeekendOpsMode) {
  const cutoff = lastOccurrence(nowMs, 0, 19);
  const windowStart = cutoff - RESULTS_LOOKBACK_DAYS[mode] * DAY;
  const items: MatchLike[] = [];
  const exceptions: { id: string; reason: TimingIssue }[] = [];
  for (const m of matches) {
    if (hasResult(m) || m.isArchived) continue;
    const start = istToMs(m.date, m.time);
    const e = resultEligibility(m, cutoff);
    if (!e.eligible) {
      if ((e.reason === "missing_or_invalid_start" || e.reason === "missing_or_unknown_format") && (start === null || start >= windowStart)) {
        exceptions.push({ id: m.id, reason: e.reason });
      }
      continue;
    }
    if (start !== null && start >= windowStart) items.push(m);
  }
  return { cutoff, windowStart, items: sortByStart(items), exceptions };
}

/** Explicit Admin backfill queue: every eligible match with no result, any age. */
export function resultsBackfill(matches: readonly MatchLike[], nowMs: number) {
  return sortByStart(matches.filter((m) => resultEligibility(m, nowMs).eligible));
}

/** The Saturday (YYYY-MM-DD) of the weekend a POTW prompt at `nowMs` refers to, if open. */
export function potwWindow(nowMs: number): { open: true; weekendId: string; opensAt: number; closesAt: number } | { open: false } {
  const opensAt = lastOccurrence(nowMs, 1, 8); // Monday 08:00
  const closesAt = opensAt + 4 * DAY + 16 * HOUR - 60 * 1000; // Friday 23:59
  if (nowMs > closesAt) return { open: false };
  const saturday = opensAt - 8 * HOUR - 2 * DAY; // midnight of the preceding Saturday
  return { open: true, weekendId: istDate(saturday), opensAt, closesAt };
}

/** Weekend label, e.g. "21 – 22 Nov 2026", from a Saturday weekendId. */
export function weekendLabel(weekendId: string): string {
  const sat = istToMs(weekendId);
  if (sat === null) return weekendId;
  const fmt = (ms: number, withYear: boolean) => {
    const p = istParts(ms);
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][p.month - 1];
    return `${p.day} ${mon}${withYear ? ` ${p.year}` : ""}`;
  };
  return `${fmt(sat, false)} – ${fmt(sat + DAY, true)}`;
}

/**
 * Actual match fee prompt (due Tuesday 08:00 IST): matches with no recorded
 * actual fee and open finances. Recurring: the Saturday/Sunday before the most
 * recent Tuesday 08:00. Testing: the last 14 days of concluded matches.
 */
export function feesPrompt(matches: readonly MatchLike[], nowMs: number, mode: WeekendOpsMode) {
  const cutoff = lastOccurrence(nowMs, 2, 8);
  let from: string;
  let to: string;
  if (mode === "recurring") {
    const saturday = cutoff - 8 * HOUR - 3 * DAY;
    from = istDate(saturday);
    to = istDate(saturday + DAY);
  } else {
    from = istDate(cutoff - FEES_LOOKBACK_DAYS_TESTING * DAY);
    to = istDate(cutoff);
  }
  const items = matches.filter((m) => {
    if (m.isArchived || m.financeStatus === "closed") return false;
    if (typeof m.groundFeePaidAmount === "number") return false;
    if (typeof m.date !== "string" || m.date < from || m.date > to) return false;
    const end = estimatedEnd(m);
    return "ms" in end ? end.ms <= cutoff : (istToMs(m.date) ?? Infinity) <= cutoff;
  });
  return { cutoff, from, to, items: sortByStart(items) };
}

function sortByStart<T extends MatchLike>(list: T[]): T[] {
  return list.slice().sort((a, b) => (istToMs(a.date, a.time) ?? 0) - (istToMs(b.date, b.time) ?? 0));
}

// ── Historical Data Completion ──────────────────────────────────────────────
//
// Persistent backfill lists, separate from the recurring prompts: an item is in
// exactly one of (recurring prompt, history). Pending state is the data itself,
// so the lists survive refreshes, sessions and admin accounts until completed.

/** Result values that mean the match was played (Player of the Weekend eligible). */
export const PLAYED_RESULTS: readonly string[] = ["KAvach Won", "KAvach Lost", "Tie", "Draw"];

/** Historical results: every eligible match without a result that is NOT in the current recurring prompt. */
export function resultsHistory(matches: readonly MatchLike[], nowMs: number, mode: WeekendOpsMode) {
  const recurring = resultsPrompt(matches, nowMs, mode);
  const inPrompt = new Set(recurring.items.map((m) => m.id));
  const promptExceptions = new Set(recurring.exceptions.map((e) => e.id));
  const items = resultsBackfill(matches, nowMs).filter((m) => !inPrompt.has(m.id));
  const exceptions: (MatchLike & { reason: TimingIssue })[] = [];
  for (const m of matches) {
    if (hasResult(m) || m.isArchived || promptExceptions.has(m.id)) continue;
    const e = estimatedEnd(m);
    if ("issue" in e) exceptions.push({ ...m, reason: e.issue });
  }
  return { items, exceptions: sortByStart(exceptions) };
}

/** A concluded match (estimated end passed; date passed when the end can't be estimated). */
function isConcluded(m: MatchLike, nowMs: number): boolean {
  const end = estimatedEnd(m);
  if ("ms" in end) return end.ms <= nowMs;
  const day = istToMs(m.date);
  return day !== null && day + DAY <= nowMs;
}

/** Historical actual fees: concluded, open-finance matches with no recorded fee, outside the current recurring prompt. */
export function feesHistory(matches: readonly MatchLike[], nowMs: number, mode: WeekendOpsMode) {
  const inPrompt = new Set(feesPrompt(matches, nowMs, mode).items.map((m) => m.id));
  return sortByStart(
    matches.filter(
      (m) =>
        !inPrompt.has(m.id) &&
        !m.isArchived &&
        m.financeStatus !== "closed" &&
        typeof m.groundFeePaidAmount !== "number" &&
        isConcluded(m, nowMs),
    ),
  );
}

/** Saturday (YYYY-MM-DD) of the weekend containing a Saturday or Sunday date, else null. */
export function weekendIdOf(date: string | undefined): string | null {
  const ms = istToMs(date);
  if (ms === null) return null;
  const dow = istParts(ms).dow;
  if (dow === 6) return istDate(ms);
  if (dow === 0) return istDate(ms - DAY);
  return null;
}

/**
 * Default start of the Player of the Weekend history (server env
 * POTW_HISTORY_FROM, YYYY-MM-DD, overrides). Owner to confirm.
 */
export const POTW_HISTORY_FROM_DEFAULT = "2026-01-01";
export function potwHistoryFrom(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): string {
  const v = env.POTW_HISTORY_FROM;
  return typeof v === "string" && istToMs(v) !== null ? v : POTW_HISTORY_FROM_DEFAULT;
}

/**
 * Historical Player of the Weekend: past weekends (from `fromDate`) with at
 * least one played match and no award, excluding the weekend whose regular
 * award window is open now. Nothing is ever awarded automatically.
 */
export function potwHistory(matches: readonly MatchLike[], awardedWeekendIds: ReadonlySet<string>, nowMs: number, fromDate: string) {
  const open = potwWindow(nowMs);
  const currentWeekend = open.open ? open.weekendId : null;
  const byWeekend = new Map<string, MatchLike[]>();
  for (const m of matches) {
    if (m.isArchived || !PLAYED_RESULTS.includes(String(m.result))) continue;
    const wid = weekendIdOf(m.date);
    if (!wid || wid < fromDate || wid === currentWeekend || awardedWeekendIds.has(wid)) continue;
    const sunEnd = istToMs(wid)! + 2 * DAY;
    if (sunEnd > nowMs) continue; // weekend not over yet
    byWeekend.set(wid, [...(byWeekend.get(wid) || []), m]);
  }
  return [...byWeekend.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekendId, list]) => ({ weekendId, label: weekendLabel(weekendId), matches: sortByStart(list) }));
}

/** Server check for a historical award request: same rules as potwHistory for one weekend. */
export function isHistoricalPotwWeekend(weekendId: string, weekendMatches: readonly MatchLike[], nowMs: number, fromDate: string): boolean {
  if (weekendIdOf(weekendId) !== weekendId) return false; // must be a Saturday
  return potwHistory(weekendMatches, new Set(), nowMs, fromDate).some((w) => w.weekendId === weekendId);
}

// ── Player of the Weekend ───────────────────────────────────────────────────

export const POTW_BADGE_TYPE = "player_of_weekend";
export const POTW_MESSAGE_MAX_CHARS = 120;
export const POTW_MESSAGE_MAX_LINES = 4;
export const POTW_BANNER_DAYS = 7;

/** Deterministic ids: one badge, one banner post, one notification per weekend. */
export const potwIds = (weekendId: string) => ({
  badge: `potw_${weekendId}`,
  post: `potw_${weekendId}`,
  notification: `potw_${weekendId}`,
});

/** Optional performance message: ≤ 4 lines, ≤ 120 chars, printable text. */
export function validatePotwMessage(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false, error: "Message must be text." };
  const value = raw.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
  if (/[\u0000-\u0008\u000B-\u001F\u007F]/.test(value)) return { ok: false, error: "Message contains unsupported characters." };
  if (value.length > POTW_MESSAGE_MAX_CHARS) return { ok: false, error: `Message must be ${POTW_MESSAGE_MAX_CHARS} characters or fewer.` };
  if (value.split("\n").length > POTW_MESSAGE_MAX_LINES) return { ok: false, error: `Message must be ${POTW_MESSAGE_MAX_LINES} lines or fewer.` };
  return { ok: true, value };
}

/**
 * Banner visibility: the newest award only, for 7 days from its award time.
 * A newer award replaces it immediately; without one it expires after 7 days.
 */
export function activePotwPost<T extends { id: string; kind?: string; createdAt?: unknown }>(posts: readonly T[], nowMs: number, toMillis: (v: unknown) => number | null): T | null {
  const awards = posts
    .filter((p) => p.kind === "potw")
    .map((p) => ({ p, at: toMillis(p.createdAt) }))
    .filter((x): x is { p: T; at: number } => x.at !== null)
    .sort((a, b) => b.at - a.at);
  const latest = awards[0];
  if (!latest) return null;
  return nowMs - latest.at < POTW_BANNER_DAYS * DAY && latest.at <= nowMs + 5 * 60 * 1000 ? latest.p : null;
}

// ── CricHeroes link ─────────────────────────────────────────────────────────

/**
 * Safe destination for `matches.matchUrl` (the CricHeroes match URL), or null
 * (the opponent name then renders as plain text).
 *
 * Any https host is accepted: CricHeroes share links use several domains, and
 * the previous cricheroes.in/.com-only check silently hid valid links. Safety:
 * only http(s) schemes (http is upgraded to https); a bare "host/path" gets
 * https://; javascript:, data:, mailto:, protocol-relative and credentialed
 * URLs, hosts without a dot and over-long values are rejected.
 */
export function cricHeroesHref(url: unknown): string | null {
  if (typeof url !== "string") return null;
  let raw = url.trim();
  if (!raw || raw.length > 2048 || /\s/.test(raw) || raw.startsWith("//")) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme === "http") raw = "https:" + raw.slice(5);
    else if (scheme !== "https") {
      // "cricheroes.in:443/..." style host:port without a scheme
      if (!/^[a-z0-9.-]+\.[a-z]{2,}:\d+(\/|$)/i.test(raw)) return null;
      raw = `https://${raw}`;
    }
  } else {
    raw = `https://${raw}`;
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (!u.hostname.includes(".") || u.hostname.endsWith(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Short host label for link titles, e.g. "cricheroes.com". */
export function linkHostLabel(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Authoritatively identifies a POTW announcement from its `kind` and `potw.weekendId` metadata.
 * Never infers POTW status from title or text.
 */
export function getPotwWeekendIdFromPost(
  post: { kind?: unknown; potw?: { weekendId?: unknown } | null } | null | undefined,
): string | null {
  if (!post || post.kind !== "potw") return null;
  const raw = post.potw?.weekendId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

/**
 * Routes announcement deletion through the POTW API for POTW announcements
 * (atomically deleting badge, announcement, and notification) and falls back to
 * direct deletion only for non-POTW announcements. Never falls back to direct
 * deletion when the POTW API fails.
 */
export async function executeAnnouncementDelete({
  post,
  deleteViaPotwApi,
  deleteDirectDoc,
}: {
  post: { kind?: unknown; potw?: { weekendId?: unknown } | null } | null | undefined;
  deleteViaPotwApi: (weekendId: string) => Promise<boolean>;
  deleteDirectDoc: () => Promise<boolean>;
}): Promise<boolean> {
  const weekendId = getPotwWeekendIdFromPost(post);
  if (weekendId) {
    return await deleteViaPotwApi(weekendId);
  }
  return await deleteDirectDoc();
}

/**
 * Authoritatively identifies a POTW badge from its `badgeType` or deterministic
 * `potw_<YYYY-MM-DD>` document id.
 */
export function getPotwWeekendIdFromBadge(
  badgeId: string,
  badge?: { badgeType?: unknown; weekendId?: unknown } | null,
): string | null {
  const isPotw = badge?.badgeType === POTW_BADGE_TYPE || badgeId.startsWith("potw_");
  if (!isPotw) return null;
  const raw =
    typeof badge?.weekendId === "string" && badge.weekendId.trim()
      ? badge.weekendId.trim()
      : badgeId.startsWith("potw_")
        ? badgeId.slice(5)
        : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/**
 * Routes badge deletion through the POTW API for POTW badges (atomically
 * removing badge, announcement, and notification) and falls back to direct
 * deletion only for non-POTW badges.
 */
export async function executeBadgeDelete({
  badgeId,
  badge,
  deleteViaPotwApi,
  deleteDirectDoc,
}: {
  badgeId: string;
  badge?: { badgeType?: unknown; weekendId?: unknown } | null;
  deleteViaPotwApi: (weekendId: string) => Promise<boolean>;
  deleteDirectDoc: () => Promise<boolean>;
}): Promise<boolean> {
  const weekendId = getPotwWeekendIdFromBadge(badgeId, badge);
  if (weekendId) {
    return await deleteViaPotwApi(weekendId);
  }
  return await deleteDirectDoc();
}
