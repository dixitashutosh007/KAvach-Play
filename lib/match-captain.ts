/**
 * Match Captain Management & Friday Captain Reminder helpers (`lib/match-captain.ts`).
 *
 * Pure, deterministic helpers shared by Admin Match Center, Admin Home, and
 * Player Match views. Uses `Asia/Kolkata` as the club business timezone.
 */
import type { Match, Player } from "./types";
import { normalizeIndianMobile } from "./utils";

export const CLUB_TIMEZONE = "Asia/Kolkata";

export interface ResolvedCaptain {
  id: string;
  name: string;
  mobile?: string;
}

/**
 * Returns active club players eligible to be assigned as match captain.
 * Not restricted to the match's selected squad.
 */
export function getEligibleCaptainPlayers(
  players: readonly Player[],
): Player[] {
  return players
    .filter(
      (p) =>
        !p.disabled &&
        !p.mergedInto &&
        p.mergeStatus !== "in_progress" &&
        p.inviteStatus !== "Rejected" &&
        p.inviteStatus !== "Pending",
    )
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

/**
 * Resolves a match's assigned captain against active player records.
 * Returns null if no captain is assigned or the referenced player is missing,
 * disabled, or merged (never silently substitutes another player).
 */
export function resolveMatchCaptain(
  match: Pick<Match, "captainId"> | null | undefined,
  players: readonly Player[],
): ResolvedCaptain | null {
  const captainId = typeof match?.captainId === "string" ? match.captainId.trim() : "";
  if (!captainId) return null;

  const found = players.find(
    (p) =>
      p.id === captainId &&
      !p.disabled &&
      !p.mergedInto &&
      p.mergeStatus !== "in_progress",
  );
  if (!found) return null;

  return {
    id: found.id,
    name: found.name,
    mobile: found.mobile,
  };
}

/**
 * Formats a player's mobile number into digits-only international format for wa.me.
 * Returns null if missing or malformed.
 */
export function formatWhatsAppDigits(mobile: string | undefined | null): string | null {
  if (!mobile) return null;
  const raw = String(mobile).trim();
  if (!raw) return null;

  const normalized = normalizeIndianMobile(raw);
  if (/^\+91\d{10}$/.test(normalized)) {
    return normalized.slice(1); // "91XXXXXXXXXX"
  }

  // Allow explicit international E.164 numbers (+<country><number>, 10-15 digits)
  if (raw.startsWith("+")) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) {
      return digits;
    }
  }

  return null;
}

export type CaptainWhatsAppResult =
  | { ok: true; url: string; digits: string }
  | { ok: false; reason: string };

/**
 * Builds a wa.me URL to message the assigned match captain directly.
 */
export function buildCaptainWhatsAppUrl(
  captain: ResolvedCaptain | null | undefined,
  match: Pick<Match, "opponent" | "date" | "time">,
): CaptainWhatsAppResult {
  if (!captain) {
    return { ok: false, reason: "No active captain is assigned for this match." };
  }
  const digits = formatWhatsAppDigits(captain.mobile);
  if (!digits) {
    return {
      ok: false,
      reason: `No valid WhatsApp number on file for captain ${captain.name}.`,
    };
  }
  const text = `Hi ${captain.name}, reaching out regarding the KAvach match vs ${match.opponent || "TBD"} on ${match.date}.`;
  return {
    ok: true,
    digits,
    url: `https://wa.me/${digits}?text=${encodeURIComponent(text)}`,
  };
}

/**
 * Parses a match's date + time in Asia/Kolkata (+05:30) into epoch milliseconds.
 * Returns null if date is invalid.
 */
export function parseMatchKolkataMs(dateStr: string | undefined, timeStr?: string): number | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const trimmedDate = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) return null;
  const cleanTime =
    timeStr && /^\d{2}:\d{2}$/.test(timeStr.trim()) ? timeStr.trim() : "23:59";
  const ms = Date.parse(`${trimmedDate}T${cleanTime}:00+05:30`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Returns true when `nowMs` falls on a Friday in `Asia/Kolkata`.
 * Independent of the browser or server local timezone.
 */
export function isFridayInKolkata(nowMs: number = Date.now()): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: CLUB_TIMEZONE,
    weekday: "short",
  }).format(new Date(nowMs));
  return weekday === "Fri";
}

/**
 * Returns upcoming, non-archived, non-abandoned matches that do not have an
 * assigned captain, sorted chronologically.
 */
export function getUpcomingMatchesMissingCaptain(
  matches: readonly Match[],
  nowMs: number = Date.now(),
): Match[] {
  return matches
    .filter((m) => {
      if (m.isArchived) return false;
      if (m.result && m.result !== "Pending") return false;
      if (typeof m.captainId === "string" && m.captainId.trim().length > 0) {
        return false;
      }
      const matchMs = parseMatchKolkataMs(m.date, m.time);
      if (matchMs === null) return false;
      return matchMs >= nowMs;
    })
    .sort((a, b) => {
      const aMs = parseMatchKolkataMs(a.date, a.time) ?? 0;
      const bMs = parseMatchKolkataMs(b.date, b.time) ?? 0;
      return aMs - bMs;
    });
}

/**
 * Returns true when the Friday Captain Assignment Reminder should be shown.
 */
export function shouldShowFridayCaptainReminder(
  matches: readonly Match[],
  isAuthorizedAdmin: boolean,
  nowMs: number = Date.now(),
): boolean {
  if (!isAuthorizedAdmin) return false;
  if (!isFridayInKolkata(nowMs)) return false;
  return getUpcomingMatchesMissingCaptain(matches, nowMs).length > 0;
}
