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
  };
  matchConfiguration?: {
    directionsHoursBefore?: number;
    directionsHoursAfter?: number;
    enablePlayerAvailability?: boolean;
  };
  // automaticReminders and emailAutomationEnabled were removed with the
  // cron cleanup. Reminders are only sent when an admin explicitly clicks
  // a "Send" button; there is no scheduled automation.
};

export type AppUser = {
  id: string; // The user's UID
  email: string;
  photoURL?: string;
  role: "admin" | "player";
  isStudioAdmin?: boolean;
  isMatchAdmin?: boolean;
  isFinanceAdmin?: boolean;
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
};

export type Ground = {
  id: string;
  name: string;
  mapUrl: string;
  organiserName: string;
  gpayNumber: string;
  practiceFee?: number;
  tournamentFee?: number;
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
  availability?:
    | "Yes"
    | "No"
    | "Tentative"
    | "Pending"
    | "Confirmed"
    | "Waitlist";
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
  status: "Paid" | "Unpaid" | "Failed";
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
