/**
 * Home top-banner slide model (`components/home/bannerSlides.ts`).
 *
 * Pure helpers (no React / Firebase) for:
 *  - building banner slides from EXISTING data sources (pinned club
 *    announcements, feature promos, player birthdays). Match / fixture content
 *    is deliberately excluded (owner decision 2026-11-21);
 *  - today / tomorrow birthday highlights in the club timezone;
 *  - per-user dismissal bookkeeping keyed by a "period" so a dismissed banner does
 *    not reappear during the same banner period, but does when the content changes.
 */
import type { AppConfig, Player, Post } from "@/lib/types";
import { getPlayerBirthdayStatus } from "@/lib/birthday-utils";
import { pinnedAnnouncements } from "./postKinds";
import { firstHttpsLink, toSafeHttpsHref } from "@/lib/linkify";
import { BANNER_DURATION_DEFAULT_SEC, resolveDisplayDurationMs } from "@/lib/banner-duration";

const DEFAULT_DURATION_MS = BANNER_DURATION_DEFAULT_SEC * 1000;

export type BannerKind = "notice" | "promo" | "birthday-today" | "birthday-tomorrow";

export interface BannerSlide {
  id: string;
  kind: BannerKind;
  title: string;
  subtitle?: string;
  description: string;
  badge: string;
  badgeColor?: "scarlet" | "wine" | "gold" | "emerald";
  ctaText?: string;
  ctaDestination?: string;
  targetId?: string;
  /**
   * Validated HTTPS destination. When present the whole banner surface opens it
   * (safe external navigation); otherwise the banner keeps its in-app behaviour.
   */
  href?: string;
  /** How long this slide stays visible before auto-rotating (ms). */
  durationMs: number;
  /** Stable key for dismissal; changes when the banner's "period" changes. */
  dismissKey: string;
  /**
   * Whether the user may dismiss this slide. The current announcement model has
   * no mandatory / non-dismissible flag, so every slide is dismissible today.
   */
  dismissible: boolean;
}

export interface ClubDay {
  year: number;
  /** 0-based month */
  month: number;
  day: number;
  /** YYYY-MM-DD in the club timezone */
  dateString: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function clubDayFromParts(year: number, month: number, day: number): ClubDay {
  return { year, month, day, dateString: `${year}-${pad(month + 1)}-${pad(day)}` };
}

/** Midnight (device-local) Date carrying the club calendar day, for date-only helpers. */
export function clubDayToDate(d: ClubDay): Date {
  return new Date(d.year, d.month, d.day);
}

function toSeconds(ts: unknown): number | null {
  if (!ts) return null;
  if (typeof ts === "number") return Math.floor(ts > 1e12 ? ts / 1000 : ts);
  if (typeof ts === "object" && ts && "seconds" in (ts as any)) return Number((ts as any).seconds) || null;
  const parsed = Date.parse(String(ts));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

/** "Asha" · "Asha & Ravi" · "Asha, Ravi & 2 more" */
export function formatBirthdayNames(names: string[]): string {
  const clean = names.map((n) => (n || "").trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} & ${clean[1]}`;
  return `${clean[0]}, ${clean[1]} & ${clean.length - 2} more`;
}

/**
 * Today's and tomorrow's birthdays, evaluated on the CLUB calendar day.
 * Uses the existing birthday utilities (leap-day policy, year rollover) and only
 * exposes what the existing club birthday feature already shows: the name.
 */
export function buildBirthdaySlides(players: Player[] = [], today: ClubDay): BannerSlide[] {
  const ref = clubDayToDate(today);
  const todayNames: string[] = [];
  const tomorrowNames: string[] = [];

  for (const p of players) {
    if (!p || p.disabled || (p as any).mergedInto || !p.dob || !p.name) continue;
    const status = getPlayerBirthdayStatus(p.dob, ref);
    if (status.isToday) todayNames.push(p.name);
    else if (status.isUpcoming && status.daysUntil === 1) tomorrowNames.push(p.name);
  }

  todayNames.sort((a, b) => a.localeCompare(b));
  tomorrowNames.sort((a, b) => a.localeCompare(b));
  const slides: BannerSlide[] = [];

  if (todayNames.length > 0) {
    slides.push({
      id: `birthday-today-${today.dateString}`,
      kind: "birthday-today",
      badge: todayNames.length > 1 ? "Birthdays Today" : "Birthday Today",
      badgeColor: "gold",
      title: `Happy Birthday, ${formatBirthdayNames(todayNames)}!`,
      description:
        todayNames.length > 1
          ? "The whole club wishes our teammates a fantastic day on and off the field."
          : "The whole club wishes our teammate a fantastic day on and off the field.",
      durationMs: DEFAULT_DURATION_MS,
      dismissKey: `birthday-today:${today.dateString}`,
      dismissible: true,
    });
  }

  if (tomorrowNames.length > 0) {
    slides.push({
      id: `birthday-tomorrow-${today.dateString}`,
      kind: "birthday-tomorrow",
      badge: tomorrowNames.length > 1 ? "Birthdays Tomorrow" : "Birthday Tomorrow",
      badgeColor: "gold",
      title: `${formatBirthdayNames(tomorrowNames)} ${tomorrowNames.length > 1 ? "celebrate" : "celebrates"} tomorrow`,
      description: "Get your wishes ready for tomorrow's celebration.",
      durationMs: DEFAULT_DURATION_MS,
      dismissKey: `birthday-tomorrow:${today.dateString}`,
      dismissible: true,
    });
  }

  return slides;
}

export interface BuildBannerSlidesInput {
  announcements?: Post[];
  players?: Player[];
  appConfig?: AppConfig | null;
  isFeatureEnabled: (key: any) => boolean;
  today: ClubDay;
}

/** All candidate slides (before dismissal filtering). Birthdays first. */
export function buildBannerSlides({
  announcements = [],
  players = [],
  isFeatureEnabled,
  today,
}: BuildBannerSlidesInput): BannerSlide[] {
  const list: BannerSlide[] = [...buildBirthdaySlides(players, today)];
  const monthKey = today.dateString.slice(0, 7);

  // 1. Pinned club announcements (admin chose "Show in top banner"); newest first, max 2
  pinnedAnnouncements(announcements)
    .slice(0, 2)
    .forEach((post) => {
      const version = toSeconds((post as any).updatedAt) ?? toSeconds(post.createdAt) ?? "";
      const body = (post.text || "").trim();
      // Destination: the announcement's link field, else the first HTTPS link in
      // its text (backward compatible with announcements that only embed a URL).
      const href = toSafeHttpsHref(post.linkUrl) || firstHttpsLink(body) || undefined;
      list.push({
        id: `post-${post.id}`,
        kind: "notice",
        title: post.title?.trim() || "Club Announcement",
        subtitle: post.authorName ? `By ${post.authorName}` : undefined,
        description: body.slice(0, 110) + (body.length > 110 ? "..." : ""),
        badge: "Club Notice",
        badgeColor: "scarlet",
        ctaText: "Read Notice",
        ctaDestination: "announcements",
        targetId: post.id,
        ...(href ? { href } : {}),
        durationMs: resolveDisplayDurationMs(post.displayDurationSec),
        dismissKey: `post:${post.id}:${version}`,
        dismissible: true,
      });
    });

  // 2. Promotions (monthly period)
  if (isFeatureEnabled("studio")) {
    list.push({
      id: "campaign-studio",
      kind: "promo",
      title: "KAvach Studio",
      subtitle: "Bowling Machines & Professional Turf Nets",
      description: "Book high-intensity batting and bowling sessions with advanced video analysis.",
      badge: "Training Facility",
      badgeColor: "wine",
      ctaText: "Book a Session",
      ctaDestination: "studio",
      durationMs: DEFAULT_DURATION_MS,
      dismissKey: `campaign-studio:${monthKey}`,
      dismissible: true,
    });
  }
  if (isFeatureEnabled("shop")) {
    list.push({
      id: "campaign-shop",
      kind: "promo",
      title: "Official Scarlet Match Kit 2026",
      subtitle: "Personalised Jersey & Training Caps",
      description: "Customise your matchday kit with your official jersey number and name.",
      badge: "Club Store",
      badgeColor: "gold",
      ctaText: "Visit Club Shop",
      ctaDestination: "shop",
      durationMs: DEFAULT_DURATION_MS,
      dismissKey: `campaign-shop:${monthKey}`,
      dismissible: true,
    });
  }

  // No match / fixture slides and no fallback: an empty list hides the banner.
  return list;
}

/** Removes the given dismissal keys (used by "Undo" and "Show club highlights"). */
export function restoreDismissed(map: DismissedMap, keys: string[]): DismissedMap {
  const out: DismissedMap = { ...map };
  for (const k of keys) delete out[k];
  return out;
}

// ── Dismissal bookkeeping ────────────────────────────────────────────────────

export type DismissedMap = Record<string, number>;
export const DISMISS_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

export function dismissStorageKey(userId: string): string {
  return `kavach:home-banner-dismissed:v1:${userId || "anonymous"}`;
}

export function parseDismissed(raw: string | null | undefined): DismissedMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: DismissedMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Drops entries older than the retention window so storage cannot grow unbounded. */
export function pruneDismissed(map: DismissedMap, nowMs: number): DismissedMap {
  const out: DismissedMap = {};
  for (const [k, t] of Object.entries(map)) {
    if (nowMs - t <= DISMISS_RETENTION_MS) out[k] = t;
  }
  return out;
}

export function visibleSlides(slides: BannerSlide[], dismissed: DismissedMap): BannerSlide[] {
  return slides.filter((s) => !(s.dismissible && dismissed[s.dismissKey] !== undefined));
}
