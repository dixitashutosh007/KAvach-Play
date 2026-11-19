import { format } from "date-fns";
import type { Player } from "./types";

export interface ParsedDob {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/**
 * Checks if a given year is a leap year in the Gregorian calendar.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns the exact number of days in a given month of a given year,
 * correctly handling leap years for February.
 */
export function getDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  const daysPerMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return daysPerMonth[month - 1];
}

/**
 * Strict Date of Birth Parser.
 *
 * Requirements:
 * - Requires exact full formats:
 *   1. "DD/MM/YYYY" (e.g. "12/04/1995")
 *   2. "YYYY-MM-DD" (e.g. "1995-04-12")
 * - Strictly rejects trailing characters (e.g. "1995-04-12junk"), partial tokens,
 *   invalid separators, and unpadded numeric fields (e.g. "1/4/1995", "1995-4-12").
 * - Strictly validates calendar dates against leap years (e.g. "29/02/2000" is valid,
 *   "29/02/2001" is invalid).
 * - Safely returns null for missing, undefined, empty, or malformed strings.
 */
export function parsePlayerDob(dob: string | undefined | null): ParsedDob | null {
  if (!dob || typeof dob !== "string") return null;
  const trimmed = dob.trim();
  if (!trimmed) return null;

  // 1. Exact DD/MM/YYYY match (two digits day, slash, two digits month, slash, four digits year)
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const parts = trimmed.split("/");
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);

    if (year < 1900 || year > 2100) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > getDaysInMonth(year, month)) return null;

    return { day, month, year };
  }

  // 2. Exact YYYY-MM-DD match (four digits year, dash, two digits month, dash, two digits day)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parts = trimmed.split("-");
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);

    if (year < 1900 || year > 2100) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > getDaysInMonth(year, month)) return null;

    return { day, month, year };
  }

  return null;
}

/**
 * Resolves recurring celebration day for a given birth month and day in a target year.
 * Policy: In non-leap years, February 29 birthdays recur and are celebrated on
 * February 28 (the final calendar day of February, preserving the birth month).
 */
export function getCelebrationDate(
  month: number,
  day: number,
  targetYear: number
): { month: number; day: number } {
  if (month === 2 && day === 29 && !isLeapYear(targetYear)) {
    return { month: 2, day: 28 };
  }
  return { month, day };
}

export interface BirthdayStatus {
  isToday: boolean;
  isUpcoming: boolean; // within next 14 calendar days (excluding today)
  daysUntil: number; // 0 for today, 1..14 for upcoming, -1 otherwise
  formattedDate: string; // e.g. "Apr 12th"
  parsedDob: ParsedDob | null;
}

/**
 * Evaluates whether a player's birthday is today or within the next 14 days
 * relative to referenceDate, correctly handling year-boundary transitions (e.g. Dec to Jan)
 * and February 29 leap-day recurrence in non-leap years.
 */
export function getPlayerBirthdayStatus(
  dob: string | undefined | null,
  referenceDate: Date = new Date()
): BirthdayStatus {
  const parsed = parsePlayerDob(dob);
  if (!parsed) {
    return {
      isToday: false,
      isUpcoming: false,
      daysUntil: -1,
      formattedDate: "—",
      parsedDob: null,
    };
  }

  const { month, day } = parsed;

  // Normalize reference date to midnight in local time
  const ref = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );

  const refYear = ref.getFullYear();

  // 1. Check celebration date in reference year (handling Feb 29 in non-leap years)
  const celebrationThisYear = getCelebrationDate(month, day, refYear);
  const bdayThisYear = new Date(
    refYear,
    celebrationThisYear.month - 1,
    celebrationThisYear.day
  );

  // Check if birthday is TODAY
  if (
    celebrationThisYear.month === ref.getMonth() + 1 &&
    celebrationThisYear.day === ref.getDate()
  ) {
    return {
      isToday: true,
      isUpcoming: false,
      daysUntil: 0,
      formattedDate: format(bdayThisYear, "MMM do"),
      parsedDob: parsed,
    };
  }

  // Check difference in calendar days for this year
  const diffDaysThisYear = Math.round(
    (bdayThisYear.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDaysThisYear > 0 && diffDaysThisYear <= 14) {
    return {
      isToday: false,
      isUpcoming: true,
      daysUntil: diffDaysThisYear,
      formattedDate: format(bdayThisYear, "MMM do"),
      parsedDob: parsed,
    };
  }

  // 2. Check year-boundary rollover (e.g. today is Dec 28, birthday is Jan 3 of next year)
  const nextYear = refYear + 1;
  const celebrationNextYear = getCelebrationDate(month, day, nextYear);
  const bdayNextYear = new Date(
    nextYear,
    celebrationNextYear.month - 1,
    celebrationNextYear.day
  );

  const diffDaysNextYear = Math.round(
    (bdayNextYear.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDaysNextYear > 0 && diffDaysNextYear <= 14) {
    return {
      isToday: false,
      isUpcoming: true,
      daysUntil: diffDaysNextYear,
      formattedDate: format(bdayNextYear, "MMM do"),
      parsedDob: parsed,
    };
  }

  const displayYear = diffDaysThisYear >= 0 ? refYear : nextYear;
  const celebrationDisplay = getCelebrationDate(month, day, displayYear);
  const displayDate = new Date(
    displayYear,
    celebrationDisplay.month - 1,
    celebrationDisplay.day
  );

  return {
    isToday: false,
    isUpcoming: false,
    daysUntil: -1,
    formattedDate: format(displayDate, "MMM do"),
    parsedDob: parsed,
  };
}

export interface PartitionedBirthdays {
  todayBirthdays: Array<Player & { birthdayStatus: BirthdayStatus }>;
  upcomingBirthdays: Array<Player & { birthdayStatus: BirthdayStatus }>;
}

/**
 * Partitions players into today's birthdays and upcoming birthdays (next 14 days),
 * sorting upcoming birthdays chronologically by nearest date.
 */
export function partitionBirthdays(
  players: Player[] = [],
  referenceDate: Date = new Date()
): PartitionedBirthdays {
  const todayList: Array<Player & { birthdayStatus: BirthdayStatus }> = [];
  const upcomingList: Array<Player & { birthdayStatus: BirthdayStatus }> = [];

  for (const player of players) {
    if (!player || player.disabled || !player.dob) continue;

    const status = getPlayerBirthdayStatus(player.dob, referenceDate);
    if (status.isToday) {
      todayList.push({ ...player, birthdayStatus: status });
    } else if (status.isUpcoming) {
      upcomingList.push({ ...player, birthdayStatus: status });
    }
  }

  // Sort upcoming birthdays chronologically (closest daysUntil first)
  upcomingList.sort((a, b) => a.birthdayStatus.daysUntil - b.birthdayStatus.daysUntil);

  return {
    todayBirthdays: todayList,
    upcomingBirthdays: upcomingList,
  };
}
