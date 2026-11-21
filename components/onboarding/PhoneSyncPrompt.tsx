"use client";

import { User } from "firebase/auth";
import { motion } from "motion/react";
import { Shield } from "lucide-react";
import { Player } from "@/lib/types";

/**
 * Shown to players who are not yet linked when the app finds their existing
 * player record by the login's verified mobile number (phone OTP) or
 * Google-verified email (Google sign-in). Offers a one-click, server-verified
 * "sync" that links the two.
 */
export function PhoneSyncPrompt({
  existingPlayer,
  user,
  matchedBy = "mobile",
  isSubmitting,
  onSync,
  onLogOut,
  themeStyles,
  accentColor,
  textAccentColor,
}: {
  existingPlayer: Player;
  user: User;
  /** How the record was found: verified mobile number or Google email. */
  matchedBy?: "mobile" | "google";
  isSubmitting: boolean;
  onSync: () => Promise<void>;
  onLogOut: () => Promise<void>;
  themeStyles: React.CSSProperties;
  accentColor: string;
  textAccentColor: string;
}) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4 text-center overflow-y-auto"
      style={themeStyles}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-surface max-w-sm w-full p-8 rounded-2xl border border-border shadow-xl text-left my-8"
      >
        <div className="mb-6 mt-2 text-center text-accent flex justify-center">
          <Shield className="w-10 h-10" />
        </div>
        <h2 className="text-xl font-bold text-text-primary mb-2 text-center">
          Welcome back, {existingPlayer.name}!
        </h2>
        <p className="text-sm text-text-secondary mb-6 text-center leading-relaxed">
          We found your existing player profile for{" "}
          <b className="font-mono text-emerald-700 break-all">
            {matchedBy === "google" ? user.email : user.phoneNumber}
          </b>
          . Sync your profile once to log in automatically without admin approval.
        </p>
        <button
          onClick={onSync}
          disabled={isSubmitting}
          className="w-full py-3 px-4 rounded-xl font-bold shadow flex items-center justify-center transition-opacity cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: accentColor, color: textAccentColor }}
        >
          {isSubmitting ? "Syncing..." : "Sync Profile"}
        </button>
        <button
          onClick={onLogOut}
          className="w-full py-3 px-4 rounded-xl font-bold mt-3 border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-all text-sm flex items-center justify-center cursor-pointer"
        >
          Sign Out
        </button>
      </motion.div>
    </div>
  );
}
