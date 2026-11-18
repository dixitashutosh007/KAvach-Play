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
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Home as HomeIcon,
  Trophy,
  CalendarDays,
  Map,
  Users,
  LogOut,
  Settings as SettingsIcon,
  ArrowRight,
  Shield,
  Video,
  Palette,
  Sparkles,
  Check,
  ChevronRight,
  ShoppingBag,
  X,
  ImageIcon,
  Wallet,
  CreditCard,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { HomeTab } from "@/components/HomeTab";
import { ProfileTab } from "@/components/ProfileTab";
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
import { db, auth } from "@/lib/firebase";
import { normalizeIndianMobile } from "@/lib/utils";

import { useTheme } from "@/hooks/useTheme";
import { PhoneSyncPrompt } from "@/components/onboarding/PhoneSyncPrompt";
import { RegistrationForm } from "@/components/onboarding/RegistrationForm";
import { PendingApprovalScreen } from "@/components/onboarding/PendingApprovalScreen";
import { RejectedScreen } from "@/components/onboarding/RejectedScreen";
import { AccountDisabledScreen } from "@/components/onboarding/AccountDisabledScreen";
import { QuotaExceededScreen } from "@/components/onboarding/QuotaExceededScreen";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { useToast } from "@/components/ui/Toast";

// Lazy-loaded tab components — only downloaded when the user navigates to them
const MatchesTab = dynamic(() => import("@/components/MatchesTab").then(m => ({ default: m.MatchesTab })), { ssr: false });
const GroundsTab = dynamic(() => import("@/components/GroundsTab").then(m => ({ default: m.GroundsTab })), { ssr: false });
const PlayersTab = dynamic(() => import("@/components/PlayersTab").then(m => ({ default: m.PlayersTab })), { ssr: false });
const LeaderboardTab = dynamic(() => import("@/components/LeaderboardTab").then(m => ({ default: m.LeaderboardTab })), { ssr: false });
const SettingsTab = dynamic(() => import("@/components/SettingsTab").then(m => ({ default: m.SettingsTab })), { ssr: false });
const AdminDashboard = dynamic(() => import("@/components/AdminDashboard").then(m => ({ default: m.AdminDashboard })), { ssr: false });
const StudioTab = dynamic(() => import("@/components/StudioTab").then(m => ({ default: m.StudioTab })), { ssr: false });
const StudioAdminTab = dynamic(() => import("@/components/StudioAdminTab").then(m => ({ default: m.StudioAdminTab })), { ssr: false });
const NotificationsTab = dynamic(() => import("@/components/NotificationsTab").then(m => ({ default: m.NotificationsTab })), { ssr: false });
const FinanceTab = dynamic(() => import("@/components/FinanceTab").then(m => ({ default: m.FinanceTab })), { ssr: false });
const DuesAndRemindersTab = dynamic(() => import("@/components/DuesAndRemindersTab").then(m => ({ default: m.DuesAndRemindersTab })), { ssr: false });
const ShopTab = dynamic(() => import("@/components/ShopTab").then(m => ({ default: m.ShopTab })), { ssr: false });
const OpinionTab = dynamic(() => import("@/components/OpinionTab").then(m => ({ default: m.OpinionTab })), { ssr: false });
const DesignTab = dynamic(() => import("@/components/DesignTab").then(m => ({ default: m.DesignTab })), { ssr: false });
const ClubTab = dynamic(() => import("@/components/ClubTab").then(m => ({ default: m.ClubTab })), { ssr: false });

export default function Home() {
  const router = useRouter();
  const {
    user,
    hasAdminClaim,
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
  >("home");
  const [tabAction, setTabAction] = useState<string | null>(null);

  const setActiveTab = useCallback((tab: any, action?: string) => {
    setActiveTabBase(tab);
    setTabAction(action || null);
  }, []);
  const activeTab = activeTabBase;
  const [persona, setPersona] = useState<"player" | "admin">("player");
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
  const isAdminUser =
    store.isLoaded &&
    user &&
    (isSuperAdminUser ||
      currentUserObj?.isStudioAdmin ||
      currentUserObj?.isMatchAdmin ||
      currentUserObj?.isFinanceAdmin ||
      currentUserObj?.isClubAdmin);

  useEffect(() => {
    if (isAdminUser && !hasInitializedAdminRef.current) {
      hasInitializedAdminRef.current = true;
      // In accordance with Decision D-10:
      // Standard Player View is the default experience for all club members on login,
      // including administrators. An authorized entry point into the Admin Console is
      // provided in the header.
    }
  }, [isAdminUser, currentUserObj, user]);

  // Set local current time for pure render and ticking countdowns
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000 * 30); // update every 30s
    return () => clearInterval(interval);
  }, []);

  // Enforce feature access
  useEffect(() => {
    if (persona === "player") {
      let redirect = false;
      if (activeTab === "home" && !isFeatureEnabled("feed")) redirect = true;
      if (activeTab === "matches" && !isFeatureEnabled("matches"))
        redirect = true;
      if (activeTab === "leaderboard" && !isFeatureEnabled("leaderboard"))
        redirect = true;
      if (activeTab === "studio" && !isFeatureEnabled("studio"))
        redirect = true;
      if (activeTab === "shop" && !isFeatureEnabled("shop"))
        redirect = true;

      if (redirect) {
        setTimeout(() => setActiveTab("profile"), 0);
      }
    }
  }, [persona, activeTab, isFeatureEnabled]);

  // Lazy Firestore subscriptions — only start the expensive payments and
  // otherFees collectionGroup listeners when the user actually opens a tab
  // that consumes them. Previously these ran for every logged-in user on
  // login. Idempotent: calling ensurePayments twice does nothing.
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
  const STATS_TABS = new Set(["club", "home"]);
  const MERCH_TABS = new Set(["club"]);
  const POLL_TABS = new Set(["club"]);
  const BADGE_TABS = new Set(["club", "home", "profile"]);
  const TOURNAMENT_TABS = new Set(["matches"]);
  const SUB_PLAN_TABS = new Set(["studio", "club"]);
  const FEE_TEMPLATE_TABS = new Set(["finance", "club"]);
  const FEE_PLAN_TABS = new Set(["matches", "finance", "club"]);
  const MERCH_CATALOG_TABS = new Set(["club"]);
  const OUT_OF_PLAY_TABS = new Set(["profile", "studio", "club"]);
  useEffect(() => {
    if (!store.isLoaded) return;
    // ARCH-001: Detach listeners when domain tab is no longer active
    if (!PAYMENT_TABS.has(activeTab)) store.detachDomain?.("allPayments");
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

    const playerScope = isAdminUser ? undefined : user?.uid;
    if (PAYMENT_TABS.has(activeTab)) store.ensurePayments?.(playerScope);
    if (OTHER_FEE_TABS.has(activeTab)) store.ensureOtherFees?.(playerScope);
    if (POSTS_TABS.has(activeTab)) store.ensurePosts?.();
    if (STATS_TABS.has(activeTab)) store.ensurePlayerStats?.();
    if (MERCH_TABS.has(activeTab)) store.ensureMerchOrders?.();
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
  }, [activeTab, store.isLoaded, isAdminUser, user, store.ensurePayments, store.ensureOtherFees, store.ensurePosts, store.ensurePlayerStats, store.ensureMerchOrders, store.ensurePolls, store.ensurePollResponses, store.ensureTournaments, store.ensureSubscriptionPlans, store.ensureFeeTemplates, store.ensureFeePlans, store.ensureMerchandises, store.ensureOutOfPlays, store.ensureBadges, store.ensureBadgeTypeDefs, store.detachDomain]);

  // Admin-only subscriptions: full appUsers collection (100+ PII docs) and
  // subscriptionHistory audit trail. Non-admin players never load these.
  useEffect(() => {
    if (!store.isLoaded) return;
    if (isAdminUser) {
      store.ensureAllAppUsers?.();
      store.ensureSubscriptionHistory?.();
    }
  }, [
    isAdminUser,
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
  const currentPlayerObj = store.players.find(
    (p) => p.id === user?.uid || p.authUid === user?.uid,
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

  const existingPlayerWithSameEmail =
    !isMobileAuth && user?.email
      ? store.players.find((p) => {
          if (!p.email || p.disabled || p.mergedInto) return false;
          return (
            p.email.trim().toLowerCase() === user.email!.trim().toLowerCase() &&
            p.id !== user?.uid
          );
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


  if (!store.isLoaded) {
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
      const oldUserDoc = doc(db, "appUsers", existingMatch.id);
      const oldUserSnap = await getDoc(oldUserDoc);
      const oldUserData = oldUserSnap.exists() ? oldUserSnap.data() : {};

      const userDoc = doc(db, "appUsers", user.uid);
      const userSnap = await getDoc(userDoc);

      if (!userSnap.exists()) {
        await setDoc(userDoc, {
          ...oldUserData,
          email:
            existingMatch.email ||
            user.email ||
            oldUserData.email ||
            "",
          name:
            existingMatch.name ||
            user.displayName ||
            oldUserData.name ||
            "",
          photoURL: user.photoURL || oldUserData.photoURL || "",
          role: oldUserData.role || "player",
          mobile: normalizeIndianMobile(user.phoneNumber || existingMatch.mobile || ""),
          isStudioMember: existingMatch.isStudioMember || false,
        });
      } else {
        if (user.photoURL && !userSnap.data().photoURL) {
          await updateDoc(userDoc, { photoURL: user.photoURL });
        }
      }

      const playerDoc = doc(db, "players", existingMatch.id);
      await updateDoc(playerDoc, {
        authUid: user.uid,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Error syncing profile:", err);
      toast("Failed to sync your profile. Please try again.", "error");
    } finally {
      setIsRegistering(false);
    }
  };

  // Registration submission moved into <RegistrationForm>.

  if (
    currentPlayerObj &&
    currentPlayerObj.inviteStatus === "Pending"
  ) {
    if (currentUserObj?.role !== "admin") {
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
  if (justRegistered && !currentPlayerObj && currentUserObj && currentUserObj.role !== "admin" && !user?.isAnonymous) {
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
  if (!currentPlayerObj && !user?.isAnonymous && user && currentUserObj?.role !== "admin") {
    const existingMatch = existingPlayerWithSamePhone || existingPlayerWithSameEmail;
    if (existingMatch) {
      return (
        <PhoneSyncPrompt
          existingPlayer={existingMatch}
          user={user}
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
  const player =
    store.players.find((p) => p.id === user.uid || p.authUid === user.uid) ||
    store.players.find((p) => p.mobile && appUser?.mobile && normalizeIndianMobile(p.mobile) === normalizeIndianMobile(appUser.mobile));

  if (player?.disabled) {
    return (
      <AccountDisabledScreen
        player={player}
        user={user}
        store={store}
        now={now}
      />
    );
  }

  const isSuperAdmin = !!hasAdminClaim;
  const isFinanceAdmin = isSuperAdmin || appUser?.isFinanceAdmin;
  const isStudioAdmin = isSuperAdmin || appUser?.isStudioAdmin;
  const isMatchAdmin = isSuperAdmin || appUser?.isMatchAdmin;
  const isClubAdmin = isSuperAdmin || appUser?.isClubAdmin;

  const isAdmin =
    isSuperAdmin || isFinanceAdmin || isStudioAdmin || isMatchAdmin || isClubAdmin;
  const canDesign = isClubAdmin || !!appUser?.isDesigner;
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
      {/* Dynamic Header */}
      <header className="bg-surface/95 backdrop-blur-xl border-b border-border fixed top-0 w-full z-40 p-2 sm:p-3 sm:px-6 flex items-center shadow-sm transition-all">
        <div className="max-w-7xl xl:max-w-[1440px] mx-auto w-full px-1 sm:px-2 md:px-4 flex items-center justify-between gap-2 sm:gap-4">
          <button onClick={() => setActiveTab("home")} className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 text-left cursor-pointer group">
            {logoUrl ? (
              <Image
                src={logoUrl}
                width={40}
                height={40}
                alt="Logo"
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover border border-border shrink-0 shadow-md group-hover:opacity-80 transition"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0 group-hover:bg-brand/20 transition">
                <Shield className="w-5 h-5 text-brand" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="font-black text-sm sm:text-lg md:text-xl tracking-tight text-brand truncate leading-tight uppercase group-hover:opacity-80 transition">
                {clubName}
              </h1>
            </div>
          </button>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {isAdmin && (
              <button
                onClick={() => {
                  if (persona === "admin") {
                    setPersona("player");
                    setActiveTab("home");
                  } else {
                    setPersona("admin");
                    if (isSuperAdmin) setActiveTab("home");
                    else if (isFinanceAdmin) setActiveTab("finance");
                    else if (isMatchAdmin) setActiveTab("matches");
                    else if (isStudioAdmin) setActiveTab("studio");
                    else if (isClubAdmin) setActiveTab("club");
                    else setActiveTab("home");
                  }
                }}
                className="min-h-[44px] px-2 sm:px-2.5 py-1.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider border border-brand/30 text-brand bg-brand/5 hover:bg-brand/10 rounded-lg transition shadow-inner cursor-pointer flex items-center justify-center gap-1"
                title={persona === "admin" ? "Switch to Player View" : "Enter Admin Console"}
              >
                <Shield className="w-3.5 h-3.5 shrink-0 text-brand" />
                <span className="hidden xs:inline">{persona === "admin" ? "Player View" : "Admin Console"}</span>
                <span className="xs:hidden">{persona === "admin" ? "Player" : "Admin"}</span>
              </button>
            )}

            <button
              onClick={() => setActiveTab("notifications")}
              className="relative min-h-[44px] min-w-[44px] rounded-full ring-2 ring-transparent hover:ring-brand/20 hover:bg-surface-hover transition flex items-center justify-center shrink-0 text-text-secondary hover:text-text-primary cursor-pointer"
              title="Notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-rose-500 rounded-full border border-surface animate-pulse" />
              )}
            </button>

            {(user.photoURL || appUser?.photoURL) && (
              <button
                onClick={() => setActiveTab("profile")}
                className="min-h-[44px] min-w-[44px] rounded-full ring-2 ring-transparent hover:ring-brand/20 hover:bg-surface-hover transition flex items-center justify-center shrink-0 cursor-pointer"
                title="My Profile"
              >
                <Image
                  src={user.photoURL || appUser?.photoURL || ""}
                  width={32}
                  height={32}
                  alt="Profile"
                  className="w-8 h-8 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </button>
            )}

            <button
              onClick={() => logOut()}
              className="min-h-[44px] text-[9px] sm:text-[10px] font-bold uppercase tracking-widest border border-border text-text-secondary px-2 sm:px-2.5 py-1.5 rounded-lg hover:bg-surface-hover hover:text-text-primary transition hidden sm:flex items-center justify-center gap-1 shrink-0 cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Exit</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Responsive Workspace */}
      <main className="max-w-7xl xl:max-w-[1440px] mx-auto px-4 md:px-6 lg:px-8 pt-24 sm:pt-28 pb-12">
        <div className="md:grid md:grid-cols-12 md:gap-6 lg:gap-8 items-start animate-fade-in">
          {/* LEFT PANEL: Live Desktop Sidebar Panel (Hidden on Mobile, Beautiful on Desktop) */}
          <div className="hidden md:block md:col-span-4 lg:col-span-3 space-y-6 sticky top-28">
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
                  const myPlayers = store.players.filter(
                    (p) =>
                      p.id === appUser?.id ||
                      p.authUid === appUser?.id ||
                      (appUser?.mobile && p.mobile && normalizeIndianMobile(p.mobile) === normalizeIndianMobile(appUser.mobile)),
                  );
                  let dueValue = 0;
                  if (myPlayers.length > 0) {
                    const matchDue = store.payments
                      .filter(
                        (p) =>
                          myPlayers.some((mp) => mp.id === p.playerId) &&
                          p.status === "Unpaid",
                      )
                      .reduce(
                        (total, p) =>
                          total +
                          (store.matches.find((m) => m.id === p.matchId)?.fee ||
                            0),
                        0,
                      );
                    const otherFeeDue =
                      store.otherFees
                        ?.filter(
                          (f) =>
                            myPlayers.some((mp) => mp.id === f.playerId) &&
                            f.status === "Unpaid",
                        )
                        .reduce((total, f) => total + (f.amount || 0), 0) || 0;
                    dueValue = matchDue + otherFeeDue;
                  }

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

              {persona === "player" ? (
                <>
                  {isFeatureEnabled("feed") && (
                    <button
                      onClick={() => setActiveTab("home")}
                      className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                        activeTab === "home"
                          ? "bg-accent text-text-accent"
                          : "text-text-secondary hover:bg-surface-hover"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <HomeIcon className="w-4.5 h-4.5 shrink-0" /> Home
                      </span>
                      <ChevronRight className="w-4 h-4 opacity-40 group-hover:translate-x-1 transition-transform" />
                    </button>
                  )}

                  {isFeatureEnabled("matches") && (
                    <button
                      onClick={() => setActiveTab("matches")}
                      className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                        activeTab === "matches"
                          ? "bg-accent text-text-accent"
                          : "text-text-secondary hover:bg-surface-hover"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <CalendarDays className="w-4.5 h-4.5 shrink-0" /> Matches
                      </span>
                      <ChevronRight className="w-4 h-4 opacity-40 group-hover:translate-x-1 transition-transform" />
                    </button>
                  )}

                  <button
                    onClick={() => setActiveTab("finance")}
                    className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                      activeTab === "finance" || activeTab === "dues_and_reminders"
                        ? "bg-accent text-text-accent"
                        : "text-text-secondary hover:bg-surface-hover"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Wallet className="w-4.5 h-4.5 shrink-0" /> Payments
                    </span>
                    <ChevronRight className="w-4 h-4 opacity-40 group-hover:translate-x-1 transition-transform" />
                  </button>

                  {isFeatureEnabled("leaderboard") && (
                    <button
                      onClick={() => setActiveTab("leaderboard")}
                      className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                        activeTab === "leaderboard"
                          ? "bg-accent text-text-accent"
                          : "text-text-secondary hover:bg-surface-hover"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Trophy className="w-4.5 h-4.5 shrink-0" /> Performance
                      </span>
                      <ChevronRight className="w-4 h-4 opacity-40 group-hover:translate-x-1 transition-transform" />
                    </button>
                  )}

                  <button
                    onClick={() => setActiveTab("club")}
                    className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                      activeTab === "club"
                        ? "bg-accent text-text-accent"
                        : "text-text-secondary hover:bg-surface-hover"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Users className="w-4.5 h-4.5 shrink-0" /> Club
                    </span>
                    <ChevronRight className="w-4 h-4 opacity-40 group-hover:translate-x-1 transition-transform" />
                  </button>
                </>
              ) : (
                <div className="space-y-1">
                  {([
                    { tab: "home", label: "Overview", icon: HomeIcon, show: true },
                    { tab: "matches", label: "Match Centre", icon: CalendarDays, show: isMatchAdmin },
                    { tab: "club", label: "Player Roster", icon: Users, show: isClubAdmin },
                    { tab: "finance", label: "Finance & Dues", icon: Shield, show: isFinanceAdmin },
                    { tab: "studio", label: "Studio & Nets", icon: Video, show: isStudioAdmin },
                    { tab: "design", label: "Design Studio", icon: ImageIcon, show: canDesign },
                    { tab: "settings", label: "Settings & Access", icon: SettingsIcon, show: isSuperAdmin },
                  ] as const)
                    .filter((item) => item.show)
                    .map((item) => {
                      const IconComp = item.icon;
                      return (
                        <button
                          key={item.tab}
                          data-testid={`sidebar-tab-${item.tab}`}
                          onClick={() => setActiveTab(item.tab as any)}
                          className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                            activeTab === item.tab
                              ? "bg-accent text-text-accent"
                              : "text-text-secondary hover:bg-surface-hover"
                          }`}
                        >
                          <span className="flex items-center gap-2.5 uppercase text-[11px]">
                            <IconComp
                              className="w-4 h-4 text-accent group-hover:scale-110 transition-transform"
                              style={
                                activeTab === item.tab
                                  ? { color: "#000" }
                                  : undefined
                              }
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
          <div className="col-span-1 md:col-span-8 lg:col-span-9 space-y-6">
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
            ) : persona === "player" ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                >
                  {activeTab === "home" && (
                    <HomeTab
                      store={store}
                      isAdmin={false}
                      currentUserId={user.uid}
                      currentUserName={player?.name || "Player"}
                      onNavigateToMatch={(matchId) => setActiveTab("matches", `match_${matchId}`)}
                      onNavigateToPayments={() => setActiveTab("finance")}
                    />
                  )}
                  {activeTab === "matches" && (
                    <MatchesTab
                      store={store}
                      persona={persona}
                      isMatchAdmin={isMatchAdmin || isSuperAdmin || isClubAdmin}
                      isSuperAdmin={isSuperAdmin}
                      defaultAction={tabAction}
                    />
                  )}
                  {activeTab === "finance" && (
                    <FinanceTab
                      store={store}
                      persona={persona}
                      isFinanceAdmin={false}
                      isSuperAdmin={false}
                    />
                  )}
                  {activeTab === "leaderboard" && (
                    <LeaderboardTab store={store} persona={persona} />
                  )}
                  {activeTab === "studio" && <StudioTab store={store} />}
                  {activeTab === "shop" && (
                    <ShopTab store={store} persona={persona} isAdmin={false} />
                  )}
                  {activeTab === "opinion" && (
                    <OpinionTab store={store} persona={persona} />
                  )}
                  {activeTab === "design" && canDesign && (
                    <DesignTab store={store} />
                  )}
                  {activeTab === "profile" && <ProfileTab store={store} />}
                  {activeTab === "club" && (
                    <ClubTab
                      store={store}
                      persona={persona}
                      canDesign={canDesign}
                      isFinanceAdmin={isFinanceAdmin || isSuperAdmin}
                      isClubAdmin={isClubAdmin || isSuperAdmin}
                      isSuperAdmin={isSuperAdmin}
                      currentUserId={user?.uid || ""}
                      currentUserName={player?.name || user?.displayName || "Player"}
                      isFeatureEnabled={isFeatureEnabled}
                      defaultSubTab={tabAction as any}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            ) : (
              <div className="space-y-6">
                {/* Admin Hub Context Banner (replaces redundant mobile pill bar UX-P1-01) */}
                <div
                  data-testid="admin-hub-context-banner"
                  className="flex items-center justify-between bg-surface border border-brand/20 rounded-xl px-3 sm:px-4 py-2.5 shadow-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-brand animate-pulse shrink-0" />
                    <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-brand truncate">
                      Admin Console · {
                        activeTab === "home" ? "Overview" :
                        activeTab === "matches" ? "Match Centre" :
                        activeTab === "finance" ? "Finance & Dues" :
                        activeTab === "club" ? "Player Roster" :
                        activeTab === "studio" ? "Studio & Nets" :
                        activeTab === "design" ? "Design Studio" :
                        activeTab === "settings" ? "Settings & Access" :
                        "Workspace"
                      }
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setPersona("player");
                      setActiveTab("home");
                    }}
                    className="text-[10px] font-bold uppercase tracking-wider text-text-secondary hover:text-brand transition flex items-center gap-1 cursor-pointer shrink-0 ml-2"
                    title="Return to Player View"
                  >
                    <span>Player View</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                  >
                    {activeTab === "home" && (
                      <AdminDashboard
                        store={store}
                        setActiveTab={setActiveTab}
                        isSuperAdmin={isSuperAdmin}
                        isFinanceAdmin={isFinanceAdmin}
                        isMatchAdmin={isMatchAdmin}
                        isStudioAdmin={isStudioAdmin}
                        isClubAdmin={isClubAdmin}
                      />
                    )}
                    {activeTab === "club" && (
                      <ClubTab
                        store={store}
                        persona={persona}
                        canDesign={canDesign}
                        isFinanceAdmin={isFinanceAdmin || isSuperAdmin}
                        isClubAdmin={isClubAdmin || isSuperAdmin}
                        isSuperAdmin={isSuperAdmin}
                        currentUserId={user?.uid || ""}
                        currentUserName={player?.name || user?.displayName || "Admin"}
                        isFeatureEnabled={isFeatureEnabled}
                        defaultSubTab={tabAction as any}
                      />
                    )}
                    {activeTab === "matches" && (
                      <MatchesTab
                        store={store}
                        persona={persona}
                        isMatchAdmin={isMatchAdmin || isSuperAdmin || isClubAdmin}
                        isSuperAdmin={isSuperAdmin}
                        defaultAction={tabAction}
                      />
                    )}
                    {activeTab === "studio" && (
                      <StudioAdminTab
                        store={store}
                        adminId={user.uid}
                        adminName={appUser?.name || "Admin"}
                        persona={persona}
                        isStudioAdmin={isStudioAdmin || isSuperAdmin}
                        isSuperAdmin={isSuperAdmin}
                        defaultAction={tabAction}
                        isFeatureEnabled={isFeatureEnabled}
                      />
                    )}
                    {activeTab === "notifications" && (
                      <NotificationsTab store={store} persona={persona} />
                    )}
                    {activeTab === "design" && canDesign && (
                      <DesignTab store={store} />
                    )}
                    {activeTab === "settings" && <SettingsTab store={store} setPreviewTheme={setPreviewThemeId} />}
                    {activeTab === "profile" && <ProfileTab store={store} />}
                    {activeTab === "finance" && (
                      <FinanceTab
                        store={store}
                        persona={persona}
                        isFinanceAdmin={isFinanceAdmin || isSuperAdmin}
                        isSuperAdmin={isSuperAdmin}
                        defaultAction={tabAction}
                      />
                    )}
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
        persona={persona}
        hasMissingMandatory={hasMissingMandatory}
        canDesign={canDesign}
        currentPlayerId={player?.id || user?.uid}
      />
    </div>
  );
}
