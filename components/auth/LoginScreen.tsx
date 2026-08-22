"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Shield, Trophy, ChevronRight } from "lucide-react";
import { PhoneLoginForm } from "@/components/PhoneLoginForm";

/**
 * The unauthenticated landing page: club branding + choice of phone OTP,
 * Google, or email/password login. Owns all its own state — the parent
 * only supplies the auth actions and theme.
 */
export function LoginScreen({
  onGoogleSignIn,
  onEmailSignIn,
  themeStyles,
  accentColor,
  textAccentColor,
}: {
  onGoogleSignIn: () => Promise<void>;
  onEmailSignIn: (email: string, password: string) => Promise<void>;
  themeStyles: React.CSSProperties;
  accentColor: string;
  textAccentColor: string;
}) {
  const [authMethod, setAuthMethod] = useState<"phone" | "google_email">("phone");
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
      await onGoogleSignIn();
    } catch (err: any) {
      setAuthError(err.message || "Authentication failed.");
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen relative flex flex-col items-center justify-center p-4 overflow-hidden z-10"
      style={themeStyles}
    >
      {/* Animated ambient background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <motion.div
          animate={{ scale: [1, 1.25, 1], x: [0, 40, 0], y: [0, -30, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/4 -left-20 w-80 h-80 rounded-full bg-accent/10 blur-3xl pointer-events-none"
        />
        <motion.div
          animate={{ scale: [1.3, 1, 1.3], x: [0, -40, 0], y: [0, 40, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
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
        transition={{ type: "spring", stiffness: 90, damping: 15, mass: 0.9, delay: 0.05 }}
        className="glass relative p-8 sm:p-10 rounded-2xl max-w-sm w-full text-center border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl z-10"
      >
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

        <div className="mb-8">
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 180, damping: 12, delay: 0.25 }}
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
              Kavach Play provides a comprehensive suite of tools to manage your
              cricket club. Track player records, manage finances, monitor match
              statistics via leaderboards, and schedule match fixtures with ease.
              Sign in to access your club profile!
            </p>
          </motion.div>
        </div>

        {authMethod === "phone" ? (
          <PhoneLoginForm
            onOtherOptions={() => setAuthMethod("google_email")}
            themeAccent={accentColor}
            themeTextAccent={textAccentColor}
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
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
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
                <span className="px-3 text-[9px] uppercase tracking-widest text-white/40 font-bold">Or</span>
                <div className="flex-1 h-px bg-white/10"></div>
              </div>
              <button
                onClick={() => setEmailForm(true)}
                data-testid="email-login-toggle"
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

            {authError && (
              <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-lg mt-2">
                {authError}
              </div>
            )}
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
                await onEmailSignIn(email, password);
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
                data-testid="email-input"
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
                data-testid="password-input"
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
                data-testid="submit-login"
                className="flex-1 py-3 px-4 rounded-xl bg-accent text-black text-xs font-bold hover:opacity-95 transition shadow-[0_4px_12px_rgba(16,185,129,0.15)] flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                style={{ color: textAccentColor }}
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
