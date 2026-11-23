"use client";

import { useRef } from "react";
import {
  Home as HomeIcon,
  Wallet,
  Users,
  CalendarDays,
  User as UserIcon,
  Image as ImageIcon,
  Settings as SettingsIcon,
} from "lucide-react";
import type { AppConfig } from "@/lib/types";
import type { Tab } from "./navTypes";
import { getPlayerPrimaryNav, getPlayerNavParent, type PlayerPrimaryTab } from "@/lib/player-navigation";
import {
  getAdminPrimaryNav,
  getAdminNavParent,
  type AdminCapabilities,
  type AdminDestination,
} from "@/lib/admin-navigation";

export type { Tab } from "./navTypes";

type Feature = keyof NonNullable<AppConfig["features"]>;

const PLAYER_NAV_ICONS: Record<PlayerPrimaryTab, typeof HomeIcon> = {
  home: HomeIcon,
  profile: UserIcon,
  matches: CalendarDays,
};

export const ADMIN_NAV_ICONS: Record<AdminDestination, typeof HomeIcon> = {
  home: HomeIcon,
  matches: CalendarDays,
  club: Users,
  finance: Wallet,
  design: ImageIcon,
  settings: SettingsIcon,
};

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
  adminPermissions?: Partial<AdminCapabilities>;
}) {

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
    // Admin Primary Navigation (D-18): Home | Match Center | Club | Finance |
    // Design Studio | Settings, filtered by the existing permission model — the
    // same config and order as the desktop sidebar. No More drawer: club
    // features live in Club's own section bar.
    const caps: AdminCapabilities = {
      isSuperAdmin: !!adminPermissions?.isSuperAdmin,
      isClubAdmin: !!adminPermissions?.isClubAdmin,
      isMatchAdmin: !!adminPermissions?.isMatchAdmin,
      isFinanceAdmin: !!adminPermissions?.isFinanceAdmin,
      isStudioAdmin: !!adminPermissions?.isStudioAdmin,
      canDesign: !!(adminPermissions?.canDesign ?? canDesign),
    };
    const adminParent = getAdminNavParent(activeTab);
    const adminItems = getAdminPrimaryNav(caps, (f) => isFeatureEnabled(f as Feature));

    return (
      <nav
        data-testid="admin-mobile-bottom-nav"
        data-render-count={process.env.NODE_ENV !== "production" ? renderCountRef.current : undefined}
        aria-label="Admin primary mobile navigation"
        className="fixed bottom-0 left-0 right-0 w-full bg-surface/95 backdrop-blur-2xl !border-b-0 !border-x-0 !rounded-none md:hidden pb-safe z-30 flex items-center shadow-lg justify-around border-t border-border px-1"
      >
        {adminItems.map(({ tab, label, shortLabel }) => {
          const Icon = ADMIN_NAV_ICONS[tab];
          const isActive = adminParent === tab;
          return (
            <button
              key={tab}
              data-testid={`admin-nav-${tab}`}
              onClick={() => onSelectTab(tab)}
              className={btnCls(isActive)}
              title={label}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="w-5 h-5" />
              <span className={labelCls}>{shortLabel}</span>
            </button>
          );
        })}
      </nav>
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
