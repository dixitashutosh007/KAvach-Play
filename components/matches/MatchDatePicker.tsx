"use client";

/**
 * Touch-friendly date picker for Add / Edit Match
 * (`components/matches/MatchDatePicker.tsx`).
 *
 * A field that shows the selected date ("Sun, 14 Nov 2026"); tapping it opens
 * an inline month calendar with previous / next month, 44px day cells, a
 * scarlet selected state and a ring on today. Values are calendar dates
 * ("YYYY-MM-DD"), handled without timezone conversion. No dates are disabled:
 * the current form allows past dates (recording played matches), and that rule
 * is unchanged.
 */
import React, { useId, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { dateKey, parseDateKey, shiftMonth } from "@/lib/match-date-strip";
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

export function MatchDatePicker({
  value,
  onChange,
  todayKey: todayKeyProp,
  defaultOpen = false,
}: {
  /** "YYYY-MM-DD" ("" when unset). */
  value: string;
  onChange: (key: string) => void;
  todayKey?: string;
  defaultOpen?: boolean;
}) {
  const todayKey = todayKeyProp || getClubCalendarDate().dateString;
  const selected = parseDateKey(value);
  const anchor = selected || parseDateKey(todayKey)!;
  const [open, setOpen] = useState(defaultOpen);
  const [view, setView] = useState({ year: anchor.year, month: anchor.month });
  const panelId = useId();

  const toggle = () => {
    if (!open) setView({ year: anchor.year, month: anchor.month });
    setOpen((v) => !v);
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="match-date-field"
        className="w-full min-h-[48px] flex items-center gap-3 rounded-xl border border-border bg-surface px-3 text-left hover:border-brand/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <CalendarDays className="w-5 h-5 text-brand shrink-0" aria-hidden="true" />
        <span className={`flex-1 text-sm font-bold ${selected ? "text-text-primary" : "text-text-muted"}`}>
          {selected ? formatPickerDate(value) : "Select a date"}
        </span>
        <ChevronRight className={`w-4 h-4 text-text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div id={panelId} className="rounded-xl border border-border bg-surface p-3 shadow-xs" data-testid="match-date-calendar">
          <div className="flex items-center justify-between mb-2">
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
          <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={`${MONTHS[view.month]} ${view.year}`}>
            {WEEKDAY_LETTERS.map((d, i) => (
              <span key={i} className="text-[10px] font-bold uppercase text-text-muted py-1" aria-hidden="true">
                {d}
              </span>
            ))}
            {monthGrid(view.year, view.month).map((day, i) => {
              if (day === null) return <span key={`e${i}`} aria-hidden="true" />;
              const key = dateKey(view.year, view.month, day);
              const isSel = key === value;
              const isToday = key === todayKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onChange(key);
                    setOpen(false);
                  }}
                  aria-pressed={isSel}
                  aria-label={formatPickerDate(key)}
                  data-testid={`match-date-day-${key}`}
                  className={`h-11 rounded-lg text-sm font-bold tabular-nums cursor-pointer transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                    isSel
                      ? "bg-brand text-white"
                      : `text-text-primary hover:bg-brand-surface ${isToday ? "ring-1 ring-inset ring-brand/50" : ""}`
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
