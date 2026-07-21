"use client";

import { motion } from "motion/react";
import { Shield, Users } from "lucide-react";

/**
 * "Registration Pending" and "Awaiting Admin Approval" screens. Both are
 * shown after a player has submitted their info but the admin hasn't yet
 * approved. Two visual styles because they originally lived in different
 * branches — `variant` picks between them.
 */
export function PendingApprovalScreen({
  variant,
  onLogOut,
  themeStyles,
}: {
  variant: "pending" | "awaiting";
  onLogOut: () => Promise<void>;
  themeStyles: React.CSSProperties;
}) {
  if (variant === "pending") {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-4 text-center relative"
        style={themeStyles}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass max-w-sm w-full p-8 rounded-2xl border border-white/10 shadow-xl z-10"
        >
          <div className="w-12 h-12 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-6 h-6 text-blue-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Registration Pending</h2>
          <p className="text-xs text-white/70 leading-relaxed mb-6">
            Your request has been registered. As soon as the club admin approves it,
            you will be able to log in. Come back in some time!
          </p>
          <button
            onClick={onLogOut}
            className="w-full py-3.5 px-6 rounded-xl bg-white/10 text-white font-bold hover:bg-white/20 transition-all text-xs"
          >
            Log Out
          </button>
        </motion.div>
      </div>
    );
  }

  // "awaiting" variant — larger, more prominent
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4"
      style={themeStyles}
    >
      <div className="glass p-8 rounded-2xl max-w-sm w-full text-center space-y-6 shadow-2xl relative overflow-hidden border border-white/10">
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-accent/20 animate-pulse">
          <Users className="w-8 h-8 text-accent" />
        </div>
        <div className="space-y-3">
          <h2 className="font-black text-lg text-white tracking-wide uppercase">
            Awaiting Admin to Approve Your Request
          </h2>
          <p className="text-xs text-white/60 leading-relaxed">
            Your profile registration has been successfully recorded in the squad
            database. Contact the club desk or stay tuned while your membership is
            being verified.
          </p>
        </div>
        <button
          onClick={onLogOut}
          className="w-full bg-white/15 text-white font-extrabold py-3 rounded-xl hover:bg-white/20 transition text-xs uppercase tracking-wider"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
