import type { AdminDestination } from "./admin-navigation.ts";
import type { AdminSearchRoleContext } from "./admin-search.ts";

export interface AdminSearchCommandItem {
  id: string;
  kind: "command" | "date";
  title: string;
  subtitle: string;
  badge: string;
  destination: { tab: AdminDestination; action?: string };
  resolvedDate?: string;
}

const MONTH_MAP: Readonly<Record<string, number>> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const CLUB_TZ = "Asia/Kolkata";

export function getTodayInClubTz(now: Date = new Date()): { year: number; month: number; day: number; iso: string } {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m, day: d, iso };
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parses date expressions such as:
 * - "29 Dec", "29 December", "Matches on 29 Dec", "29 Dec 2026"
 * - "Dec 29", "December 29"
 * - "2026-12-29"
 * - "today", "tomorrow"
 *
 * When year is omitted, resolves the next upcoming occurrence in Asia/Kolkata.
 * Invalid calendar dates (e.g. "31 Feb") return null gracefully.
 */
export function parseAdminDateQuery(
  rawQuery: string,
  now: Date = new Date(),
): { isoDate: string; displayLabel: string } | null {
  const cleaned = rawQuery
    .trim()
    .toLowerCase()
    .replace(/^(matches?\s+(on|for)\s+|schedule\s+(on|for)\s+|on\s+)/i, "")
    .trim();
  if (!cleaned) return null;

  const today = getTodayInClubTz(now);

  if (cleaned === "today") {
    return { isoDate: today.iso, displayLabel: `Today (${today.iso})` };
  }
  if (cleaned === "tomorrow") {
    const tmrw = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
    const iso = toIsoDate(tmrw.getUTCFullYear(), tmrw.getUTCMonth() + 1, tmrw.getUTCDate());
    return { isoDate: iso, displayLabel: `Tomorrow (${iso})` };
  }

  // ISO YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(cleaned);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (!isValidCalendarDate(y, m, d)) return null;
    const iso = toIsoDate(y, m, d);
    return { isoDate: iso, displayLabel: formatDisplayDate(y, m, d) };
  }

  let day: number | null = null;
  let month: number | null = null;
  let explicitYear: number | null = null;

  // "29 Dec" or "29 December 2026"
  const dmMatch = /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/.exec(cleaned);
  if (dmMatch && MONTH_MAP[dmMatch[2]]) {
    day = Number(dmMatch[1]);
    month = MONTH_MAP[dmMatch[2]];
    explicitYear = dmMatch[3] ? Number(dmMatch[3]) : null;
  }

  // "Dec 29" or "December 29, 2026"
  const mdMatch = /^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(cleaned);
  if (day === null && mdMatch && MONTH_MAP[mdMatch[1]]) {
    month = MONTH_MAP[mdMatch[1]];
    day = Number(mdMatch[2]);
    explicitYear = mdMatch[3] ? Number(mdMatch[3]) : null;
  }

  if (day === null || month === null) return null;

  if (explicitYear !== null) {
    if (!isValidCalendarDate(explicitYear, month, day)) return null;
    return {
      isoDate: toIsoDate(explicitYear, month, day),
      displayLabel: formatDisplayDate(explicitYear, month, day),
    };
  }

  // Resolve next upcoming occurrence (including today)
  let candidateYear = today.year;
  const candidateIsoThisYear = toIsoDate(candidateYear, month, day);
  if (candidateIsoThisYear < today.iso) {
    candidateYear += 1;
  }
  // Handle Feb 29 leap year if needed
  if (month === 2 && day === 29 && !isValidCalendarDate(candidateYear, month, day)) {
    while (!isValidCalendarDate(candidateYear, 2, 29) && candidateYear < today.year + 8) {
      candidateYear += 1;
    }
  }
  if (!isValidCalendarDate(candidateYear, month, day)) return null;

  return {
    isoDate: toIsoDate(candidateYear, month, day),
    displayLabel: formatDisplayDate(candidateYear, month, day),
  };
}

function formatDisplayDate(year: number, month: number, day: number): string {
  const dt = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(dt);
}

interface CommandDef {
  id: string;
  title: string;
  subtitle: string;
  keywords: string[];
  allowed: (r: AdminSearchRoleContext) => boolean;
  destination: { tab: AdminDestination; action?: string };
}

const ADMIN_COMMANDS: readonly CommandDef[] = [
  {
    id: "cmd-add-match",
    title: "Add Match",
    subtitle: "Open the Add Match wizard",
    keywords: ["add match", "new match", "create match", "schedule match"],
    allowed: (r) => r.isSuperAdmin || r.isClubAdmin,
    destination: { tab: "matches", action: "add_match" },
  },
  {
    id: "cmd-unpaid-players",
    title: "Unpaid Players",
    subtitle: "View players with pending payments & dues",
    keywords: ["unpaid players", "unpaid", "players pending payment", "pending payment"],
    allowed: (r) => r.isSuperAdmin || r.isFinanceAdmin,
    destination: { tab: "finance", action: "dues_unpaid" },
  },
  {
    id: "cmd-view-dues",
    title: "View Dues",
    subtitle: "Open the Finance Dues & Outstanding dashboard",
    keywords: ["due", "dues", "total due", "pending dues", "outstanding"],
    allowed: (r) => r.isSuperAdmin || r.isFinanceAdmin,
    destination: { tab: "finance", action: "dues" },
  },
  {
    id: "cmd-add-noshow",
    title: "Add No Show",
    subtitle: "Open the Add No Show fee creation modal",
    keywords: ["add no show", "record no show", "no show", "noshow"],
    allowed: (r) => r.isSuperAdmin || r.isFinanceAdmin,
    destination: { tab: "home", action: "add_noshow" },
  },
  {
    id: "cmd-announcement",
    title: "Create Announcement",
    subtitle: "Open the Club Announcement composer",
    keywords: ["announcement", "create announcement", "new announcement", "publish announcement"],
    allowed: (r) => r.isSuperAdmin || r.isClubAdmin,
    destination: { tab: "club", action: "announcements:create" },
  },
  {
    id: "cmd-badge",
    title: "Grant Badge",
    subtitle: "Open the Award Badge workflow",
    keywords: ["badge", "grant badge", "award badge"],
    allowed: (r) => r.isSuperAdmin || r.isClubAdmin,
    destination: { tab: "club", action: "badges_grant" },
  },
];

/**
 * Resolves role-filtered Admin Quick Actions and Date/Schedule commands.
 */
export function resolveAdminCommands(
  rawQuery: string,
  roles: AdminSearchRoleContext,
  now: Date = new Date(),
): { commands: AdminSearchCommandItem[]; dateResults: AdminSearchCommandItem[] } {
  const q = rawQuery.trim().toLowerCase();
  if (q.length < 2) {
    return { commands: [], dateResults: [] };
  }

  const canSeeAnyAdmin = roles.isSuperAdmin || roles.isClubAdmin || roles.isFinanceAdmin;
  if (!canSeeAnyAdmin) {
    return { commands: [], dateResults: [] };
  }

  const commands: AdminSearchCommandItem[] = [];
  for (const cmd of ADMIN_COMMANDS) {
    if (!cmd.allowed(roles)) continue;
    const matched =
      cmd.title.toLowerCase().includes(q) ||
      cmd.keywords.some((kw) => kw.includes(q) || q.includes(kw));
    if (!matched) continue;
    commands.push({
      id: cmd.id,
      kind: "command",
      title: cmd.title,
      subtitle: cmd.subtitle,
      badge: "Quick Action",
      destination: cmd.destination,
    });
  }

  const dateResults: AdminSearchCommandItem[] = [];
  const parsedDate = parseAdminDateQuery(rawQuery, now);
  if (parsedDate) {
    const canSeeClub = roles.isSuperAdmin || roles.isClubAdmin;
    dateResults.push({
      id: `cmd-date-${parsedDate.isoDate}`,
      kind: "date",
      title: `Matches on ${parsedDate.displayLabel}`,
      subtitle: `Filter schedule for ${parsedDate.isoDate} (IST)`,
      badge: "Date",
      resolvedDate: parsedDate.isoDate,
      destination: canSeeClub
        ? { tab: "matches", action: `date_${parsedDate.isoDate}` }
        : { tab: "finance", action: `matches_date_${parsedDate.isoDate}` },
    });
  }

  return { commands, dateResults };
}
