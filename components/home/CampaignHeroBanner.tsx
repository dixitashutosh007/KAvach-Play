"use client";

/**
 * Player Home top banner (`components/home/CampaignHeroBanner.tsx`).
 *
 * Shows pinned club announcements, promotions and today's / tomorrow's birthdays.
 * Match / fixture content is intentionally not shown here. Behaviour:
 *  - auto-rotates (paused on hover, keyboard focus, touch, hidden tab, or when the
 *    user prefers reduced motion);
 *  - swipe on touch screens, arrow buttons on wider screens, dots everywhere,
 *    ←/→ keys while focused;
 *  - every slide can be dismissed individually; dismissal is stored per user in
 *    this browser and keyed to the slide's period (see bannerSlides.ts). A
 *    dismissal can be undone for a few seconds, and when every highlight is
 *    hidden a "Show club highlights" link restores them;
 *  - a single slide shows no carousel controls; no slides renders nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Sparkles,
  ShoppingBag,
  Video,
  Cake,
  Gift,
  X,
  RotateCcw,
  ExternalLink,
  Crown,
} from "lucide-react";
import type { AppConfig, Player, Post } from "@/lib/types";
import { getClubCalendarDate } from "@/lib/utils";
import { PlayerOfWeekendBadgeSvg } from "@/components/BadgeIcon";
import {
  buildBannerSlides,
  clubDayFromParts,
  dismissStorageKey,
  parseDismissed,
  pruneDismissed,
  restoreDismissed,
  visibleSlides,
  type BannerSlide,
  type DismissedMap,
} from "./bannerSlides";

// Fallback only; each slide carries its own durationMs (see bannerSlides.ts).
const AUTO_ROTATE_MS = 6000;
const RESUME_AFTER_TOUCH_MS = 8000;
const SWIPE_THRESHOLD_PX = 40;
const UNDO_WINDOW_MS = 6000;

export function CampaignHeroBanner({
  announcements = [],
  players = [],
  currentUserId = "",
  appConfig,
  isFeatureEnabled,
  onNavigate,
  nowMs,
}: {
  announcements?: Post[];
  players?: Player[];
  currentUserId?: string;
  appConfig?: AppConfig | null;
  isFeatureEnabled: (key: any) => boolean;
  onNavigate: (tab: string, targetId?: string) => void;
  nowMs?: number;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [touchPausedUntil, setTouchPausedUntil] = useState(0);
  const [isDocumentHidden, setIsDocumentHidden] = useState(false);
  const [dismissed, setDismissed] = useState<DismissedMap>({});
  const [lastDismissed, setLastDismissed] = useState<BannerSlide | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  // Set when a touch gesture was a swipe, so the banner link does not open.
  const suppressLinkClickRef = useRef(false);

  // Club calendar day (Asia/Kolkata) for birthdays and banner periods.
  const today = useMemo(() => {
    const { year, month, day } = getClubCalendarDate(new Date());
    return clubDayFromParts(year, month, day);
  }, []);

  // Load this user's dismissals after mount (browser storage only).
  useEffect(() => {
    try {
      const key = dismissStorageKey(currentUserId);
      const pruned = pruneDismissed(parseDismissed(window.localStorage.getItem(key)), Date.now());
      setDismissed(pruned);
      window.localStorage.setItem(key, JSON.stringify(pruned));
    } catch {
      setDismissed({});
    }
  }, [currentUserId]);

  useEffect(() => {
    const onVisibility = () => setIsDocumentHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const allSlides = useMemo(
    () => buildBannerSlides({ announcements, players, appConfig, isFeatureEnabled, today, nowMs }),
    [announcements, players, appConfig, isFeatureEnabled, today, nowMs],
  );
  const slides = useMemo(() => visibleSlides(allSlides, dismissed), [allSlides, dismissed]);
  const slideCount = slides.length;
  const safeIndex = slideCount > 0 ? Math.min(currentIndex, slideCount - 1) : 0;
  const activeSlide: BannerSlide | undefined = slides[safeIndex];

  useEffect(() => {
    if (currentIndex !== safeIndex) setCurrentIndex(safeIndex);
  }, [currentIndex, safeIndex]);

  const goTo = useCallback(
    (next: number, dir: 1 | -1) => {
      if (slideCount <= 1) return;
      setDirection(dir);
      setCurrentIndex(((next % slideCount) + slideCount) % slideCount);
    },
    [slideCount],
  );
  const handleNext = useCallback(() => goTo(safeIndex + 1, 1), [goTo, safeIndex]);
  const handlePrev = useCallback(() => goTo(safeIndex - 1, -1), [goTo, safeIndex]);

  // Auto-rotation
  const [now, setNow] = useState(() => Date.now());
  const isPaused =
    isHovered || isFocusWithin || isDocumentHidden || prefersReducedMotion === true || now < touchPausedUntil;
  useEffect(() => {
    if (slideCount <= 1 || isPaused) return;
    const t = setTimeout(handleNext, activeSlide?.durationMs || AUTO_ROTATE_MS);
    return () => clearTimeout(t);
  }, [slideCount, isPaused, handleNext, safeIndex]);
  // Re-evaluate the touch pause once it expires.
  useEffect(() => {
    if (touchPausedUntil <= Date.now()) return;
    const t = setTimeout(() => setNow(Date.now()), touchPausedUntil - Date.now() + 10);
    return () => clearTimeout(t);
  }, [touchPausedUntil]);

  const pauseForTouch = () => {
    const until = Date.now() + RESUME_AFTER_TOUCH_MS;
    setNow(Date.now());
    setTouchPausedUntil(until);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
    pauseForTouch();
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const moved = Math.abs(dx) > 10 || Math.abs(dy) > 10;
    suppressLinkClickRef.current = moved;
    if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) handleNext();
      else handlePrev();
    }
    pauseForTouch();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (slideCount <= 1) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      handleNext();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      handlePrev();
    }
  };

  const persistDismissed = (next: DismissedMap) => {
    setDismissed(next);
    try {
      window.localStorage.setItem(dismissStorageKey(currentUserId), JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode): dismissal lasts for this session only.
    }
  };

  const dismiss = (slide: BannerSlide, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!slide.dismissible) return;
    persistDismissed({ ...dismissed, [slide.dismissKey]: Date.now() });
    setLastDismissed(slide);
  };

  const undoDismiss = () => {
    if (!lastDismissed) return;
    persistDismissed(restoreDismissed(dismissed, [lastDismissed.dismissKey]));
    setLastDismissed(null);
  };

  const restoreAll = () => {
    persistDismissed(restoreDismissed(dismissed, allSlides.map((s) => s.dismissKey)));
    setLastDismissed(null);
    setCurrentIndex(0);
  };

  // The undo offer expires after a few seconds.
  useEffect(() => {
    if (!lastDismissed) return;
    const t = setTimeout(() => setLastDismissed(null), UNDO_WINDOW_MS);
    return () => clearTimeout(t);
  }, [lastDismissed]);

  const undoBar = lastDismissed ? (
    <div
      role="status"
      data-testid="banner-undo"
      className="w-full flex items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium text-text-secondary shadow-xs"
    >
      <span className="truncate">Highlight hidden</span>
      <button
        type="button"
        onClick={undoDismiss}
        className="inline-flex items-center gap-1 min-h-[36px] px-2 rounded-lg font-bold text-scarlet hover:bg-scarlet/10 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50"
      >
        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
        Undo
      </button>
    </div>
  ) : null;

  if (!activeSlide) {
    // Nothing to show at all → render nothing. Everything dismissed → offer a way back.
    if (allSlides.length === 0) return null;
    return (
      <div className="w-full flex flex-col gap-2">
        {undoBar}
        {!lastDismissed && (
          <button
            type="button"
            data-testid="banner-restore"
            onClick={restoreAll}
            className="self-start inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full border border-border bg-surface text-xs font-bold text-scarlet hover:border-scarlet/40 shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50"
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            Show club highlights ({allSlides.length})
          </button>
        )}
      </div>
    );
  }

  const isBirthday = activeSlide.kind === "birthday-today" || activeSlide.kind === "birthday-tomorrow";
  const isBirthdayToday = activeSlide.kind === "birthday-today";

  const badgeStyle = (color?: string) => {
    switch (color) {
      case "gold":
        return "bg-muted-gold/25 text-white border-muted-gold/50";
      case "wine":
        return "bg-deep-wine/30 text-white border-white/20";
      case "emerald":
        return "bg-emerald-500/20 text-emerald-100 border-emerald-500/30";
      case "scarlet":
      default:
        return "bg-scarlet/30 text-white border-white/25";
    }
  };

  const renderBadgeIcon = (slide: BannerSlide) => {
    if (slide.kind === "potw") return <Crown className="w-3.5 h-3.5 text-muted-gold" aria-hidden="true" />;
    if (slide.kind === "birthday-today") return <Cake className="w-3.5 h-3.5 text-muted-gold" aria-hidden="true" />;
    if (slide.kind === "birthday-tomorrow") return <Gift className="w-3.5 h-3.5 text-muted-gold" aria-hidden="true" />;
    if (slide.badge.includes("Store")) return <ShoppingBag className="w-3.5 h-3.5 text-muted-gold" aria-hidden="true" />;
    if (slide.badge.includes("Training")) return <Video className="w-3.5 h-3.5 text-white" aria-hidden="true" />;
    return <Sparkles className="w-3.5 h-3.5 text-muted-gold" aria-hidden="true" />;
  };

  const isPotw = activeSlide.kind === "potw" && Boolean(activeSlide.potw);
  const surfaceClass = isPotw
    ? "bg-gradient-to-br from-[#5E0718] via-[#A30F2D] to-[#B8862F]"
    : isBirthday
    ? "bg-gradient-to-br from-deep-wine via-[#8E2338] to-[#B8862F]"
    : "bg-gradient-to-br from-deep-wine via-[#8B1A2C] to-scarlet";

  return (
    <div className="w-full flex flex-col gap-2">
    {undoBar}
    <section
      data-testid="campaign-hero-banner"
      data-slide-kind={activeSlide.kind}
      aria-roledescription="carousel"
      aria-label="Club highlights"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocusCapture={() => setIsFocusWithin(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsFocusWithin(false);
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onKeyDown={onKeyDown}
      className={`relative w-full rounded-2xl overflow-hidden shadow-sm border border-border text-white touch-pan-y ${surfaceClass}`}
    >
      <div className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(#FFF6F4_1px,transparent_1px)] [background-size:16px_16px]" />
      {isBirthdayToday && !prefersReducedMotion && (
        <motion.div
          aria-hidden="true"
          className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-muted-gold/25 blur-2xl pointer-events-none"
          animate={{ opacity: [0.35, 0.6, 0.35], scale: [1, 1.08, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Whole-banner link (stretched link): sits under the content; text lets taps
          through, while dismiss / navigation controls sit above it. */}
      {activeSlide.href && (
        <a
          href={activeSlide.href}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="banner-link"
          aria-label={`Open link: ${activeSlide.title} (opens in a new tab)`}
          onClick={(e) => {
            if (suppressLinkClickRef.current) {
              e.preventDefault();
              suppressLinkClickRef.current = false;
            }
          }}
          className="absolute inset-0 z-[5] rounded-2xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80"
        />
      )}

      <div
        className={`relative z-10 p-4 sm:p-5 flex flex-col gap-2 min-h-[176px] sm:min-h-[196px] ${
          activeSlide.href ? "pointer-events-none" : ""
        }`}
      >
        {/* Top row: badge · indicator · dismiss */}
        <div className="flex items-center justify-between gap-2">
          <div
            className={`inline-flex min-w-0 items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${badgeStyle(
              activeSlide.badgeColor,
            )}`}
          >
            {renderBadgeIcon(activeSlide)}
            <span className="truncate">{activeSlide.badge}</span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {slideCount > 1 && (
              <span
                data-testid="banner-slide-indicator"
                className="whitespace-nowrap tabular-nums text-[11px] font-bold px-2 py-0.5 rounded-full bg-black/20 text-white/90 select-none"
                aria-hidden="true"
              >
                {safeIndex + 1}/{slideCount}
              </span>
            )}
            {activeSlide.dismissible && (
              <button
                type="button"
                data-testid="banner-dismiss"
                style={{ pointerEvents: "auto" }}
                onClick={(e) => dismiss(activeSlide, e)}
                aria-label={`Dismiss: ${activeSlide.title}`}
                className="w-9 h-9 -mr-1.5 flex items-center justify-center rounded-full text-white/85 hover:text-white hover:bg-black/25 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Slide content */}
        <div
          className="relative flex-1"
          aria-live={isPaused || slideCount <= 1 ? "polite" : "off"}
          role="group"
          aria-roledescription="slide"
          aria-label={`${safeIndex + 1} of ${slideCount}`}
        >
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={activeSlide.id}
              custom={direction}
              initial={prefersReducedMotion ? false : { opacity: 0, x: direction * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: direction * -24 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.28, ease: "easeOut" }}
              data-testid={`banner-slide-${activeSlide.id}`}
            >
              {isPotw && activeSlide.potw ? (
                <PotwSlideBody potw={activeSlide.potw} />
              ) : (
              <>
              {activeSlide.subtitle && (
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-gold mb-0.5 truncate">
                  {activeSlide.subtitle}
                </p>
              )}
              <h2 className="text-lg sm:text-2xl font-black font-heading tracking-tight leading-snug max-w-xl text-white break-words line-clamp-2">
                {activeSlide.title}
              </h2>
              <p className="text-xs sm:text-sm text-white/85 font-medium mt-1 max-w-lg line-clamp-2">
                {activeSlide.description}
              </p>
              </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Bottom row: CTA · navigation */}
        <div className="flex items-center justify-between gap-2 min-h-[44px]">
          {activeSlide.href ? (
            <span
              data-testid="banner-link-hint"
              aria-hidden="true"
              className="min-h-[36px] px-3 py-1.5 rounded-xl border border-white/40 bg-white/10 text-xs font-black uppercase tracking-wider text-white inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              Open link
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </span>
          ) : activeSlide.ctaText && activeSlide.ctaDestination ? (
            <button
              type="button"
              data-testid="hero-campaign-cta"
              onClick={() => onNavigate(activeSlide.ctaDestination as string, activeSlide.targetId)}
              className="min-h-[44px] px-4 py-2 bg-warm-white text-deep-wine hover:bg-white rounded-xl text-xs font-black uppercase tracking-wider transition shadow-sm flex items-center gap-2 cursor-pointer group active:scale-98 whitespace-nowrap"
            >
              <span>{activeSlide.ctaText}</span>
              <ArrowRight className="w-3.5 h-3.5 text-scarlet transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </button>
          ) : (
            <span />
          )}

          {slideCount > 1 && (
            <div className="flex items-center gap-1" style={{ pointerEvents: "auto" }}>
              <button
                type="button"
                onClick={handlePrev}
                aria-label="Previous highlight"
                className="hidden sm:flex w-9 h-9 items-center justify-center rounded-full bg-black/20 hover:bg-black/35 text-white/90 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <div className="flex items-center" role="group" aria-label="Choose highlight">
                {slides.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => goTo(idx, idx >= safeIndex ? 1 : -1)}
                    aria-label={`Show highlight ${idx + 1} of ${slideCount}`}
                    aria-current={idx === safeIndex ? "true" : undefined}
                    className="group/dot p-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded-full"
                  >
                    <span
                      className={`block h-2 rounded-full transition-all ${
                        idx === safeIndex ? "w-5 bg-muted-gold" : "w-2 bg-white/45 group-hover/dot:bg-white/70"
                      }`}
                    />
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleNext}
                aria-label="Next highlight"
                className="hidden sm:flex w-9 h-9 items-center justify-center rounded-full bg-black/20 hover:bg-black/35 text-white/90 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
    </div>
  );
}

/** Player of the Weekend slide body: photo (or initials) in a gold ring, crown, name, message. */
export function PotwSlideBody({ potw }: { potw: NonNullable<BannerSlide["potw"]> }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const initials = potw.playerName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <div className="flex items-center gap-3 sm:gap-4" data-testid="banner-potw">
      <div className="relative shrink-0">
        <Crown className="absolute -top-3.5 left-1/2 -translate-x-1/2 w-6 h-6 text-muted-gold drop-shadow" fill="currentColor" aria-hidden="true" />
        <div className="w-[72px] h-[72px] sm:w-[84px] sm:h-[84px] rounded-full p-[3px] bg-gradient-to-br from-[#F5D77A] via-[#D6A52B] to-[#A87C14] shadow-lg">
          {potw.photoURL && !photoFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={potw.photoURL}
              alt={potw.playerName}
              referrerPolicy="no-referrer"
              onError={() => setPhotoFailed(true)}
              className="w-full h-full rounded-full object-cover bg-deep-wine"
              data-testid="banner-potw-photo"
            />
          ) : (
            <div className="w-full h-full rounded-full bg-deep-wine flex items-center justify-center text-xl font-black text-muted-gold" data-testid="banner-potw-initials">
              {initials || "★"}
            </div>
          )}
        </div>
        <div className="absolute -bottom-1.5 -right-1.5">
          <PlayerOfWeekendBadgeSvg size={30} />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-gold truncate">
          Player of the Weekend{potw.weekendLabel ? ` · ${potw.weekendLabel}` : ""}
        </p>
        <h2 className="text-xl sm:text-2xl font-black font-heading tracking-tight leading-snug text-white break-words line-clamp-2" data-testid="banner-potw-name">
          {potw.playerName}
        </h2>
        {potw.message && (
          <p className="text-xs sm:text-sm text-white/90 font-medium mt-0.5 whitespace-pre-line line-clamp-4" data-testid="banner-potw-message">
            {potw.message}
          </p>
        )}
      </div>
    </div>
  );
}
