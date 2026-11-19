"use client";

import { useState } from "react";
import {
  Home as HomeIcon,
  Wallet,
  Users,
  CalendarDays,
  MoreHorizontal,
} from "lucide-react";
import type { AppConfig } from "@/lib/types";
import { MoreDrawer, Tab } from "./MoreDrawer";

type Feature = keyof NonNullable<AppConfig["features"]>;

const PLAYER_OVERFLOW_TABS: Tab[] = [
  "leaderboard",
  "studio",
  "shop",
  "opinion",
  "design",
  "club",
  "notifications",
];

const ADMIN_OVERFLOW_TABS: Tab[] = [
  "settings",
  "studio",
  "design",
  "shop",
  "leaderboard",
  "opinion",
  "grounds",
  "notifications",
];

export function MobileBottomNav({
  activeTab,
  onSelectTab,
  isFeatureEnabled,
  persona,
  hasMissingMandatory,
  canDesign,
  currentPlayerId,
}: {
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
  isFeatureEnabled: (key: Feature) => boolean;
  persona: "admin" | "player";
  hasMissingMandatory: boolean;
  canDesign?: boolean;
  currentPlayerId?: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  if (hasMissingMandatory) return null;

  const btnCls = (isActive: boolean) =>
    `flex-1 min-h-[48px] py-1.5 flex flex-col items-center justify-center gap-0.5 cursor-pointer transition select-none ${
      isActive
        ? "text-accent font-extrabold"
        : "text-text-muted hover:text-text-primary"
    }`;
  const labelCls = "text-[9px] font-bold uppercase tracking-wider";

  if (persona === "admin") {
    const isMoreActive = ADMIN_OVERFLOW_TABS.includes(activeTab);

    return (
      <>
        <MoreDrawer
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          onSelectTab={onSelectTab}
          activeTab={activeTab}
          isFeatureEnabled={isFeatureEnabled}
          canDesign={canDesign ?? false}
          persona="admin"
        />
        <nav
          data-testid="admin-mobile-bottom-nav"
          aria-label="Admin primary mobile navigation"
          className="fixed bottom-0 left-0 right-0 w-full bg-surface/95 backdrop-blur-2xl !border-b-0 !border-x-0 !rounded-none md:hidden pb-safe z-30 flex items-center shadow-lg justify-around border-t border-border px-1"
        >
          <button
            onClick={() => onSelectTab("home")}
            className={btnCls(activeTab === "home")}
            title="Dashboard Overview"
            aria-label="Dashboard Overview"
          >
            <HomeIcon className="w-5 h-5" />
            <span className={labelCls}>Overview</span>
          </button>
          <button
            onClick={() => onSelectTab("matches")}
            className={btnCls(activeTab === "matches")}
            title="Match Centre"
            aria-label="Match Centre"
          >
            <CalendarDays className="w-5 h-5" />
            <span className={labelCls}>Matches</span>
          </button>
          <button
            onClick={() => onSelectTab("finance")}
            className={btnCls(activeTab === "finance" || activeTab === "dues_and_reminders")}
            title="Finance & Dues"
            aria-label="Finance & Dues"
          >
            <Wallet className="w-5 h-5" />
            <span className={labelCls}>Finance</span>
          </button>
          <button
            onClick={() => onSelectTab("club")}
            className={btnCls(activeTab === "club" || activeTab === "players")}
            title="Club & Roster"
            aria-label="Club & Roster"
          >
            <Users className="w-5 h-5" />
            <span className={labelCls}>Club</span>
          </button>
          <button
            onClick={() => setMoreOpen(true)}
            className={btnCls(isMoreActive)}
            title="More Admin Hubs"
            aria-label="More Admin Hubs"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className={labelCls}>More</span>
          </button>
        </nav>
      </>
    );
  }

  // Approved Player Primary Navigation: Home | Matches | Finance | Players | More
  const isPlayerMoreActive = PLAYER_OVERFLOW_TABS.includes(activeTab);

  return (
    <>
      <MoreDrawer
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onSelectTab={onSelectTab}
        activeTab={activeTab}
        isFeatureEnabled={isFeatureEnabled}
        canDesign={canDesign ?? false}
        persona="player"
      />
      <nav
        data-testid="player-mobile-bottom-nav"
        aria-label="Player primary mobile navigation"
        className="fixed bottom-0 left-0 right-0 w-full bg-surface/95 backdrop-blur-2xl !border-b-0 !border-x-0 !rounded-none md:hidden pb-safe z-30 flex items-center shadow-lg justify-around border-t border-border px-1"
      >
        <button
          onClick={() => onSelectTab("home")}
          className={btnCls(activeTab === "home")}
          title="Home"
          aria-label="Home"
        >
          <HomeIcon className="w-5 h-5" />
          <span className={labelCls}>Home</span>
        </button>
        <button
          onClick={() => onSelectTab("matches")}
          className={btnCls(activeTab === "matches")}
          title="Matches"
          aria-label="Matches"
        >
          <CalendarDays className="w-5 h-5" />
          <span className={labelCls}>Matches</span>
        </button>
        <button
          onClick={() => onSelectTab("finance")}
          className={btnCls(activeTab === "finance" || activeTab === "dues_and_reminders")}
          title="Finance & Payments"
          aria-label="Finance"
        >
          <Wallet className="w-5 h-5" />
          <span className={labelCls}>Finance</span>
        </button>
        <button
          onClick={() => onSelectTab("players")}
          className={btnCls(activeTab === "players")}
          title="Player Directory & Roster"
          aria-label="Players"
        >
          <Users className="w-5 h-5" />
          <span className={labelCls}>Players</span>
        </button>
        <button
          onClick={() => setMoreOpen(true)}
          className={btnCls(isPlayerMoreActive)}
          title="More Features"
          aria-label="More Features"
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className={labelCls}>More</span>
        </button>
      </nav>
    </>
  );
}
