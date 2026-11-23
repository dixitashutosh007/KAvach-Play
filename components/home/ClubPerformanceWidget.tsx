"use client";

/**
 * Player Home — Club Performance widget (`components/home/ClubPerformanceWidget.tsx`).
 *
 * Shows ONLY the admin-maintained exact totals (appConfig/clubStats): Matches
 * Played, Matches Won and the calculated Win Rate. Until totals are published
 * it shows a loading / "not published yet" / error state — never sample numbers.
 *
 * Motion: counters count up and the ring fills ONCE when the card first enters
 * view (once per browser session). prefers-reduced-motion shows final values
 * immediately. No looping, pulsing or decorative animation.
 */
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Trophy } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useClubStats } from "@/hooks/useClubStats";
import { computeWinRate, formatWinRate } from "@/lib/club-stats";

const DURATION_MS = 1100;
const SESSION_KEY = "kavach:club-stats-animated";
const RING_RADIUS = 42;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function alreadyAnimatedThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markAnimated() {
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // Storage unavailable: animation may replay on the next visit.
  }
}

function shouldAnimate(): boolean {
  if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  return !alreadyAnimatedThisSession();
}

export function ClubPerformanceWidget({ canManage = false }: { canManage?: boolean }) {
  const { stats, loading, error } = useClubStats();
  if (stats) return <ClubPerformanceCard played={stats.matchesPlayed} won={stats.matchesWon} />;
  return <ClubPerformanceStatus state={loading ? "loading" : error ? "error" : "empty"} canManage={canManage} />;
}

/**
 * Loading / unconfigured / error presentation. Never shows invented numbers;
 * keeps the section visible so members (and admins) understand its state.
 */
export function ClubPerformanceStatus({
  state,
  canManage = false,
}: {
  state: "loading" | "empty" | "error";
  canManage?: boolean;
}) {
  return (
    <section
      data-testid="club-performance-widget"
      data-state={state}
      aria-label="Club performance"
      aria-busy={state === "loading" || undefined}
      className="w-full rounded-2xl border border-white/10 bg-[#1F1D21] text-white p-5 sm:p-6 shadow-sm"
    >
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-dusty-red">Club Performance</p>
      <h2 className="mt-0.5 text-lg sm:text-xl font-black font-heading tracking-tight text-white">Our journey so far</h2>

      {state === "loading" ? (
        <div className="mt-4 grid grid-cols-2 gap-3" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
              <div className="h-3 w-24 rounded bg-white/10" />
              <div className="mt-2 h-8 w-16 rounded bg-white/10" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 flex items-start gap-3">
          <Trophy className="w-5 h-5 text-muted-gold shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm text-white/75 leading-relaxed" data-testid="club-performance-message">
            {state === "error" ? (
              <p>Club statistics couldn&apos;t be loaded right now. Pull down to refresh or try again later.</p>
            ) : (
              <>
                <p>Club statistics haven&apos;t been published yet.</p>
                {canManage && (
                  <p className="mt-1 text-xs text-white/60">
                    Add the totals in Admin → Club → Leaderboard &amp; Stats.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function ClubPerformanceCard({ played, won }: { played: number; won: number }) {
  const prefersReducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLElement>(null);
  const winRate = computeWinRate(played, won);
  const targetRate = winRate ?? 0;
  // Decide before first paint whether to animate (avoids a final→0 flicker).
  const [armed] = useState(() => shouldAnimate());
  // progress: 0 → 1 over the animation; 1 = final values.
  const [progress, setProgress] = useState(() => (armed ? 0 : 1));

  // If the user prefers reduced motion (or it changes), show final values at once.
  useEffect(() => {
    if (prefersReducedMotion) setProgress(1);
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (!armed || prefersReducedMotion || !rootRef.current) return;
    let frame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        markAnimated();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / DURATION_MS);
          setProgress(easeOutCubic(t));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.35 },
    );
    observer.observe(rootRef.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [armed, prefersReducedMotion]);

  const shownPlayed = Math.round(played * progress);
  const shownWon = Math.round(won * progress);
  const ringOffset = RING_CIRCUMFERENCE * (1 - (targetRate / 100) * progress);
  const rateLabel = formatWinRate(winRate);

  return (
    <section
      ref={rootRef}
      data-testid="club-performance-widget"
      aria-label="Club performance"
      className="w-full rounded-2xl border border-white/10 bg-[#1F1D21] text-white p-5 sm:p-6 shadow-sm"
    >
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-dusty-red">Club Performance</p>
      <h2 className="mt-0.5 text-lg sm:text-xl font-black font-heading tracking-tight text-white">Our journey so far</h2>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/60">
            <CalendarDays className="w-3.5 h-3.5 text-dusty-red" aria-hidden="true" />
            Matches played
          </div>
          <p className="mt-1 text-3xl sm:text-4xl font-black font-heading tabular-nums leading-none" data-testid="club-stats-played-value">
            <span aria-hidden="true">{shownPlayed.toLocaleString("en-IN")}</span>
            <span className="sr-only">{played}</span>
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/60">
            <Trophy className="w-3.5 h-3.5 text-muted-gold" aria-hidden="true" />
            Matches won
          </div>
          <p className="mt-1 text-3xl sm:text-4xl font-black font-heading tabular-nums leading-none" data-testid="club-stats-won-value">
            <span aria-hidden="true">{shownWon.toLocaleString("en-IN")}</span>
            <span className="sr-only">{won}</span>
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4 border-t border-white/10 pt-4">
        <div className="relative w-24 h-24 shrink-0" data-testid="club-stats-ring">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden="true">
            <circle cx="50" cy="50" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
            <circle
              cx="50"
              cy="50"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              className="stroke-scarlet"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={winRate === null ? RING_CIRCUMFERENCE : ringOffset}
            />
          </svg>
          <span className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-black font-heading tabular-nums leading-none" data-testid="club-stats-winrate">
              {rateLabel}
            </span>
            <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-white/60">Win rate</span>
          </span>
        </div>
        <p className="text-xs sm:text-sm text-white/70 leading-relaxed">Every match adds to our story.</p>
      </div>
    </section>
  );
}
