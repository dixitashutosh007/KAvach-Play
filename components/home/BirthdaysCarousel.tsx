"use client";

import { useMemo } from "react";
import { Cake, Sparkles } from "lucide-react";
import { format, addDays, isWithinInterval } from "date-fns";
import { Player } from "@/lib/types";

export function BirthdaysCarousel({ players = [] }: { players: Player[] }) {
  const { todayBirthdays, upcomingBirthdays } = useMemo(() => {
    const today = new Date();
    const nextTwoWeeks = addDays(today, 14);
    const todayStr = format(today, "MM-dd");

    const todayList: Player[] = [];
    const upcomingList: Player[] = [];

    players.forEach((p) => {
      if (!p.dob || p.disabled) return;
      try {
        const dobDate = new Date(p.dob);
        const dobMonthDay = format(dobDate, "MM-dd");

        if (dobMonthDay === todayStr) {
          todayList.push(p);
        } else {
          const currentYearBday = new Date(
            today.getFullYear(),
            dobDate.getMonth(),
            dobDate.getDate()
          );
          if (isWithinInterval(currentYearBday, { start: today, end: nextTwoWeeks })) {
            upcomingList.push(p);
          } else {
            const nextYearBday = new Date(
              today.getFullYear() + 1,
              dobDate.getMonth(),
              dobDate.getDate()
            );
            if (isWithinInterval(nextYearBday, { start: today, end: nextTwoWeeks })) {
              upcomingList.push(p);
            }
          }
        }
      } catch {
        // Ignore date parsing errors
      }
    });

    upcomingList.sort((a, b) => {
      const aDate = new Date(a.dob!);
      const bDate = new Date(b.dob!);
      return aDate.getMonth() - bDate.getMonth() || aDate.getDate() - bDate.getDate();
    });

    return { todayBirthdays: todayList, upcomingBirthdays: upcomingList };
  }, [players]);

  const allBirthdayItems = [...todayBirthdays, ...upcomingBirthdays];
  const hasBirthdays = allBirthdayItems.length > 0;

  return (
    <section
      data-testid="birthdays-section"
      aria-label="Club Birthdays"
      className="w-full flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-soft-blush flex items-center justify-center">
            <Cake className="w-3.5 h-3.5 text-scarlet" />
          </div>
          <h2 className="text-xs sm:text-sm font-bold text-text-primary uppercase tracking-wider font-heading">
            Team Birthdays
          </h2>
        </div>

        {todayBirthdays.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted-gold/20 text-deep-wine border border-muted-gold/40">
            <Sparkles className="w-3 h-3 text-muted-gold" />
            <span>Celebrating Today!</span>
          </span>
        )}
      </div>

      {hasBirthdays ? (
        <div className="flex overflow-x-auto gap-3 pb-2 pt-1 no-scrollbar snap-x snap-mandatory scroll-smooth">
          {allBirthdayItems.map((p) => {
            const isTodayBirthday = todayBirthdays.some((t) => t.id === p.id);
            let bdayFormatted = "";
            try {
              bdayFormatted = format(new Date(p.dob!), "MMM do");
            } catch {
              bdayFormatted = "Upcoming";
            }

            return (
              <div
                key={p.id}
                data-testid={`birthday-card-${p.id}`}
                className={`snap-start shrink-0 min-w-[200px] sm:min-w-[220px] rounded-xl p-3 border flex items-center gap-3 shadow-xs transition ${
                  isTodayBirthday
                    ? "bg-gradient-to-r from-soft-blush to-canvas-warm border-scarlet/40 shadow-sm ring-1 ring-scarlet/20"
                    : "bg-surface border-border hover:bg-canvas-warm/40"
                }`}
              >
                {/* Avatar with Cake Badge */}
                <div className="relative shrink-0">
                  <div
                    className={`w-11 h-11 rounded-full flex items-center justify-center font-heading font-black text-sm uppercase ${
                      isTodayBirthday
                        ? "bg-scarlet text-white shadow-xs"
                        : "bg-deep-wine/10 text-deep-wine border border-deep-wine/20"
                    }`}
                  >
                    {p.name.charAt(0)}
                  </div>
                  {isTodayBirthday && (
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-muted-gold flex items-center justify-center text-[10px] text-deep-wine shadow-xs">
                      🎂
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-text-primary truncate font-heading">
                    {p.name}
                  </p>
                  <p
                    className={`text-[11px] font-bold mt-0.5 ${
                      isTodayBirthday ? "text-scarlet font-black" : "text-text-secondary"
                    }`}
                  >
                    {isTodayBirthday ? "Today! 🎉" : bdayFormatted}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl p-4 text-center text-xs text-text-muted">
          No team birthdays in the next 14 days. Celebrating our players all season long!
        </div>
      )}
    </section>
  );
}
