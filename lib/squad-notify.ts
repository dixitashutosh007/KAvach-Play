/**
 * Shared WhatsApp Squad Notification helpers (`lib/squad-notify.ts`).
 *
 * Single source of truth used by both Admin Match Center (`MatchesTab`) and
 * Admin Home (`AdminDashboard`).
 *
 * Note on WhatsApp URLs: `https://wa.me/?text=...` prefills text such as
 * `@+91XXXXXXXXXX`, which serves as a mention-style contact reference; WhatsApp
 * does not guarantee converting prefilled text into clickable group mentions,
 * and the admin manually selects the destination chat/group and presses Send.
 */
import type { Ground, Match, MatchPayment, Player } from "./types";
import { formatWhatsAppDigits, parseMatchKolkataMs, resolveMatchCaptain } from "./match-captain";

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export interface SquadRecipient {
  player: Player;
  digits: string | null;
  mentionTag: string | null;
  hasValidPhone: boolean;
}

export interface SquadResolutionResult {
  recipients: SquadRecipient[];
  validPhoneCount: number;
  missingPhoneNames: string[];
}

/**
 * Returns upcoming, non-archived, non-abandoned matches starting within the
 * next 48 hours in `Asia/Kolkata`, sorted chronologically.
 */
export function getMatchesWithinNext48Hours(
  matches: readonly Match[],
  nowMs: number = Date.now(),
): Match[] {
  const horizonMs = nowMs + FORTY_EIGHT_HOURS_MS;
  return matches
    .filter((m) => {
      if (m.isArchived) return false;
      if (m.result === "Abandoned") return false;
      const matchMs = parseMatchKolkataMs(m.date, m.time);
      if (matchMs === null) return false;
      return matchMs >= nowMs && matchMs <= horizonMs;
    })
    .sort((a, b) => {
      const aMs = parseMatchKolkataMs(a.date, a.time) ?? 0;
      const bMs = parseMatchKolkataMs(b.date, b.time) ?? 0;
      return aMs - bMs;
    });
}

/**
 * Formats match date & time in `Asia/Kolkata` for display and WhatsApp messages.
 */
export function formatMatchDateTimeKolkata(dateStr: string, timeStr?: string): string {
  const ms = parseMatchKolkataMs(dateStr, timeStr);
  if (ms === null) return dateStr;
  const datePart = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(ms));
  if (!timeStr) return datePart;
  const timePart = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ms));
  return `${timePart}, ${datePart}`;
}

/**
 * Resolves the canonical squad recipients for a match:
 * - Includes all active club players in the match squad (`status !== "Not Playing"`
 *   or present in `match.squadPlayerIds` if provided), regardless of payment status
 *   or whether a payment record exists.
 * - Excludes players explicitly marked `Not Playing` (`status === "Not Playing"` or
 *   `availability === "No"`).
 * - Excludes guest records (`guestName` set) and disabled/merged players.
 * - Deduplicates by canonical `playerId`.
 */
export function resolveMatchSquadRecipients(
  match: Match & { squadPlayerIds?: string[] },
  matchPayments: readonly MatchPayment[],
  players: readonly Player[],
): SquadResolutionResult {
  const paymentsForMatch = matchPayments.filter((p) => p.matchId === match.id && !p.guestName);

  const explicitlyOutPlayerIds = new Set<string>();
  const squadPlayerIds = new Set<string>();

  for (const pay of paymentsForMatch) {
    if (pay.availability === "No" || pay.status === "Not Playing") {
      if (pay.availability === "No") {
        explicitlyOutPlayerIds.add(pay.playerId);
      }
      continue;
    }
    squadPlayerIds.add(pay.playerId);
  }

  if (Array.isArray(match.squadPlayerIds)) {
    for (const pid of match.squadPlayerIds) {
      if (typeof pid === "string" && pid.trim() && !explicitlyOutPlayerIds.has(pid.trim())) {
        squadPlayerIds.add(pid.trim());
      }
    }
  }

  const recipients: SquadRecipient[] = [];
  const missingPhoneNames: string[] = [];
  let validPhoneCount = 0;

  for (const pid of squadPlayerIds) {
    if (explicitlyOutPlayerIds.has(pid)) continue;
    const player = players.find(
      (pl) =>
        pl.id === pid &&
        !pl.disabled &&
        !pl.mergedInto &&
        pl.mergeStatus !== "in_progress",
    );
    if (!player) continue;

    const digits = formatWhatsAppDigits(player.mobile);
    const hasValidPhone = digits !== null;
    if (hasValidPhone) {
      validPhoneCount++;
    } else {
      missingPhoneNames.push(player.name);
    }

    recipients.push({
      player,
      digits,
      mentionTag: digits ? `@+${digits}` : null,
      hasValidPhone,
    });
  }

  return {
    recipients,
    validPhoneCount,
    missingPhoneNames,
  };
}

export function buildDefaultSquadNotifyMessage(match: Match): string {
  const jersey = match.jerseyColor || "team";
  return `Please report 30 mins before match time. Wear your ${jersey} kit!`;
}

export function buildSquadWhatsAppMessage({
  match,
  ground,
  players = [],
  customMessage,
  resolution,
}: {
  match: Match;
  ground?: Ground;
  players?: readonly Player[];
  customMessage?: string;
  resolution: SquadResolutionResult;
}): string {
  const startLabel = formatMatchDateTimeKolkata(match.date, match.time);
  const captain = resolveMatchCaptain(match, players);

  let text = `*Upcoming Match Alert*\n`;
  text += `KAvach vs ${match.opponent || "TBD"}\n`;
  text += `Ground: ${ground?.name || "TBD"}\n`;
  text += `Start Time: ${startLabel}\n`;
  text += `Jersey Colour: ${match.jerseyColor || "TBD"}\n`;
  if (captain) {
    text += `Captain: ${captain.name}\n`;
  }
  if (ground?.mapUrl) {
    text += `Location: ${ground.mapUrl}\n`;
  }

  const trimmedMsg = (customMessage || "").trim();
  if (trimmedMsg) {
    text += `\n${trimmedMsg}\n`;
  }

  const tags = resolution.recipients
    .map((r) => r.mentionTag)
    .filter((tag): tag is string => Boolean(tag));

  text += `\nSquad (${resolution.recipients.length}): ${tags.join(" ")}`;

  if (resolution.missingPhoneNames.length > 0) {
    text += `\n\n_Could not tag (missing/invalid mobile): ${resolution.missingPhoneNames.join(", ")}_`;
  }

  return text;
}

export function buildSquadWhatsAppUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
