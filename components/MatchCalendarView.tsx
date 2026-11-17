"use client";

import { useState, useEffect, useMemo, FC } from "react";
import {
  Calendar,
  ChevronRight,
  ChevronDown,
  Edit2,
  Copy,
  Check,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { useAuth } from "./AuthProvider";
import { useSessionState } from "@/hooks/useSessionState";
import { Match } from "@/lib/types";
import { dbToInputDate } from "@/lib/utils";

export interface MatchCalendarViewProps {
  store: ReturnType<typeof useStore>;
  matches: Match[];
  grounds: ReturnType<typeof useStore>["grounds"];
  isAdmin: boolean;
  onMatchClick: (match: Match) => void;
  onEditMatch?: (match: Match) => void;
  onAddMatch: (dateStr: string) => void;
  onDuplicateMatch?: (match: Match) => void;
  onDeleteMatch?: (match: Match) => void;
  matchToDelete?: string | null;
  onConfirmDelete?: (matchId: string) => void;
  onCancelDelete?: () => void;
}

export const MatchCalendarView: FC<MatchCalendarViewProps> = ({
  store,
  matches,
  grounds,
  isAdmin,
  onMatchClick,
  onEditMatch,
  onAddMatch,
  onDuplicateMatch,
  onDeleteMatch,
  matchToDelete,
  onConfirmDelete,
  onCancelDelete,
}) => {
  const [isMounted, setIsMounted] = useState(false);
  const { user, hasAdminClaim } = useAuth();
  const currentUser = store.appUsers.find((u) => u.id === user?.uid);
  const effectiveAdmin = Boolean(
    isAdmin ||
    hasAdminClaim ||
    currentUser?.isMatchAdmin ||
    currentUser?.isClubAdmin
  );
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const [isPastCollapsed, setIsPastCollapsed] = useSessionState(
    "matches:calendar:isPastCollapsed",
    true,
  );
  const [filterGround, setFilterGround] = useSessionState<string>(
    "matches:calendar:filterGround",
    "all",
  );
  const [filterOpenSlots, setFilterOpenSlots] = useSessionState<boolean>(
    "matches:calendar:filterOpenSlots",
    false,
  );

  const getMatchDateObj = (match: Match) => {
    const parts = dbToInputDate(match.date).split("/");
    let d = new Date();
    if (parts.length === 3) {
      d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    } else {
      d = new Date(match.date);
    }
    if (match.time) {
      const [hours, mins] = match.time.split(":");
      d.setHours(parseInt(hours, 10) || 23, parseInt(mins, 10) || 59, 59, 999);
    } else {
      d.setHours(23, 59, 59, 999);
    }
    return d;
  };

  const { pastCalendarData, upcomingCalendarData } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pastCutoff = new Date(today);
    pastCutoff.setDate(pastCutoff.getDate() - 10);

    const upcomingStart = new Date(pastCutoff);
    const currentDay = upcomingStart.getDay();
    const dist = currentDay === 0 ? 6 : currentDay - 1;
    upcomingStart.setDate(upcomingStart.getDate() - dist);

    const upcomingEnd = new Date(today);
    upcomingEnd.setMonth(upcomingEnd.getMonth() + 8);

    const nonArchivedMatches = matches.filter(m => !m.isArchived).filter(m => {
       if (filterGround !== "all" && m.groundId !== filterGround) return false;
       return true;
    });

    const isMatchOpen = (m: Match) => m.format === "Other" || m.opponent === "TBD" || m.opponent.toLowerCase().includes("open") || m.format.toLowerCase().includes("open");

    const pastMatches = nonArchivedMatches.filter(m => getMatchDateObj(m) < pastCutoff);
    let earliestPastDate = new Date(today);
    if (pastMatches.length > 0) {
      earliestPastDate = new Date(Math.min(...pastMatches.map(m => getMatchDateObj(m).getTime())));
    }

    const pastStart = new Date(earliestPastDate);
    pastStart.setHours(0, 0, 0, 0);
    const pCurrentDay = pastStart.getDay();
    const pDist = pCurrentDay === 0 ? 6 : pCurrentDay - 1;
    pastStart.setDate(pastStart.getDate() - pDist);

    const pastEnd = new Date(upcomingStart);
    pastEnd.setDate(pastEnd.getDate() - 1);

    const generateWeeks = (startData: Date, endData: Date) => {
      const weeks: { weekLabel: string; monthLabel: string; days: any[] }[] = [];
      let current = new Date(startData);
      while (current <= endData) {
        const weekStart = new Date(current);
        const days = [];

        for (let i = 0; i < 7; i++) {
          const d = new Date(current);
          d.setDate(d.getDate() + i);

          const pYear = d.getFullYear();
          const pMonth = String(d.getMonth() + 1).padStart(2, "0");
          const pDate = String(d.getDate()).padStart(2, "0");
          const dateStr = `${pYear}-${pMonth}-${pDate}`;

          const dayMatches = nonArchivedMatches.filter((m) => {
             const parts = dbToInputDate(m.date).split("/");
             if (parts.length === 3) {
               const mDateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
               return mDateStr === dateStr;
             }
             return m.date === dateStr;
          });
          const dayOfWeek = d.getDay();

          let includeDay = false;
          let appendMatches = dayMatches;

          if (filterOpenSlots) {
             const hasTournamentMatch = dayMatches.some(m => m.matchType === "Tournament");
             if (!hasTournamentMatch && (dayOfWeek === 0 || dayOfWeek === 6)) {
               includeDay = true;
             }
          } else {
             if (dayOfWeek === 0 || dayOfWeek === 6 || dayMatches.length > 0) {
               includeDay = true;
             }
          }

          if (includeDay) {
            days.push({
              date: d,
              dateStr,
              dayOfWeek,
              matches: appendMatches,
            });
          }
        }

        const monthLabel = weekStart.toLocaleString("en-US", {
          month: "long",
          year: "numeric",
        });

        let includeWeek = false;
        if (filterOpenSlots) {
            includeWeek = days.length > 0;
        } else {
            includeWeek = days.some(d => d.matches.length > 0) || endData === upcomingEnd;
        }

        if (includeWeek) {
             weeks.push({
              weekLabel: `Week of ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric"})}`,
              monthLabel,
              days,
            });
        }

        current.setDate(current.getDate() + 7);
      }
      return weeks;
    };

    let pastCalendarData: any[] = [];
    if (pastMatches.length > 0 && pastStart < pastEnd) {
      pastCalendarData = generateWeeks(pastStart, pastEnd);
    }
    const upcomingCalendarData = generateWeeks(upcomingStart, upcomingEnd);

    return { pastCalendarData, upcomingCalendarData };
  }, [matches, filterGround, filterOpenSlots]);

  const groupWeeksByMonth = (calendarData: any[]) => {
    const grouped: { [month: string]: any[] } = {};
    calendarData.forEach((week) => {
      if (!grouped[week.monthLabel]) {
        grouped[week.monthLabel] = [];
      }
      grouped[week.monthLabel].push(week);
    });
    return grouped;
  };

  const upcomingGrouped = groupWeeksByMonth(upcomingCalendarData);
  const pastGrouped = groupWeeksByMonth(pastCalendarData);

  if (!isMounted) {
    return <div className="p-4 text-center text-text-muted animate-pulse mt-4">Loading calendar view...</div>;
  }

  return (
    <div className="space-y-8 pb-12 mt-4 text-left">
      {isAdmin && (
        <div className="bg-surface p-4 rounded-xl flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] uppercase font-bold text-text-muted tracking-widest block mb-1">Ground</label>
            <select
              value={filterGround}
              onChange={(e) => setFilterGround(e.target.value)}
              className="w-full bg-surface-hover border border-border rounded-lg text-sm px-3 py-2 text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="all">All Grounds</option>
              {grounds.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-none pt-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-text-primary hover:text-text-primary transition">
              <input
                type="checkbox"
                checked={filterOpenSlots}
                onChange={(e) => setFilterOpenSlots(e.target.checked)}
                className="w-4 h-4 accent-accent"
              />
              Show Open Slots
            </label>
          </div>
        </div>
      )}

      {Object.keys(pastGrouped).length > 0 && (
        <div className="bg-surface p-4 rounded-xl">
          <button
            onClick={() => setIsPastCollapsed(!isPastCollapsed)}
            className="flex w-full items-center justify-between text-text-primary hover:text-text-primary"
          >
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Calendar className="w-5 h-5" /> Past Matches
            </h2>
            {isPastCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
          {!isPastCollapsed && (
            <div className="mt-4 space-y-6">
              {Object.entries(pastGrouped).reverse().map(([monthName, weeks]) => (
                <div key={monthName} className="space-y-4">
                  <h3 className="text-sm font-bold border-b border-border pb-2 text-text-muted shrink-0">
                    {monthName}
                  </h3>
                  <div className="space-y-4">
                    {weeks.slice().reverse().map((week, idx) => (
                      <div
                        key={idx}
                        className="bg-surface-hover border border-border rounded-xl p-4 overflow-x-auto custom-scrollbar"
                      >
                        <div className="flex gap-4 min-w-max flex-row-reverse justify-end">
                          {week.days.slice().reverse().map((day: any, dIdx: number) => (
                            <div
                              key={dIdx}
                              className="w-40 shrink-0 flex flex-col space-y-2"
                            >
                              <div className="text-center pb-2 border-b border-border">
                                <div className="text-[10px] uppercase font-bold tracking-widest text-text-muted">
                                  {day.date.toLocaleDateString("en-US", {
                                    weekday: "short",
                                  })}
                                </div>
                                <div className="text-2xl font-bold font-mono flex flex-col items-center">
                                  <span>{day.date.getDate()}</span>
                                  <span className="text-[10px] font-sans text-text-muted uppercase tracking-widest leading-none mt-1">{day.date.toLocaleDateString("en-US", { month: "short" })}</span>
                                </div>
                              </div>
                              <div className="space-y-2 pt-1 flex flex-col justify-start h-full min-h-[5rem]">
                                {day.matches.length > 0 && day.matches.map((m: Match) => {
                                  const matchPayments = store.payments.filter(p => p.matchId === m.id && store.players.some((pl) => pl.id === p.playerId));
                                  const paidCount = matchPayments.filter(p => p.status === "Paid").length;
                                  const unpaidCount = matchPayments.filter(p => p.status === "Unpaid").length;
                                  return (
                                    <div
                                      key={m.id}
                                      onClick={() => onMatchClick(m)}
                                      className={`p-2.5 rounded-lg border flex flex-col gap-1 cursor-pointer transition shadow-sm relative group overflow-hidden ${
                                        m.matchType === "Tournament"
                                          ? "bg-red-500/10 border-red-500/30 hover:bg-red-500/20"
                                          : "bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/20"
                                      }`}
                                    >
                                      <div className="flex justify-between items-start">
                                        <div className="text-[10px] uppercase font-bold tracking-wider text-text-primary opacity-70">
                                          {m.matchType} • {m.time}
                                        </div>
                                        {m.isTentative && (
                                          <span className="bg-orange-500 text-black px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider animate-pulse ml-1 shrink-0" title={`Blocked by ${m.tentativelyBlockedBy || "Admin"}`}>
                                            Blocked{m.tentativelyBlockedBy ? ` · ${m.tentativelyBlockedBy}` : ""}
                                          </span>
                                        )}
                                      </div>

                                      {matchToDelete === m.id ? (
                                        <div className="mt-1 flex items-center justify-between gap-1 bg-black/60 rounded-lg px-2 py-1 border border-red-500/50">
                                          <span className="text-[9px] text-red-400 uppercase font-bold tracking-wider">
                                            Sure?
                                          </span>
                                          <div className="flex gap-1">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onConfirmDelete?.(m.id);
                                              }}
                                              className="text-red-400 hover:bg-red-500/20 rounded p-1 transition"
                                            >
                                              <Check className="w-3 h-3" />
                                            </button>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onCancelDelete?.();
                                              }}
                                              className="text-text-secondary hover:bg-surface-hover rounded p-1 transition"
                                            >
                                              <span className="text-[10px] font-bold px-0.5">X</span>
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <>
                                          <div className="font-bold text-sm leading-tight text-text-primary">
                                            vs {m.opponent}
                                          </div>
                                          <div className="text-[10px] text-text-muted truncate">
                                            {grounds.find((g) => g.id === m.groundId)?.name || "Unknown Ground"}
                                          </div>
                                          {effectiveAdmin && m.isGroundFeePaid && (
                                            <div className="mt-1 text-[9px] uppercase tracking-widest font-bold text-emerald-400 flex items-center">
                                              <CheckCircle2 className="w-3 h-3 mr-1" /> Ground Fee Paid
                                            </div>
                                          )}
                                          {effectiveAdmin && (
                                            <div className="mt-1 flex gap-2 text-[9px] font-bold uppercase tracking-wider">
                                              <span className="text-emerald-400">{paidCount} Paid</span>
                                              {unpaidCount > 0 && <span className="text-red-400">{unpaidCount} Unpaid</span>}
                                            </div>
                                          )}
                                          {effectiveAdmin && (
                                            <div className="flex items-center justify-between gap-1 mt-2 pt-2 border-t border-border/50 transition-opacity">
                                              <div className="flex items-center gap-1">
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    onEditMatch?.(m);
                                                  }}
                                                  className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover rounded-lg bg-surface-hover border border-border transition"
                                                  title="Edit Match"
                                                >
                                                  <Edit2 className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    onDuplicateMatch?.(m);
                                                  }}
                                                  className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover rounded-lg bg-surface-hover border border-border transition"
                                                  title="Duplicate Match"
                                                >
                                                  <Copy className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    onDeleteMatch?.(m);
                                                  }}
                                                  className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-red-400 hover:bg-red-500/10 rounded-lg bg-surface-hover border border-border transition"
                                                  title="Delete Match"
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                              </div>
                                              {m.matchUrl && (
                                                <a
                                                  href={m.matchUrl}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="text-[9px] bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded px-1.5 py-0.5 hover:bg-blue-500 hover:text-text-primary transition uppercase font-bold tracking-wider"
                                                  onClick={(e) => e.stopPropagation()}
                                                >
                                                  Share
                                                </a>
                                              )}
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  );
                                })}
                                {day.matches.length === 0 && (
                                  <div className="flex-1 flex items-center justify-center text-text-primary/10 text-xs italic">
                                    No Match
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {Object.entries(upcomingGrouped).map(([monthName, weeks]) => (
        <div key={monthName} className="space-y-4">
          <h2 className="text-xl font-bold border-b border-border pb-2 text-text-primary shrink-0">
            {monthName}
          </h2>
          <div className="space-y-4">
            {weeks.map((week, idx) => (
              <div
                key={idx}
                className="bg-surface-hover border border-border rounded-xl p-4 overflow-x-auto custom-scrollbar"
              >
                <div className="flex gap-4 min-w-max">
                  {week.days.map((day: any, dIdx: number) => (
                    <div
                      key={dIdx}
                      className="w-40 shrink-0 flex flex-col space-y-2"
                    >
                      <div className="text-center pb-2 border-b border-border">
                        <div className="text-[10px] uppercase font-bold tracking-widest text-text-muted">
                          {day.date.toLocaleDateString("en-US", {
                            weekday: "short",
                          })}
                        </div>
                        <div className="text-2xl font-bold font-mono flex flex-col items-center">
                          <span>{day.date.getDate()}</span>
                          <span className="text-[10px] font-sans text-text-muted uppercase tracking-widest leading-none mt-1">{day.date.toLocaleDateString("en-US", { month: "short" })}</span>
                        </div>
                      </div>

                      <div className="space-y-2 pt-1 flex flex-col justify-start h-full min-h-[5rem]">
                        {day.matches.length > 0 && day.matches.map((m: Match) => {
                          const matchPayments = store.payments.filter(p => p.matchId === m.id && store.players.some((pl) => pl.id === p.playerId));
                          const paidCount = matchPayments.filter(p => p.status === "Paid").length;
                          const unpaidCount = matchPayments.filter(p => p.status === "Unpaid").length;
                          return (
                          <div
                            key={m.id}
                            onClick={() => onMatchClick(m)}
                            className={`p-2.5 rounded-lg border flex flex-col gap-1 cursor-pointer transition shadow-sm relative group overflow-hidden ${
                              m.matchType === "Tournament"
                                ? "bg-red-500/10 border-red-500/30 hover:bg-red-500/20"
                                : "bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/20"
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <div className="text-[10px] uppercase font-bold tracking-wider text-text-primary opacity-70">
                                {m.matchType} • {m.time}
                              </div>
                              {m.isTentative && (
                                <span className="bg-orange-500 text-black px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider animate-pulse ml-1 shrink-0" title={`Blocked by ${m.tentativelyBlockedBy || "Admin"}`}>
                                  Blocked{m.tentativelyBlockedBy ? ` · ${m.tentativelyBlockedBy}` : ""}
                                </span>
                              )}
                            </div>
                            {m.tournamentId && (() => {
                              const t = store.tournaments.find(
                                (tt) => tt.id === m.tournamentId,
                              );
                              if (!t) return null;
                              return (
                                <div
                                  className="text-[9px] font-bold text-purple-300 uppercase tracking-wider truncate flex items-center gap-1"
                                  title={t.name}
                                >
                                  🏆 {t.name}
                                </div>
                              );
                            })()}

                            {matchToDelete === m.id ? (
                              <div className="mt-1 flex items-center justify-between gap-1 bg-black/60 rounded-lg px-2 py-1 border border-red-500/50">
                                <span className="text-[9px] text-red-400 uppercase font-bold tracking-wider">
                                  Sure?
                                </span>
                                <div className="flex gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onConfirmDelete?.(m.id);
                                    }}
                                    className="text-red-400 hover:bg-red-500/20 rounded p-1 transition"
                                  >
                                    <Check className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onCancelDelete?.();
                                    }}
                                    className="text-text-secondary hover:bg-surface-hover rounded p-1 transition"
                                  >
                                    <span className="text-[10px] font-bold px-0.5">X</span>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="font-bold text-sm leading-tight text-text-primary">
                                  vs {m.opponent}
                                </div>
                                {m.groundId && (
                                  <div className="text-[9px] uppercase tracking-widest text-text-secondary truncate mt-0.5">
                                    {grounds.find((g) => g.id === m.groundId)?.name || "Unknown Ground"}
                                  </div>
                                )}

                                {effectiveAdmin && m.isGroundFeePaid && (
                                  <div className="mt-1 text-[9px] uppercase tracking-widest font-bold text-emerald-400 flex items-center">
                                    <CheckCircle2 className="w-3 h-3 mr-1" /> Ground Fee Paid
                                  </div>
                                )}

                                {effectiveAdmin && (
                                  <div className="mt-1 flex gap-2 text-[9px] font-bold uppercase tracking-wider">
                                    <span className="text-emerald-400">{paidCount} Paid</span>
                                    {unpaidCount > 0 && <span className="text-red-400">{unpaidCount} Unpaid</span>}
                                  </div>
                                )}

                                {effectiveAdmin && (
                                  <div className="flex items-center justify-between gap-1 mt-2 pt-2 border-t border-border/50 transition-opacity">
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onEditMatch?.(m);
                                        }}
                                        className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover rounded-lg bg-surface-hover border border-border transition"
                                        title="Edit Match"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onDuplicateMatch?.(m);
                                        }}
                                        className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover rounded-lg bg-surface-hover border border-border transition"
                                        title="Duplicate Match"
                                      >
                                        <Copy className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onDeleteMatch?.(m);
                                        }}
                                        className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-red-400 hover:bg-red-500/10 rounded-lg bg-surface-hover border border-border transition"
                                        title="Delete Match"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                    {m.matchUrl && (
                                      <a
                                        href={m.matchUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[9px] bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded px-1.5 py-0.5 hover:bg-blue-500 hover:text-text-primary transition uppercase font-bold tracking-wider"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        Share
                                      </a>
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                        })}

                        {(effectiveAdmin || day.matches.length === 0) && (
                          <div
                            onClick={() => effectiveAdmin ? onAddMatch(day.dateStr) : undefined}
                            className={`${day.matches.length === 0 ? "flex-1 min-h-[5rem]" : "py-2 mt-1"} rounded-lg flex items-center justify-center border-2 border-dashed border-emerald-500/30 bg-emerald-500/5 transition ${effectiveAdmin ? "cursor-pointer hover:bg-emerald-500/10 hover:border-emerald-500/50" : ""}`}
                          >
                            <span className="text-emerald-400 font-bold text-[10px] uppercase tracking-wider">
                              {day.matches.length > 0 ? "+ Add" : "Open Slot"}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
