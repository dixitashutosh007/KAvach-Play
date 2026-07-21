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
import { GroundsTab } from "@/components/GroundsTab";
import { PlayersTab } from "@/components/PlayersTab";
import { MatchesTab } from "@/components/MatchesTab";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
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
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { HomeTab } from "@/components/HomeTab";
import { LeaderboardTab } from "@/components/LeaderboardTab";
import { SettingsTab } from "@/components/SettingsTab";
import { AdminDashboard } from "@/components/AdminDashboard";
import { ProfileTab } from "@/components/ProfileTab";
import { StudioTab } from "@/components/StudioTab";
import { StudioAdminTab } from "@/components/StudioAdminTab";
import { NotificationsTab } from "@/components/NotificationsTab";
import { FinanceTab } from "@/components/FinanceTab";
import { DuesAndRemindersTab } from "@/components/DuesAndRemindersTab";
import { ShopTab } from "@/components/ShopTab";
import { OpinionTab } from "@/components/OpinionTab";
import { LoadingScreen } from "@/components/LoadingScreen";
import { motion, AnimatePresence } from "motion/react";
import { Bell, PieChart } from "lucide-react";
import Image from "next/image";
import { PhoneLoginForm } from "@/components/PhoneLoginForm";
import {
  doc,
  setDoc,
  serverTimestamp,
  getDoc,
  updateDoc,
  getDocFromServer,
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";

import { useTheme } from "@/hooks/useTheme";
import { PhoneSyncPrompt } from "@/components/onboarding/PhoneSyncPrompt";
import { RegistrationForm } from "@/components/onboarding/RegistrationForm";
import { PendingApprovalScreen } from "@/components/onboarding/PendingApprovalScreen";
import { RejectedScreen } from "@/components/onboarding/RejectedScreen";
import { AccountDisabledScreen } from "@/components/onboarding/AccountDisabledScreen";

export default function Home() {
  const router = useRouter();
  const {
    user,
    hasAdminClaim,
    signIn,
    signInDemo,
    signInWithEmail,
    linkGoogleAccount,
    logOut,
  } = useAuth();
  const store = useStore(user);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [minWaitDone, setMinWaitDone] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinWaitDone(true), 1500);
    return () => clearTimeout(timer);
  }, []);

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

  // Email login states
  const [emailForm, setEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setAuthError("");
    setIsGoogleLoading(true);
    try {
      await signIn();
    } catch (err: any) {
      setAuthError(err.message || "Authentication failed.");
    } finally {
      setIsGoogleLoading(false);
    }
  };

  // Initialize admin view default tab
  const hasInitializedAdminRef = useRef(false);
  const currentUserObj =
    store.isLoaded && user
      ? store.appUsers.find((u) => u.id === user.uid)
      : null;
  const isAdminUser =
    store.isLoaded &&
    user &&
    (currentUserObj?.role === "admin" ||
      currentUserObj?.isStudioAdmin ||
      currentUserObj?.isMatchAdmin ||
      currentUserObj?.isFinanceAdmin ||
      hasAdminClaim);

  useEffect(() => {
    if (isAdminUser && !hasInitializedAdminRef.current) {
      hasInitializedAdminRef.current = true;
      setPersona("admin");
      if (
        currentUserObj?.role === "admin" ||
        hasAdminClaim
      ) {
        setActiveTab("home");
      } else if (currentUserObj?.isFinanceAdmin) {
        setActiveTab("finance");
      } else if (currentUserObj?.isStudioAdmin) {
        setActiveTab("studio");
      } else if (currentUserObj?.isMatchAdmin) {
        setActiveTab("matches");
      }
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
    "dues_and_reminders",
    "profile",
    "players",
    "studio",
    "settings",
  ]);
  const OTHER_FEE_TABS = new Set([
    "home",
    "finance",
    "dues_and_reminders",
    "players",
    "profile",
  ]);
  useEffect(() => {
    if (!store.isLoaded) return;
    if (PAYMENT_TABS.has(activeTab)) store.ensurePayments?.();
    if (OTHER_FEE_TABS.has(activeTab)) store.ensureOtherFees?.();
  }, [activeTab, store.isLoaded, store.ensurePayments, store.ensureOtherFees]);

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

  const hasPhoneAuth =
    user &&
    !user.isAnonymous &&
    user.providerData?.some((p) => p.providerId === "phone");

  const needsGoogleSync =
    user &&
    !user.isAnonymous &&
    user.providerData &&
    !hasPhoneAuth &&
    !user.providerData.some((p) => p.providerId === "google.com");

  const isMobileAuth = !!user?.phoneNumber;
  const currentPlayerObj = store.players.find(
    (p) => p.id === user?.uid || p.authUid === user?.uid,
  );
  const existingPlayerWithSamePhone =
    isMobileAuth && user?.phoneNumber
      ? store.players.find((p) => {
          const profileMobile = (p.mobile || "").replace(/[^0-9]/g, "");
          const authMobile = (user.phoneNumber || "").replace(/[^0-9]/g, "");
          return (
            profileMobile &&
            authMobile &&
            (authMobile.endsWith(profileMobile) ||
              profileMobile.endsWith(authMobile)) &&
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
      <div
        className="min-h-screen relative flex flex-col items-center justify-center p-4 overflow-hidden z-10"
        style={themeStyles}
      >
        {/* Animated ambient background orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <motion.div
            animate={{
              scale: [1, 1.25, 1],
              x: [0, 40, 0],
              y: [0, -30, 0],
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute top-1/4 -left-20 w-80 h-80 rounded-full bg-accent/10 blur-3xl pointer-events-none"
          />
          <motion.div
            animate={{
              scale: [1.3, 1, 1.3],
              x: [0, -40, 0],
              y: [0, 40, 0],
            }}
            transition={{
              duration: 12,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute bottom-1/4 -right-20 w-80 h-80 rounded-full bg-accent/5 blur-3xl pointer-events-none"
          />
        </div>

        {/* Decorative background vectors */}
        <div className="absolute inset-0 pointer-events-none z-0">
          <motion.div
            animate={{ y: [0, -12, 0], rotate: [0, 360] }}
            transition={{ duration: 16, repeat: Infinity, ease: "linear" }}
            className="absolute top-1/4 right-1/4 opacity-10"
          >
            <Trophy className="h-6 w-6 text-accent" />
          </motion.div>
          <motion.div
            animate={{ y: [0, 12, 0], rotate: [0, -360] }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="absolute bottom-1/3 left-1/4 opacity-5"
          >
            <Shield className="h-5 w-5 text-accent" />
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.93 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            type: "spring",
            stiffness: 90,
            damping: 15,
            mass: 0.9,
            delay: 0.05,
          }}
          className="glass relative p-8 sm:p-10 rounded-2xl max-w-sm w-full text-center border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl z-10"
        >
          {/* Subtle top decoration glow bar */}
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

          <div className="mb-8">
            <motion.div
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{
                type: "spring",
                stiffness: 180,
                damping: 12,
                delay: 0.25,
              }}
              className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-accent/20 to-accent/5 rounded-2xl border border-accent/20 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.15)] animate-pulse"
            >
              <Shield className="w-8 h-8 text-accent" />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
            >
              <h1 className="font-extrabold text-4xl tracking-tight text-white mb-1.5">
                Kavach Play
              </h1>
              <span className="text-accent/80 text-[10px] font-bold uppercase tracking-[0.3em] block mb-3">
                Sports Management Portal
              </span>
              <p className="text-white/60 text-xs leading-relaxed max-w-[280px] mx-auto">
                Kavach Play provides a comprehensive suite of tools to manage
                your cricket club. Track player records, manage finances,
                monitor match statistics via leaderboards, and schedule match
                fixtures with ease. Sign in to access your club profile!
              </p>
            </motion.div>
          </div>

          {authMethod === "phone" ? (
            <PhoneLoginForm
              onOtherOptions={() => setAuthMethod("google_email")}
              themeAccent={currentThemeObj.accent}
              themeTextAccent={currentThemeObj.textAccent}
            />
          ) : !emailForm ? (
            <div className="space-y-4">
              <motion.button
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleGoogleSignIn}
                disabled={isGoogleLoading}
                className="w-full cursor-pointer bg-white text-black font-extrabold py-4 px-8 rounded-2xl hover:opacity-90 transition-all shadow-[0_4px_25px_rgba(255,255,255,0.25)] flex items-center justify-center gap-3"
              >
                {isGoogleLoading ? (
                  <div className="w-6 h-6 border-2 border-black/50 border-t-black rounded-full animate-spin" />
                ) : (
                  <svg className="w-6 h-6" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                )}
                <span className="text-base tracking-wide">
                  {isGoogleLoading ? "Connecting..." : "Sign in with Google"}
                </span>
              </motion.button>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.45 }}
                className="text-xs text-white/50 pt-2 flex flex-col items-center gap-2"
              >
                <div className="flex items-center w-full max-w-[200px] mb-2">
                  <div className="flex-1 h-px bg-white/10"></div>
                  <span className="px-3 text-[9px] uppercase tracking-widest text-white/40 font-bold">
                    Or
                  </span>
                  <div className="flex-1 h-px bg-white/10"></div>
                </div>
                <button
                  onClick={() => setEmailForm(true)}
                  className="font-medium text-white/60 hover:text-white transition underline-offset-4 cursor-pointer focus:outline-none"
                >
                  Log in with Email & Password
                </button>
                <button
                  onClick={() => setAuthMethod("phone")}
                  className="font-medium text-white/60 hover:text-white transition underline-offset-4 cursor-pointer focus:outline-none pt-1"
                >
                  &larr; Back to Mobile Login
                </button>
              </motion.div>
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!email || !password) {
                  setAuthError("Please fill in both email and password.");
                  return;
                }
                setAuthError("");
                setIsSubmitting(true);
                try {
                  await signInWithEmail(email, password);
                } catch (err: any) {
                  setAuthError(err.message || "Authentication failed.");
                } finally {
                  setIsSubmitting(false);
                }
              }}
              className="space-y-4 text-left"
            >
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/60">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-accent transition"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/60">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-accent transition"
                  required
                  minLength={6}
                />
              </div>

              {authError && (
                <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-lg">
                  {authError}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEmailForm(false);
                    setAuthError("");
                  }}
                  className="flex-1 py-3 px-4 rounded-xl border border-white/10 text-white text-xs font-bold hover:bg-white/5 transition cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-3 px-4 rounded-xl bg-accent text-black text-xs font-bold hover:opacity-95 transition shadow-[0_4px_12px_rgba(16,185,129,0.15)] flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                  style={{ color: currentThemeObj.textAccent }}
                >
                  {isSubmitting ? (
                    <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>Submit</span>
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </motion.div>

        {/* Footer with Privacy Policy */}
        <div className="absolute bottom-6 left-0 right-0 flex flex-col items-center justify-center gap-2 z-10">
          <p className="text-white/30 text-[10px]">
            &copy; {new Date().getFullYear()} Kavach Play. All rights reserved.
          </p>
          <div className="flex gap-4">
            <Link
              href="/policy"
              className="text-white/50 hover:text-white text-[10px] tracking-wide transition underline-offset-4 hover:underline"
            >
              Privacy Policy
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!store.isLoaded || !minWaitDone) {
    if (quotaExceeded) {
      return (
        <div
          className="min-h-screen flex flex-col items-center justify-center p-4 text-center"
          style={themeStyles}
        >
          <div className="glass max-w-lg w-full p-8 rounded-2xl border border-amber-500/30 space-y-6 shadow-xl leading-relaxed">
            <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-2 border border-amber-500/30">
              <span className="text-2xl">⚠️</span>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold uppercase tracking-wider text-white">
                Database Quota Exceeded
              </h2>
              <p className="text-xs text-white/70 leading-relaxed">
                This database has exceeded the free daily read limits. Daily
                read operations are currently suspended until the quota resets
                tomorrow.
              </p>
            </div>
            <div className="bg-white/5 p-4 rounded-xl text-left border border-white/5 space-y-3">
              <h4 className="text-[11px] font-bold text-accent uppercase tracking-wider">
                How to resolve immediately:
              </h4>
              <p className="text-[11px] text-white/50 leading-relaxed">
                You can instantly upgrade the database to the pay-as-you-go Plan
                (Flame/Blaze) via the Google Firebase Console. Simply click the
                link below and enable billing.
              </p>
              <a
                href="https://console.firebase.google.com/project/gen-lang-client-0004191483/firestore/databases/ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412/data?openUpgradeDialog=true"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:opacity-90 transition text-black font-bold uppercase tracking-widest text-[10px] rounded-xl shadow-md cursor-pointer mt-2"
              >
                <span>Upgrade Database</span>
                <ArrowRight className="w-3.5 h-3.5 animate-pulse" />
              </a>
            </div>
          </div>
        </div>
      );
    }
    return <LoadingScreen theme={store.appConfig?.loadingAnimationTheme || "radar"} />;
  }


  const handleSyncAccount = async () => {
    if (!user || !existingPlayerWithSamePhone) return;
    setIsRegistering(true);
    try {
      // Find old appUsers doc to preserve roles if necessary
      const oldUserDoc = doc(db, "appUsers", existingPlayerWithSamePhone.id);
      const oldUserSnap = await getDoc(oldUserDoc);
      const oldUserData = oldUserSnap.exists() ? oldUserSnap.data() : {};

      // Create the user profile reference using their NEW auth user.uid
      const userDoc = doc(db, "appUsers", user.uid);
      const userSnap = await getDoc(userDoc);

      if (!userSnap.exists()) {
        await setDoc(userDoc, {
          ...oldUserData,
          email:
            existingPlayerWithSamePhone.email ||
            user.email ||
            oldUserData.email ||
            "",
          name:
            existingPlayerWithSamePhone.name ||
            user.displayName ||
            oldUserData.name ||
            "",
          photoURL: user.photoURL || oldUserData.photoURL || "",
          role: oldUserData.role || "player", // preserve old role
          mobile: user.phoneNumber || existingPlayerWithSamePhone.mobile || "",
          isStudioMember: existingPlayerWithSamePhone.isStudioMember || false,
        });
      } else {
        // If the user already had a document, just make sure photoURL is somewhat preserved if they had one
        if (user.photoURL && !userSnap.data().photoURL) {
          await updateDoc(userDoc, { photoURL: user.photoURL });
        }
      }

      // Instead of duplicating the old player, we just tell the old player document that
      // we are the authenticating UID for it.
      // Firestore rules have been updated to support `isSelf` via authUid field.
      const playerDoc = doc(db, "players", existingPlayerWithSamePhone.id);
      await updateDoc(playerDoc, {
        authUid: user.uid,
        updatedAt: serverTimestamp(),
      });
      // The store.players will pick this up on snapshot, and currentPlayerObj will find it via authUid matching.
    } catch (err) {
      console.error("Error syncing profile:", err);
      // Wait for 2 secs so user can be alerted, if we had an alert box.
    } finally {
      setIsRegistering(false);
    }
  };

  // Registration submission moved into <RegistrationForm>.

  if (!currentPlayerObj && !currentUserObj && !user?.isAnonymous && user) {
    if (existingPlayerWithSamePhone) {
      return (
        <PhoneSyncPrompt
          existingPlayer={existingPlayerWithSamePhone}
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
        onLogOut={logOut}
        themeStyles={themeStyles}
        accentColor={currentThemeObj.accent}
        textAccentColor={currentThemeObj.textAccent}
      />
    );
  }

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

  if (needsGoogleSync) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-4 text-center"
        style={themeStyles}
      >
        <div className="glass max-w-sm w-full p-8 rounded-2xl border border-white/10 flex flex-col items-center shadow-xl space-y-6">
          <svg className="w-16 h-16 text-white mb-2" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <div className="space-y-2">
            <h2 className="text-xl font-bold uppercase tracking-wider text-white">
              Sync Google Account
            </h2>
            <p className="text-xs text-white/70 leading-relaxed pb-2">
              For better security and a faster login experience, we are
              transitioning to Google Sign-In.
              <br />
              <br />
              Please link your account now.
            </p>
          </div>
          <button
            onClick={async () => {
              try {
                await linkGoogleAccount();
              } catch (e: any) {
                alert(e.message);
              }
            }}
            className="w-full py-3.5 px-6 rounded-xl bg-white text-black font-extrabold hover:opacity-95 transition-all shadow-[0_4px_15px_rgba(255,255,255,0.2)] flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Link Google Account</span>
          </button>
        </div>
      </div>
    );
  }

  const clubName = store.appConfig?.clubName || "KAVACH CRICKET CLUB";
  const logoUrl = store.appConfig?.logoUrl;

  const appUser = store.appUsers.find((u) => u.id === user.uid);
  const player =
    store.players.find((p) => p.id === user.uid || p.authUid === user.uid) ||
    store.players.find((p) => p.mobile === appUser?.mobile && p.mobile);

  if (player?.disabled) {
    return <AccountDisabledScreen />;
  }

  const isSuperAdmin =
    appUser?.role === "admin" || hasAdminClaim;
  const isFinanceAdmin = isSuperAdmin || appUser?.isFinanceAdmin;
  const isStudioAdmin = isSuperAdmin || appUser?.isStudioAdmin;
  const isMatchAdmin = isSuperAdmin || appUser?.isMatchAdmin;

  const isAdmin =
    isSuperAdmin || isFinanceAdmin || isStudioAdmin || isMatchAdmin;
  const hasMissingMandatory =
    !isAdmin &&
    (!appUser?.name ||
      !appUser?.dob ||
      !appUser?.locality ||
      !appUser?.bloodGroup ||
      !appUser?.emergencyContact ||
      !appUser?.mobile);
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
            <p className="text-white/60 text-xs uppercase tracking-widest font-semibold">
              Complete Registration
            </p>
          </div>
          <ProfileTab store={store} forceEdit={true} />
          <div className="mt-8 text-center">
            <button
              onClick={logOut}
              className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest transition"
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
      <header className="bg-black/60 backdrop-blur-xl border-b border-glass-border fixed top-0 w-full z-40 p-3 sm:px-6 flex items-center shadow-lg transition-all">
        <div className="max-w-7xl xl:max-w-[1440px] mx-auto w-full px-1 sm:px-2 md:px-4 flex items-center justify-between gap-4">
          <button onClick={() => setActiveTab("home")} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer group">
            {logoUrl ? (
              <Image
                src={logoUrl}
                width={40}
                height={40}
                alt="Logo"
                className="w-10 h-10 rounded-full object-cover border border-glass-border shrink-0 shadow-md group-hover:opacity-80 transition"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-accent/15 border border-accent/20 flex items-center justify-center shrink-0 group-hover:bg-accent/25 transition">
                <Shield className="w-5 h-5 text-accent" />
              </div>
            )}
            <div>
              <h1 className="font-black text-lg sm:text-xl tracking-tight text-accent break-words leading-none uppercase group-hover:text-accent/80 transition">
                {clubName}
              </h1>
            </div>
          </button>

          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {isAdmin && (
              <button
                onClick={() => {
                  if (persona === "admin") {
                    setPersona("player");
                    setActiveTab("home");
                  } else {
                    setPersona("admin");
                    if (isMatchAdmin) setActiveTab("matches");
                    else if (isStudioAdmin) setActiveTab("studio");
                    else if (isFinanceAdmin) setActiveTab("finance");
                    else setActiveTab("home");
                  }
                }}
                className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest border border-accent/30 text-accent px-2.5 py-1.5 rounded-lg hover:bg-accent/10 transition shadow-inner cursor-pointer"
              >
                {persona === "admin" ? "View Player" : "Manage Admin"}
              </button>
            )}

            <button
              onClick={() => setActiveTab("notifications")}
              className="relative p-1.5 rounded-full ring-2 ring-transparent hover:ring-accent transition flex shrink-0 shadow text-white/70 hover:text-white"
              title="Notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-rose-500 rounded-full border border-black animate-pulse" />
              )}
            </button>

            {(user.photoURL || appUser?.photoURL) && (
              <button
                onClick={() => setActiveTab("profile")}
                className="p-0.5 rounded-full ring-2 ring-transparent hover:ring-accent transition flex shrink-0 shadow"
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
              className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest border border-white/10 text-white/60 px-2.5 py-1.5 rounded-lg hover:bg-white/10 hover:text-white transition flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Exit</span>
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
            <div className="glass rounded-2xl p-5 border border-glass-border flex flex-col relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-accent/10 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center gap-4.5">
                {user.photoURL || appUser?.photoURL ? (
                  <Image
                    src={user.photoURL || appUser?.photoURL || ""}
                    width={56}
                    height={56}
                    alt="User Avatar"
                    className="w-14 h-14 rounded-full border border-glass-border object-cover shrink-0 shadow-md"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                    <Users className="w-7 h-7 text-accent" />
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-extrabold text-white text-base leading-tight truncate">
                    {appUser?.name || "Profile"}
                  </h3>
                  <p className="text-white/40 text-xs truncate mt-0.5">
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
              <div className="grid grid-cols-2 gap-2 mt-5 pt-4 border-t border-glass-border text-center">
                {(() => {
                  const myPlayers = store.players.filter(
                    (p) =>
                      p.id === appUser?.id ||
                      p.authUid === appUser?.id ||
                      (appUser?.mobile && p.mobile === appUser.mobile),
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
                      <div className="text-[9px] text-white/40 uppercase font-black tracking-wider">
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
                        className="block w-full text-left bg-white/5 p-2.5 rounded-xl border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer"
                        title="Click to view and pay dues"
                      >
                        {innerContent}
                      </button>
                    );
                  }
                  return (
                    <div className="bg-white/5 p-2.5 rounded-xl border border-white/5">
                      {innerContent}
                    </div>
                  );
                })()}
                <div className="bg-white/5 p-2.5 rounded-xl border border-white/5">
                  <div className="text-[9px] text-white/40 uppercase font-black tracking-wider">
                    Blood Group
                  </div>
                  <div className="text-xs font-bold text-accent mt-1">
                    {appUser?.bloodGroup || "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* Desktop Navigation Link Column */}
            <div className="glass rounded-2xl p-4 border border-glass-border space-y-1.5">
              <div className="text-[9px] text-white/30 uppercase font-black tracking-wider px-3 mb-2">
                Navigation Console
              </div>

              {persona === "player" ? (
                <>
                  {isFeatureEnabled("feed") && (
                    <button
                      onClick={() => setActiveTab("home")}
                      className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                        activeTab === "home"
                          ? "bg-accent text-black"
                          : "text-white/70 hover:bg-white/5"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <HomeIcon className="w-4.5 h-4.5 shrink-0" /> Club Feed
                      </span>
                      <ChevronRight className="w-4 h-4 opacity-40 group-hover:translate-x-1 transition-transform" />
                    </button>
                  )}

                  {isFeatureEnabled("matches") && (
                    <button
                      onClick={() => setActiveTab("matches")}
                      className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                        activeTab === "matches"
                          ? "bg-accent text-black"
                          : "text-white/70 hover:bg-white/5"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <CalendarDays className="w-4.5 h-4.5 shrink-0" />{" "}
                        Matches
                      </span>
                      <ChevronRight className="w-4 h-4 opacity-40 group-hover:translate-x-1 transition-transform" />
                    </button>
                  )}

                  {isFeatureEnabled("leaderboard") && (
                    <button
                      onClick={() => setActiveTab("leaderboard")}
                      className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                        activeTab === "leaderboard"
                          ? "bg-accent text-black"
                          : "text-white/70 hover:bg-white/5"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Trophy className="w-4.5 h-4.5 shrink-0" /> Leaderboard
                        Stats
                      </span>
                      <ChevronRight className="w-4 h-4 opacity-40 group-hover:translate-x-1 transition-transform" />
                    </button>
                  )}

                  {isFeatureEnabled("studio") && (
                    <button
                      onClick={() => setActiveTab("studio")}
                      className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                        activeTab === "studio"
                          ? "bg-accent text-black"
                          : "text-white/70 hover:bg-white/5"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Video className="w-4.5 h-4.5 shrink-0" /> Studio
                      </span>
                      <ChevronRight className="w-4 h-4 opacity-40 group-hover:translate-x-1 transition-transform" />
                    </button>
                  )}

                  {isFeatureEnabled("shop") && (
                    <button
                      onClick={() => setActiveTab("shop")}
                      className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                        activeTab === "shop"
                          ? "bg-accent text-black"
                          : "text-white/70 hover:bg-white/5"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <ShoppingBag className="w-4.5 h-4.5 shrink-0" /> Shop
                      </span>
                      <ChevronRight className="w-4 h-4 opacity-40 group-hover:translate-x-1 transition-transform" />
                    </button>
                  )}

                  <button
                    onClick={() => setActiveTab("profile")}
                    className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                      activeTab === "profile"
                        ? "bg-accent text-black"
                        : "text-white/70 hover:bg-white/5"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Users className="w-4.5 h-4.5 shrink-0" /> Profile
                    </span>
                    <ChevronRight className="w-4 h-4 opacity-40 group-hover:translate-x-1 transition-transform" />
                  </button>
                </>
              ) : (
                <div className="space-y-1">
                  {[
                    "finance",
                    "dues_and_reminders",
                    "studio",
                    "matches",
                    "home",
                    "settings",
                    "leaderboard",
                    "shop",
                    "opinion",
                  ]
                    .filter((tab) => {
                      if (tab === "finance" || tab === "dues_and_reminders")
                        return isFinanceAdmin || isSuperAdmin;
                      if (tab === "studio")
                        return isStudioAdmin || isSuperAdmin;
                      if (tab === "matches")
                        return isMatchAdmin || isSuperAdmin;
                      if (tab === "settings") return isSuperAdmin;
                      if (tab === "shop") return isFeatureEnabled("shop");
                      if (tab === "opinion") return isFeatureEnabled("opinion");
                      return true;
                    })
                    .map((tab) => {
                      const iconMap: Record<string, any> = {
                        home: HomeIcon,
                        matches: CalendarDays,
                        studio: Video,
                        leaderboard: Trophy,
                        settings: SettingsIcon,
                        finance: Shield,
                        dues_and_reminders: Bell,
                        shop: ShoppingBag,
                        opinion: PieChart,
                      };
                      const IconComp = iconMap[tab] || Trophy;
                      const uppercaseLabels: Record<string, string> = {
                        home: "Admin Home",
                        matches: "Matches",
                        studio: "Squad",
                        leaderboard: "Leaderboard",
                        settings: "Settings",
                        finance: "Finance",
                        dues_and_reminders: "Dues",
                        shop: "Shop",
                        opinion: "Pulse",
                      };
                      return (
                        <button
                          key={tab}
                          onClick={() => setActiveTab(tab as any)}
                          className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-bold tracking-wide transition flex items-center justify-between group cursor-pointer ${
                            activeTab === tab
                              ? "bg-accent text-black"
                              : "text-white/70 hover:bg-white/5"
                          }`}
                        >
                          <span className="flex items-center gap-2.5 uppercase text-[11px]">
                            <IconComp
                              className="w-4 h-4 text-accent group-hover:scale-110 transition-transform"
                              style={
                                activeTab === tab
                                  ? { color: "#000" }
                                  : undefined
                              }
                            />
                            {uppercaseLabels[tab]}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 opacity-40 group-hover:translate-x-1 transition-transform" />
                        </button>
                      );
                    })}
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
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                      Database Quota Limit Reached
                    </h3>
                    <p className="text-xs text-white/70 mt-0.5">
                      This applet has exceeded the free Firestore Enterprise
                      daily read limit.
                    </p>
                  </div>
                </div>

                <p className="text-[11px] text-white/50 leading-relaxed pl-1">
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
              store.players.filter((p) => p.inviteStatus === "Pending").length >
                0 &&
              activeTab !== "studio" && (
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
                      <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                        Pending Approvals Alert
                      </h4>
                      <p className="text-xs text-white/60 mt-0.5">
                        There are{" "}
                        <strong className="text-accent font-semibold">
                          {
                            store.players.filter(
                              (p) => p.inviteStatus === "Pending",
                            ).length
                          }{" "}
                          registration request(s)
                        </strong>{" "}
                        awaiting verification.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab("studio")}
                    className="text-[10px] font-bold uppercase tracking-wider bg-accent text-black px-4 py-2 rounded-xl hover:opacity-90 transition inline-flex items-center gap-1 shrink-0 self-start sm:self-auto cursor-pointer"
                    style={{ color: currentThemeObj.textAccent }}
                  >
                    Review <ArrowRight className="w-3.5 h-3.5 animate-pulse" />
                  </button>
                </motion.div>
              )}

            {/* Active Tab Screen Area */}
            {hasMissingMandatory ? (
              <div className="glass rounded-2xl p-5 border border-red-500/30">
                <div className="bg-red-500/10 border border-red-500/20 text-red-300 p-4 rounded-xl mb-6 text-xs font-semibold uppercase tracking-wider text-center">
                  ⚠️ Core setup required. Complete registration values to access
                  features.
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
                    />
                  )}
                  {activeTab === "matches" && (
                    <MatchesTab store={store} persona={persona} />
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
                  {activeTab === "profile" && <ProfileTab store={store} />}
                </motion.div>
              </AnimatePresence>
            ) : (
              <div className="space-y-6">
                {/* Mobile Tab Pill Controls (Only visible on Mobile when Admin menu is up) */}
                <div className="md:hidden relative mb-4">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-accent">
                    <Check className="w-4 h-4" />
                  </div>
                  <select
                    value={activeTab}
                    onChange={(e) => setActiveTab(e.target.value as any)}
                    className="w-full appearance-none bg-black/40 border border-glass-border rounded-xl px-4 py-3 pl-9 text-sm font-bold uppercase tracking-widest text-white focus:outline-none focus:border-accent [&>option]:bg-emerald-950"
                  >
                    <option value="home">Admin Home</option>
                    {(isFinanceAdmin || isSuperAdmin) && (
                      <>
                        <option value="finance">Finance Dashboard</option>
                        <option value="dues_and_reminders">Dues</option>
                      </>
                    )}
                    {(isStudioAdmin || isSuperAdmin) && (
                      <option value="studio">Squad & Studio</option>
                    )}
                    {(isMatchAdmin || isSuperAdmin) && (
                      <option value="matches">Matches</option>
                    )}
                    <option value="leaderboard">Leaderboard</option>
                    {isFeatureEnabled("shop") && <option value="shop">Shop</option>}
                    {isFeatureEnabled("opinion") && <option value="opinion">Pulse</option>}
                    {isSuperAdmin && <option value="settings">Settings</option>}
                  </select>
                  <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-white/50">
                    <ChevronRight className="w-4 h-4 rotate-90" />
                  </div>
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
                      <AdminDashboard store={store} setActiveTab={setActiveTab} />
                    )}
                    {activeTab === "matches" && (
                      <MatchesTab
                        store={store}
                        persona={persona}
                        isMatchAdmin={isMatchAdmin || isSuperAdmin}
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
                      />
                    )}
                    {activeTab === "leaderboard" && (
                      <LeaderboardTab store={store} persona={persona} />
                    )}
                    {activeTab === "notifications" && (
                      <NotificationsTab store={store} persona={persona} />
                    )}
                    {activeTab === "settings" && <SettingsTab store={store} setPreviewTheme={setPreviewThemeId} />}
                    {activeTab === "profile" && <ProfileTab store={store} />}
                    {activeTab === "finance" && (
                      <FinanceTab
                        store={store}
                        persona={persona}
                        isFinanceAdmin={isFinanceAdmin || isSuperAdmin}
                        defaultAction={tabAction}
                      />
                    )}
                    {activeTab === "dues_and_reminders" && (
                      <DuesAndRemindersTab store={store} isFinanceAdmin={isFinanceAdmin || isSuperAdmin} />
                    )}
                    {activeTab === "shop" && (
                      <ShopTab store={store} persona={persona} isAdmin={true} />
                    )}
                    {activeTab === "opinion" && (
                      <OpinionTab store={store} persona={persona} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Mobile-first bottom navigation (Only displays on Mobile devices when profile is complete) */}
      {!hasMissingMandatory && persona === "player" && (
        <nav className="fixed bottom-0 left-0 right-0 w-full glass !border-b-0 !border-x-0 !rounded-none md:hidden pb-safe z-30 flex items-center shadow-2xl justify-around bg-black/85 backdrop-blur-2xl px-1">
          {isFeatureEnabled("feed") && (
            <button
              onClick={() => setActiveTab("home")}
              className={`flex-1 py-2.5 flex flex-col items-center gap-1 cursor-pointer transition ${
                activeTab === "home"
                  ? "text-accent font-extrabold scale-105"
                  : "text-white/40 hover:text-white/80"
              }`}
            >
              <HomeIcon className="w-5 h-5" />
              <span className="text-[9px] font-bold uppercase tracking-wider">
                Feed
              </span>
            </button>
          )}

          {isFeatureEnabled("matches") && (
            <button
              onClick={() => setActiveTab("matches")}
              className={`flex-1 py-2.5 flex flex-col items-center gap-1 cursor-pointer transition ${
                activeTab === "matches"
                  ? "text-accent font-extrabold scale-105"
                  : "text-white/40 hover:text-white/80"
              }`}
            >
              <CalendarDays className="w-5 h-5" />
              <span className="text-[9px] font-bold uppercase tracking-wider text-center leading-tight">
                Matches
              </span>
            </button>
          )}

          {isFeatureEnabled("leaderboard") && (
            <button
              onClick={() => setActiveTab("leaderboard")}
              className={`flex-1 py-2.5 flex flex-col items-center gap-1 cursor-pointer transition ${
                activeTab === "leaderboard"
                  ? "text-accent font-extrabold scale-105"
                  : "text-white/40 hover:text-white/80"
              }`}
            >
              <Trophy className="w-5 h-5" />
              <span className="text-[9px] font-bold uppercase tracking-wider">
                Stats
              </span>
            </button>
          )}

          {isFeatureEnabled("studio") && (
            <button
              onClick={() => setActiveTab("studio")}
              className={`flex-1 py-2.5 flex flex-col items-center gap-1 cursor-pointer transition ${
                activeTab === "studio"
                  ? "text-accent font-extrabold scale-105"
                  : "text-white/40 hover:text-white/80"
              }`}
            >
              <Video className="w-5 h-5" />
              <span className="text-[9px] font-bold uppercase tracking-wider">
                Studio
              </span>
            </button>
          )}

          {isFeatureEnabled("shop") && (
            <button
              onClick={() => setActiveTab("shop")}
              className={`flex-1 py-2.5 flex flex-col items-center gap-1 cursor-pointer transition ${
                activeTab === "shop"
                  ? "text-accent font-extrabold scale-105"
                  : "text-white/40 hover:text-white/80"
              }`}
            >
              <ShoppingBag className="w-5 h-5" />
              <span className="text-[9px] font-bold uppercase tracking-wider">
                Shop
              </span>
            </button>
          )}

          {persona === "player" && (
            <button
              onClick={() => setActiveTab("profile")}
              className={`flex-1 py-2.5 flex flex-col items-center gap-1 cursor-pointer transition ${
                activeTab === "profile"
                  ? "text-accent font-extrabold scale-105"
                  : "text-white/40 hover:text-white/80"
              }`}
            >
              <Users className="w-5 h-5" />
              <span className="text-[9px] font-bold uppercase tracking-wider">
                Profile
              </span>
            </button>
          )}
        </nav>
      )}
    </div>
  );
}
