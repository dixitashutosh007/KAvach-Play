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
  effectiveFee?: number;
  totalCollected?: number;
  totalOffset?: number;
  isWaived: boolean;
  feeOverride?: number;
  paymentRecord: MatchPayment | null;
  records?: MatchPayment[];
}

export type PersonalPaymentStatusResult = PersonalMatchPaymentInfo;

export interface AggregatedPaymentResult {
  effectiveFee: number;
  totalCollected: number;
  totalOffset: number;
  totalRecognized: number;
  netPayable: number;
  status: PersonalPaymentDisplayStatus;
  label: "PAID" | "UNPAID" | "PARTIALLY PAID" | "WAIVED" | null;
  isWaived: boolean;
  feeOverride?: number;
  contributingPayments: MatchPayment[];
}

/**
 * Authoritative Payment Aggregation Engine.
 *
 * Scopes records to the authenticated player's own match obligation,
 * aggregates distinct legitimate collections across multiple payments,
 * deduplicates shared transaction identifiers, applies fee overrides and offsets,
 * preserves legacy Paid records, and handles malformed amounts deterministically.
 */
export function aggregatePlayerMatchPayment(
  player: Player | null | undefined,
  match: Match,
  payments: MatchPayment[] = []
): AggregatedPaymentResult {
  if (!player) {
    return {
      effectiveFee: match.fee || 0,
      totalCollected: 0,
      totalOffset: 0,
      totalRecognized: 0,
      netPayable: 0,
      status: "NOT_APPLICABLE",
      label: null,
      isWaived: false,
      feeOverride: undefined,
      contributingPayments: [],
    };
  }

  // 1. Scope records strictly to this player and this match
  const playerPayments = (payments || []).filter(
    (p) => p && p.playerId === player.id && p.matchId === match.id && !p.guestName
  );

  // 2. Resolve effective fee (feeOverride vs match.fee)
  let feeOverride: number | undefined = undefined;
  for (const p of playerPayments) {
    if (typeof p.feeOverride === "number" && !isNaN(p.feeOverride) && p.feeOverride >= 0) {
      feeOverride = p.feeOverride;
      break;
    }
  }

  const baseFee =
    typeof match.fee === "number" && !isNaN(match.fee) && match.fee >= 0
      ? match.fee
      : 0;
  const effectiveFee = feeOverride !== undefined ? feeOverride : baseFee;

  // 3. Option A Abandoned match policy
  const isAbandoned = match.result === "Abandoned";
  const hasWaivedDoc = playerPayments.some((p) => p.status === "Waived");

  // 4. Aggregate distinct legitimate collections and offsets
  const seenDocIds = new Set<string>();
  const seenRazorpayIds = new Set<string>();
  let totalCollected = 0;
  let totalOffset = 0;
  const contributing: MatchPayment[] = [];

  for (const p of playerPayments) {
    // Ignore failed transactions
    if (p.status === "Failed") continue;

    // Deduplication check by document ID
    if (p.id) {
      if (seenDocIds.has(p.id)) continue;
      seenDocIds.add(p.id);
    }

    // Deduplication check by Razorpay Payment ID
    if (p.razorpayPaymentId) {
      if (seenRazorpayIds.has(p.razorpayPaymentId)) continue;
      seenRazorpayIds.add(p.razorpayPaymentId);
    }

    contributing.push(p);

    // Calculate collection for this record
    let collectedFromThisDoc = 0;
    if (
      typeof p.feeCollectedAmount === "number" &&
      !isNaN(p.feeCollectedAmount) &&
      p.feeCollectedAmount > 0
    ) {
      collectedFromThisDoc = p.feeCollectedAmount;
    } else if (p.status === "Paid") {
      // Legacy Paid record without explicit feeCollectedAmount
      const offsetOnDoc =
        typeof p.feeOffsetAmount === "number" &&
        !isNaN(p.feeOffsetAmount) &&
        p.feeOffsetAmount > 0
          ? p.feeOffsetAmount
          : 0;
      collectedFromThisDoc = Math.max(0, effectiveFee - offsetOnDoc);
    }

    totalCollected += collectedFromThisDoc;

    // Calculate offset for this record
    if (
      typeof p.feeOffsetAmount === "number" &&
      !isNaN(p.feeOffsetAmount) &&
      p.feeOffsetAmount > 0
    ) {
      totalOffset += p.feeOffsetAmount;
    } else if (p.manualMethod === "club_sponsored" && p.status === "Paid") {
      totalOffset += effectiveFee;
    }
  }

  // Cap offset to effectiveFee
  totalOffset = Math.min(effectiveFee, Math.max(0, totalOffset));

  // If match is abandoned or obligation is explicitly waived:
  if (isAbandoned || hasWaivedDoc) {
    return {
      effectiveFee,
      totalCollected,
      totalOffset,
      totalRecognized: totalCollected + totalOffset,
      netPayable: 0,
      status: "WAIVED",
      label: "WAIVED",
      isWaived: true,
      feeOverride,
      contributingPayments: contributing,
    };
  }

  // Non-billable match (e.g. 0 fee match)
  if (!isMatchBillable(match) || effectiveFee === 0) {
    return {
      effectiveFee: 0,
      totalCollected,
      totalOffset: 0,
      totalRecognized: totalCollected,
      netPayable: 0,
      status: "PAID",
      label: "PAID",
      isWaived: false,
      feeOverride,
      contributingPayments: contributing,
    };
  }

  // Outstanding payable derivation
  const totalRecognized = totalCollected + totalOffset;
  const netPayable = Math.max(0, effectiveFee - totalRecognized);

  // Status derivation
  let status: PersonalPaymentDisplayStatus = "UNPAID";
  let label: "PAID" | "UNPAID" | "PARTIALLY PAID" | "WAIVED" | null = "UNPAID";

  if (netPayable === 0) {
    status = "PAID";
    label = "PAID";
  } else if (totalCollected > 0 || totalOffset > 0) {
    status = "PARTIALLY PAID";
    label = "PARTIALLY PAID";
  } else {
    // 0 collected, 0 offset, netPayable > 0
    const isNotPlaying = playerPayments.some(
      (p) => p.status === "Not Playing" || p.availability === "No"
    );
    if (
      isNotPlaying &&
      playerPayments.length === 1 &&
      (playerPayments[0].feeCollectedAmount || 0) === 0
    ) {
      status = "NOT_APPLICABLE";
      label = null;
    } else {
      status = "UNPAID";
      label = "UNPAID";
    }
  }

  return {
    effectiveFee,
    totalCollected,
    totalOffset,
    totalRecognized,
    netPayable,
    status,
    label,
    isWaived: false,
    feeOverride,
    contributingPayments: contributing,
  };
}

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
 * - Multiple payment records are aggregated and deduplicated without double counting.
 */
export function getPersonalMatchPaymentStatus(
  player: Player | null | undefined,
  match: Match,
  payments: MatchPayment[] = []
): PersonalMatchPaymentInfo {
  const agg = aggregatePlayerMatchPayment(player, match, payments);
  const primaryRecord = agg.contributingPayments[0] || null;

  return {
    status: agg.status,
    label: agg.label,
    amountDue: agg.netPayable,
    netPayable: agg.netPayable,
    amountPaid: agg.totalCollected,
    paidAmount: agg.totalCollected,
    totalFee: agg.effectiveFee,
    effectiveFee: agg.effectiveFee,
    totalCollected: agg.totalCollected,
    totalOffset: agg.totalOffset,
    isWaived: agg.isWaived,
    feeOverride: agg.feeOverride,
    paymentRecord: primaryRecord,
    records: agg.contributingPayments,
  };
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

