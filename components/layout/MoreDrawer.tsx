"use client";

import { useEffect, useRef } from "react";
import {
  Trophy,
  Video,
  ShoppingBag,
  Image as ImageIcon,
  Settings as SettingsIcon,
  X,
  PieChart,
  Users,
  User as UserIcon,
  MapPin,
  Bell,
} from "lucide-react";
import type { AppConfig } from "@/lib/types";

export type Tab =
  | "home"
  | "matches"
  | "grounds"
  | "players"
  | "leaderboard"
  | "profile"
  | "settings"
  | "studio"
  | "notifications"
  | "finance"
  | "dues_and_reminders"
  | "shop"
  | "opinion"
  | "design"
  | "club";

type Feature = keyof NonNullable<AppConfig["features"]>;

export interface AdminPermissions {
  isSuperAdmin?: boolean;
  isClubAdmin?: boolean;
  isMatchAdmin?: boolean;
  isFinanceAdmin?: boolean;
  isStudioAdmin?: boolean;
  canDesign?: boolean;
}

interface MoreDrawerItem {
  tab: Tab;
  label: string;
  icon: any;
  feature?: Feature;
  requireDesign?: boolean;
  requireSuperAdmin?: boolean;
  requireStudioAdmin?: boolean;
  requireMatchAdmin?: boolean;
}

const PLAYER_MORE_ITEMS: MoreDrawerItem[] = [
  { tab: "leaderboard", label: "Performance & Stats", icon: Trophy, feature: "leaderboard" },
  { tab: "studio", label: "Studio", icon: Video, feature: "studio" },
  { tab: "shop", label: "Club Merchandise", icon: ShoppingBag, feature: "shop" },
  { tab: "opinion", label: "Polls & Pulse", icon: PieChart, feature: "opinion" },
  { tab: "design", label: "Design Studio", icon: ImageIcon, requireDesign: true },
  { tab: "club", label: "Club Details & Info", icon: Users },
  { tab: "profile", label: "My Profile", icon: UserIcon },
];

const ADMIN_MORE_ITEMS: MoreDrawerItem[] = [
  { tab: "settings", label: "Settings & Access", icon: SettingsIcon, requireSuperAdmin: true },
  { tab: "studio", label: "Studio & Nets", icon: Video, feature: "studio", requireStudioAdmin: true },
  { tab: "grounds", label: "Grounds & Venues", icon: MapPin, requireMatchAdmin: true },
  { tab: "design", label: "Design Studio", icon: ImageIcon, requireDesign: true },
  { tab: "shop", label: "Merchandise Shop", icon: ShoppingBag, feature: "shop" },
  { tab: "leaderboard", label: "Leaderboard & Stats", icon: Trophy, feature: "leaderboard" },
  { tab: "opinion", label: "Polls & Pulse", icon: PieChart, feature: "opinion" },
  { tab: "notifications", label: "Notifications", icon: Bell },
];

export function MoreDrawer({
  open,
  onClose,
  onSelectTab,
  activeTab,
  isFeatureEnabled,
  canDesign,
  persona,
  adminPermissions,
  triggerRef,
}: {
  open: boolean;
  onClose: () => void;
  onSelectTab: (tab: Tab) => void;
  activeTab: Tab;
  isFeatureEnabled: (key: Feature) => boolean;
  canDesign: boolean;
  persona?: "admin" | "player";
  adminPermissions?: AdminPermissions;
  triggerRef?: React.RefObject<HTMLElement | null>;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const originalOverflowRef = useRef<string>("");
  const onCloseRef = useRef(onClose);

  // Keep onCloseRef current across renders without re-triggering lifecycle effects
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Modal open/close transition & scroll/focus lifecycle
  useEffect(() => {
    if (open) {
      if (!wasOpenRef.current) {
        wasOpenRef.current = true;
        previouslyFocusedElementRef.current =
          triggerRef?.current || (document.activeElement as HTMLElement | null);

        originalOverflowRef.current = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const focusTimer = setTimeout(() => {
          closeBtnRef.current?.focus();
        }, 30);

        return () => {
          clearTimeout(focusTimer);
        };
      }
    } else {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        document.body.style.overflow = originalOverflowRef.current;
        const targetToRestore = previouslyFocusedElementRef.current;
        if (targetToRestore && typeof targetToRestore.focus === "function") {
          targetToRestore.focus();
        }
      }
    }
  }, [open, triggerRef]);

  // Ensure scroll lock restoration on unmount if unmounted while still open
  useEffect(() => {
    return () => {
      if (wasOpenRef.current) {
        document.body.style.overflow = originalOverflowRef.current;
        const targetToRestore = previouslyFocusedElementRef.current;
        if (targetToRestore && typeof targetToRestore.focus === "function") {
          targetToRestore.focus();
        }
      }
    };
  }, []);

  // Keyboard events (Escape & Tab focus trap)
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape key dismissal
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      // Focus trap containment within open modal sheet
      if (e.key === "Tab" && sheetRef.current) {
        const focusableElements = sheetRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length === 0) {
          e.preventDefault();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (
            document.activeElement === firstElement ||
            !sheetRef.current.contains(document.activeElement)
          ) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (
            document.activeElement === lastElement ||
            !sheetRef.current.contains(document.activeElement)
          ) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!open) return null;

  const targetItems = persona === "admin" ? ADMIN_MORE_ITEMS : PLAYER_MORE_ITEMS;
  const visibleItems = targetItems.filter((item) => {
    if (item.feature && !isFeatureEnabled(item.feature)) return false;

    if (persona === "admin") {
      if (item.requireSuperAdmin && !adminPermissions?.isSuperAdmin) return false;
      if (
        item.requireStudioAdmin &&
        !(adminPermissions?.isStudioAdmin || adminPermissions?.isSuperAdmin)
      )
        return false;
      if (
        item.requireMatchAdmin &&
        !(
          adminPermissions?.isMatchAdmin ||
          adminPermissions?.isSuperAdmin ||
          adminPermissions?.isClubAdmin
        )
      )
        return false;
      if (item.requireDesign && !(adminPermissions?.canDesign || canDesign)) return false;
    } else {
      if (item.requireDesign && !canDesign) return false;
    }

    return true;
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="more-drawer-title"
      aria-describedby="more-drawer-desc"
      className="fixed inset-0 z-50 md:hidden"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-up Sheet */}
      <div
        ref={sheetRef}
        data-testid="more-drawer-sheet"
        className="absolute bottom-0 left-0 right-0 bg-surface border-t border-border rounded-t-2xl pb-safe shadow-2xl animate-slide-up max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-border/50">
          <div>
            <h3
              id="more-drawer-title"
              className="text-xs font-bold uppercase tracking-widest text-text-primary"
            >
              {persona === "admin" ? "Admin Console Hubs" : "More Destinations"}
            </h3>
            <p id="more-drawer-desc" className="text-[11px] text-text-muted mt-0.5">
              {persona === "admin"
                ? "Administrative settings and operations"
                : "Secondary club features and resources"}
            </p>
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close navigation drawer"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-surface-hover transition text-text-muted hover:text-text-primary cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 space-y-1">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.tab;
            return (
              <button
                key={item.tab}
                data-testid={`more-item-${item.tab}`}
                onClick={() => {
                  onSelectTab(item.tab);
                  onClose();
                }}
                className={`w-full min-h-[44px] flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition cursor-pointer ${
                  isActive
                    ? "bg-accent text-text-accent shadow-xs"
                    : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
