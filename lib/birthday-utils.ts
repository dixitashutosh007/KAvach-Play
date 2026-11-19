import { format } from "date-fns";
import type { Player } from "./types";

export interface ParsedDob {
  year?: number;
  month: number; // 1-12
  day: number; // 1-31
}

/**
 * Deterministically parses a player's date of birth string.
 * Supports:
 * - ISO / DB format: YYYY-MM-DD (e.g. "1995-04-12")
 * - Formatted / UI format: DD/MM/YYYY (e.g. "12/04/1995")
 *
 * Rejects invalid dates (e.g. Feb 31st, month 13), ambiguous non-standard formats,
 * null/undefined, and garbage strings safely without throwing.
 */
export function parsePlayerDob(dob: string | undefined | null): ParsedDob | null {
  if (!dob || typeof dob !== "string") return null;
  const trimmed = dob.trim();
  if (!trimmed) return null;

  // 1. Try DD/MM/YYYY
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const year = parseInt(parts[2], 10);

      if (
        !isNaN(day) &&
        !isNaN(month) &&
        !isNaN(year) &&
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= 31 &&
        year >= 1900 &&
        year <= 2100
      ) {
        // Validate calendar days for the specific month/year
        const testDate = new Date(year, month - 1, day);
        if (
          testDate.getFullYear() === year &&
          testDate.getMonth() === month - 1 &&
          testDate.getDate() === day
        ) {
          return { day, month, year };
        }
      }
    }
    return null;
  }

  // 2. Try YYYY-MM-DD
  if (trimmed.includes("-")) {
    const parts = trimmed.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);

      if (
        !isNaN(year) &&
        !isNaN(month) &&
        !isNaN(day) &&
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= 31 &&
        year >= 1900 &&
        year <= 2100
      ) {
        const testDate = new Date(year, month - 1, day);
        if (
          testDate.getFullYear() === year &&
          testDate.getMonth() === month - 1 &&
          testDate.getDate() === day
        ) {
          return { day, month, year };
        }
      }
    }
    return null;
  }

  return null;
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
 * relative to referenceDate, correctly handling year-boundary transitions (e.g. Dec to Jan).
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

  // Check if birthday is today
  if (month === ref.getMonth() + 1 && day === ref.getDate()) {
    const todayDate = new Date(ref.getFullYear(), month - 1, day);
    return {
      isToday: true,
      isUpcoming: false,
      daysUntil: 0,
      formattedDate: format(todayDate, "MMM do"),
      parsedDob: parsed,
    };
  }

  // 1. Check birthday in reference year
  const bdayThisYear = new Date(ref.getFullYear(), month - 1, day);
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
  const bdayNextYear = new Date(ref.getFullYear() + 1, month - 1, day);
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

  const displayYear = diffDaysThisYear >= 0 ? ref.getFullYear() : ref.getFullYear() + 1;
  const displayDate = new Date(displayYear, month - 1, day);

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
