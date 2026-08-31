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
  };
  whatsappTemplateVariables?: {
    studio_expiry_reminder?: string;
    studio_expired_reminder?: string;
    studio_expires_today?: string;
    payment_reminder?: string;
  };
  isStudioEnabled?: boolean;
  features?: {
    payments: boolean;
    studio: boolean;
    leaderboard: boolean;
    feed: boolean;
    matches: boolean;
    isWixEnabled?: boolean;
    shop?: boolean;
    opinion?: boolean;
    pna?: boolean;
    badges?: boolean;
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
  isStudioAdmin?: boolean;
  isMatchAdmin?: boolean;
  isFinanceAdmin?: boolean;
  isClubAdmin?: boolean;
  // When true, this user sees the KAvach Design tab (post templates for
  // match results / milestones / achievements). Admins get access
  // automatically regardless of this flag.
  isDesigner?: boolean;
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
  groundFeePaidAmount?: number;
  // When set, this match belongs to a tournament (see Tournament).
  // Autofilled fields on the match were seeded from that tournament
  // at creation time but are free to be edited afterwards.
  tournamentId?: string;
  // Google Calendar event id for the public match calendar. Set by the
  // /api/calendar/sync route after the event is created so later edits
  // and deletes map back to the right event.
  googleEventId?: string;
  matchFeeBudget?: number;
  createdAt?: any;
  updatedAt?: any;
};

export type Player = {
  id: string;
  name: string;
  authUid?: string;
  photoURL?: string;
  email?: string;
  mobile: string;
  disabled?: boolean;
  disabledAt?: string;
  mergedInto?: string;
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
  createdAt?: any;
  updatedAt?: any;
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

export type MatchPayment = {
  id: string;
  matchId: string;
  playerId: string;
  guestName?: string;
  status: "Paid" | "Unpaid" | "Not Playing" | "Failed";
  paymentMethod?: "razorpay" | "manual";
  manualBy?: string;
  availability?:
    | "Yes"
    | "No"
    | "Tentative"
    | "Pending"
    | "Confirmed"
    | "Waitlist";
  feeOverride?: number;
  planTag?: string;
  sponsoredBy?: string;
  sponsoring?: string;
  updatedAt?: any;
};

export type FeePlan = {
  id: string;
  name: string;
  type: "fixed" | "monthly" | "sponsored";
  feeAmount?: number;
  monthlyAmount?: number;
  isActive?: boolean;
  createdAt?: any;
  updatedAt?: any;
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

export type BadgeType =
  | "year_1" | "year_2" | "year_3" | "year_4" | "year_5"
  | "original"
  | "core"
  | "elite"
  | "centurion"
  | "hattrick"
  | "5wh"
  | "runs_2k" | "runs_5k" | "runs_10k"
  | "wickets_100" | "wickets_200" | "wickets_300" | "wickets_500";

export type BadgeTier = "bronze" | "silver" | "gold" | "diamond";

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
