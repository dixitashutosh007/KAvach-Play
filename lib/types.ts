/**
 * Core Data Models & Type Definitions (`lib/types.ts`)
 *
 * Contains all primary TypeScript type definitions used throughout the application.
 * Defines the schemas for configurations, players, matches, subscription plans,
 * grounds, and other crucial structures. Ensures strict type-checking between standard
 * React states and untyped external data fetched from Firestore.
 */
export type AppConfig = {
  id: string;
  clubName: string;
  logoUrl: string;
  // Optional PNG with a transparent background — used by DesignTab
  // when the logo needs to sit directly on a coloured/photo background
  // without a visible white square around it.
  logoTransparentUrl?: string;
  themeColor: string;
  globalTheme?: string;
  loadingAnimationTheme?: "radar" | "kinetic" | "minimal" | "staggered" | "breathe";
  razorpayKeyId?: string;
  resendApiKey?: string;
  emailProvider?: "resend" | "smtp";
  resendSender?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFrom?: string;
  emailTemplates?: {
    welcome?: { subject: string; body: string };
    due_reminder?: { subject: string; body: string };
    payment_success?: { subject: string; body: string };
  };
  whatsappProvider?: "meta" | "none";
  whatsappPhoneNumberId?: string;
  whatsappAccessToken?: string;
  whatsappTemplates?: {
    studio_expiry_reminder?: string;
    studio_expired_reminder?: string;
    studio_expires_today?: string;
    payment_reminder?: string;
    club_invite?: string;
  };
  whatsappTemplateVariables?: {
    studio_expiry_reminder?: string;
    studio_expired_reminder?: string;
    studio_expires_today?: string;
    payment_reminder?: string;
    club_invite?: string;
  };
  whatsappTemplateLanguages?: {
    payment_reminder?: string;
    club_invite?: string;
  };
  crmTeamPlayerIds?: string[];
  isStudioEnabled?: boolean;
  features?: {
    payments: boolean;
    studio: boolean;
    leaderboard: boolean;
    feed: boolean;
    matches: boolean;
    shop?: boolean;
    opinion?: boolean;
    pna?: boolean;
    badges?: boolean;
    cricketStatsLeaderboard?: boolean;
  };
  matchConfiguration?: {
    directionsHoursBefore?: number;
    directionsHoursAfter?: number;
    enablePlayerAvailability?: boolean;
  };
  googleCalendarId?: string;
};

export type AppUser = {
  id: string; // The user's UID
  email: string;
  photoURL?: string;
  role: "admin" | "player";
  status?: "Active" | "Disabled" | string;
  playerId?: string;
  /** Active roles (D-22): Club Admin and Finance Admin; Super Admin is the `admin` claim. Server-written only. */
  isFinanceAdmin?: boolean;
  isClubAdmin?: boolean;
  /** @deprecated D-22 retired role (→ Club Admin). Grants nothing; removed by the migration. */
  isStudioAdmin?: boolean;
  /** @deprecated D-22 retired role (→ Club Admin). Grants nothing; removed by the migration. */
  isMatchAdmin?: boolean;
  /** @deprecated D-22 retired role (→ Club Admin). Grants nothing; removed by the migration. */
  isDesigner?: boolean;
  /** Original retired-role values kept by the D-22 migration for traceability. */
  roleMigration?: { migrationId: string; from: Record<string, unknown>; migratedAt?: unknown };
  rolesUpdatedAt?: unknown;
  rolesUpdatedBy?: string;
  name?: string;
  dob?: string;
  locality?: string;
  bloodGroup?: string;
  emergencyContact?: string;
  battingStyle?: string;
  bowlingStyle?: string;
  isWicketKeeper?: boolean;
  chestSize?: string;
  jerseyNumber?: string;
  jerseyName?: string;
  waistSize?: string;
  mobile?: string;
  isStudioMember?: boolean;
  studioStartDate?: string;
  studioEndDate?: string;
  studioPlan?: "Trial" | "1M" | "3M" | "6M" | "12M" | "Other";
  lastPaidDate?: string;
  lastPaidAmount?: number;
  studioExpiryDate?: string;
  kavachJoining?: string;
  // Firebase Auth providers linked to this user, captured on login.
  // Values: "google.com" | "phone" | "password" | "anonymous" | "apple.com" | ...
  authProviders?: string[];
  lastLoginAt?: string; // ISO timestamp of the last time authProviders was written
  // Map of providerId → ISO timestamp of the first time this provider was
  // observed on the user. Never overwritten once set for a given provider,
  // so it acts as a rough "when did they first link this method" audit.
  firstProviderLinkedAt?: Record<string, string>;
};

export type Ground = {
  id: string;
  name: string;
  mapUrl: string;
  organiserName: string;
  organiserPhone?: string;   // optional — read by tournament / match forms as autofill
  gpayNumber: string;
  practiceFee?: number;
  tournamentFee?: number;
  createdAt?: any;
  updatedAt?: any;
};

// A tournament is a persistent bundle of match-scheduling defaults
// (ground, organiser, per-player fee, colours). Individual matches
// can be linked to a tournament via `Match.tournamentId`, in which
// case the match form's tournament dropdown autofills those defaults.
// Autofilled fields remain editable per match.
//
// Single-axis status: Upcoming → Ongoing → Ended, plus a "Disabled"
// state that hides the tournament from the new-match dropdown
// without touching lifecycle. New-match dropdown shows only
// Upcoming + Ongoing; Ended and Disabled are omitted.
export type Tournament = {
  id: string;
  name: string;
  groundId: string;
  organiserName: string;
  organiserPhone: string;
  gpayNumber: string;
  jerseyColor: "Scarlet Red" | "Whites";
  format?: "T20" | "T30";         // default T30 (99% of tournaments)
  amountPerMatch: number;         // ground fee per match, ₹
  perPlayerFee: number;           // default round(amountPerMatch/12 * 1.05); editable override
  status: "Upcoming" | "Ongoing" | "Ended" | "Disabled";
  startDate?: string;             // YYYY-MM-DD, optional
  endDate?: string;               // YYYY-MM-DD, optional
  notes?: string;
  createdAt?: any;
  updatedAt?: any;
};

export type Match = {
  id: string;
  groundId: string;
  format: "T20" | "T30" | "Other";
  jerseyColor: "Scarlet Red" | "Whites";
  opponent: string;
  matchType: "Practice" | "Tournament";
  fee: number;
  date: string;
  time: string;
  maxSquadSize: number;
  matchUrl?: string;
  streamingUrl?: string;
  result?:
    | "KAvach Won"
    | "KAvach Lost"
    | "Draw"
    | "Tie"
    | "Abandoned"
    | "Pending";
  resultMarginType?: "runs" | "wickets";
  resultMarginAmount?: number;
  playerOfTheMatch?: string;
  potmId?: string;
  topPerformerIds?: string[];
  bestBatsman?: string;
  bestBowler?: string;
  isTentative?: boolean;
  tentativelyBlockedBy?: string;
  isArchived?: boolean;
  isGroundFeePaid?: boolean;
  /** Actual ground / vendor expense (₹). Server-only: /api/finance/match-ledger. */
  groundFeePaidAmount?: number;
  groundFeeSetBy?: string;
  groundFeeSetByName?: string;
  groundFeeSetAt?: any;
  groundFeeHistory?: { kind: "set" | "correction" | "adjustment"; from: number | null; to: number; reason: string; by: string; byName: string; at: string }[];
  /** Match finance lifecycle (absent = "open"). Server-only. */
  financeStatus?: "open" | "closed";
  financeClosedAt?: any;
  financeClosedBy?: string;
  financeClosedByName?: string;
  financeHistory?: { action: "closed" | "reopened"; reason?: string; statement?: Record<string, unknown>; by: string; byName: string; at: string }[];
  // When set, this match belongs to a tournament (see Tournament).
  // Autofilled fields on the match were seeded from that tournament
  // at creation time but are free to be edited afterwards.
  tournamentId?: string;
  // Google Calendar event id for the public match calendar. Set by the
  // /api/calendar/sync route after the event is created so later edits
  // and deletes map back to the right event.
  googleEventId?: string;
  matchFeeBudget?: number;
  /**
   * Margin % used by the Add/Edit Match fee calculator when `fee` was set
   * (default 5). Informational: `fee` stays the authoritative per-player fee.
   */
  feeMarginPct?: number;
  createdAt?: any;
  updatedAt?: any;
};

export type Player = {
  id: string;
  name: string;
  kavachId?: string;
  authUid?: string;
  photoURL?: string;
  email?: string;
  mobile: string;
  disabled?: boolean;
  disabledAt?: string;
  mergedInto?: string;
  mergeStatus?: "in_progress" | "completed" | "failed" | string;
  mergeJobId?: string;
  mergeLeaseOwner?: string;
  mergeFencingToken?: number;
  mergeLeaseExpiresAt?: number;
  inviteStatus:
    | "Unverified"
    | "Verified"
    | "Invited"
    | "Pending"
    | "Accepted"
    | "Rejected";
  dob?: string;
  locality?: string;
  bloodGroup?: string;
  emergencyContact?: string;
  battingStyle?: string;
  bowlingStyle?: string;
  isWicketKeeper?: boolean;
  chestSize?: string;
  jerseyNumber?: string;
  jerseyName?: string;
  waistSize?: string;
  isStudioMember?: boolean;
  studioStartDate?: string;
  studioEndDate?: string;
  studioPlan?: "Trial" | "1M" | "3M" | "6M" | "12M" | "Other";
  lastPaidDate?: string;
  lastPaidAmount?: number;
  studioExpiryDate?: string;
  rejectedAt?: string;
  feePlanIds?: string[];
  monthlyPlan?: {
    planId: string;
    amount: number;
    startDate: string;
    endDate: string;
    paidStatus: "Paid" | "Unpaid";
  };
  kavachJoining?: string;
  totalRuns?: number;
  totalWickets?: number;
  droppedCatches?: number;
  stunningCatches?: number;
  createdAt?: any;
  updatedAt?: any;
};

export type CatchLogEntry = {
  id: string;
  playerId: string;
  playerName: string;
  type: "dropped" | "stunning";
  count: number;
  matchId?: string;
  comment?: string;
  recordedBy: string;
  recordedAt?: any;
};

export type SubscriptionPlan = {
  id: string;
  name: string;
  durationDays: number;
  fee: number;
  benefits: string;
  isActive?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

export type SubscriptionHistory = {
  id: string;
  playerId: string;
  adminId: string;
  adminName: string;
  oldExpiryDate?: string;
  newExpiryDate: string;
  planId: string;
  planName: string;
  paidAmount: number;
  createdAt?: any;
};

export type OutOfPlay = {
  id: string;
  playerId: string;
  startDate: string; // ISO date string (YYYY-MM-DD)
  endDate: string; // ISO date string (YYYY-MM-DD)
  comment?: string;
  createdAt?: any;
  updatedAt?: any;
};

export type MatchComment = {
  id: string;
  matchId: string;
  playerId: string;
  playerName: string;
  text: string;
  createdAt?: any;
};

export type ManualPaymentMethod = "cash_collected" | "club_sponsored" | "part_of_plan" | "deposited_directly";

export type PaymentReversal = {
  amount: number;
  method: "razorpay_refund" | "cash" | "upi" | "bank";
  reference: string;
  reason: string;
  removedFromSquad: boolean;
  original: {
    status: string;
    paymentMethod: string | null;
    manualMethod: string | null;
    feeCollectedAmount: number | null;
    feeOverride: number | null;
    razorpayPaymentId: string | null;
    manualBy: string | null;
  };
  resultStatus: "Unpaid" | "Not Playing";
  by: string;
  byName: string;
  at: string;
};

export type MatchPayment = {
  id: string;
  matchId: string;
  playerId: string;
  guestName?: string;
  status: "Paid" | "Unpaid" | "Not Playing" | "Failed" | "Waived";
  paymentMethod?: "razorpay" | "manual";
  razorpayPaymentId?: string;
  manualMethod?: ManualPaymentMethod;
  manualBy?: string;
  feeCollectedAmount?: number;
  feeOffsetAmount?: number;
  waivedReason?: string;
  waivedAt?: any;
  availability?:
    | "Yes"
    | "No"
    | "Tentative"
    | "Pending"
    | "Confirmed"
    | "Waitlist";
  tacticalNote?: string;
  availabilityNote?: string;
  feeOverride?: number;
  planTag?: string;
  /**
   * How this payment's fee was worked out (Finance Plans): plan, assignment,
   * match date/fee, contribution, sponsorship, override reason. Written only
   * by `/api/finance/match-plans`. See lib/match-plan-application.
   */
  financeSnapshot?: import("./match-plan-application").FinanceSnapshot;
  /** Append-only record of refunds / reversals (server-only: /api/finance/match-ledger). */
  reversals?: PaymentReversal[];
  sponsoredBy?: string;
  sponsoring?: string;
  updatedAt?: any;
};

/**
 * Finance Plan (stored in the existing `feePlans` collection; formerly "Match
 * Fee Plan"). "Regular" is not stored: it is the absence of an active
 * assignment. New fields are optional so existing plan documents stay valid.
 */
export type FeePlan = {
  id: string;
  name: string;
  type: "fixed" | "monthly" | "sponsored" | "percentage";
  /** fixed: player contribution per match (₹). */
  feeAmount?: number;
  /** monthly: subscription amount per period (₹). */
  monthlyAmount?: number;
  /** percentage: discount on the actual match fee, 0–100. */
  discountPct?: number;
  /** monthly: how the subscription is allocated to matches. */
  allocationPolicy?: "fixed_per_match" | "distribute";
  /** monthly + fixed_per_match: player contribution allocated per match (₹). */
  perMatchContribution?: number;
  /** Optional window in which NEW assignments may start/run (YYYY-MM-DD). Never alters past matches. */
  validFrom?: string;
  validTo?: string;
  description?: string;
  isActive?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

/**
 * A player's assignment to a Finance Plan for a date range
 * (`financePlanAssignments`). Written only by the server API; never deleted —
 * ending sets `endDate`, cancelling a not-yet-started one sets `cancelled`.
 * `startDate: null` = carried over from the legacy `player.feePlanIds` list
 * (in effect since before date tracking).
 */
export type FinancePlanAssignment = {
  id: string;
  playerId: string;
  planId: string;
  /** Plan name at assignment time (display / audit). */
  planName: string;
  /** Inclusive, YYYY-MM-DD; null = legacy (no recorded start). */
  startDate: string | null;
  /** Inclusive, YYYY-MM-DD; null = open-ended. */
  endDate: string | null;
  cancelled?: boolean;
  legacy?: boolean;
  createdBy?: string;
  createdByName?: string;
  createdAt?: any;
  endedBy?: string;
  endedByName?: string;
  endedAt?: any;
  endReason?: string;
};

export type PostComment = {
  id: string;
  userId: string;
  userName: string;
  text: string;
  createdAt?: any;
};

export type Post = {
  id: string;
  text: string;
  imageUrl?: string;
  authorName?: string;
  authorId?: string;
  comments: PostComment[];
  isSystem?: boolean; // For birthday automated posts
  /** Club announcement published by an admin (shown under Club Announcements, not the Feed). */
  isAnnouncement?: boolean;
  /** Pinned announcements are also highlighted in the Home top banner. */
  isPinned?: boolean;
  /** Optional announcement headline. */
  title?: string;
  /** Optional HTTPS destination; the Home banner opens it when tapped. */
  linkUrl?: string;
  /** Seconds this announcement stays in the Home top banner before rotating (default 6). */
  displayDurationSec?: number;
  /** "potw": Player of the Weekend award post (server-created; drives the Home banner slide). */
  kind?: "potw";
  potw?: { playerId: string; playerName: string; photoURL?: string; message?: string; weekendId: string; weekendLabel?: string };
  createdAt?: any;
  updatedAt?: any;
};

export type Notification = {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: "email" | "in_app" | "both";
  isRead: boolean;
  metadata?: any;
  createdAt?: any;
};

export type OtherFee = {
  id: string;
  playerId: string;
  templateId?: string;
  title: string;
  amount: number;
  comment?: string;
  status: "Paid" | "Unpaid" | "Failed" | "Cancelled";
  cancelledBy?: string;
  cancelledAt?: any;
  createdAt?: any;
  updatedAt?: any;
};

export type FeeTemplate = {
  id: string;
  name: string;
  amount: number;
  createdAt?: any;
  updatedAt?: any;
};

export type PlayerStat = {
  id: string;
  playerId: string;
  year: number;
  runs: number;
  wickets: number;
  updatedAt?: any;
};

export type BadgeType = string;

export type BadgeTier = "bronze" | "silver" | "gold" | "diamond";

export type BadgeTypeDef = {
  id: string;
  label: string;
  short: string;
  tier: BadgeTier;
  emoji: string;
  stackable: boolean;
  order: number;
  createdAt?: any;
  updatedAt?: any;
};

export type Badge = {
  id: string;
  playerId: string;
  playerName: string;
  badgeType: BadgeType;
  matchId?: string;
  note?: string;
  awardedBy: string;
  awardedByName: string;
  awardedAt: any;
  redeemed: boolean;
  redeemedAt?: any;
};

export type MerchCustomFieldOption = {
  value: string;
  priceModifierType: "None" | "Add";
  priceModifierValue?: number;
};

export type MerchCustomField = {
  name: string;
  options: MerchCustomFieldOption[];
};

export type Merchandise = {
  id: string;
  name: string;
  description: string;
  category: "Jersey" | "Pant" | "Jacket" | "Sweater" | "Cap" | "Cricket Gears" | "Stickers" | "Others";
  basePrice: number;
  sizes: string[]; // Legacy size specs
  specs: string[]; // Legacy spec options
  customFields?: MerchCustomField[];
  requirePlayerDetails?: boolean;
  minOrderQuantity: number;
  status: "Accepting Orders" | "Not Accepting Orders";
  imageUrl?: string;
  isHidden?: boolean;
  // When the admin resets the "Vendor Goal Target" progress bar
  // (after placing a batch with the vendor), we snapshot the current
  // paid-orders count here. Subsequent progress is displayed as
  // (paidCount − targetBaseline) / minOrderQuantity so a new batch
  // starts from 0/MOQ without wiping historical orders.
  targetBaseline?: number;
  targetBaselineAt?: string; // ISO date of last reset (for display)
  createdAt?: any;
  updatedAt?: any;
};

export type MerchOrder = {
  id: string;
  playerId: string;
  playerName: string;
  merchId: string;
  merchName: string;
  size: string; // Legacy size
  spec?: string; // Legacy spec
  customSelections?: Record<string, string>;
  jerseyName?: string;
  jerseyNumber?: string;
  price: number;
  paymentStatus: "Paid" | "Unpaid" | "Failed";
  orderStatus: "Order Placed" | "Awaiting Min Order Qnty" | "Ready to Place Order" | "Order Received" | "Fulfilled";
  isManual?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

export type Poll = {
  id: string;
  title: string;
  type: "singleChoice" | "multipleChoice" | "slider";
  options?: string[]; // For single/multiple choice
  sliderMin?: number; // For slider
  sliderMax?: number; // For slider
  sliderMinLabel?: string;
  sliderMaxLabel?: string;
  isSticked: boolean;
  isActive: boolean;
  isEdited?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

export type PollResponse = {
  id: string;
  pollId: string;
  playerId: string;
  response: string | string[] | number;
  isArchived?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

export type LeadStatus = "new" | "contacted" | "trial" | "converted" | "closed";
export type LeadInterest = "studio" | "matches" | "both";
export type LeadSource = "whatsapp" | "call" | "jotform" | "email" | "walk_in" | "other";

export type LeadNote = {
  id: string;
  text: string;
  adminId: string;
  adminName: string;
  createdAt: string; // ISO timestamp
};

export type ClubLead = {
  id: string;
  name: string;
  mobile: string;
  email?: string;
  area?: string;
  source: LeadSource;
  interest: LeadInterest;
  queryText: string;
  status: LeadStatus;
  nextFollowUpDate?: string;
  notes: LeadNote[];
  convertedPlayerId?: string;
  assignedTo?: string[];
  createdAt?: any;
  updatedAt?: any;
};

