"use client";

import { useState, useRef, useCallback } from "react";
import {
  Home as HomeIcon,
  Wallet,
  Users,
  CalendarDays,
  MoreHorizontal,
  User as UserIcon,
} from "lucide-react";
import type { AppConfig } from "@/lib/types";
import { MoreDrawer, Tab, AdminPermissions } from "./MoreDrawer";
import { getPlayerPrimaryNav, getPlayerNavParent, type PlayerPrimaryTab } from "@/lib/player-navigation";

type Feature = keyof NonNullable<AppConfig["features"]>;

const PLAYER_NAV_ICONS: Record<PlayerPrimaryTab, typeof HomeIcon> = {
  home: HomeIcon,
  profile: UserIcon,
  matches: CalendarDays,
};

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

  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    (window as any).__KAVACH_BOTTOM_NAV_RENDER_COUNT__ = renderCountRef.current;
  }

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
          adminPermissions={adminPermissions}
          triggerRef={adminMoreBtnRef}
        />
        <nav
          data-testid="admin-mobile-bottom-nav"
          data-render-count={process.env.NODE_ENV !== "production" ? renderCountRef.current : undefined}
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

  // Player Primary Navigation (D-16): exactly Home | Profile | Matches, the same
  // order as the desktop sidebar. No More drawer — secondary screens are reached
  // from Home / Profile and highlight their parent here.
  const activeParent = getPlayerNavParent(activeTab);
  const playerItems = getPlayerPrimaryNav((f) => isFeatureEnabled(f as Feature));

  return (
    <nav
      data-testid="player-mobile-bottom-nav"
      data-render-count={process.env.NODE_ENV !== "production" ? renderCountRef.current : undefined}
      aria-label="Player primary mobile navigation"
      className="fixed bottom-0 left-0 right-0 w-full bg-surface/95 backdrop-blur-2xl !border-b-0 !border-x-0 !rounded-none md:hidden pb-safe z-30 flex items-center shadow-lg justify-around border-t border-border px-1"
    >
      {playerItems.map(({ tab, label }) => {
        const Icon = PLAYER_NAV_ICONS[tab];
        const isActive = activeParent === tab;
        return (
          <button
            key={tab}
            data-testid={`player-nav-${tab}`}
            onClick={() => onSelectTab(tab)}
            className={btnCls(isActive)}
            title={label}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon className="w-5 h-5" />
            <span className={labelCls}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
