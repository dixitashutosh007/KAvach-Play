"use client";

/**
 * Admin Match Centre — date-first List View (`components/matches/AdminMatchDateList.tsx`).
 *
 *  ┌ Sunday, 22 November 2026 ─────────────── ‹ November 2026 › ┐
 *  │ [NOV] [NOV] [NOV] [NOV] …   tall rounded date cards (scroll) │
 *  │  21    22    25    28                                         │
 *  │ [SAT] [SUN] [WED] [SAT]                                       │
 *  │ ● Booked  ● Available  ● Tentatively Blocked                  │
 *  └──────────────────────────────────────────────────────────────┘
 *  Matches — Sunday, 22 November
 *  [existing admin match cards, with Edit / Delete]
 *
 * Data comes from the store's existing live `matches` subscription (no extra
 * Firestore query); edits and deletes made through the existing workflows flow
 * back through that subscription, so the strip and the selected date refresh
 * automatically.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, CalendarX2 } from "lucide-react";
import type { Match } from "@/lib/types";
import { getClubCalendarDate } from "@/lib/utils";
import { useSessionState } from "@/hooks/useSessionState";
import {
  DATE_STATUS_LABEL,
  buildMonthDateStrip,
  formatDayMonth,
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
}

export function AdminMatchDateList({
  matches,
  loaded = true,
  renderMatchCard,
  onAddMatch,
  todayKey: todayKeyProp,
}: AdminMatchDateListProps) {
  const today = getClubCalendarDate();
  const todayKey = todayKeyProp || today.dateString;
  const [todayYear, todayMonth] = todayKey.split("-").map(Number);

  // Survive opening a match and coming back (same tab session).
  const [view, setView] = useSessionState<{ year: number; month: number }>("matches:dateList:month", {
    year: todayYear,
    month: todayMonth - 1,
  });
  // null = automatic (today, else nearest upcoming date in the month).
  const [picked, setPicked] = useSessionState<string | null>("matches:dateList:selected", null);

  const strip = useMemo(() => buildMonthDateStrip(view.year, view.month, matches), [view.year, view.month, matches]);
  const pickedIsValid = picked !== null && strip.some((d) => d.key === picked);
  const selectedKey = pickedIsValid ? picked : pickDefaultDateKey(strip, todayKey);
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
    if (!track || !selectedKey) return;
    const el = track.querySelector<HTMLElement>(`[data-date-key="${selectedKey}"]`);
    if (!el) return;
    const left = el.offsetLeft - track.clientWidth / 2 + el.clientWidth / 2;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo?.({ left: Math.max(0, left), behavior: reduce ? "auto" : "smooth" });
  }, [selectedKey, view.year, view.month]);

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
    setPicked(key);
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
          <h3 className="text-base sm:text-lg font-black font-heading text-text-primary tracking-tight" aria-live="polite" data-testid="selected-date-heading">
            {selectedKey ? formatLongDate(selectedKey) : monthLabel}
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
          className="relative mt-3 -mx-3 px-3 sm:-mx-4 sm:px-4 flex gap-2 sm:gap-2.5 overflow-x-auto overscroll-x-contain no-scrollbar py-1"
        >
          {strip.map((d) => (
            <DateCard key={d.key} date={d} selected={d.key === selectedKey} isToday={d.key === todayKey} onSelect={selectDate} />
          ))}
        </div>

        {/* Legend */}
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-medium text-text-muted" data-testid="date-legend">
          {(["booked", "available", "tentative"] as DateStatus[]).map((s) => (
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

      {/* Matches for the selected date */}
      <section aria-labelledby="date-matches-heading" data-testid="date-matches">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 id="date-matches-heading" className="text-sm font-bold uppercase tracking-wider text-text-primary font-heading">
            {selectedKey ? `Matches — ${formatDayMonth(selectedKey)}` : "Matches"}
          </h3>
          {selected && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-text-secondary" data-testid="selected-date-status">
              <span className={`w-2 h-2 rounded-full ${STATUS_MARKER[selected.status]}`} aria-hidden="true" />
              {DATE_STATUS_LABEL[selected.status]}
            </span>
          )}
        </div>

        {!loaded ? (
          <div className="py-10 text-center text-sm text-text-muted bg-surface border border-border rounded-2xl" aria-busy="true">
            Loading matches…
          </div>
        ) : !selectedKey ? (
          <EmptyState
            title={strip.length ? "Select a date" : "No dates to show"}
            body={
              strip.length
                ? `Choose a date above to see its matches for ${monthLabel}.`
                : `There are no weekend dates or scheduled matches in ${monthLabel}.`
            }
          />
        ) : dayMatches.length > 0 ? (
          <div className="space-y-4">{dayMatches.map((m, i) => renderMatchCard(m, i))}</div>
        ) : (
          <EmptyState
            title="No matches scheduled for this date."
            body={
              selected?.status === "available"
                ? "This weekend date is available for booking."
                : undefined
            }
            action={
              onAddMatch ? (
                <button
                  type="button"
                  onClick={() => onAddMatch(selectedKey)}
                  data-testid="date-add-match"
                  className="mt-3 inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl bg-brand text-white text-xs font-bold uppercase tracking-wider hover:opacity-90 cursor-pointer"
                >
                  <CalendarPlus className="w-4 h-4" aria-hidden="true" />
                  Add match on this date
                </button>
              ) : null
            }
          />
        )}
      </section>
    </div>
  );
}

function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="py-8 px-4 text-center bg-surface border border-dashed border-border rounded-2xl" data-testid="date-empty-state">
      <CalendarX2 className="w-7 h-7 text-text-muted mx-auto" aria-hidden="true" />
      <p className="mt-2 text-sm font-bold text-text-primary">{title}</p>
      {body && <p className="mt-1 text-xs text-text-secondary">{body}</p>}
      {action}
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
      className={`shrink-0 w-[3.75rem] h-[6.25rem] sm:w-16 sm:h-[6.75rem] rounded-[18px] border flex flex-col items-center justify-center cursor-pointer select-none transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand/50 ${
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
