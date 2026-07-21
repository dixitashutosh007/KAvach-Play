"use client";

import { User } from "firebase/auth";
import { motion } from "motion/react";
import { Shield } from "lucide-react";
import { Player } from "@/lib/types";

/**
 * Shown when a user logs in via phone OTP and the app finds an existing
 * player record with a matching phone number but a different auth UID.
 * Offers a one-click "sync" that links the two.
 */
export function PhoneSyncPrompt({
  existingPlayer,
  user,
  isSubmitting,
  onSync,
  onLogOut,
  themeStyles,
  accentColor,
  textAccentColor,
}: {
  existingPlayer: Player;
  user: User;
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
        className="glass max-w-sm w-full p-8 rounded-2xl border border-white/10 shadow-xl text-left my-8"
      >
        <div className="mb-6 mt-2 text-center text-accent flex justify-center">
          <Shield className="w-10 h-10" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2 text-center">
          Welcome back, {existingPlayer.name}!
        </h2>
        <p className="text-sm text-white/70 mb-6 text-center leading-relaxed">
          We found your existing player profile for{" "}
          <b className="font-mono text-emerald-400">{user.phoneNumber}</b>.
          Sync your profile to log in automatically without admin approval.
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
          className="w-full py-3 px-4 rounded-xl font-bold mt-3 border border-white/10 text-white/70 hover:text-white hover:bg-white/5 transition-all text-sm flex items-center justify-center cursor-pointer"
        >
          Sign Out
        </button>
      </motion.div>
    </div>
  );
}
