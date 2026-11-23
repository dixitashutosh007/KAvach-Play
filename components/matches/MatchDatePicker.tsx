"use client";

/**
 * Weekend-first date picker for the Add / Edit Match wizard
 * (`components/matches/MatchDatePicker.tsx`).
 *
 * Most club matches are on Saturdays and Sundays, so by default it shows only
 * that month's weekend dates as compact tiles (≈2–3 rows), with previous /
 * next month. "Show all days" opens the full month grid for a weekday; it
 * opens there automatically when the selected date is a weekday (e.g. editing
 * a weekday match). Values are calendar dates ("YYYY-MM-DD"), handled without
 * timezone conversion. No dates are disabled (past dates are allowed for
 * recording played matches, as before).
 */
import React, { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { dateKey, parseDateKey, shiftMonth, weekdayOf } from "@/lib/match-date-strip";
import { getClubCalendarDate } from "@/lib/utils";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/** "Sun, 14 Nov 2026" */
export function formatPickerDate(key: string): string {
  const p = parseDateKey(key);
  if (!p) return "";
  return `${DAYS[p.weekday]}, ${p.day} ${MONTHS_SHORT[p.month]} ${p.year}`;
}

/** Calendar cells for a month: leading nulls for the first week's offset. */
export function monthGrid(year: number, month: number): (number | null)[] {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
}

/** Every Saturday and Sunday of a month, in order. */
export function monthWeekendDays(year: number, month: number): { day: number; weekday: number }[] {
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const out: { day: number; weekday: number }[] = [];
  for (let d = 1; d <= days; d++) {
    const wd = weekdayOf(year, month, d);
    if (wd === 0 || wd === 6) out.push({ day: d, weekday: wd });
  }
  return out;
}

export function MatchDatePicker({
  value,
  onChange,
  todayKey: todayKeyProp,
}: {
  /** "YYYY-MM-DD" ("" when unset). */
  value: string;
  onChange: (key: string) => void;
  todayKey?: string;
  /** Accepted for compatibility; the picker is always shown inline. */
  defaultOpen?: boolean;
}) {
  const todayKey = todayKeyProp || getClubCalendarDate().dateString;
  const selected = parseDateKey(value);
  const anchor = selected || parseDateKey(todayKey)!;
  const [view, setView] = useState({ year: anchor.year, month: anchor.month });
  const selectedIsWeekday = !!selected && selected.weekday !== 0 && selected.weekday !== 6;
  const [showAll, setShowAll] = useState(selectedIsWeekday);

  const weekends = monthWeekendDays(view.year, view.month);

  const dayButtonClass = (isSel: boolean, isToday: boolean) =>
    `rounded-xl font-bold tabular-nums cursor-pointer transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
      isSel ? "bg-brand text-white" : `text-text-primary hover:bg-brand-surface ${isToday ? "ring-1 ring-inset ring-brand/50" : ""}`
    }`;

  return (
    <div className="rounded-xl border border-border bg-surface p-3 flex flex-col gap-2" data-testid="match-date-picker">
      <p className="flex items-center gap-2 text-sm font-bold" data-testid="match-date-field">
        <CalendarDays className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
        <span className={selected ? "text-text-primary" : "text-text-muted"}>{selected ? formatPickerDate(value) : "Select a date"}</span>
      </p>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))}
          aria-label="Previous month"
          className="w-11 h-11 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-text-primary cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </button>
        <p className="text-sm font-black font-heading text-text-primary" aria-live="polite" data-testid="match-date-month">
          {MONTHS[view.month]} {view.year}
        </p>
        <button
          type="button"
          onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))}
          aria-label="Next month"
          className="w-11 h-11 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-text-primary cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {showAll ? (
        <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={`${MONTHS[view.month]} ${view.year}`} data-testid="match-date-calendar">
          {WEEKDAY_LETTERS.map((d, i) => (
            <span key={i} className="text-[10px] font-bold uppercase text-text-muted py-1" aria-hidden="true">
              {d}
            </span>
          ))}
          {monthGrid(view.year, view.month).map((day, i) => {
            if (day === null) return <span key={`e${i}`} aria-hidden="true" />;
            const key = dateKey(view.year, view.month, day);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange(key)}
                aria-pressed={key === value}
                aria-label={formatPickerDate(key)}
                data-testid={`match-date-day-${key}`}
                className={`h-10 text-sm ${dayButtonClass(key === value, key === todayKey)}`}
              >
                {day}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={`Weekends in ${MONTHS[view.month]} ${view.year}`} data-testid="match-date-weekends">
          {weekends.map(({ day, weekday }) => {
            const key = dateKey(view.year, view.month, day);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange(key)}
                aria-pressed={key === value}
                aria-label={formatPickerDate(key)}
                data-testid={`match-date-day-${key}`}
                className={`min-h-[52px] flex flex-col items-center justify-center gap-0.5 border ${key === value ? "border-brand" : "border-border"} ${dayButtonClass(key === value, key === todayKey)}`}
              >
                <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">{DAYS[weekday]}</span>
                <span className="text-base leading-none">{day}</span>
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        data-testid="match-date-toggle"
        className="self-center min-h-[40px] px-3 rounded-lg text-xs font-bold text-brand hover:bg-brand-surface cursor-pointer"
      >
        {showAll ? "Weekends only" : "Show all days (pick a weekday)"}
      </button>
    </div>
  );
}
