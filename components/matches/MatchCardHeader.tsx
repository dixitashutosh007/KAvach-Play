"use client";

/**
 * Shared match-card presentation (`components/matches/MatchCardHeader.tsx`).
 *
 * Used by the Player Match Center, Player Home upcoming fixtures and the Admin
 * Match Center so all three share one visual identity:
 *
 *   [ category ribbon ]                                   [ top-right slot ]
 *   ┌ identity ─────────────────┐ │ ┌ logistics ───────────┐
 *   │ [T30] [jersey]            │ │ │      7:00 AM          │
 *   │ vs                        │ │ │  ───── ● ─────        │
 *   │ Opponent                  │ │ │   SAT · 21 NOV        │
 *   │ [result] [payment]        │ │ │   📍 Venue ↗          │
 *   └───────────────────────────┘ │ └──────────────────────┘
 *
 * Always two columns (identity | logistics), matching desktop. On narrow cards
 * (below a 24rem card width) type sizes step down and the venue truncates.
 */
import React from "react";
import { Calendar, MapPin, ExternalLink, Trophy } from "lucide-react";
import type { Ground, Match } from "@/lib/types";
import { formatMatchDisplayTime } from "@/lib/personal-match-payment";
import { getVenueMapsLink } from "@/lib/venue-maps";
import {
  formatMatchCardDate,
  getMatchCategory,
  getMatchFormatBadge,
  type MatchCategory,
} from "@/lib/match-card-format";
import { JerseyInfographic } from "./JerseyInfographic";
import { getMatchResultDisplay, MATCH_RESULT_STAMP_CLASSES } from "./matchResult";
import { cricHeroesHref, linkHostLabel } from "@/lib/weekend-ops";

// ── Small presentational pieces ─────────────────────────────────────────────

/** The small "vs" label above the opponent name. */
export function MatchVsLabel() {
  return <span className="block text-[11px] font-bold uppercase tracking-widest text-text-muted leading-none">vs</span>;
}

/**
 * Opponent name — the CricHeroes link of every match card and detail header.
 *
 * With a safe `matches.matchUrl` the whole name (plus a small external-link
 * icon) is one link that opens the match on CricHeroes in a new tab; the click
 * never reaches the card's own navigation. Without a valid URL the name is
 * plain text. Same font, size and line clamp either way, so the card's layout
 * and height do not change.
 */
export function MatchOpponentName({
  match,
  as: Tag = "h3",
  className,
  prefix = "",
  fallback = "Opponent TBC",
}: {
  match: Match;
  as?: "h1" | "h2" | "h3";
  /** Heading classes WITHOUT a line-clamp (the clamp is applied to the name). */
  className: string;
  /** e.g. "vs " for detail headers that print "vs Opponent". */
  prefix?: string;
  fallback?: string;
}) {
  const name = match.opponent?.trim() || fallback;
  const href = cricHeroesHref(match.matchUrl);
  if (!href) {
    return (
      <Tag className={`${className} line-clamp-2`} title={name} data-testid={`match-opponent-${match.id}`}>
        {prefix}
        {name}
      </Tag>
    );
  }
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <Tag className={className} data-testid={`match-opponent-${match.id}`}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stop}
        data-testid={`cricheroes-link-${match.id}`}
        title={`Open on ${linkHostLabel(href) || "CricHeroes"} (new tab)`}
        aria-label={`${prefix}${name} — open match on CricHeroes (opens in a new tab)`}
        className="group/opp inline-flex max-w-full items-start gap-1 rounded-md text-inherit -mx-0.5 px-0.5 hover:text-scarlet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50"
      >
        <span className="min-w-0 break-words line-clamp-2 underline decoration-scarlet/40 decoration-2 underline-offset-4 group-hover/opp:decoration-scarlet">
          {prefix}
          {name}
        </span>
        <ExternalLink className="shrink-0 w-[0.7em] h-[0.7em] mt-[0.2em] text-scarlet" strokeWidth={2.5} aria-hidden="true" data-testid={`cricheroes-icon-${match.id}`} />
      </a>
    </Tag>
  );
}

/** Restrained colours for the compact, inline result stamp. */
const COMPACT_RESULT_CLASSES = {
  won: "bg-emerald-50 text-emerald-700 border-emerald-200",
  lost: "bg-rose-50 text-rose-700 border-rose-200",
  tied: "bg-amber-50 text-amber-800 border-amber-200",
  abandoned: "bg-slate-100 text-slate-600 border-slate-200",
  noResult: "bg-slate-100 text-slate-600 border-slate-200",
} as const;

export function MatchResultStamp({
  match,
  compact = false,
  className = "",
}: {
  match: Match;
  /** Small inline stamp (label only; margin in the tooltip) for the opponent line. */
  compact?: boolean;
  className?: string;
}) {
  const display = getMatchResultDisplay(match.result);
  if (!display) return null;
  const showMargin =
    (display.tone === "won" || display.tone === "lost") && Boolean(match.resultMarginAmount);
  if (compact) {
    const margin = showMargin ? ` by ${match.resultMarginAmount} ${match.resultMarginType || "runs"}` : "";
    return (
      <span
        data-testid={`result-stamp-${match.id}`}
        data-result-tone={display.tone}
        data-compact="true"
        title={`${display.label}${margin}`}
        className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-black uppercase tracking-wider leading-none font-heading whitespace-nowrap shrink-0 ${COMPACT_RESULT_CLASSES[display.tone]} ${className}`}
      >
        {display.label}
      </span>
    );
  }
  return (
    <span
      data-testid={`result-stamp-${match.id}`}
      data-result-tone={display.tone}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-black uppercase tracking-wider border font-heading shrink-0 whitespace-nowrap ${MATCH_RESULT_STAMP_CLASSES[display.tone]}`}
    >
      {display.tone === "won" && <Trophy className="w-3 h-3 text-emerald-100 shrink-0" aria-hidden="true" />}
      <span>{display.label}</span>
      {showMargin && (
        <span className="font-semibold normal-case tracking-normal opacity-90 border-l border-white/40 pl-1 ml-0.5">
          by {match.resultMarginAmount} {match.resultMarginType || "runs"}
        </span>
      )}
    </span>
  );
}

const FORMAT_BADGE_CLASSES = {
  t20: "bg-blue-50 text-blue-800 border-blue-300",
  t30: "bg-scarlet/10 text-scarlet border-scarlet/40",
  other: "bg-surface-hover text-text-primary border-border",
} as const;

export function MatchFormatBadge({
  format,
  matchId,
  compact = false,
}: {
  format?: string | null;
  matchId: string;
  /** Small chip for the mobile Home card header row. */
  compact?: boolean;
}) {
  const badge = getMatchFormatBadge(format);
  if (!badge) return null;
  return (
    <span
      data-testid={compact ? `format-badge-compact-${matchId}` : `format-badge-${matchId}`}
      data-format-tone={badge.tone}
      className={`inline-flex items-center justify-center font-black tracking-wide font-heading leading-none shrink-0 ${
        compact
          ? "h-7 min-w-[2.5rem] px-2 rounded-md border text-xs"
          : "min-w-[3rem] px-2.5 py-1 rounded-lg border-2 text-sm"
      } ${FORMAT_BADGE_CLASSES[badge.tone]}`}
    >
      {badge.label}
    </span>
  );
}

/** Three cricket stumps with bails — lightweight inline SVG for the Practice ribbon. */
function StumpsIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path d="M3.5 3h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4.5 4.5V14M8 4.5V14M11.5 4.5V14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const RIBBON_CLIP = "[clip-path:polygon(0_0,100%_0,calc(100%-16px)_100%,0_100%)]";

export function MatchCategoryRibbon({ category, matchId }: { category: MatchCategory; matchId: string }) {
  const isTournament = category === "Tournament";
  return (
    <span
      data-testid={`category-ribbon-${matchId}`}
      data-category={category.toLowerCase()}
      className={`inline-flex min-w-0 bg-muted-gold pr-[3px] ${RIBBON_CLIP}`}
    >
      <span
        className={`inline-flex min-w-0 items-center gap-1.5 pl-3 pr-7 max-[399px]:pr-5 max-[399px]:tracking-[0.04em] py-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-white font-heading ${RIBBON_CLIP} ${
          isTournament ? "bg-gradient-to-r from-violet-800 to-violet-600" : "bg-gradient-to-r from-teal-700 to-teal-500"
        }`}
      >
        {isTournament ? (
          <Trophy className="w-3.5 h-3.5 shrink-0 text-amber-200" aria-hidden="true" />
        ) : (
          <StumpsIcon className="w-3.5 h-3.5 shrink-0 text-teal-50" />
        )}
        <span className="truncate">{isTournament ? "Tournament" : "Practice"}</span>
      </span>
    </span>
  );
}

/** Thin scarlet line with a small cricket ball in the middle (inline SVG). */
export function CricketBallDivider({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-1.5 w-full max-w-[9rem] ${className}`} aria-hidden="true">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-scarlet/60" />
      <svg viewBox="0 0 12 12" className="w-3 h-3 shrink-0">
        <circle cx="6" cy="6" r="5.5" className="fill-scarlet" />
        <path d="M3.2 1.6c1.6 2.6 1.6 6.2 0 8.8M8.8 1.6c-1.6 2.6-1.6 6.2 0 8.8" stroke="white" strokeWidth="0.8" fill="none" strokeLinecap="round" strokeDasharray="1 0.9" />
      </svg>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-scarlet/60" />
    </span>
  );
}

/**
 * Top row of a match card: the category ribbon flush with the card's top-left
 * corner, plus an optional slot on the right (Next Match chip, expand toggle,
 * admin actions). Must be the first child of a card with `p-3 sm:p-4`.
 */
export function MatchCardTopBar({
  match,
  end,
  corner,
}: {
  match: Match;
  end?: React.ReactNode;
  /**
   * Optional tab flush with the card's top-RIGHT corner. It stretches to the
   * row height, i.e. the category ribbon's height, so both sit on the same top
   * edge with the same height.
   */
  corner?: React.ReactNode;
}) {
  const category = getMatchCategory(match.matchType);
  if (!category && !end && !corner) return null;
  return (
    <div className="flex items-start justify-between gap-2 -mt-3 -ml-3 sm:-mt-4 sm:-ml-4 mb-1 min-w-0">
      {category ? <MatchCategoryRibbon category={category} matchId={match.id} /> : <span />}
      {(end || corner) && (
        <div className="flex items-start self-stretch shrink-0 gap-1.5">
          {end ? <div className="flex items-center gap-1.5 mt-2 sm:mt-3">{end}</div> : null}
          {corner ? <div className="flex self-stretch -mr-3 sm:-mr-4">{corner}</div> : null}
        </div>
      )}
    </div>
  );
}

const CORNER_CLIP = "[clip-path:polygon(16px_0,100%_0,100%_100%,0_100%)]";

/**
 * Mirror of the category ribbon for the top-right corner: match format (T30 /
 * T20) and jersey. Same height and top edge as the ribbon (it stretches to the
 * top-bar row); a gold left edge echoes the ribbon's gold right edge.
 */
export function MatchCornerTab({ match, className = "" }: { match: Match; className?: string }) {
  const badge = getMatchFormatBadge(match.format);
  if (!badge && !match.jerseyColor) return null;
  return (
    <span
      data-testid={`match-card-chips-${match.id}`}
      className={`inline-flex self-stretch min-h-7 bg-muted-gold pl-[3px] ${CORNER_CLIP} ${className}`}
    >
      <span className={`inline-flex items-center gap-2 pl-6 pr-4 bg-soft-blush ${CORNER_CLIP}`}>
        {badge && (
          <span
            data-testid={`format-badge-compact-${match.id}`}
            data-format-tone={badge.tone}
            className="text-[11px] font-black uppercase tracking-[0.08em] font-heading leading-none text-scarlet"
          >
            {badge.label}
          </span>
        )}
        {badge && match.jerseyColor && <span className="w-px h-3.5 bg-scarlet/25" aria-hidden="true" />}
        {match.jerseyColor && <JerseyInfographic color={match.jerseyColor} size="sm" />}
      </span>
    </span>
  );
}

// ── Main body ───────────────────────────────────────────────────────────────

export interface MatchCardHeaderProps {
  match: Match;
  ground?: Ground | null;
  /** Rendered under the opponent (e.g. personal payment badge). */
  meta?: React.ReactNode;
  /** Hide the result stamp (e.g. when a caller renders its own). */
  hideResult?: boolean;
  /**
   * "row" (default): result stamp in the meta row under the opponent.
   * "inline": compact stamp right-aligned on the opponent line (no extra row).
   */
  resultPlacement?: "row" | "inline";
  /**
   * Below md, format + jersey are shown in the card's top-right corner tab
   * (MatchCornerTab) instead of the identity column — the Player Matches list
   * on phones. Desktop layout is unchanged.
   */
  chipsInCornerOnMobile?: boolean;
}

export function MatchCardHeader({ match, ground, meta, hideResult = false, resultPlacement = "row", chipsInCornerOnMobile = false }: MatchCardHeaderProps) {
  const venueLink = getVenueMapsLink(ground);
  const venueName = ground?.name?.trim() || "";
  const hasResult = !hideResult && getMatchResultDisplay(match.result) !== null;
  const inlineResult = hasResult && resultPlacement === "inline";
  const rowResult = hasResult && !inlineResult;
  const hasMetaRow = rowResult || Boolean(meta);

  return (
    <div className="@container" data-testid={`match-card-header-${match.id}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_1px_minmax(0,auto)] items-center gap-3 @sm:gap-4">
        {/* Identity */}
        <div className="min-w-0 flex flex-col gap-1.5" data-testid={`match-card-identity-${match.id}`}>
          <div className={`flex items-center gap-2 ${chipsInCornerOnMobile ? "max-md:hidden" : ""}`} data-testid={`match-card-title-row-${match.id}`}>
            <MatchFormatBadge format={match.format} matchId={match.id} />
            {match.jerseyColor && <JerseyInfographic color={match.jerseyColor} size="xl" />}
          </div>
          <div className="min-w-0">
            <MatchVsLabel />{" "}
            <div className="mt-0.5 flex items-start gap-2 min-w-0" data-testid={`match-opponent-line-${match.id}`}>
              <MatchOpponentName
                match={match}
                fallback=""
                className="min-w-0 flex-1 text-lg @sm:text-2xl font-black font-heading text-text-primary tracking-tight leading-tight break-words"
              />
              {inlineResult && <MatchResultStamp match={match} compact className="mt-1 @sm:mt-1.5" />}
            </div>
          </div>
          {hasMetaRow && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {rowResult && <MatchResultStamp match={match} />}
              {meta}
            </div>
          )}
        </div>

        {/* Vertical divider (two-column layout only) */}
        <span className="w-px self-stretch bg-border" aria-hidden="true" />

        {/* Logistics */}
        <div
          className="min-w-0 max-w-[9.5rem] @sm:max-w-none flex flex-col items-center gap-1 @sm:gap-1.5 text-center"
          data-testid={`match-card-logistics-${match.id}`}
        >
          <div className="flex flex-col items-center gap-1">
            <span
              data-testid={`match-time-${match.id}`}
              className="text-xl @sm:text-3xl font-black font-heading text-scarlet leading-none tracking-tight whitespace-nowrap tabular-nums"
            >
              {formatMatchDisplayTime(match.time)}
            </span>
            <CricketBallDivider className="min-w-[5rem]" />
          </div>

          <div className="min-w-0 max-w-full flex flex-col items-center gap-0.5 @sm:gap-1">
            <span
              data-testid={`match-date-${match.id}`}
              className="inline-flex items-center gap-1 @sm:gap-1.5 text-xs @sm:text-sm font-bold text-text-primary tracking-wide whitespace-nowrap"
            >
              <Calendar className="w-3.5 h-3.5 @sm:w-4 @sm:h-4 text-scarlet shrink-0" aria-hidden="true" />
              {formatMatchCardDate(match.date)}
            </span>
            {venueName && (
              <span className="inline-flex items-center gap-1 @sm:gap-1.5 min-w-0 max-w-full text-xs @sm:text-sm">
                <MapPin className="w-3.5 h-3.5 @sm:w-4 @sm:h-4 text-scarlet shrink-0" aria-hidden="true" />
                {venueLink ? (
                  <a
                    href={venueLink.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`venue-link-${match.id}`}
                    aria-label={`Open ${venueName} in Google Maps (opens in a new tab)`}
                    className="inline-flex items-center gap-1 min-w-0 font-bold text-scarlet hover:text-deep-wine underline decoration-scarlet/40 underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50"
                  >
                    <span className="truncate">{venueName}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="truncate font-semibold text-text-primary" data-testid={`venue-text-${match.id}`}>
                    {venueName}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Mobile Player Home body ─────────────────────────────────────────────────

/**
 * Fixed-geometry match body for the mobile Player Home carousel.
 *
 *   ┌ left (1fr) ─────────┐ │ ┌ right (1fr) ─────────┐
 *   │ VS                  │ │ │       7:00 AM         │
 *   │ Opponent (≤2 lines) │ │ │   ───── ● ─────       │
 *   │ [result]            │ │ │   📅 SAT · 28 NOV     │
 *   └─────────────────────┘ │ │   📍 Venue… ↗         │
 *                           │ └──────────────────────┘
 *
 * Two EQUAL grid tracks with a 1px track between them, so the divider always
 * sits at the card's centre regardless of content. Both columns clip their own
 * overflow (min-w-0 + overflow-hidden), so nothing can cross the divider. The
 * right column always renders four rows (a "Venue TBC" placeholder when the
 * venue is missing), so it sets a constant body height; the left column is
 * shorter than it even with a two-line opponent name.
 *
 * The format badge and jersey are NOT rendered here; the card places them in
 * its header row (top-right) to free the opponent column.
 */
export function MatchCardCompactBody({ match, ground, hideResult = false }: MatchCardHeaderProps) {
  const venueLink = getVenueMapsLink(ground);
  const venueName = ground?.name?.trim() || "";
  const opponent = match.opponent?.trim() || "Opponent TBC";
  const hasResult = !hideResult && getMatchResultDisplay(match.result) !== null;

  return (
    <div
      data-testid={`match-card-compact-${match.id}`}
      className="grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-stretch gap-x-3"
    >
      {/* Left: opponent */}
      <div className="min-w-0 overflow-hidden flex flex-col justify-center gap-1" data-testid={`match-card-compact-left-${match.id}`}>
        <MatchVsLabel />
        <MatchOpponentName match={match} className="text-lg font-black font-heading text-text-primary tracking-tight leading-tight break-words" />
        {hasResult && (
          <div className="flex">
            <MatchResultStamp match={match} />
          </div>
        )}
      </div>

      {/* Fixed divider track */}
      <span className="w-px bg-border" aria-hidden="true" data-testid={`match-card-compact-divider-${match.id}`} />

      {/* Right: time, date, venue */}
      <div
        className="min-w-0 overflow-hidden flex flex-col items-center justify-center gap-1.5 text-center"
        data-testid={`match-card-compact-right-${match.id}`}
      >
        <span
          data-testid={`match-time-compact-${match.id}`}
          className="max-w-full text-2xl font-black font-heading text-scarlet leading-none tracking-tight whitespace-nowrap tabular-nums"
        >
          {formatMatchDisplayTime(match.time)}
        </span>
        <CricketBallDivider className="max-w-[7rem]" />
        <span className="max-w-full inline-flex items-center gap-1 text-sm font-bold text-text-primary tracking-wide whitespace-nowrap leading-5">
          <Calendar className="w-4 h-4 text-scarlet shrink-0" aria-hidden="true" />
          <span className="truncate">{formatMatchCardDate(match.date)}</span>
        </span>
        <span className="w-full min-w-0 inline-flex items-center justify-center gap-1 text-sm leading-5">
          <MapPin className="w-4 h-4 text-scarlet shrink-0" aria-hidden="true" />
          {venueName && venueLink ? (
            <a
              href={venueLink.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              data-testid={`venue-link-compact-${match.id}`}
              aria-label={`Open ${venueName} in Google Maps (opens in a new tab)`}
              title={venueName}
              className="inline-flex items-center gap-1 min-w-0 font-bold text-scarlet hover:text-deep-wine underline decoration-scarlet/40 underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-scarlet/50"
            >
              <span className="truncate">{venueName}</span>
              <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            </a>
          ) : (
            <span
              className={`truncate ${venueName ? "font-semibold text-text-primary" : "font-medium text-text-muted"}`}
              data-testid={`venue-text-compact-${match.id}`}
              title={venueName || undefined}
            >
              {venueName || "Venue TBC"}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

// ── Admin Match Centre: stacked mobile body ─────────────────────────────────

/**
 * Mobile (below md) body for Admin Match Centre cards. Single column, no fixed
 * desktop widths:
 *
 *   VS
 *   Opponent (≤ 2 lines)                     [WON]   (persisted result only)
 *   🏆 Tournament name (truncates)
 *   ┌ 7:00 AM │ 📅 SAT · 28 NOV ┐
 *   │         │ 📍 Venue… ↗      │
 *   └──────────────────────────┘
 *
 * The format badge and jersey sit in the card's top-right corner tab
 * (MatchCornerTab); the desktop card keeps MatchCardHeader.
 */
export function MatchCardStackedBody({
  match,
  ground,
  tournamentName,
}: {
  match: Match;
  ground?: Ground | null;
  tournamentName?: string;
}) {
  const venueLink = getVenueMapsLink(ground);
  const venueName = ground?.name?.trim() || "";
  const opponent = match.opponent?.trim() || "Opponent TBC";
  const hasResult = getMatchResultDisplay(match.result) !== null;
  return (
    <div className="flex flex-col gap-3 min-w-0" data-testid={`match-card-stacked-${match.id}`}>
      <div className="min-w-0">
        <MatchVsLabel />
        {/* Opponent left, result right on the same line: no extra row. */}
        <div className="mt-1 flex items-start gap-2 min-w-0" data-testid={`match-opponent-line-${match.id}`}>
          <MatchOpponentName
            match={match}
            className="min-w-0 flex-1 text-lg font-black font-heading text-text-primary tracking-tight leading-tight break-words"
          />
          {hasResult && <MatchResultStamp match={match} compact className="mt-1" />}
        </div>
        {tournamentName && (
          <p
            className="mt-1 flex items-center gap-1 min-w-0 text-[11px] font-bold text-deep-wine"
            data-testid={`match-card-tournament-${match.id}`}
            title={tournamentName}
          >
            <Trophy className="w-3.5 h-3.5 text-muted-gold shrink-0" aria-hidden="true" />
            <span className="truncate">{tournamentName}</span>
          </p>
        )}
      </div>

      <div
        className="grid grid-cols-[auto_1px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border/70 bg-surface-hover/50 px-3 py-2.5"
        data-testid={`match-card-schedule-${match.id}`}
      >
        <span
          data-testid={`match-time-stacked-${match.id}`}
          className="text-2xl font-black font-heading text-scarlet leading-none tracking-tight whitespace-nowrap tabular-nums"
        >
          {formatMatchDisplayTime(match.time)}
        </span>
        <span className="w-px self-stretch bg-border" aria-hidden="true" />
        <div className="min-w-0 flex flex-col gap-1">
          <span className="flex items-center gap-1.5 min-w-0 text-sm font-bold text-text-primary leading-5">
            <Calendar className="w-4 h-4 text-scarlet shrink-0" aria-hidden="true" />
            <span className="truncate">{formatMatchCardDate(match.date)}</span>
          </span>
          <span className="flex items-center gap-1.5 min-w-0 text-sm leading-5">
            <MapPin className="w-4 h-4 text-scarlet shrink-0" aria-hidden="true" />
            {venueName && venueLink ? (
              <a
                href={venueLink.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                data-testid={`venue-link-stacked-${match.id}`}
                aria-label={`Open ${venueName} in Google Maps (opens in a new tab)`}
                title={venueName}
                className="inline-flex items-center gap-1 min-w-0 font-bold text-scarlet hover:text-deep-wine underline decoration-scarlet/40 underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-scarlet/50"
              >
                <span className="truncate">{venueName}</span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              </a>
            ) : (
              <span className={`truncate ${venueName ? "font-semibold text-text-primary" : "font-medium text-text-muted"}`} title={venueName || undefined}>
                {venueName || "Venue TBC"}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
