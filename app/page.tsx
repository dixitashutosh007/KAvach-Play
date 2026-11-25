/**
 * Root Application Entry Point (`app/page.tsx`)
 *
 * This file serves as the main entry point for the single-page application structure.
 * It manages the primary layout, global state initialization (via `useStore` and `useAuth`),
 * responsive navigation logic, and renders the appropriate Tab component based on user selection.
 * It also handles application initialization states, database quota exceeding cases, and layout for
 * both mobile and desktop (sidebar) navigation.
 */
"use client";

import { useStore } from "@/hooks/useStore";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Home as HomeIcon,
  CalendarDays,
  Map,
  Users,
  LogOut,
  ArrowRight,
  Palette,
  Sparkles,
  Check,
  ChevronRight,
  ShoppingBag,
  X,
  CreditCard,
  User as UserIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { HomeTab } from "@/components/HomeTab";
import { ProfileTab } from "@/components/ProfileTab";
import { ProfileLinkNotice } from "@/components/ProfileLinkNotice";
import { ProfileSyncDialog, profileSyncDismissKey } from "@/components/ProfileSyncDialog";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "@/components/ui/PullToRefreshIndicator";
import { LoadingScreen } from "@/components/LoadingScreen";
import { motion, AnimatePresence } from "motion/react";
import { Bell, PieChart } from "lucide-react";
import Image from "next/image";
import {
  doc,
  setDoc,
  serverTimestamp,
  getDoc,
  updateDoc,
  getDocFromServer,
} from "firebase/firestore";
import { db, auth, firestoreDatabaseId } from "@/lib/firebase";
import { authedFetch } from "@/lib/authed-fetch";
import { DEVELOPMENT_FIRESTORE_DATABASE_ID } from "@/lib/database-config";
import { normalizeIndianMobile } from "@/lib/utils";
import { resolvePlayerForUser, resolveMyPlayers } from "@/lib/player-identity";
import { calculatePlayerDues } from "@/lib/player-dues";
import {
  getPlayerPrimaryNav,
  getPlayerNavParent,
  getPlayerBackLink,
  resolvePlayerTab,
  type PlayerPrimaryTab,
} from "@/lib/player-navigation";
import {
  getAdminPrimaryNav,
  getAdminNavParent,
  getAdminLanding,
  getVisibleClubSections,
  resolveAdminRoute,
  isAdminDestinationVisible,
  type AdminCapabilities,
} from "@/lib/admin-navigation";
import { ADMIN_NAV_ICONS } from "@/components/layout/MobileBottomNav";
import { AccessDenied, PERMISSION_DENIED_MESSAGE } from "@/components/ui/AccessDenied";

import { useTheme } from "@/hooks/useTheme";
import { PhoneSyncPrompt } from "@/components/onboarding/PhoneSyncPrompt";
import { RegistrationForm } from "@/components/onboarding/RegistrationForm";
import { PendingApprovalScreen } from "@/components/onboarding/PendingApprovalScreen";
import { RejectedScreen } from "@/components/onboarding/RejectedScreen";
import { AccountDisabledScreen } from "@/components/onboarding/AccountDisabledScreen";
import { QuotaExceededScreen } from "@/components/onboarding/QuotaExceededScreen";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { AppHeader } from "@/components/layout/AppHeader";
import { useToast } from "@/components/ui/Toast";
import { WeekendPrompts } from "@/components/weekend-ops/WeekendPrompts";

const PLAYER_NAV_ICONS: Record<PlayerPrimaryTab, typeof HomeIcon> = {
  home: HomeIcon,
  club: Users,
  matches: CalendarDays,
};

// Lazy-loaded tab components — only downloaded when the user navigates to them
const MatchesTab = dynamic(() => import("@/components/MatchesTab").then(m => ({ default: m.MatchesTab })), { ssr: false });
const PlayersTab = dynamic(() => import("@/components/PlayersTab").then(m => ({ default: m.PlayersTab })), { ssr: false });
const LeaderboardTab = dynamic(() => import("@/components/LeaderboardTab").then(m => ({ default: m.LeaderboardTab })), { ssr: false });
const SettingsTab = dynamic(() => import("@/components/SettingsTab").then(m => ({ default: m.SettingsTab })), { ssr: false });
const AdminDashboard = dynamic(() => import("@/components/AdminDashboard").then(m => ({ default: m.AdminDashboard })), { ssr: false });
const StudioTab = dynamic(() => import("@/components/StudioTab").then(m => ({ default: m.StudioTab })), { ssr: false });
const NotificationsTab = dynamic(() => import("@/components/NotificationsTab").then(m => ({ default: m.NotificationsTab })), { ssr: false });
const FinanceTab = dynamic(() => import("@/components/FinanceTab").then(m => ({ default: m.FinanceTab })), { ssr: false });
const DuesAndRemindersTab = dynamic(() => import("@/components/DuesAndRemindersTab").then(m => ({ default: m.DuesAndRemindersTab })), { ssr: false });
const ShopTab = dynamic(() => import("@/components/ShopTab").then(m => ({ default: m.ShopTab })), { ssr: false });
const OpinionTab = dynamic(() => import("@/components/OpinionTab").then(m => ({ default: m.OpinionTab })), { ssr: false });
const DesignTab = dynamic(() => import("@/components/DesignTab").then(m => ({ default: m.DesignTab })), { ssr: false });
const BadgesTab = dynamic(() => import("@/components/BadgesTab").then(m => ({ default: m.BadgesTab })), { ssr: false });
const PlayerClubTab = dynamic(() => import("@/components/club/PlayerClubTab").then(m => ({ default: m.PlayerClubTab })), { ssr: false });
const PlayerDirectory = dynamic(() => import("@/components/club/PlayerDirectory").then(m => ({ default: m.PlayerDirectory })), { ssr: false });
const ClubAnnouncementsScreen = dynamic(() => import("@/components/club/ClubAnnouncementsScreen").then(m => ({ default: m.ClubAnnouncementsScreen })), { ssr: false });
const PulseScreen = dynamic(() => import("@/components/club/PulseScreen").then(m => ({ default: m.PulseScreen })), { ssr: false });
const ClubTab = dynamic(() => import("@/components/ClubTab").then(m => ({ default: m.ClubTab })), { ssr: false });

export default function Home() {
  const router = useRouter();
  const {
    user,
    hasAdminClaim,
    refreshAuth,
    signIn,
    signInDemo,
    signInWithEmail,
    logOut,
  } = useAuth();
  const store = useStore(user);
  const { toast } = useToast();
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  useEffect(() => {
    if (user) {
      const redirect = sessionStorage.getItem("postLoginRedirect");
      if (redirect) {
        sessionStorage.removeItem("postLoginRedirect");
        router.push(redirect);
      }
    }
  }, [user, router]);

  useEffect(() => {
    if (store.appConfig?.clubName) {
      document.title = store.appConfig.clubName;
    }
    if (store.appConfig?.logoUrl) {
      let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = store.appConfig.logoUrl;
    }
  }, [store.appConfig?.logoUrl, store.appConfig?.clubName]);

  useEffect(() => {
    const handleQuota = () => setQuotaExceeded(true);
    if (typeof window !== "undefined") {
      window.addEventListener("firestore-quota-exceeded", handleQuota);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("firestore-quota-exceeded", handleQuota);
      }
    };
  }, []);

  const [activeTabBase, setActiveTabBase] = useState<
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
    | "club"
    | "badges"
    | "pulse"
    | "announcements"
  >("home");
  const [tabAction, setTabAction] = useState<string | null>(null);
  const [, setTestRerenderCount] = useState(0);

  const setActiveTab = useCallback((tab: any, action?: string) => {
    setActiveTabBase(tab);
    setTabAction(action || null);
  }, []);
  const activeTab = activeTabBase;
  const [persona, setPersona] = useState<"player" | "admin">("player");
  // D-20: header screens (Profile, Notifications) return to the primary tab the
  // player came from.
  const lastPlayerPrimaryRef = useRef<"home" | "club" | "matches">("home");
  useEffect(() => {
    if (activeTabBase === "home" || activeTabBase === "club" || activeTabBase === "matches") {
      lastPlayerPrimaryRef.current = activeTabBase;
    }
  }, [activeTabBase]);
  const [previewThemeId, setPreviewThemeId] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() =>
    typeof window !== "undefined" ? Date.now() : 0,
  );

  const isFeatureEnabled = useCallback(
    (
      featureKey: keyof NonNullable<
        import("@/lib/types").AppConfig["features"]
      >,
    ) => {
      return store.appConfig?.features?.[featureKey] !== false; // defaults to true
    },
    [store.appConfig],
  );

  // Login-form state moved into <LoginScreen>.

  // Initialize admin view default tab
  const hasInitializedAdminRef = useRef(false);
  const currentUserObj =
    store.isLoaded && user
      ? store.appUsers.find((u) => u.id === user.uid)
      : null;
  const isSuperAdminUser = !!hasAdminClaim;
  // Stable resolved player id for scoping player-only subscriptions.
  const scopedPlayerId = useMemo(
    () => resolvePlayerForUser(store.players, user?.uid, currentUserObj)?.id || null,
    [store.players, user?.uid, currentUserObj],
  );
  const isAdminUser =
    store.isLoaded &&
    user &&
    // D-22: active roles only (Super Admin claim, Club Admin, Finance Admin).
    // Retired Match Admin / Studio Admin / Designer flags grant nothing.
    (isSuperAdminUser || currentUserObj?.isFinanceAdmin || currentUserObj?.isClubAdmin);

  // Effective admin capabilities (D-18 navigation input; D-22 three-role model).
  // Same derivation as the per-screen guards further down: the Super Admin claim
  // folds into every role. Not an authority — rules and server RBAC decide.
  const adminCaps = useMemo<AdminCapabilities>(() => {
    const sup = !!hasAdminClaim;
    return {
      isSuperAdmin: sup,
      isClubAdmin: sup || !!currentUserObj?.isClubAdmin,
      isFinanceAdmin: sup || !!currentUserObj?.isFinanceAdmin,
    };
  }, [hasAdminClaim, currentUserObj]);

  // Pending weekend-operations tasks (indicator on the Admin persona toggle).
  const [weekendPending, setWeekendPending] = useState(0);

  useEffect(() => {
    if (isAdminUser && !hasInitializedAdminRef.current) {
      hasInitializedAdminRef.current = true;
      // In accordance with Decision D-10:
      // Standard Player View is the default experience for all club members on login,
      // including administrators. An authorized entry point into the Admin Console is
      // provided in the header.
    }
  }, [isAdminUser, currentUserObj, user]);

  // Development-only access diagnostic. Logs which database the client is bound
  // to and which authority sources grant admin access. Booleans only: never the
  // UID, email, phone or any token. Disabled when bound to production.
  const hasLoggedAccessDiagnosticRef = useRef(false);
  useEffect(() => {
    if (!store.isLoaded || !user || hasLoggedAccessDiagnosticRef.current) return;
    if (store.selfAppUserStatus === "loading") return;
    if (firestoreDatabaseId !== DEVELOPMENT_FIRESTORE_DATABASE_ID) return;
    hasLoggedAccessDiagnosticRef.current = true;
    const diagPlayerLinked = !!resolvePlayerForUser(store.players, user.uid, currentUserObj);
    const diagOtpLogin = !!user.phoneNumber;
    const diagGoogleLogin = !!user.providerData?.some((p) => p.providerId === "google.com");
    const diagEmailMatchCount = user.email
      ? store.players.filter(
          (p) => !p.disabled && !p.mergedInto && (p.email || "").trim().toLowerCase() === user.email!.trim().toLowerCase(),
        ).length
      : 0;
    console.info("[KAvach access diagnostic]", {
      firestoreDatabaseId,
      adminCustomClaim: !!hasAdminClaim,
      appUserDocument: store.selfAppUserStatus,
      isClubAdmin: !!currentUserObj?.isClubAdmin,
      isFinanceAdmin: !!currentUserObj?.isFinanceAdmin,
      retiredRoleFlags: ["isMatchAdmin", "isStudioAdmin", "isDesigner", "canDesign"].filter((k) => (currentUserObj as any)?.[k] === true),
      resolvedAsAdmin: !!isAdminUser,
      playersLoaded: store.playersLoaded,
      playerLinked: diagPlayerLinked,
      otpLogin: diagOtpLogin,
      googleLogin: diagGoogleLogin,
      playerRecordsMatchingLoginEmail: diagEmailMatchCount,
      matchesLoaded: store.matches.length,
      matchesError: store.matchesError,
    });
  }, [store.isLoaded, store.selfAppUserStatus, store.matches.length, store.matchesError, store.playersLoaded, store.players, user, hasAdminClaim, currentUserObj, isAdminUser]);

  // Profile sync popup: dismissed for this browser session per login.
  const [profileSyncDismissed, setProfileSyncDismissed] = useState(false);
  useEffect(() => {
    if (!user) return;
    try {
      setProfileSyncDismissed(window.sessionStorage.getItem(profileSyncDismissKey(user.uid)) === "1");
    } catch {
      setProfileSyncDismissed(false);
    }
  }, [user]);
  const dismissProfileSync = useCallback(() => {
    setProfileSyncDismissed(true);
    try {
      if (user) window.sessionStorage.setItem(profileSyncDismissKey(user.uid), "1");
    } catch {
      // Storage unavailable: popup stays hidden until reload.
    }
  }, [user]);

  // Mobile pull-to-refresh: refreshes data in place (no page reload).
  const handlePullRefresh = useCallback(async () => {
    await Promise.all([store.refreshData?.(), refreshAuth?.()]);
  }, [store.refreshData, refreshAuth]);
  const pullToRefresh = usePullToRefresh({
    enabled: Boolean(user && !user.isAnonymous && store.isLoaded),
    onRefresh: handlePullRefresh,
  });

  // Guard: if persona is set to admin but the user lacks authoritative administrative privileges,
  // revert strictly to player view to prevent client-side state or URL tampering.
  useEffect(() => {
    if (persona === "admin" && store.isLoaded && !isAdminUser) {
      setPersona("player");
      setActiveTab("home");
    }
  }, [persona, store.isLoaded, isAdminUser, setActiveTab]);

  // In-app navigation requests from nested components (e.g. Player Roster →
  // "Manage in Access Control"). Only changes the view; every screen keeps its guard.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const d = (e as CustomEvent<{ tab?: string; action?: string }>).detail;
      if (d?.tab) setActiveTab(d.tab, d.action);
    };
    window.addEventListener("kavach:navigate", onNavigate);
    return () => window.removeEventListener("kavach:navigate", onNavigate);
  }, [setActiveTab]);

  // Test-only navigation hooks (strictly isolated behind non-production runtime)
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      (window as any).__KAVACH_NAVIGATE_TAB__ = (tab: any, action?: string) => {
        setActiveTab(tab, action);
      };
      (window as any).__KAVACH_SET_PERSONA__ = (p: "player" | "admin") => {
        setPersona(p);
      };
      (window as any).__KAVACH_TRIGGER_PARENT_RERENDER__ = () => {
        setTestRerenderCount((c) => c + 1);
      };
    }
  }, [setActiveTab]);

  // Set local current time for pure render and ticking countdowns
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000 * 30); // update every 30s
    return () => clearInterval(interval);
  }, []);

  // Player persona guard (D-16): the Player persona may only show Home, Profile,
  // Matches and their secondary destinations, and only when the club has the
  // relevant feature enabled. Admin-only tabs (club, design, settings, grounds,
  // dues_and_reminders) and disabled features fall back to a primary destination.
  useEffect(() => {
    if (persona !== "player") return;
    const resolved = resolvePlayerTab(activeTab, (f) => isFeatureEnabled(f));
    if (resolved !== activeTab) {
      setTimeout(() => setActiveTab(resolved), 0);
    }
  }, [persona, activeTab, isFeatureEnabled, setActiveTab]);

  // Lazy Firestore subscriptions — only start the expensive payments and
  // otherFees collectionGroup listeners when the user actually opens a tab
  // that consumes them. Previously these ran for every logged-in user on
  // login. Idempotent: calling ensurePayments twice does nothing.
  // Admin persona route guard (D-18/D-19): legacy tab ids (studio, grounds,
  // opinion, leaderboard, shop, badges, players, dues_and_reminders) and former
  // Club sections (reminders, activity) open inside their destination. Screens a
  // role may not use show a polite access-denied message rather than redirecting.
  useEffect(() => {
    if (persona !== "admin" || !store.isLoaded || !isAdminUser) return;
    const next = resolveAdminRoute(activeTab, tabAction);
    if (next) setTimeout(() => setActiveTab(next.tab, next.action), 0);
  }, [persona, activeTab, tabAction, store.isLoaded, isAdminUser, setActiveTab]);

  // D-19: a save rejected by Firestore rules gets a polite access-denied message
  // instead of failing silently (lib/errorHandling.ts dispatches the event).
  useEffect(() => {
    if (typeof window === "undefined") return;
    let last = 0;
    const onDenied = () => {
      const now = Date.now();
      if (now - last < 3000) return;
      last = now;
      toast(PERMISSION_DENIED_MESSAGE, "error");
    };
    window.addEventListener("firestore-permission-denied", onDenied);
    return () => window.removeEventListener("firestore-permission-denied", onDenied);
  }, [toast]);

  const scopedPersonaRef = useRef<"player" | "admin">(persona);
  const PAYMENT_TABS = new Set([
    "home",
    "matches",
    "finance",
    "club",
    "profile",
    "studio",
    "settings",
  ]);
  const OTHER_FEE_TABS = new Set([
    "home",
    "finance",
    "club",
    "profile",
  ]);
  const POSTS_TABS = new Set(["home"]);
  const STATS_TABS = new Set(["club"]); // Home no longer shows the performance summary
  // Shop orders: admin Club (all orders); player Shop, Finance/Payments and Profile
  // payment history (own orders only, filtered by player id below).
  const MERCH_TABS = new Set(["club", "shop", "finance", "profile"]);
  // "opinion"/"pulse" (player Polls & Pulse screens) need polls and responses;
  // before D-20 the player Polls screen loaded nothing (regression fixed here).
  const POLL_TABS = new Set(["club", "opinion", "pulse"]);
  const BADGE_TABS = new Set(["club", "home", "profile", "badges", "leaderboard"]);
  const TOURNAMENT_TABS = new Set(["matches"]);
  const SUB_PLAN_TABS = new Set(["studio", "club", "profile"]);
  const FEE_TEMPLATE_TABS = new Set(["finance", "club"]);
  const FEE_PLAN_TABS = new Set(["matches", "finance", "club"]);
  const MERCH_CATALOG_TABS = new Set(["club", "shop"]);
  const OUT_OF_PLAY_TABS = new Set(["profile", "studio", "club"]);
  useEffect(() => {
    if (!store.isLoaded) return;
    // D-20: the Player Club tab loads only compact, bounded previews through its
    // own queries (components/club/*). It must not start the admin Club's
    // whole-collection listeners, so it maps to a key that is in no set below.
    const activeTab = persona === "player" && activeTabBase === "club" ? "player_club" : activeTabBase;
    // Admin Match Centre loads payments on demand (a match's Payment Details
    // panel, match detail, edit form via ensureMatchPayments; Calendar and
    // Assign views via ensurePayments) instead of the whole collection up front.
    const wantsAllPayments =
      PAYMENT_TABS.has(activeTab) && !(activeTab === "matches" && persona === "admin");
    // ARCH-001: Detach listeners when domain tab is no longer active
    if (!wantsAllPayments) store.detachDomain?.("allPayments");
    if (!OTHER_FEE_TABS.has(activeTab)) store.detachDomain?.("allOtherFees");
    if (!POSTS_TABS.has(activeTab)) store.detachDomain?.("posts");
    if (!STATS_TABS.has(activeTab)) store.detachDomain?.("playerStats");
    if (!MERCH_TABS.has(activeTab)) store.detachDomain?.("merchOrders");
    if (!POLL_TABS.has(activeTab)) {
      store.detachDomain?.("polls");
      store.detachDomain?.("pollResponses");
    }
    if (!OUT_OF_PLAY_TABS.has(activeTab)) store.detachDomain?.("outOfPlays");
    if (!BADGE_TABS.has(activeTab)) {
      store.detachDomain?.("badges");
      store.detachDomain?.("badgeTypeDefs");
    }

    // Players load only their own payment records. Records are keyed by the PLAYER
    // id, which differs from the login uid for most linked players (Google or phone).
    // D-16: an admin in Player persona is scoped exactly like a regular player, so
    // club-wide financial records are only loaded in Admin persona.
    if (scopedPersonaRef.current !== persona) {
      // Re-subscribe with the scope of the new persona (subscriptions are keyed
      // by domain, not scope, so a stale scope would otherwise persist).
      store.detachDomain?.("allPayments");
      store.detachDomain?.("allOtherFees");
      store.detachDomain?.("merchOrders");
      scopedPersonaRef.current = persona;
    }
    const playerScope = isAdminUser && persona === "admin" ? undefined : scopedPlayerId || user?.uid;
    if (wantsAllPayments) store.ensurePayments?.(playerScope);
    if (OTHER_FEE_TABS.has(activeTab)) store.ensureOtherFees?.(playerScope);
    if (POSTS_TABS.has(activeTab)) store.ensurePosts?.();
    if (STATS_TABS.has(activeTab)) store.ensurePlayerStats?.();
    if (MERCH_TABS.has(activeTab)) store.ensureMerchOrders?.(playerScope);
    if (POLL_TABS.has(activeTab)) {
      store.ensurePolls?.();
      store.ensurePollResponses?.();
    }
    if (TOURNAMENT_TABS.has(activeTab)) store.ensureTournaments?.();
    if (SUB_PLAN_TABS.has(activeTab)) store.ensureSubscriptionPlans?.();
    if (FEE_TEMPLATE_TABS.has(activeTab)) store.ensureFeeTemplates?.();
    if (FEE_PLAN_TABS.has(activeTab)) store.ensureFeePlans?.();
    if (MERCH_CATALOG_TABS.has(activeTab)) store.ensureMerchandises?.();
    if (OUT_OF_PLAY_TABS.has(activeTab)) store.ensureOutOfPlays?.();
    if (BADGE_TABS.has(activeTab)) { store.ensureBadges?.(); store.ensureBadgeTypeDefs?.(); }

    return () => {
      // ARCH-001: Teardown on unmount / navigation
      store.detachAllLazy?.();
    };
  }, [activeTab, persona, store.isLoaded, isAdminUser, user, store.ensurePayments, store.ensureOtherFees, store.ensurePosts, store.ensurePlayerStats, store.ensureMerchOrders, store.ensurePolls, store.ensurePollResponses, store.ensureTournaments, store.ensureSubscriptionPlans, store.ensureFeeTemplates, store.ensureFeePlans, store.ensureMerchandises, store.ensureOutOfPlays, store.ensureBadges, store.ensureBadgeTypeDefs, store.detachDomain, store.refreshNonce, scopedPlayerId]);

  // Admin-only subscriptions: full appUsers collection (100+ PII docs) and
  // subscriptionHistory audit trail. Non-admin players never load these.
  // R2-A/R2-C: mirrors the rules' isAnyAdmin() (D-22: Super claim, Club or Finance Admin).
  const canReadAccountRecords =
    !!isAdminUser && (isSuperAdminUser || !!currentUserObj?.isFinanceAdmin || !!currentUserObj?.isClubAdmin);
  useEffect(() => {
    if (!store.isLoaded) return;
    if (canReadAccountRecords) {
      store.ensureAllAppUsers?.();
      store.ensureSubscriptionHistory?.();
    }
  }, [
    canReadAccountRecords,
    store.isLoaded,
    store.ensureAllAppUsers,
    store.ensureSubscriptionHistory,
  ]);
  const { currentTheme: currentThemeObj, themeStyles } = useTheme(
    previewThemeId,
    store.appConfig?.globalTheme,
  );

  const [authMethod, setAuthMethod] = useState<"phone" | "google_email">(
    "phone",
  );
  // Registration form state now lives inside <RegistrationForm>. Only the
  // sync flow uses isRegistering at this level.
  const [isRegistering, setIsRegistering] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);


  const isMobileAuth = !!user?.phoneNumber;
  const isGoogleLogin = !!user?.providerData?.some((p) => p.providerId === "google.com");
  const currentPlayerObj = resolvePlayerForUser(
    store.players,
    user?.uid,
    currentUserObj,
  );
  const existingPlayerWithSamePhone =
    isMobileAuth && user?.phoneNumber
      ? (() => {
          const normAuth = normalizeIndianMobile(user.phoneNumber || "");
          if (normAuth.length < 12) return null;
          const activeMatch = store.players.find((p) => {
            if (!p.mobile || p.disabled || p.mergedInto) return false;
            const normProfile = normalizeIndianMobile(p.mobile);
            return normProfile.length >= 12 && normProfile === normAuth && p.id !== user?.uid;
          });
          if (activeMatch) return activeMatch;
          const mergedMatch = store.players.find((p) => {
            if (!p.mobile || !p.mergedInto) return false;
            const normProfile = normalizeIndianMobile(p.mobile);
            return normProfile.length >= 12 && normProfile === normAuth;
          });
          if (mergedMatch) {
            let keeper = store.players.find(p => p.id === (mergedMatch as any).mergedInto);
            let depth = 0;
            while ((keeper as any)?.mergedInto && depth < 5) {
              keeper = store.players.find(p => p.id === (keeper as any).mergedInto);
              depth++;
            }
            if (keeper && !keeper.disabled && keeper.id !== user?.uid) return keeper;
          }
          return null;
        })()
      : null;

  // Email candidate for linking a Google login. Unlike production, a record
  // whose id equals this login's uid is NOT excluded: under the remediated
  // identity model that record no longer matches by id when its authUid points
  // to another login (e.g. the player's mobile login), so it must be offered
  // here. The server re-verifies the Google-verified email before linking.
  const existingPlayerWithSameEmail =
    !isMobileAuth && user?.email
      ? store.players.find((p) => {
          if (!p.email || p.disabled || p.mergedInto) return false;
          return p.email.trim().toLowerCase() === user.email!.trim().toLowerCase();
        })
      : null;

  // Auto-accept synced players who are Unverified
  useEffect(() => {
    if (
      currentPlayerObj &&
      currentPlayerObj.authUid &&
      currentPlayerObj.inviteStatus === "Unverified"
    ) {
      // Background fix to auto-accept synced users that got stuck
      const playerDoc = doc(db, "players", currentPlayerObj.id);
      updateDoc(playerDoc, {
        inviteStatus: "Accepted",
        updatedAt: serverTimestamp(),
      }).catch((e) => console.error("Auto-accept failed", e));
    }
  }, [currentPlayerObj]);

  // Theme resolution and CSS-var injection now lives in useTheme (above).

  if (!user || user.isAnonymous) {
    return (
      <LoginScreen
        onGoogleSignIn={signIn}
        onEmailSignIn={signInWithEmail}
        themeStyles={themeStyles}
        accentColor={currentThemeObj.accent}
        textAccentColor={currentThemeObj.textAccent}
      />
    );
  }


  if (!store.isLoaded || !store.playersLoaded || store.selfAppUserStatus === "loading") {
    if (quotaExceeded) {
      return <QuotaExceededScreen themeStyles={themeStyles} />;
    }
    return (
      <LoadingScreen
        theme={store.appConfig?.loadingAnimationTheme || "radar"}
        clubName={store.appConfig?.clubName}
      />
    );
  }


  const handleSyncAccount = async () => {
    const existingMatch = existingPlayerWithSamePhone || existingPlayerWithSameEmail;
    if (!user || !existingMatch) return;
    setIsRegistering(true);
    try {
      // Phone logins link through the verified phone number; Google logins
      // through the Google-verified email. Identity always comes from the
      // verified ID token on the server — never from client-side writes.
      // authedFetch attaches the ID token and refreshes it once on 401 (R1).
      const viaGoogle = !existingPlayerWithSamePhone && isGoogleLogin;
      const res = viaGoogle
        ? await authedFetch("/api/player/link-google", { method: "POST" })
        : await authedFetch("/api/player/link-account", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              playerId: existingMatch.id,
            }),
          });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to link player account");
      }

      store.applyLinkedPlayerId(user.uid, data.playerId || existingMatch.id);
      setProfileSyncDismissed(true);
      toast("Profile linked successfully!", "success");
    } catch (err: any) {
      console.error("Error syncing profile:", err);
      toast(err.message || "Failed to sync your profile. Please try again.", "error");
    } finally {
      setIsRegistering(false);
    }
  };

  // Registration submission moved into <RegistrationForm>.

  if (
    currentPlayerObj &&
    currentPlayerObj.inviteStatus === "Pending"
  ) {
    // Admins (verified claim or appUsers permission flags) bypass the pending screen.
    if (!isAdminUser) {
      return (
        <PendingApprovalScreen
          variant="pending"
          onLogOut={logOut}
          themeStyles={themeStyles}
        />
      );
    }
  }

  // Guard: just submitted registration — player doc may still be propagating
  // from the batch write. Show PendingApproval briefly instead of flashing
  // the registration form again.
  if (justRegistered && !currentPlayerObj && currentUserObj && !isSuperAdminUser && !user?.isAnonymous) {
    return (
      <PendingApprovalScreen
        variant="pending"
        onLogOut={logOut}
        themeStyles={themeStyles}
      />
    );
  }

  // No player doc — show registration form. This handles both first-time
  // registration AND the case where a previous attempt created the appUser
  // doc but not the player doc (e.g. old non-atomic writes or a failed batch).
  if (!currentPlayerObj && !user?.isAnonymous && user && !isSuperAdminUser) {
    const existingMatch = existingPlayerWithSamePhone || existingPlayerWithSameEmail;
    if (existingMatch) {
      return (
        <PhoneSyncPrompt
          existingPlayer={existingMatch}
          user={user}
          matchedBy={existingPlayerWithSamePhone ? "mobile" : "google"}
          isSubmitting={isRegistering}
          onSync={handleSyncAccount}
          onLogOut={logOut}
          themeStyles={themeStyles}
          accentColor={currentThemeObj.accent}
          textAccentColor={currentThemeObj.textAccent}
        />
      );
    }

    return (
      <RegistrationForm
        user={user}
        players={store.players}
        onLogOut={logOut}
        onRegistered={() => setJustRegistered(true)}
        themeStyles={themeStyles}
        accentColor={currentThemeObj.accent}
        textAccentColor={currentThemeObj.textAccent}
      />
    );
  }

  const clubName = store.appConfig?.clubName || "KAVACH CRICKET CLUB";
  const logoUrl = store.appConfig?.logoUrl;

  const appUser = store.appUsers.find((u) => u.id === user.uid);
  const player = resolvePlayerForUser(store.players, user.uid, appUser);

  if (player?.disabled || appUser?.status === "Disabled") {
    return (
      <AccountDisabledScreen
        player={player || ({ id: user.uid, name: appUser?.name || "Player", mobile: appUser?.mobile || "" } as any)}
        user={user}
        store={store}
        now={now}
      />
    );
  }

  const isSuperAdmin = !!hasAdminClaim;
  const isFinanceAdmin = isSuperAdmin || appUser?.isFinanceAdmin;
  const isClubAdmin = isSuperAdmin || !!appUser?.isClubAdmin;
  // D-22: Match operations, Studio and Design Studio are Club Admin capabilities.
  // These aliases are derived ONLY from Club Admin; retired flags are ignored.
  const isStudioAdmin = isClubAdmin;
  const isMatchAdmin = isClubAdmin;
  const canDesign = isClubAdmin;
  const isAuthorizedAdmin = isSuperAdmin || isFinanceAdmin || isClubAdmin;
  const isAdmin = isAuthorizedAdmin;
  const effectiveIsAdminMode = persona === "admin" && isAuthorizedAdmin;
  // Mandatory profile fields every non-admin player must have populated
  // before they can use the app. If any of these are missing on next
  // open (even for existing users), we force them through the completion
  // screen so old profiles get topped up.
  // Mandatory-fields spec: which fields the player must have populated
  // before they can use the app. Kept as a list rather than a boolean
  // so we can (a) render a specific "you're missing X, Y" message and
  // (b) keep the check + the message in sync as fields evolve.
  const missingMandatoryLabels = !isAdmin
    ? [
        !appUser?.name && "Name",
        !appUser?.dob && "Date of Birth",
        !appUser?.locality && "Locality",
        !appUser?.bloodGroup && "Blood Group",
        !appUser?.emergencyContact && "Emergency Contact",
        !appUser?.mobile && "Mobile Number",
        !appUser?.email && "Email",
        !appUser?.chestSize && "Chest Size",
        (!appUser?.jerseyNumber || appUser?.jerseyNumber === "10") &&
          "Jersey Number (any except 10)",
      ].filter((v): v is string => Boolean(v))
    : [];
  const hasMissingMandatory = missingMandatoryLabels.length > 0;
  const isVerified =
    player?.inviteStatus === "Verified" || player?.inviteStatus === "Accepted";

  if (!isAdmin && !isVerified) {
    if (player?.inviteStatus === "Rejected") {
      return (
        <RejectedScreen
          player={player}
          user={user}
          clubName={clubName}
          now={now}
          store={store}
          onLogOut={logOut}
          themeStyles={themeStyles}
        />
      );
    }


    if (
      hasMissingMandatory ||
      !player ||
      player.inviteStatus === "Unverified"
    ) {
      return (
        <div
          className="min-h-screen pb-20 sm:pb-0 font-sans p-4 max-w-md mx-auto"
          style={themeStyles}
        >
          <div className="pt-8 pb-4 text-center">
            <h1 className="font-extrabold text-2xl tracking-tight text-accent mb-1">
              {clubName}
            </h1>
            <p className="text-text-secondary text-xs uppercase tracking-widest font-semibold">
              Complete Your Profile
            </p>
            <p className="text-text-muted text-[11px] mt-2 max-w-xs mx-auto leading-relaxed">
              {hasMissingMandatory
                ? `Please fill in: ${missingMandatoryLabels.join(", ")}. Save to submit for admin approval.`
                : "Fill in the required details below and save to submit for admin approval."}
            </p>
          </div>
          <ProfileTab store={store} forceEdit={true} />
          <div className="mt-8 text-center">
            <button
              onClick={logOut}
              className="text-text-muted hover:text-text-primary text-xs font-bold uppercase tracking-widest transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      );
    } else {
      return (
        <PendingApprovalScreen
          variant="awaiting"
          onLogOut={logOut}
          themeStyles={themeStyles}
        />
      );
    }
  }

  // Find membership text
  const isStudioUser = appUser?.isStudioMember || player?.isStudioMember;

  const myNotifications = store.notifications.filter((n) => {
    if (isAdmin && persona === "admin") {
      return n.userId === "admin" || n.userId === "all";
    }
    return n.userId === user?.uid || n.userId === "all";
  });
  const unreadCount = myNotifications.filter((n) => !n.isRead).length;

  return (
    <div
      className="min-h-screen pb-20 md:pb-8 font-sans transition-all duration-500"
      style={themeStyles}
    >
      <PullToRefreshIndicator status={pullToRefresh.status} distance={pullToRefresh.distance} />

      {/* Dynamic Header */}
      <AppHeader
        clubName={clubName}
        logoUrl={logoUrl}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        user={user}
        appUser={appUser}
        isAdmin={isAdmin}
        persona={persona}
        onTogglePersona={() => {
          if (persona === "admin") {
            setPersona("player");
            setActiveTab("home");
          } else {
            setPersona("admin");
            // Existing role priority, expressed in D-18 destinations.
            const landing = getAdminLanding(adminCaps, (f) => isFeatureEnabled(f));
            setActiveTab(landing.tab, landing.action);
          }
        }}
        unreadCount={unreadCount}
        adminPendingCount={weekendPending}
        onSignOut={logOut}
      />

      {/* Main Content Responsive Workspace */}
      {/* D-20 layout: one page gutter (16px mobile) owned here — screens add no
          outer horizontal padding of their own. Top offset = fixed header height
          + 16px (+ notch inset); bottom space for the mobile nav is on the root. */}
      <main className="max-w-7xl xl:max-w-[1440px] mx-auto px-4 md:px-6 lg:px-8 pt-[calc(76px_+_env(safe-area-inset-top))] sm:pt-[calc(84px_+_env(safe-area-inset-top))] pb-6">
        <div className="md:grid md:grid-cols-12 md:gap-6 lg:gap-8 items-start animate-fade-in">
          {/* LEFT PANEL: Live Desktop Sidebar Panel (Hidden on Mobile, Beautiful on Desktop) */}
          <div className="hidden md:block md:col-span-4 lg:col-span-3 space-y-6 sticky top-24">
            {/* Elegant user card dashboard */}
            <div className="bg-surface rounded-2xl p-5 border border-border flex flex-col relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-accent/10 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center gap-4.5">
                {user.photoURL || appUser?.photoURL ? (
                  <Image
                    src={user.photoURL || appUser?.photoURL || ""}
                    width={56}
                    height={56}
                    alt="User Avatar"
                    className="w-14 h-14 rounded-full border border-border object-cover shrink-0 shadow-md"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                    <Users className="w-7 h-7 text-accent" />
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-extrabold text-text-primary text-base leading-tight truncate">
                    {appUser?.name || "Profile"}
                  </h3>
                  <p className="text-text-muted text-xs truncate mt-0.5">
                    {user.email}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded-md inline-block mt-2">
                    {persona === "admin"
                      ? "CLUB ADMIN"
                      : isStudioUser
                        ? "STUDIO MEMBER"
                        : "SQUAD PLAYER"}
                  </p>
                </div>
              </div>

              {/* Stats overview mini widget inside card */}
              <div className="grid grid-cols-2 gap-2 mt-5 pt-4 border-t border-border text-center">
                {(() => {
                  const myPlayers = resolveMyPlayers(
                    store.players,
                    user?.uid,
                    appUser,
                  );
                  const duesSummary = calculatePlayerDues(
                    myPlayers,
                    store.payments,
                    store.matches,
                    store.otherFees,
                  );
                  const dueValue = duesSummary.totalDue;

                  const myPlayerRaw = myPlayers[0];

                  const innerContent = (
                    <>
                      <div className="text-[9px] text-text-muted uppercase font-black tracking-wider">
                        Total Due
                      </div>
                      <div className="text-xs font-bold text-red-400 mt-1 truncate">
                        ₹{dueValue}
                      </div>
                    </>
                  );

                  if (myPlayerRaw) {
                    return (
                      <button
                        onClick={() => setActiveTab("profile")}
                        className="block w-full text-left bg-surface-hover p-2.5 rounded-xl border border-border hover:bg-surface-hover hover:border-border transition-all cursor-pointer"
                        title="Click to view and pay dues"
                      >
                        {innerContent}
                      </button>
                    );
                  }
                  return (
                    <div className="bg-surface-hover p-2.5 rounded-xl border border-border">
                      {innerContent}
                    </div>
                  );
                })()}
                <div className="bg-surface-hover p-2.5 rounded-xl border border-border">
                  <div className="text-[9px] text-text-muted uppercase font-black tracking-wider">
                    Blood Group
                  </div>
                  <div className="text-xs font-bold text-accent mt-1">
                    {appUser?.bloodGroup || "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* Desktop Navigation Link Column */}
            <div className="bg-surface rounded-2xl p-4 border border-border space-y-1.5">
              <div className="text-[9px] text-text-primary/30 uppercase font-black tracking-wider px-3 mb-2">
                Navigation Console
              </div>

              {!effectiveIsAdminMode ? (
                <>
                  {/* Player Primary Navigation (D-16): exactly Home, Profile,
                      Matches — identical items and order to the mobile bottom nav. */}
                  {getPlayerPrimaryNav((f) => isFeatureEnabled(f)).map(({ tab, label }) => {
                    const IconComp = PLAYER_NAV_ICONS[tab];
                    const isActive = getPlayerNavParent(activeTab) === tab;
                    return (
                      <button
                        key={tab}
                        data-testid={`sidebar-player-${tab}`}
                        onClick={() => setActiveTab(tab)}
                        aria-current={isActive ? "page" : undefined}
                        className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                          isActive
                            ? "bg-accent text-text-accent"
                            : "text-text-secondary hover:bg-surface-hover"
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          <IconComp className="w-4.5 h-4.5 shrink-0" /> {label}
                        </span>
                        <ChevronRight className="w-4 h-4 opacity-40 group-hover:translate-x-1 transition-transform" />
                      </button>
                    );
                  })}
                </>
              ) : (
                <div className="space-y-1">
                  {/* Admin Primary Navigation (D-18): Home, Match Center, Club,
                      Finance, Design Studio, Settings — all six destinations
                      remain visible to every admin role; unauthorized screens
                      are protected by AccessDenied guards. */}
                  {getAdminPrimaryNav(adminCaps, (f) => isFeatureEnabled(f)).map((item) => {
                    const IconComp = ADMIN_NAV_ICONS[item.tab];
                    const isActive = getAdminNavParent(activeTab) === item.tab;
                    return (
                      <button
                        key={item.tab}
                        data-testid={`sidebar-tab-${item.tab}`}
                        onClick={() => setActiveTab(item.tab)}
                        aria-current={isActive ? "page" : undefined}
                        className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                          isActive
                            ? "bg-accent text-text-accent"
                            : "text-text-secondary hover:bg-surface-hover"
                        }`}
                      >
                        <span className="flex items-center gap-2.5 uppercase text-[11px]">
                          <IconComp
                            className={`w-4 h-4 group-hover:scale-110 transition-transform ${
                              isActive ? "text-text-accent" : "text-accent"
                            }`}
                          />
                          {item.label}
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 opacity-40 group-hover:translate-x-1 transition-transform" />
                      </button>
                    );
                  })}
                  <div className="pt-2 border-t border-border mt-2">
                    <button
                      onClick={() => {
                        setPersona("player");
                        setActiveTab("home");
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs font-bold tracking-wide transition flex items-center justify-between group cursor-pointer text-text-muted hover:text-brand hover:bg-brand/5"
                    >
                      <span className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-wider">
                        <ArrowRight className="w-3.5 h-3.5 rotate-180" /> Return to Player View
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT PANEL: Dynamic Screen Area (Responsive Flex Grid block) */}
          <div className="col-span-1 md:col-span-8 lg:col-span-9 space-y-4 md:space-y-6">
            {quotaExceeded && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 space-y-3 shadow-lg"
              >
                <div className="flex items-start gap-3">
                  <span className="p-2 rounded-xl bg-amber-500/20 text-amber-300 select-none">
                    ⚠️
                  </span>
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                      Database Quota Limit Reached
                    </h3>
                    <p className="text-xs text-text-secondary mt-0.5">
                      This applet has exceeded the free Firestore Enterprise
                      daily read limit.
                    </p>
                  </div>
                </div>

                <p className="text-[11px] text-text-muted leading-relaxed pl-1">
                  Because multiple players or repeated fetches consumed all
                  daily free units, queries or data loads on some tabs may be
                  incomplete until the quota restarts tomorrow. You can upgrade
                  instantly to ensure stable operation.
                </p>

                <div className="pt-1.5 pl-1">
                  <a
                    href="https://console.firebase.google.com/project/gen-lang-client-0004191483/firestore/databases/ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412/data?openUpgradeDialog=true"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-black text-[10px] font-bold uppercase tracking-wider rounded-xl hover:opacity-90 transition shadow-md cursor-pointer"
                  >
                    <span>Upgrade Database on Firebase</span>
                    <ArrowRight className="w-3.5 h-3.5 animate-pulse" />
                  </a>
                </div>
              </motion.div>
            )}

            {persona === "admin" &&
              (isSuperAdmin || isClubAdmin) &&
              store.players.filter((p) => p.inviteStatus === "Pending" || p.inviteStatus === "Unverified").filter(p => !p.disabled).length >
                0 &&
              activeTab !== "studio" && activeTab !== "club" && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-accent/15 border border-accent/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg border-dashed"
                >
                  <div className="flex items-start gap-3">
                    <span className="p-2 mr-1 rounded-xl bg-accent/20 text-accent shrink-0">
                      🔔
                    </span>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                        Pending Approvals Alert
                      </h4>
                      <p className="text-xs text-text-secondary mt-0.5">
                        There are{" "}
                        <strong className="text-accent font-semibold">
                          {
                            store.players.filter(
                              (p) => (p.inviteStatus === "Pending" || p.inviteStatus === "Unverified") && !p.disabled,
                            ).length
                          }{" "}
                          registration request(s)
                        </strong>{" "}
                        awaiting verification.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab("club", "players")}
                    className="text-[10px] font-bold uppercase tracking-wider bg-accent text-text-accent px-4 py-2 rounded-xl hover:opacity-90 transition inline-flex items-center gap-1 shrink-0 self-start sm:self-auto cursor-pointer"
                    style={{ color: currentThemeObj.textAccent }}
                  >
                    Review <ArrowRight className="w-3.5 h-3.5 animate-pulse" />
                  </button>
                </motion.div>
              )}

            {/* Profile sync popup: opens automatically when a verified candidate exists */}
            {!effectiveIsAdminMode &&
              !player &&
              store.playersLoaded &&
              !profileSyncDismissed &&
              (existingPlayerWithSamePhone || (isGoogleLogin && existingPlayerWithSameEmail)) && (
                <ProfileSyncDialog
                  playerName={(existingPlayerWithSamePhone || existingPlayerWithSameEmail)!.name}
                  matchedBy={existingPlayerWithSamePhone ? "mobile" : "google"}
                  isSyncing={isRegistering}
                  onSync={handleSyncAccount}
                  onDismiss={dismissProfileSync}
                />
              )}

            {/* Unlinked account notice (admins bypass the registration/link gate) */}
            {!effectiveIsAdminMode && !player && store.playersLoaded && (
              <ProfileLinkNotice
                signedInWithPhone={isMobileAuth}
                signedInWithGoogle={!isMobileAuth && isGoogleLogin}
                candidate={
                  existingPlayerWithSamePhone
                    ? { id: existingPlayerWithSamePhone.id, name: existingPlayerWithSamePhone.name }
                    : isGoogleLogin && existingPlayerWithSameEmail
                      ? { id: existingPlayerWithSameEmail.id, name: existingPlayerWithSameEmail.name }
                      : null
                }
                isLinking={isRegistering}
                onLink={handleSyncAccount}
              />
            )}

            {/* Weekend match operations (Admin persona only; the fetch also feeds the
                persona-toggle indicator). Server decides what is due per verified role. */}
            {isAuthorizedAdmin && (
              <WeekendPrompts
                uid={user.uid}
                isAdmin={isAuthorizedAdmin}
                active={effectiveIsAdminMode}
                activeTab={activeTab}
                players={store.players}
                grounds={store.grounds}
                onPendingChange={setWeekendPending}
              />
            )}

            {/* Active Tab Screen Area */}
            {hasMissingMandatory ? (
              <div className="bg-surface rounded-2xl p-5 border border-red-500/30">
                <div className="bg-red-500/10 border border-red-500/20 text-red-300 p-4 rounded-xl mb-6 text-xs font-semibold text-left">
                  <div className="uppercase tracking-wider font-bold mb-2">
                    ⚠️ Complete your profile to continue
                  </div>
                  <div className="text-red-200/90 leading-relaxed normal-case">
                    The club needs the following before you can use the app.
                    Fill them in below and hit <span className="font-bold">Complete Registration</span>:
                  </div>
                  <ul className="mt-2 space-y-1 normal-case text-red-100">
                    {missingMandatoryLabels.map((label) => (
                      <li key={label} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                        {label}
                      </li>
                    ))}
                  </ul>
                </div>
                <ProfileTab store={store} forceEdit={true} />
              </div>
            ) : !effectiveIsAdminMode ? (
              <AnimatePresence mode="wait">
                {/* Player persona (D-16). Admin privileges are deliberately not
                    passed into any player screen: every component below receives
                    player-only flags, so a Super Admin here sees what a regular
                    player sees. Admin capabilities live in Admin persona only. */}
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                >
                  {(() => {
                    const back =
                      getPlayerBackLink(activeTab) ??
                      (activeTab === "notifications"
                        ? {
                            parent: lastPlayerPrimaryRef.current,
                            parentLabel: { home: "Home", club: "Club", matches: "Matches" }[lastPlayerPrimaryRef.current],
                            label: "Notifications",
                          }
                        : null);
                    if (!back) return null;
                    return (
                      <div className="mb-4 flex items-center gap-2" data-testid="player-back-bar">
                        <button
                          type="button"
                          data-testid="player-back-button"
                          onClick={() => setActiveTab(back.parent)}
                          className="min-h-[44px] inline-flex items-center gap-1.5 pl-2 pr-3 rounded-xl text-sm font-bold text-text-secondary hover:text-text-primary hover:bg-surface-hover transition cursor-pointer"
                          aria-label={`Back to ${back.parentLabel}`}
                        >
                          <ArrowRight className="w-4 h-4 rotate-180" aria-hidden="true" />
                          {back.parentLabel}
                        </button>
                        <span className="text-text-muted" aria-hidden="true">/</span>
                        <h2 className="text-sm font-bold text-text-primary truncate">{back.label}</h2>
                      </div>
                    );
                  })()}
                  {activeTab === "home" && (
                    <HomeTab
                      store={store}
                      isAdmin={false}
                      currentUserId={user.uid}
                      currentUserName={player?.name || user?.displayName || ""}
                      onNavigateToMatch={(matchId) => setActiveTab("matches", `match_${matchId}`)}
                      onNavigateToPayments={() => setActiveTab("finance")}
                      onNavigateToTab={setActiveTab}
                    />
                  )}
                  {activeTab === "matches" && (
                    <MatchesTab
                      store={store}
                      persona="player"
                      isMatchAdmin={false}
                      isSuperAdmin={false}
                      defaultAction={tabAction}
                    />
                  )}
                  {activeTab === "club" && (
                    <PlayerClubTab
                      store={store}
                      currentUserId={user.uid}
                      isFeatureEnabled={isFeatureEnabled}
                      onNavigate={(t: string, action?: string) => setActiveTab(t, action)}
                    />
                  )}
                  {activeTab === "profile" && (
                    <ProfileTab
                      store={store}
                      persona="player"
                      onNavigate={(t: string) => setActiveTab(t)}
                      onBack={() => setActiveTab(lastPlayerPrimaryRef.current)}
                    />
                  )}
                  {activeTab === "finance" && (
                    <FinanceTab
                      store={store}
                      persona="player"
                      isFinanceAdmin={false}
                      isSuperAdmin={false}
                    />
                  )}
                  {activeTab === "players" && (
                    <PlayerDirectory store={store} currentUserId={user.uid} />
                  )}
                  {activeTab === "announcements" && <ClubAnnouncementsScreen openId={tabAction} />}
                  {activeTab === "pulse" && <PulseScreen store={store} currentUserId={user.uid} />}
                  {activeTab === "leaderboard" && (
                    <LeaderboardTab store={store} persona="player" />
                  )}
                  {activeTab === "badges" && (
                    <BadgesTab
                      store={store}
                      isClubAdmin={false}
                      currentUserId={user?.uid || ""}
                      currentUserName={player?.name || user?.displayName || "Player"}
                    />
                  )}
                  {activeTab === "studio" && <StudioTab store={store} />}
                  {activeTab === "shop" && (
                    <ShopTab store={store} persona="player" isAdmin={false} />
                  )}
                  {activeTab === "opinion" && (
                    <OpinionTab store={store} persona="player" />
                  )}
                  {activeTab === "notifications" && (
                    <NotificationsTab store={store} persona="player" />
                  )}
                </motion.div>
              </AnimatePresence>
            ) : (
              <div className="space-y-6">
                {/* The "Admin Console · <hub>" context banner was removed: the header
                    already shows the persona toggle (Player View) for admins, so the
                    banner only repeated it and cost vertical space on every admin page. */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                  >
                    {/* Admin persona destinations (D-18). Each keeps its existing
                        role guard; the route guard above canonicalises legacy tab ids
                        (studio, grounds, opinion, leaderboard, shop, badges, players). */}
                    {activeTab === "home" && (
                      isAdminDestinationVisible("home", adminCaps) ? (
                        <AdminDashboard
                          store={store}
                          setActiveTab={setActiveTab}
                          isSuperAdmin={isSuperAdmin}
                          isFinanceAdmin={isFinanceAdmin}
                          isClubAdmin={isClubAdmin}
                          weekendPending={weekendPending}
                        />
                      ) : (
                        <AccessDenied feature="Admin Home" requiredRole="administrators" />
                      )
                    )}
                    {activeTab === "matches" && (
                      isMatchAdmin || isSuperAdmin || isClubAdmin ? (
                        <MatchesTab
                          store={store}
                          persona={persona}
                          isMatchAdmin={isMatchAdmin || isSuperAdmin || isClubAdmin}
                          isSuperAdmin={isSuperAdmin}
                          defaultAction={tabAction}
                        />
                      ) : (
                        <AccessDenied feature="Match Center" requiredRole="Club Admins" />
                      )
                    )}
                    {activeTab === "club" && (() => {
                      const clubSections = getVisibleClubSections(adminCaps, (f) => isFeatureEnabled(f));
                      return isAdminDestinationVisible("club", adminCaps, (f) => isFeatureEnabled(f)) ? (
                        <ClubTab
                          store={store}
                          sections={clubSections}
                          isClubAdmin={isClubAdmin || isSuperAdmin}
                          isSuperAdmin={isSuperAdmin}
                          isFinanceAdmin={isFinanceAdmin || isSuperAdmin}
                          isStudioAdmin={isStudioAdmin || isSuperAdmin}
                          currentUserId={user?.uid || ""}
                          currentUserName={player?.name || user?.displayName || "Admin"}
                          adminName={appUser?.name || "Admin"}
                          isFeatureEnabled={isFeatureEnabled}
                          defaultSubTab={tabAction}
                        />
                      ) : (
                        <AccessDenied feature="Club" requiredRole="Club Admins" />
                      );
                    })()}
                    {activeTab === "finance" && (
                      isFinanceAdmin || isSuperAdmin ? (
                        <FinanceTab
                          store={store}
                          persona="admin"
                          isFinanceAdmin={isFinanceAdmin || isSuperAdmin}
                          isSuperAdmin={isSuperAdmin}
                          defaultAction={tabAction}
                          onNavigateToSettings={isSuperAdmin ? () => setActiveTab("settings") : undefined}
                        />
                      ) : (
                        <AccessDenied feature="Finance" requiredRole="Finance Admins" />
                      )
                    )}
                    {activeTab === "design" && (
                      canDesign ? (
                        <DesignTab store={store} />
                      ) : (
                        <AccessDenied feature="Design Studio" requiredRole="Club Admins" />
                      )
                    )}
                    {activeTab === "settings" && (
                      isSuperAdmin ? (
                        <SettingsTab
                          store={store}
                          setPreviewTheme={setPreviewThemeId}
                          section={tabAction}
                          onSectionChange={(sec) => setActiveTab("settings", sec || undefined)}
                        />
                      ) : (
                        <AccessDenied feature="Settings" requiredRole="Super Admins" />
                      )
                    )}
                    {/* Global admin screens reached from the header. */}
                    {activeTab === "notifications" && (
                      <NotificationsTab store={store} persona={persona} />
                    )}
                    {activeTab === "profile" && <ProfileTab store={store} />}
                  </motion.div>
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </main>

      <MobileBottomNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isFeatureEnabled={isFeatureEnabled}
        persona={effectiveIsAdminMode ? "admin" : "player"}
        hasMissingMandatory={hasMissingMandatory}
        canDesign={canDesign}
        currentPlayerId={player?.id || user?.uid}
        adminPermissions={{
          isSuperAdmin: !!isSuperAdmin,
          isClubAdmin: !!isClubAdmin,
          isFinanceAdmin: !!isFinanceAdmin,
        }}
      />
    </div>
  );
}
