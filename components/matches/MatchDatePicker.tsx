"use client";

/**
 * Weekend-first date picker for the Add / Edit Match wizard
 * (`components/matches/MatchDatePicker.tsx`).
 *
 * Inline it shows ONLY the month's Saturdays and Sundays as compact tiles
 * (2–3 short rows) with previous / next month. Any other date is picked from
 * "View Full Calendar", which opens a pop-up month calendar; choosing a day
 * closes it. Values are calendar dates ("YYYY-MM-DD"), handled without
 * timezone conversion. No dates are disabled (past dates are allowed for
 * recording played matches, as before).
 */
import React, { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
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

function MonthNav({ year, month, onShift }: { year: number; month: number; onShift: (delta: number) => void }) {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={() => onShift(-1)}
        aria-label="Previous month"
        className="w-11 h-11 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-text-primary cursor-pointer"
      >
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
      </button>
      <p className="text-sm font-black font-heading text-text-primary" aria-live="polite">
        {MONTHS[month]} {year}
      </p>
      <button
        type="button"
        onClick={() => onShift(1)}
        aria-label="Next month"
        className="w-11 h-11 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-text-primary cursor-pointer"
      >
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function MatchDatePicker({
  value,
  onChange,
  todayKey: todayKeyProp,
  defaultFullOpen = false,
}: {
  /** "YYYY-MM-DD" ("" when unset). */
  value: string;
  onChange: (key: string) => void;
  todayKey?: string;
  /** Test hook: start with the full-calendar pop-up open. */
  defaultFullOpen?: boolean;
  /** Accepted for compatibility; ignored. */
  defaultOpen?: boolean;
}) {
  const todayKey = todayKeyProp || getClubCalendarDate().dateString;
  const selected = parseDateKey(value);
  const anchor = selected || parseDateKey(todayKey)!;
  const [view, setView] = useState({ year: anchor.year, month: anchor.month });
  const [fullOpen, setFullOpen] = useState(defaultFullOpen);
  const [fullView, setFullView] = useState({ year: anchor.year, month: anchor.month });

  useEffect(() => {
    if (!fullOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullOpen]);

  const weekends = monthWeekendDays(view.year, view.month);
  const isWeekday = !!selected && selected.weekday !== 0 && selected.weekday !== 6;

  const tone = (isSel: boolean, isToday: boolean) =>
    isSel ? "bg-brand text-white border-brand" : `text-text-primary border-border hover:bg-brand-surface ${isToday ? "ring-1 ring-inset ring-brand/50" : ""}`;

  return (
    <div className="flex flex-col gap-2" data-testid="match-date-picker">
      <p className="flex items-center gap-2 text-sm font-bold" data-testid="match-date-field">
        <CalendarDays className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
        <span className={selected ? "text-text-primary" : "text-text-muted"}>{selected ? formatPickerDate(value) : "Select a date"}</span>
        {isWeekday && <span className="text-[11px] font-semibold text-text-secondary">(weekday)</span>}
      </p>

      <MonthNav year={view.year} month={view.month} onShift={(d) => setView((v) => shiftMonth(v.year, v.month, d))} />

      {/* Weekends only: compact tiles */}
      <div className="grid grid-cols-5 gap-1.5" role="group" aria-label={`Weekends in ${MONTHS[view.month]} ${view.year}`} data-testid="match-date-weekends">
        {weekends.map(({ day, weekday }) => {
          const key = dateKey(view.year, view.month, day);
          const isSel = key === value;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-pressed={isSel}
              aria-label={formatPickerDate(key)}
              data-testid={`match-date-day-${key}`}
              className={`min-h-[48px] rounded-xl border flex flex-col items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${tone(isSel, key === todayKey)}`}
            >
              <span className="text-[10px] font-bold uppercase tracking-wide opacity-80 leading-none">{DAYS[weekday]}</span>
              <span className="mt-0.5 text-base font-bold tabular-nums leading-none">{day}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => {
          setFullView({ year: view.year, month: view.month });
          setFullOpen(true);
        }}
        data-testid="match-date-view-full"
        className="self-start inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg border border-brand/30 text-xs font-bold text-brand hover:bg-brand-surface cursor-pointer"
      >
        <CalendarDays className="w-4 h-4" aria-hidden="true" />
        View Full Calendar
      </button>

      {/* Pop-up full calendar for any day */}
      {fullOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Full calendar" data-testid="match-date-full-dialog">
          <div className="w-full max-w-sm rounded-2xl bg-surface p-4 shadow-xl">
            <div className="flex items-center justify-between mb-1">
              <p className="text-base font-black font-heading text-text-primary">Pick any date</p>
              <button
                type="button"
                onClick={() => setFullOpen(false)}
                aria-label="Close calendar"
                className="w-10 h-10 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-hover cursor-pointer"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <MonthNav year={fullView.year} month={fullView.month} onShift={(d) => setFullView((v) => shiftMonth(v.year, v.month, d))} />
            <div className="grid grid-cols-7 gap-1 text-center" data-testid="match-date-calendar">
              {WEEKDAY_LETTERS.map((d, i) => (
                <span key={i} className="text-[10px] font-bold uppercase text-text-muted py-1" aria-hidden="true">
                  {d}
                </span>
              ))}
              {monthGrid(fullView.year, fullView.month).map((day, i) => {
                if (day === null) return <span key={`e${i}`} aria-hidden="true" />;
                const key = dateKey(fullView.year, fullView.month, day);
                const isSel = key === value;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      onChange(key);
                      setView({ year: fullView.year, month: fullView.month });
                      setFullOpen(false);
                    }}
                    aria-pressed={isSel}
                    aria-label={formatPickerDate(key)}
                    data-testid={`match-date-full-day-${key}`}
                    className={`h-11 rounded-lg border text-sm font-bold tabular-nums cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${isSel ? tone(true, false) : `border-transparent ${tone(false, key === todayKey)}`}`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
