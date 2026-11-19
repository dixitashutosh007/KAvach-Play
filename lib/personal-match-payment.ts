/**
 * Personal Match Payment & Match Grouping Utilities (`lib/personal-match-payment.ts`)
 *
 * Implements authoritative personal payment status derivation and mobile-first
 * match grouping for Phase 2.2 — Player Match Center.
 *
 * Rules:
 * 1. Personal payment status is derived from authoritative persisted records
 *    (`MatchPayment.status`, `feeOverride`, `feeCollectedAmount`, `feeOffsetAmount`, `match.fee`).
 * 2. User-facing status labels: "PAID", "UNPAID", "PARTIALLY PAID", "WAIVED".
 * 3. Never exposes other players' private financial information or club treasury numbers.
 * 4. Option A financial policy for abandoned matches: unpaid obligations are waived,
 *    historical paid transactions are preserved, and paid amounts are not refunded.
 * 5. Match grouping organizes fixtures into Upcoming Matches, Recent Matches, and
 *    Previous Matches based on match date and authoritative personal settlement state.
 * 6. Older matches with unpaid or partially paid obligations remain discoverable
 *    in the active view until settled.
 */

import { isMatchBillable } from "./matchBillable.ts";
import { isPlayerEligibleForMatch } from "./match-eligibility.ts";
import type { Match, MatchPayment, Player } from "./types.ts";

export type PersonalPaymentDisplayStatus =
  | "PAID"
  | "UNPAID"
  | "PARTIALLY PAID"
  | "WAIVED"
  | "NOT_APPLICABLE";

export interface PersonalMatchPaymentInfo {
  status: PersonalPaymentDisplayStatus;
  label: "PAID" | "UNPAID" | "PARTIALLY PAID" | "WAIVED" | null;
  amountDue: number;
  netPayable: number;
  amountPaid: number;
  paidAmount: number;
  totalFee: number;
  isWaived: boolean;
  feeOverride?: number;
  paymentRecord: MatchPayment | null;
}

export type PersonalPaymentStatusResult = PersonalMatchPaymentInfo;

/**
 * Parses match date and time into a deterministic local Date object.
 * Supports both `YYYY-MM-DD` and `DD/MM/YYYY`.
 */
export function parseMatchDateTime(dateStr: string, timeStr?: string): Date {
  let year = 2026;
  let month = 0; // 0-indexed
  let day = 1;

  if (dateStr.includes("/")) {
    // DD/MM/YYYY
    const parts = dateStr.split("/");
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10) - 1;
    year = parseInt(parts[2], 10);
  } else if (dateStr.includes("-")) {
    // YYYY-MM-DD
    const parts = dateStr.split("-");
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10) - 1;
    day = parseInt(parts[2], 10);
  }

  let hours = 23;
  let mins = 59;
  if (timeStr && timeStr.includes(":")) {
    const timeParts = timeStr.split(":");
    hours = parseInt(timeParts[0], 10) || 0;
    mins = parseInt(timeParts[1], 10) || 0;
  }

  return new Date(year, month, day, hours, mins, 0, 0);
}

/**
 * Derives personal match payment status for a specific player and match.
 *
 * Invariants:
 * - Fully paid obligation displays PAID.
 * - Unpaid obligation displays UNPAID.
 * - Partially settled obligation displays PARTIALLY PAID.
 * - Waived or non-billable obligations are NOT shown as unpaid.
 * - Multiple payment records are deduplicated without double counting.
 */
export function getPersonalMatchPaymentStatus(
  player: Player | null | undefined,
  match: Match,
  payments: MatchPayment[] = []
): PersonalMatchPaymentInfo {
  if (!player) {
    return {
      status: "NOT_APPLICABLE",
      label: null,
      amountDue: 0,
      netPayable: 0,
      amountPaid: 0,
      paidAmount: 0,
      totalFee: match.fee || 0,
      isWaived: false,
      feeOverride: undefined,
      paymentRecord: null,
    };
  }

  // Find all payment records for this player and match
  const playerPayments = payments.filter(
    (p) => p.playerId === player.id && p.matchId === match.id
  );

  // Deduplicate: prioritize Paid record or record with highest collection
  const payment =
    playerPayments.find((p) => p.status === "Paid") ||
    playerPayments.find((p) => (p.feeCollectedAmount || 0) > 0) ||
    playerPayments[0] ||
    null;

  const totalFee =
    payment?.feeOverride !== undefined
      ? payment.feeOverride
      : match.fee !== undefined
      ? match.fee
      : 0;

  const makeResult = (
    status: PersonalPaymentDisplayStatus,
    label: "PAID" | "UNPAID" | "PARTIALLY PAID" | "WAIVED" | null,
    amountDue: number,
    amountPaid: number,
    fee: number,
    isWaived: boolean,
    pmt: MatchPayment | null
  ): PersonalPaymentStatusResult => ({
    status,
    label,
    amountDue,
    netPayable: amountDue,
    amountPaid,
    paidAmount: amountPaid,
    totalFee: fee,
    isWaived,
    feeOverride: pmt?.feeOverride,
    paymentRecord: pmt,
  });

  // 1. Abandoned match handling (Approved Option A Policy)
  if (match.result === "Abandoned") {
    // If player paid before the match was abandoned, historical transaction is preserved
    const collected =
      (payment?.feeCollectedAmount || 0) + (payment?.feeOffsetAmount || 0);

    if (payment?.status === "Paid" || (collected >= totalFee && totalFee > 0)) {
      return makeResult("PAID", "PAID", 0, totalFee, totalFee, false, payment);
    }

    if (collected > 0) {
      // Unpaid portion is waived under Option A
      return makeResult("PARTIALLY PAID", "PARTIALLY PAID", 0, collected, totalFee, true, payment);
    }

    // Unpaid obligations are waived under Option A
    return makeResult("WAIVED", "WAIVED", 0, 0, totalFee, true, payment);
  }

  // 2. Explicitly waived obligation
  if (payment?.status === "Waived") {
    return makeResult("WAIVED", "WAIVED", 0, 0, totalFee, true, payment);
  }

  // 3. Player is marked Not Playing and has paid 0
  if (
    payment?.status === "Not Playing" &&
    (payment?.feeCollectedAmount || 0) === 0
  ) {
    return makeResult("NOT_APPLICABLE", null, 0, 0, totalFee, false, payment);
  }

  // 4. Non-billable match (e.g. 0 fee match)
  if (!isMatchBillable(match) || totalFee === 0) {
    return makeResult("PAID", "PAID", 0, 0, 0, false, payment);
  }

  // 5. Payment marked Paid
  if (payment?.status === "Paid") {
    return makeResult("PAID", "PAID", 0, totalFee, totalFee, false, payment);
  }

  // 6. Payment marked Unpaid
  if (payment?.status === "Unpaid") {
    const collected =
      (payment.feeCollectedAmount || 0) + (payment.feeOffsetAmount || 0);

    if (collected > 0 && collected < totalFee) {
      return makeResult(
        "PARTIALLY PAID",
        "PARTIALLY PAID",
        Math.max(0, totalFee - collected),
        collected,
        totalFee,
        false,
        payment
      );
    }

    if (collected >= totalFee && totalFee > 0) {
      return makeResult("PAID", "PAID", 0, totalFee, totalFee, false, payment);
    }

    return makeResult("UNPAID", "UNPAID", totalFee, 0, totalFee, false, payment);
  }

  // 7. No payment document exists yet
  // If player is viewing an upcoming open match before RSVP or squad assignment
  return makeResult("NOT_APPLICABLE", null, 0, 0, totalFee, false, null);
}

export type PlayerAvailabilityStatus =
  | "Playing"
  | "Maybe"
  | "Not Playing"
  | "Pending";

export interface PlayerAvailabilityInfo {
  status: PlayerAvailabilityStatus;
  badgeLabel: string;
  isConfirmed: boolean;
  isMaybe: boolean;
  isOut: boolean;
  isPending: boolean;
}

/**
 * Derives player's own availability for a match.
 */
export function derivePlayerAvailability(
  player: Player | null | undefined,
  match: Match,
  payments: MatchPayment[] = []
): PlayerAvailabilityInfo {
  if (!player) {
    return {
      status: "Pending",
      badgeLabel: "Pending",
      isConfirmed: false,
      isMaybe: false,
      isOut: false,
      isPending: true,
    };
  }

  const payment = payments.find(
    (p) => p.playerId === player.id && p.matchId === match.id
  );

  if (!payment) {
    return {
      status: "Pending",
      badgeLabel: "Awaiting Response",
      isConfirmed: false,
      isMaybe: false,
      isOut: false,
      isPending: true,
    };
  }

  const av = payment.availability;
  if (av === "Confirmed" || av === "Yes" || payment.status === "Paid") {
    return {
      status: "Playing",
      badgeLabel: "Playing",
      isConfirmed: true,
      isMaybe: false,
      isOut: false,
      isPending: false,
    };
  }

  if (av === "Waitlist") {
    return {
      status: "Playing",
      badgeLabel: "Waitlist",
      isConfirmed: true,
      isMaybe: false,
      isOut: false,
      isPending: false,
    };
  }

  if (av === "Tentative") {
    return {
      status: "Maybe",
      badgeLabel: "Maybe",
      isConfirmed: false,
      isMaybe: true,
      isOut: false,
      isPending: false,
    };
  }

  if (av === "No" || payment.status === "Not Playing") {
    return {
      status: "Not Playing",
      badgeLabel: "Not Playing",
      isConfirmed: false,
      isMaybe: false,
      isOut: true,
      isPending: false,
    };
  }

  // If status is Unpaid but availability is not explicitly set, they are in the squad (Playing)
  if (payment.status === "Unpaid") {
    return {
      status: "Playing",
      badgeLabel: "Playing",
      isConfirmed: true,
      isMaybe: false,
      isOut: false,
      isPending: false,
    };
  }

  return {
    status: "Pending",
    badgeLabel: "Awaiting Response",
    isConfirmed: false,
    isMaybe: false,
    isOut: false,
    isPending: true,
  };
}

export interface PlayerMatchGroups {
  upcoming: Match[];
  nextMatch: Match | null;
  recent: Match[];
  previous: Match[];
  unsettledOlder: Match[];
  allEligible: Match[];
}

/**
 * Organizes matches into Upcoming, Recent, and Previous sections based on
 * date and authoritative personal financial state.
 *
 * Rules:
 * 1. Upcoming Matches: All relevant upcoming matches sorted chronologically (nearest first).
 * 2. Next immediate fixture is identified as `nextMatch`.
 * 3. Recent Matches: Past matches within `recentCutoffDays` (default 30 days), sorted reverse chronologically.
 * 4. Older matches with unpaid or partially paid obligations remain in `recent` (or `unsettledOlder`),
 *    keeping them discoverable until settled.
 * 5. Older matches with fully settled player obligations belong under `previous`.
 * 6. No match disappears merely because it is old.
 */
export function groupPlayerMatches(
  matches: Match[] = [],
  player: Player | null | undefined,
  payments: MatchPayment[] = [],
  isAdmin: boolean = false,
  options: {
    referenceDate?: Date;
    recentCutoffDays?: number;
  } = {}
): PlayerMatchGroups {
  const refDate = options.referenceDate || new Date();
  const todayStart = new Date(
    refDate.getFullYear(),
    refDate.getMonth(),
    refDate.getDate(),
    0,
    0,
    0,
    0
  );
  const cutoffDays = options.recentCutoffDays !== undefined ? options.recentCutoffDays : 30;
  const recentCutoff = new Date(todayStart.getTime() - cutoffDays * 86400000);

  // 1. Filter matches by eligibility
  const eligibleMatches = matches.filter((m) =>
    isPlayerEligibleForMatch(player, m, payments, isAdmin)
  );

  const upcoming: Match[] = [];
  const recent: Match[] = [];
  const previous: Match[] = [];
  const unsettledOlder: Match[] = [];

  for (const match of eligibleMatches) {
    const matchDate = parseMatchDateTime(match.date, match.time);
    const hasResult =
      match.result &&
      match.result !== "Pending";

    const isUpcoming = !hasResult && matchDate.getTime() >= todayStart.getTime();

    if (isUpcoming) {
      upcoming.push(match);
    } else {
      // Past / Completed / Abandoned match
      const payInfo = getPersonalMatchPaymentStatus(player, match, payments);
      const isUnsettled =
        payInfo.status === "UNPAID" || payInfo.status === "PARTIALLY PAID";

      const isWithinRecentWindow = matchDate.getTime() >= recentCutoff.getTime();

      if (isWithinRecentWindow) {
        recent.push(match);
      } else {
        // Older match (> cutoffDays)
        if (isUnsettled) {
          // Rule 2 & 3: Older matches with unpaid or partially paid obligations
          // must remain visible and discoverable until settled.
          unsettledOlder.push(match);
          recent.push(match); // Keep visible in the active Recent list
        } else {
          // Rule 1: Older matches with fully settled obligations belong under Previous
          previous.push(match);
        }
      }
    }
  }

  // Sort upcoming chronologically (nearest first)
  upcoming.sort(
    (a, b) =>
      parseMatchDateTime(a.date, a.time).getTime() -
      parseMatchDateTime(b.date, b.time).getTime()
  );

  // Sort recent reverse chronologically (most recent first)
  recent.sort(
    (a, b) =>
      parseMatchDateTime(b.date, b.time).getTime() -
      parseMatchDateTime(a.date, a.time).getTime()
  );

  // Sort previous reverse chronologically (most recent first)
  previous.sort(
    (a, b) =>
      parseMatchDateTime(b.date, b.time).getTime() -
      parseMatchDateTime(a.date, a.time).getTime()
  );

  unsettledOlder.sort(
    (a, b) =>
      parseMatchDateTime(b.date, b.time).getTime() -
      parseMatchDateTime(a.date, a.time).getTime()
  );

  return {
    upcoming,
    nextMatch: upcoming[0] || null,
    recent,
    previous,
    unsettledOlder,
    allEligible: eligibleMatches,
  };
}

/**
 * Formats a match date (YYYY-MM-DD or DD/MM/YYYY) into a friendly string (e.g. "Sat, Nov 22, 2026").
 */
export function formatMatchDisplayDate(dateStr: string): string {
  if (!dateStr) return "Date TBD";
  try {
    const d = parseMatchDateTime(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

/**
 * Formats match time (HH:mm or standard time) into "h:mm a" (e.g. "07:00 AM").
 */
export function formatMatchDisplayTime(timeStr?: string): string {
  if (!timeStr) return "Time TBD";
  const trimmed = timeStr.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(AM|PM))?$/i);
  if (!match) return timeStr;
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const meridiem = match[3]?.toUpperCase();

  if (meridiem) {
    return `${hours}:${minutes} ${meridiem}`;
  }

  // 24-hour format
  const isPM = hours >= 12;
  if (hours === 0) {
    hours = 12;
  } else if (hours > 12) {
    hours -= 12;
  }
  return `${hours}:${minutes} ${isPM ? "PM" : "AM"}`;
}

/**
 * Computes reporting time (by default 30 minutes before match time) formatted as "h:mm a".
 */
export function computeReportingTime(timeStr?: string, minutesPrior = 30): string {
  if (!timeStr) return "";
  const trimmed = timeStr.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(AM|PM))?$/i);
  if (!match) return "";
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3]?.toUpperCase();

  if (meridiem) {
    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
  }

  let totalMinutes = hours * 60 + minutes - minutesPrior;
  if (totalMinutes < 0) totalMinutes += 24 * 60;

  let repHours = Math.floor(totalMinutes / 60);
  const repMins = totalMinutes % 60;
  const isPM = repHours >= 12;
  if (repHours === 0) {
    repHours = 12;
  } else if (repHours > 12) {
    repHours -= 12;
  }
  const repMinsStr = repMins < 10 ? `0${repMins}` : `${repMins}`;
  return `${repHours}:${repMinsStr} ${isPM ? "PM" : "AM"}`;
}

