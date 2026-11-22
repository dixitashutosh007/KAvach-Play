"use client";

/**
 * Admin Match Centre — monthly date selector (`components/matches/AdminMatchDateList.tsx`).
 *
 *  ┌ Sunday, 22 November 2026 ─────────────── ‹ November 2026 › ┐
 *  │ [NOV] [NOV] [NOV] [NOV] …   tall rounded date cards (scroll) │
 *  │  21    22    25    28                                         │
 *  │ [SAT] [SUN] [WED] [SAT]                                       │
 *  │ ● Booked  ● Available  ● Tentatively Blocked                  │
 *  └──────────────────────────────────────────────────────────────┘
 *  Selected-date panel (ONLY after the admin picks a date; clearable):
 *  Matches — Sunday, 22 November 2026   [existing admin cards, Edit / Delete]
 *
 * The regular match listing is rendered by the caller BELOW this component and
 * is never replaced or filtered by the selection.
 *
 * Data comes from the store's existing live `matches` subscription (no extra
 * Firestore query); edits and deletes made through the existing workflows flow
 * back through that subscription, so the strip and the selected date refresh
 * automatically.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Match } from "@/lib/types";
import { getClubCalendarDate } from "@/lib/utils";
import { useSessionState } from "@/hooks/useSessionState";
import {
  DATE_STATUS_LABEL,
  buildMonthDateStrip,
  formatLongDate,
  matchesOnDate,
  monthShort,
  monthYearLabel,
  pickDefaultDateKey,
  shiftMonth,
  weekdayShort,
  type DateStatus,
  type StripDate,
} from "@/lib/match-date-strip";

const SWIPE_MIN_PX = 60;

/** Booking-status colours (design tokens: error / success / warning). */
const STATUS_MARKER: Record<DateStatus, string> = {
  booked: "bg-[#DC2626]",
  available: "bg-[#15803D]",
  tentative: "bg-[#D97706]",
};

const HATCH_LIGHT = "repeating-linear-gradient(135deg, rgba(217,119,6,0.14) 0 3px, transparent 3px 8px)";
const HATCH_SELECTED = "repeating-linear-gradient(135deg, rgba(255,255,255,0.14) 0 3px, transparent 3px 8px)";

export interface AdminMatchDateListProps {
  matches: Match[];
  /** False until the first matches snapshot arrives. */
  loaded?: boolean;
  /** Renders an existing Admin Match Centre card (Edit / Delete / payments). */
  renderMatchCard: (match: Match, index: number) => React.ReactNode;
  /** Opens the existing Add Match form prefilled with this date (YYYY-MM-DD). */
  onAddMatch?: (dateKey: string) => void;
  /** Injectable for tests; defaults to today in the club timezone. */
  todayKey?: string;
  /** Test hook: initial explicit selection (normally none). */
  defaultSelectedKey?: string | null;
  /**
   * "admin" (default): booking statuses incl. Tentatively Blocked and the
   * "available for booking" hint. "player": no admin wording; the legend omits
   * Tentatively Blocked (players never receive tentative fixtures).
   */
  variant?: "admin" | "player";
  /** Session-storage namespace so Admin and Player selections stay separate. */
  storageKeyPrefix?: string;
}

export function AdminMatchDateList({
  matches,
  loaded = true,
  renderMatchCard,
  onAddMatch,
  todayKey: todayKeyProp,
  defaultSelectedKey = null,
  variant = "admin",
  storageKeyPrefix = "matches:dateList",
}: AdminMatchDateListProps) {
  const isPlayer = variant === "player";
  const today = getClubCalendarDate();
  const todayKey = todayKeyProp || today.dateString;
  const [todayYear, todayMonth] = todayKey.split("-").map(Number);

  // Survive opening a match and coming back (same tab session).
  const [view, setView] = useSessionState<{ year: number; month: number }>(`${storageKeyPrefix}:month`, {
    year: todayYear,
    month: todayMonth - 1,
  });
  // Explicit selection only (null = no date selected → no panel).
  const [picked, setPicked] = useSessionState<string | null>(`${storageKeyPrefix}:selected`, defaultSelectedKey);

  const strip = useMemo(() => buildMonthDateStrip(view.year, view.month, matches), [view.year, view.month, matches]);
  const selectedKey = picked !== null && strip.some((d) => d.key === picked) ? picked : null;
  // Where the strip starts scrolled to when nothing is selected (not a selection).
  const anchorKey = selectedKey || pickDefaultDateKey(strip, todayKey);
  const selected = strip.find((d) => d.key === selectedKey) || null;
  const dayMatches = useMemo(() => (selectedKey ? matchesOnDate(matches, selectedKey) : []), [matches, selectedKey]);

  const goToMonth = (delta: number) => {
    setView((v) => shiftMonth(v.year, v.month, delta));
    setPicked(null);
  };

  // ── Keep the selected card in view (horizontal only; never scrolls the page) ──
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !anchorKey) return;
    const el = track.querySelector<HTMLElement>(`[data-date-key="${anchorKey}"]`);
    if (!el) return;
    const left = el.offsetLeft - track.clientWidth / 2 + el.clientWidth / 2;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo?.({ left: Math.max(0, left), behavior: reduce ? "auto" : "smooth" });
  }, [anchorKey, view.year, view.month]);

  // ── Swipe = month navigation (mobile) ──────────────────────────────────────
  // Header: any clear horizontal swipe. Date strip: only when the swipe starts
  // with the strip already scrolled to that edge, so scrolling the strip and
  // tapping a date never change the month by accident.
  const swipeRef = useRef<{ x: number; y: number; atStart: boolean; atEnd: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const onTouchStart = (inStrip: boolean) => (e: React.TouchEvent) => {
    const t = e.touches[0];
    const track = trackRef.current;
    const atStart = !inStrip || !track || track.scrollLeft <= 2;
    const atEnd = !inStrip || !track || track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    swipeRef.current = { x: t.clientX, y: t.clientY, atStart, atEnd };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx > 0 && s.atStart) {
      suppressClickRef.current = true;
      goToMonth(-1); // swipe right → previous month
    } else if (dx < 0 && s.atEnd) {
      suppressClickRef.current = true;
      goToMonth(1); // swipe left → next month
    }
  };

  const selectDate = (key: string) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    // Tapping the selected date again clears the selection.
    setPicked((prev) => (prev === key ? null : key));
  };

  const monthLabel = monthYearLabel(view.year, view.month);

  return (
    <div className="flex flex-col gap-4" data-testid="admin-match-date-list">
      <section
        aria-label="Match dates"
        className="rounded-2xl border border-border bg-surface shadow-xs p-3 sm:p-4"
      >
        {/* Selected date + month navigation */}
        <div
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
          onTouchStart={onTouchStart(false)}
          onTouchEnd={onTouchEnd}
          data-testid="date-list-header"
        >
          <h3
            className={`tracking-tight font-heading ${selectedKey ? "text-base sm:text-lg font-black text-text-primary" : "text-sm font-bold text-text-secondary"}`}
            aria-live="polite"
            data-testid="selected-date-heading"
          >
            {selectedKey ? formatLongDate(selectedKey) : "Select a date to preview its matches"}
          </h3>
          <div className="flex items-center gap-1" role="group" aria-label="Change month">
            <button
              type="button"
              onClick={() => goToMonth(-1)}
              aria-label="Previous month"
              data-testid="month-prev"
              className="w-10 h-10 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="min-w-[8.5rem] text-center text-xs font-bold uppercase tracking-[0.12em] text-text-secondary tabular-nums" data-testid="month-label">
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={() => goToMonth(1)}
              aria-label="Next month"
              data-testid="month-next"
              className="w-10 h-10 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Date strip */}
        <div
          ref={trackRef}
          role="listbox"
          aria-label={`Dates in ${monthLabel}`}
          aria-orientation="horizontal"
          data-testid="date-strip"
          onTouchStart={onTouchStart(true)}
          onTouchEnd={onTouchEnd}
          // @container: cards size from the strip's own width (≈5.4 visible, so
          // the next card peeks); pb-3 leaves room for the selected card's shadow.
          className="@container relative mt-3 -mx-3 px-3 sm:-mx-4 sm:px-4 flex items-start gap-2 overflow-x-auto overscroll-x-contain no-scrollbar pt-1 pb-3"
        >
          {strip.map((d) => (
            <DateCard key={d.key} date={d} selected={d.key === selectedKey} isToday={d.key === todayKey} onSelect={selectDate} />
          ))}
        </div>

        {/* Legend */}
        <ul className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-medium text-text-muted" data-testid="date-legend">
          {((isPlayer ? ["booked", "available"] : ["booked", "available", "tentative"]) as DateStatus[]).map((s) => (
            <li key={s} className="inline-flex items-center gap-1.5">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_MARKER[s]}`}
                style={s === "tentative" ? { backgroundImage: HATCH_SELECTED } : undefined}
                aria-hidden="true"
              />
              {DATE_STATUS_LABEL[s]}
            </li>
          ))}
        </ul>
      </section>

      {/* Selected-date panel: only after an explicit selection */}
      {selectedKey && (
        <section
          aria-labelledby="date-matches-heading"
          data-testid="date-matches"
          className="rounded-2xl border border-brand/20 bg-brand-surface/40 p-3 sm:p-4"
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="min-w-0 flex items-center gap-2 flex-wrap">
              <h3 id="date-matches-heading" className="text-sm font-bold uppercase tracking-wider text-text-primary font-heading">
                Matches — {formatLongDate(selectedKey)}
              </h3>
              {selected && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-text-secondary" data-testid="selected-date-status">
                  <span className={`w-2 h-2 rounded-full ${STATUS_MARKER[selected.status]}`} aria-hidden="true" />
                  {DATE_STATUS_LABEL[selected.status]}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPicked(null)}
              data-testid="date-clear"
              aria-label="Clear selected date"
              className="shrink-0 inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-lg text-xs font-bold text-text-secondary hover:text-text-primary hover:bg-surface cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              Clear
            </button>
          </div>

          {!loaded ? (
            <p className="py-4 text-center text-sm text-text-muted" aria-busy="true">Loading matches…</p>
          ) : dayMatches.length > 0 ? (
            <div className="space-y-4">{dayMatches.map((m, i) => renderMatchCard(m, i))}</div>
          ) : (
            <div className="py-4 px-3 text-center bg-surface border border-dashed border-border rounded-xl" data-testid="date-empty-state">
              <p className="text-sm font-bold text-text-primary">No matches scheduled for this date.</p>
              {!isPlayer && selected?.status === "available" && (
                <p className="mt-1 text-xs text-text-secondary">This weekend date is available for booking.</p>
              )}
              {onAddMatch && (
                <button
                  type="button"
                  onClick={() => onAddMatch(selectedKey)}
                  data-testid="date-add-match"
                  className="mt-3 inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl bg-brand text-white text-xs font-bold uppercase tracking-wider hover:opacity-90 cursor-pointer"
                >
                  <CalendarPlus className="w-4 h-4" aria-hidden="true" />
                  Add match on this date
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Tall, narrow date card (≈0.6 width : height): month · date · weekday,
 * plus a booking-status marker that stays visible when the card is selected.
 */
export function DateCard({
  date,
  selected,
  isToday = false,
  onSelect,
}: {
  date: StripDate;
  selected: boolean;
  isToday?: boolean;
  onSelect: (key: string) => void;
}) {
  const status = DATE_STATUS_LABEL[date.status];
  const isTentative = date.status === "tentative";
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={`${weekdayShort(date.weekday)} ${date.day} ${monthShort(date.month)}, ${status}${isToday ? ", today" : ""}${
        date.matchCount > 0 ? `, ${date.matchCount} ${date.matchCount === 1 ? "match" : "matches"}` : ""
      }`}
      data-date-key={date.key}
      data-status={date.status}
      data-selected={selected || undefined}
      data-testid={`date-card-${date.key}`}
      onClick={() => onSelect(date.key)}
      style={isTentative ? { backgroundImage: selected ? HATCH_SELECTED : HATCH_LIGHT } : undefined}
      className={`shrink-0 w-[calc((100cqw-2.5rem)/5.4)] min-w-[3.5rem] max-w-[4.25rem] aspect-[3/5] rounded-[18px] border flex flex-col items-center justify-center cursor-pointer select-none transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand/50 ${
        selected
          ? "bg-brand border-brand text-white shadow-[0_6px_16px_-8px_rgba(163,15,45,0.7)]"
          : `bg-surface text-text-primary hover:border-brand/40 ${isToday ? "border-brand/50" : "border-border"}`
      }`}
    >
      <span className={`text-[10px] font-semibold uppercase tracking-[0.12em] leading-none ${selected ? "text-white/85" : "text-text-muted"}`}>
        {monthShort(date.month)}
      </span>
      <span className="mt-2 text-[26px] sm:text-[28px] font-black font-heading leading-none tabular-nums">{date.day}</span>
      <span className={`mt-2 text-[10px] font-bold uppercase tracking-[0.12em] leading-none ${selected ? "text-white/85" : "text-text-muted"}`}>
        {weekdayShort(date.weekday)}
      </span>
      <span
        data-testid={`date-status-${date.key}`}
        aria-hidden="true"
        className={`mt-2.5 h-1 w-5 rounded-full ${STATUS_MARKER[date.status]} ${selected ? "ring-2 ring-white" : ""}`}
      />
    </button>
  );
}

/** Generic name for the shared monthly date selector (Admin and Player Match Centre). */
export const MatchDateSelector = AdminMatchDateList;
