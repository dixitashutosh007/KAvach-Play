/**
 * Admin Match Centre — date-first List View helpers (`lib/match-date-strip.ts`).
 * Pure (no React / Firebase).
 *
 * Dates are calendar days ("YYYY-MM-DD") using the app's existing match-date
 * convention: `dbToInputDate` (stored "YYYY-MM-DD" strings are taken as-is, so
 * there is no UTC shift). "Today" comes from the club timezone (Asia/Kolkata).
 *
 * Status per date (booking and selection are independent):
 *  - booked     at least one non-tentative match on that date;
 *  - tentative  only tentatively blocked fixtures (`isTentative`) on that date;
 *  - available  Saturday / Sunday with neither;
 *  - (weekdays without any match are not shown).
 * Tentative blocks reuse the existing source of truth: a match document with
 * `isTentative: true` (set from the add / edit match form).
 */
import type { Match } from "@/lib/types";
import { dbToInputDate } from "@/lib/utils";

export type DateStatus = "booked" | "tentative" | "available";

export interface StripDate {
  /** YYYY-MM-DD */
  key: string;
  year: number;
  /** 0-based */
  month: number;
  day: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  status: DateStatus;
  /** Matches on this date (including tentative blocks). */
  matchCount: number;
}

const MONTHS_SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n: number) => String(n).padStart(2, "0");

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** Calendar date of a match as YYYY-MM-DD, or null when the date is unusable. */
export function matchDateKey(match: Pick<Match, "date">): string | null {
  const parts = dbToInputDate(match.date).split("/"); // DD/MM/YYYY
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!y || !m || !d) return null;
  return dateKey(y, m - 1, d);
}

/** Weekday of a calendar date, independent of the device timezone. */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

export function parseDateKey(key: string): { year: number; month: number; day: number; weekday: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  return { year, month, day, weekday: weekdayOf(year, month, day) };
}

/** Matches considered by the date-first view (archived matches are excluded, as in the existing list). */
function visible(matches: Match[]): Match[] {
  return matches.filter((m) => m && !m.isArchived);
}

/** Groups matches by calendar date key. */
export function groupMatchesByDate(matches: Match[]): Map<string, Match[]> {
  const map = new Map<string, Match[]>();
  for (const m of visible(matches)) {
    const k = matchDateKey(m);
    if (!k) continue;
    const list = map.get(k);
    if (list) list.push(m);
    else map.set(k, [m]);
  }
  return map;
}

export function statusForDate(matchesOnDate: Match[], weekday: number): DateStatus | null {
  if (matchesOnDate.some((m) => !m.isTentative)) return "booked";
  if (matchesOnDate.length > 0) return "tentative";
  if (weekday === 0 || weekday === 6) return "available";
  return null;
}

/**
 * Every Saturday and Sunday of the month plus any weekday that has at least
 * one match (or tentative block). Sorted, no duplicates.
 */
export function buildMonthDateStrip(year: number, month: number, matches: Match[]): StripDate[] {
  const byDate = groupMatchesByDate(matches);
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const out: StripDate[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const key = dateKey(year, month, day);
    const weekday = weekdayOf(year, month, day);
    const onDate = byDate.get(key) || [];
    const status = statusForDate(onDate, weekday);
    if (!status) continue;
    out.push({ key, year, month, day, weekday, status, matchCount: onDate.length });
  }
  return out;
}

/**
 * Default selection for a month: today when it is in the strip, otherwise the
 * nearest upcoming strip date; null when the month has no date on/after today
 * (the view then asks the admin to pick a date instead of guessing).
 */
export function pickDefaultDateKey(strip: StripDate[], todayKey: string): string | null {
  if (strip.some((d) => d.key === todayKey)) return todayKey;
  const upcoming = strip.find((d) => d.key > todayKey);
  return upcoming ? upcoming.key : null;
}

function timeValue(t?: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.MAX_SAFE_INTEGER;
}

/** All matches on a date (upcoming, completed, tentative), sorted by start time. */
export function matchesOnDate(matches: Match[], key: string): Match[] {
  return (groupMatchesByDate(matches).get(key) || [])
    .slice()
    .sort((a, b) => timeValue(a.time) - timeValue(b.time) || String(a.opponent || "").localeCompare(String(b.opponent || "")));
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export const monthShort = (month: number) => MONTHS_SHORT[month] || "";
export const weekdayShort = (weekday: number) => WEEKDAYS_SHORT[weekday] || "";
export const monthYearLabel = (year: number, month: number) => `${MONTHS_LONG[month]} ${year}`;

/** "Sunday, 22 November 2026" */
export function formatLongDate(key: string): string {
  const p = parseDateKey(key);
  if (!p) return "";
  return `${WEEKDAYS_LONG[p.weekday]}, ${p.day} ${MONTHS_LONG[p.month]} ${p.year}`;
}

/** "Sunday, 29 November" */
export function formatDayMonth(key: string): string {
  const p = parseDateKey(key);
  if (!p) return "";
  return `${WEEKDAYS_LONG[p.weekday]}, ${p.day} ${MONTHS_LONG[p.month]}`;
}

export const DATE_STATUS_LABEL: Record<DateStatus, string> = {
  booked: "Booked",
  available: "Available",
  tentative: "Tentatively Blocked",
};
