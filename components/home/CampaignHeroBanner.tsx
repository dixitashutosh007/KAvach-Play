"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Trophy,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Sparkles,
  ShoppingBag,
  Video,
  CalendarDays,
  Flame,
} from "lucide-react";
import { CampaignSlide } from "./types";
import { Tournament, Post, AppConfig } from "@/lib/types";

export function CampaignHeroBanner({
  tournaments = [],
  announcements = [],
  appConfig,
  isFeatureEnabled,
  onNavigate,
}: {
  tournaments?: Tournament[];
  announcements?: Post[];
  appConfig?: AppConfig | null;
  isFeatureEnabled: (key: any) => boolean;
  onNavigate: (tab: string, targetId?: string) => void;
}) {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Generate dynamic, real-data-backed campaign slides
  const slides = useMemo<CampaignSlide[]>(() => {
    const list: CampaignSlide[] = [];

    // 1. Tournaments Campaigns (if available from store)
    const activeTournaments = tournaments.filter(
      (t) => t.status === "Ongoing" || t.status === "Upcoming" || !t.status
    );
    activeTournaments.slice(0, 2).forEach((t) => {
      list.push({
        id: `tournament-${t.id}`,
        title: t.name || "KAvach Club Tournament",
        subtitle: t.format ? `${t.format} Format • ${t.jerseyColor || "Match Kit"}` : "Official Club Championship",
        description: t.notes || "Compete with top players across teams and track stats live on the leaderboard.",
        badge: t.status === "Ongoing" ? "Live Tournament" : "Upcoming Championship",
        badgeColor: "gold",
        ctaText: "View Fixtures",
        ctaDestination: "matches",
        targetId: t.id,
      });
    });

    // 2. High-priority Pinned Announcement / Club Campaign
    const pinnedPosts = announcements.filter((p) => (p as any).isPinned || (p as any).isAnnouncement);
    if (pinnedPosts.length > 0) {
      const topPinned = pinnedPosts[0];
      list.push({
        id: `post-${topPinned.id}`,
        title: (topPinned as any).title || "Club Special Announcement",
        subtitle: `By ${topPinned.authorName || "Club Management"}`,
        description: topPinned.text.slice(0, 110) + (topPinned.text.length > 110 ? "..." : ""),
        badge: "Club Notice",
        badgeColor: "scarlet",
        imageUrl: (topPinned as any).mediaUrl || topPinned.imageUrl,
        ctaText: (topPinned as any).matchId ? "View Match" : "Read Notice",
        ctaDestination: (topPinned as any).matchId ? "matches" : "announcements",
        targetId: (topPinned as any).matchId || topPinned.id,
      });
    }

    // 3. Studio & Nets Practice Campaign (if studio feature enabled)
    if (isFeatureEnabled("studio")) {
      list.push({
        id: "campaign-studio",
        title: "KAvach Studio & Nets Practice",
        subtitle: "Bowling Machines & Professional Turf Nets",
        description: "Book high-intensity batting and bowling sessions with advanced video analysis.",
        badge: "Training Facility",
        badgeColor: "wine",
        ctaText: "Book Nets Slot",
        ctaDestination: "studio",
      });
    }

    // 4. Club Merchandise Campaign (if shop feature enabled)
    if (isFeatureEnabled("shop")) {
      list.push({
        id: "campaign-shop",
        title: "Official Scarlet Match Kit 2026",
        subtitle: "Personalised Jersey & Training Caps",
        description: "Customise your matchday kit with your official jersey number and name.",
        badge: "Club Store",
        badgeColor: "gold",
        ctaText: "Visit Club Shop",
        ctaDestination: "shop",
      });
    }

    // Fallback: If no custom campaigns generated, provide core club campaign
    if (list.length === 0) {
      list.push({
        id: "campaign-general",
        title: `${appConfig?.clubName || "KAvach Cricket Club"} 2026 Season`,
        subtitle: "Weekend League & Friendly Match Schedule",
        description: "Confirm your availability for upcoming fixtures, stay in good standing, and follow club results.",
        badge: "Active Season",
        badgeColor: "scarlet",
        ctaText: "Explore Matches",
        ctaDestination: "matches",
      });
    }

    return list;
  }, [tournaments, announcements, appConfig, isFeatureEnabled]);

  // Safe index bounds
  const activeSlide = slides[currentSlideIndex] || slides[0];

  // Auto-rotation timer (5.5 seconds) - pauses on hover/focus
  useEffect(() => {
    if (isPaused || slides.length <= 1) return;

    timerRef.current = setInterval(() => {
      setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
    }, 5500);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, slides.length]);

  const handlePrev = () => {
    setCurrentSlideIndex((prev) => (prev === 0 ? slides.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
  };

  const badgeStyle = (color?: string) => {
    switch (color) {
      case "gold":
        return "bg-muted-gold/20 text-muted-gold border-muted-gold/30";
      case "wine":
        return "bg-deep-wine/25 text-white border-white/20";
      case "emerald":
        return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
      case "scarlet":
      default:
        return "bg-scarlet/25 text-white border-scarlet/40";
    }
  };

  const renderIconForSlide = (badge: string) => {
    if (badge.includes("Tournament") || badge.includes("Championship")) {
      return <Trophy className="w-4 h-4 text-muted-gold" />;
    }
    if (badge.includes("Store") || badge.includes("Shop")) {
      return <ShoppingBag className="w-4 h-4 text-muted-gold" />;
    }
    if (badge.includes("Training") || badge.includes("Studio")) {
      return <Video className="w-4 h-4 text-white" />;
    }
    return <Sparkles className="w-4 h-4 text-muted-gold" />;
  };

  return (
    <section
      data-testid="campaign-hero-banner"
      aria-roledescription="carousel"
      aria-label="Club Campaign Highlights"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={() => setIsPaused(true)}
      onTouchEnd={() => setIsPaused(false)}
      className="relative w-full rounded-2xl overflow-hidden shadow-sm border border-border bg-gradient-to-br from-deep-wine via-[#8B1A2C] to-scarlet text-white"
    >
      {/* Decorative background pattern */}
      <div className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(#FFF6F4_1px,transparent_1px)] [background-size:16px_16px]" />

      <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-between min-h-[190px] sm:min-h-[210px]">
        {/* Top meta row */}
        <div className="flex items-center justify-between gap-2">
          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border backdrop-blur-md ${badgeStyle(
              activeSlide.badgeColor
            )}`}
          >
            {renderIconForSlide(activeSlide.badge)}
            <span>{activeSlide.badge}</span>
          </div>

          {/* Slide Indicator & Controls */}
          {slides.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrev}
                aria-label="Previous slide"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-black/20 hover:bg-black/40 text-white/90 transition cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[10px] font-mono font-bold px-1 text-white/80 select-none">
                {currentSlideIndex + 1} / {slides.length}
              </span>
              <button
                type="button"
                onClick={handleNext}
                aria-label="Next slide"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-black/20 hover:bg-black/40 text-white/90 transition cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="my-2.5">
          {activeSlide.subtitle && (
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-gold mb-0.5">
              {activeSlide.subtitle}
            </p>
          )}
          <h2 className="text-lg sm:text-2xl font-black font-heading tracking-tight leading-snug max-w-xl text-white">
            {activeSlide.title}
          </h2>
          <p className="text-xs sm:text-sm text-white/85 font-medium mt-1 max-w-lg line-clamp-2">
            {activeSlide.description}
          </p>
        </div>

        {/* Bottom CTA Row */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            data-testid="hero-campaign-cta"
            onClick={() => onNavigate(activeSlide.ctaDestination, activeSlide.targetId)}
            className="min-h-[44px] px-4 py-2 bg-warm-white text-deep-wine hover:bg-white rounded-xl text-xs font-black uppercase tracking-wider transition shadow-sm flex items-center gap-2 cursor-pointer group active:scale-98"
          >
            <span>{activeSlide.ctaText}</span>
            <ArrowRight className="w-3.5 h-3.5 text-scarlet transition-transform group-hover:translate-x-1" />
          </button>

          {/* Dot Indicators */}
          {slides.length > 1 && (
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {slides.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCurrentSlideIndex(idx)}
                  aria-label={`Go to slide ${idx + 1}`}
                  className={`h-2 rounded-full transition-all cursor-pointer ${
                    idx === currentSlideIndex
                      ? "w-6 bg-muted-gold shadow-xs"
                      : "w-2 bg-white/40 hover:bg-white/60"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
