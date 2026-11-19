"use client";

import { useState, useRef, useCallback } from "react";
import {
  Home as HomeIcon,
  Wallet,
  Users,
  CalendarDays,
  MoreHorizontal,
} from "lucide-react";
import type { AppConfig } from "@/lib/types";
import { MoreDrawer, Tab, AdminPermissions } from "./MoreDrawer";

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
  adminPermissions,
}: {
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
  isFeatureEnabled: (key: Feature) => boolean;
  persona: "admin" | "player";
  hasMissingMandatory: boolean;
  canDesign?: boolean;
  currentPlayerId?: string;
  adminPermissions?: AdminPermissions;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const handleCloseMore = useCallback(() => setMoreOpen(false), []);
  const adminMoreBtnRef = useRef<HTMLButtonElement>(null);
  const playerMoreBtnRef = useRef<HTMLButtonElement>(null);

  if (hasMissingMandatory) return null;

  const btnCls = (isActive: boolean) =>
    `flex-1 min-h-[48px] py-1.5 flex flex-col items-center justify-center gap-0.5 cursor-pointer transition select-none ${
      isActive
        ? "text-accent font-extrabold"
        : "text-text-muted hover:text-text-primary"
    }`;
  const labelCls =
    "text-[8px] xs:text-[9px] font-bold uppercase tracking-wider truncate max-w-full px-0.5 text-center leading-tight";

  if (persona === "admin") {
    const isMoreActive = ADMIN_OVERFLOW_TABS.includes(activeTab);

    return (
      <>
        <MoreDrawer
          open={moreOpen}
          onClose={handleCloseMore}
          onSelectTab={onSelectTab}
          activeTab={activeTab}
          isFeatureEnabled={isFeatureEnabled}
          canDesign={canDesign ?? false}
          persona="admin"
          adminPermissions={adminPermissions}
          triggerRef={adminMoreBtnRef}
        />
        <nav
          data-testid="admin-mobile-bottom-nav"
          aria-label="Admin primary mobile navigation"
          className="fixed bottom-0 left-0 right-0 w-full bg-surface/95 backdrop-blur-2xl !border-b-0 !border-x-0 !rounded-none md:hidden pb-safe z-30 flex items-center shadow-lg justify-around border-t border-border px-1"
        >
          <button
            onClick={() => onSelectTab("home")}
            className={btnCls(activeTab === "home")}
            title="Overview"
            aria-label="Overview"
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
            <span className={labelCls}>Match Centre</span>
          </button>
          <button
            onClick={() => onSelectTab("club")}
            className={btnCls(activeTab === "club" || activeTab === "players")}
            title="Player Roster"
            aria-label="Player Roster"
          >
            <Users className="w-5 h-5" />
            <span className={labelCls}>Player Roster</span>
          </button>
          <button
            onClick={() => onSelectTab("finance")}
            className={btnCls(activeTab === "finance" || activeTab === "dues_and_reminders")}
            title="Finance & Dues"
            aria-label="Finance & Dues"
          >
            <Wallet className="w-5 h-5" />
            <span className={labelCls}>Finance & Dues</span>
          </button>
          <button
            ref={adminMoreBtnRef}
            onClick={() => setMoreOpen(true)}
            className={btnCls(isMoreActive)}
            title="More"
            aria-label="More"
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
        onClose={handleCloseMore}
        onSelectTab={onSelectTab}
        activeTab={activeTab}
        isFeatureEnabled={isFeatureEnabled}
        canDesign={canDesign ?? false}
        persona="player"
        adminPermissions={adminPermissions}
        triggerRef={playerMoreBtnRef}
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
          ref={playerMoreBtnRef}
          onClick={() => setMoreOpen(true)}
          className={btnCls(isPlayerMoreActive)}
          title="More"
          aria-label="More"
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className={labelCls}>More</span>
        </button>
      </nav>
    </>
  );
}
