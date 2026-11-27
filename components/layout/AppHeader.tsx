"use client";

import Image from "next/image";
import { Shield, Bell, LogOut, Search, User as UserIcon } from "lucide-react";

import type { Tab } from "./navTypes";
export type { Tab } from "./navTypes";

const TAB_TITLES: Record<string, string> = {
  home: "Home",
  matches: "Matches",
  finance: "Finance",
  players: "Players",
  leaderboard: "Performance",
  studio: "Studio",
  shop: "Shop",
  opinion: "Pulse",
  design: "Design Studio",
  profile: "My Profile",
  club: "Club",
  settings: "Settings",
  grounds: "Grounds & Venues",
  notifications: "Notifications",
  badges: "Player Badges",
  pulse: "Pulse",
  announcements: "Announcements",
};

interface AppHeaderProps {
  clubName?: string;
  logoUrl?: string | null;
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
  user?: {
    uid: string;
    photoURL?: string | null;
    displayName?: string | null;
    email?: string | null;
  } | null;
  appUser?: {
    name?: string;
    photoURL?: string | null;
  } | null;
  isAdmin: boolean;
  persona: "admin" | "player";
  onTogglePersona?: () => void;
  unreadCount?: number;
  /** Pending weekend-operations tasks for this admin (shown on the persona toggle). */
  adminPendingCount?: number;
  onOpenSearch?: () => void;
  onSignOut?: () => void;
}

export function AppHeader({
  clubName = "KAvach Cricket Club",
  logoUrl,
  activeTab,
  onSelectTab,
  user,
  appUser,
  isAdmin,
  persona,
  onTogglePersona,
  unreadCount = 0,
  adminPendingCount = 0,
  onOpenSearch,
  onSignOut,
}: AppHeaderProps) {
  const activeTabTitle = TAB_TITLES[activeTab] || "";
  const photoUrl = user?.photoURL || appUser?.photoURL || "";
  const displayName = appUser?.name || user?.displayName || user?.email || "Player";
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join("") || "P";

  return (
    <header
      data-testid="app-header"
      className="bg-surface/95 backdrop-blur-xl border-b border-border fixed top-0 w-full z-40 p-2 sm:p-3 sm:px-6 flex items-center shadow-xs transition-all pt-safe"
    >
      <div className="max-w-7xl xl:max-w-[1440px] mx-auto w-full px-1 sm:px-2 md:px-4 flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand Identity & Contextual Page Title */}
        <button
          onClick={() => onSelectTab("home")}
          className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 text-left cursor-pointer group"
          title="Return to Home"
        >
          {logoUrl ? (
            <Image
              src={logoUrl}
              width={40}
              height={40}
              alt="Logo"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover border border-border shrink-0 shadow-xs group-hover:opacity-80 transition"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0 group-hover:bg-brand/20 transition">
              <Shield className="w-5 h-5 text-brand" />
            </div>
          )}
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <h1 className="font-heading font-black text-sm sm:text-lg md:text-xl tracking-tight text-brand truncate leading-tight uppercase group-hover:opacity-80 transition">
              {clubName}
            </h1>
            {activeTabTitle && (
              <span className="hidden sm:inline-flex items-center text-[10px] sm:text-xs font-bold uppercase tracking-wider text-text-secondary bg-surface-hover/80 px-2 py-0.5 rounded-md border border-border">
                {activeTabTitle}
              </span>
            )}
          </div>
        </button>

        {/* Action Controls & Navigation Affordances */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Admin / Player Persona Segmented Switch (Admin members only) */}
          {isAdmin && onTogglePersona && (
            <div
              role="group"
              aria-label="Switch persona"
              data-testid="header-persona-toggle"
              className="inline-flex items-center p-0.5 rounded-full bg-[#F6F7F9] border border-[#E5E7EB] shadow-inner shrink-0"
            >
              <button
                type="button"
                onClick={() => {
                  if (persona !== "player") onTogglePersona();
                }}
                aria-pressed={persona === "player"}
                aria-label="Switch to Player view"
                data-testid="header-persona-player"
                className={`min-h-[38px] px-2.5 sm:px-3 py-1 rounded-full text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap ${
                  persona === "player"
                    ? "bg-white text-[#171C26] shadow-xs ring-1 ring-[#E5E7EB]/80"
                    : "text-[#667085] hover:text-[#171C26]"
                }`}
              >
                <UserIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Player</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (persona !== "admin") onTogglePersona();
                }}
                aria-pressed={persona === "admin"}
                aria-label="Switch to Admin console"
                data-testid="header-persona-admin"
                className={`min-h-[38px] px-2.5 sm:px-3 py-1 rounded-full text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap ${
                  persona === "admin"
                    ? "bg-[#A30F2D] text-white shadow-xs"
                    : "text-[#667085] hover:text-[#171C26]"
                }`}
              >
                <Shield className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Admin</span>
                {persona !== "admin" && adminPendingCount > 0 && (
                  <span
                    data-testid="header-persona-pending"
                    aria-label={`${adminPendingCount} admin task${adminPendingCount > 1 ? "s" : ""} pending`}
                    className="ml-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#D51F43] text-white text-[9px] font-black leading-[16px] text-center tabular-nums"
                  >
                    {adminPendingCount > 9 ? "9+" : adminPendingCount}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Global Search Affordance (Player & Admin personas) */}
          {onOpenSearch && (
            <button
              type="button"
              onClick={onOpenSearch}
              data-testid="header-search-btn"
              className="min-h-[44px] min-w-[44px] rounded-full transition flex items-center justify-center shrink-0 cursor-pointer text-text-secondary hover:text-text-primary hover:bg-surface-hover"
              title="Search"
              aria-label="Open global search"
            >
              <Search className="w-5 h-5" />
            </button>
          )}

          {/* Notifications Affordance */}
          <button
            onClick={() => onSelectTab("notifications")}
            data-testid="header-notifications-btn"
            className={`relative min-h-[44px] min-w-[44px] rounded-full transition flex items-center justify-center shrink-0 cursor-pointer ${
              activeTab === "notifications"
                ? "bg-brand/10 text-brand"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
            title="Notifications"
            aria-label="View notifications"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-surface animate-pulse" />
            )}
          </button>

          {/* Primary Profile Entry Point (Avatar) */}
          <button
            onClick={() => onSelectTab("profile")}
            data-testid="header-profile-avatar"
            className={`min-h-[44px] min-w-[44px] rounded-full ring-2 transition flex items-center justify-center shrink-0 cursor-pointer ${
              activeTab === "profile"
                ? "ring-brand bg-brand/10 shadow-sm"
                : "ring-transparent hover:ring-brand/30 hover:bg-surface-hover"
            }`}
            title={`My Profile (${displayName})`}
            aria-label="Open My Profile"
          >
            {photoUrl ? (
              <Image
                src={photoUrl}
                width={32}
                height={32}
                alt={displayName}
                className="w-8 h-8 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center text-xs font-black text-brand uppercase">
                {initials || <UserIcon className="w-4 h-4 text-brand" />}
              </div>
            )}
          </button>

          {/* Sign Out (Desktop / Tablet) */}
          {onSignOut && (
            <button
              onClick={onSignOut}
              className="min-h-[44px] text-[9px] sm:text-[10px] font-bold uppercase tracking-widest border border-border text-text-secondary px-2 sm:px-2.5 py-1.5 rounded-lg hover:bg-surface-hover hover:text-text-primary transition hidden sm:flex items-center justify-center gap-1 shrink-0 cursor-pointer"
              title="Sign Out"
              aria-label="Sign out of application"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Exit</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
