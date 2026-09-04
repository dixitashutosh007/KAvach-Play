"use client";

import { motion } from "motion/react";
import { CheckCircle, Clock } from "lucide-react";

/**
 * Shown after a player submits registration. Shows clear step progress
 * so the player knows exactly where they are in the onboarding flow.
 */
export function PendingApprovalScreen({
  onLogOut,
  themeStyles,
}: {
  variant?: "pending" | "awaiting";
  onLogOut: () => Promise<void>;
  themeStyles: React.CSSProperties;
}) {
  const steps = [
    { label: "Sign Up", done: true },
    { label: "Profile Submitted", done: true },
    { label: "Admin Review", done: false, current: true },
    { label: "Access Granted", done: false },
  ];

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
        <div className="w-14 h-14 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center mx-auto mb-5">
          <Clock className="w-7 h-7 text-amber-400 animate-pulse" />
        </div>

        <h2 className="text-xl font-bold text-white mb-1">
          Waiting for Approval
        </h2>
        <p className="text-xs text-white/50 mb-6">
          Your profile has been submitted successfully
        </p>

        {/* Step progress */}
        <div className="flex items-center justify-between mb-6 px-2">
          {steps.map((step, i) => (
            <div key={step.label} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    step.done
                      ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400"
                      : step.current
                        ? "bg-amber-500/20 border border-amber-500/40 text-amber-400 animate-pulse"
                        : "bg-white/5 border border-white/10 text-white/30"
                  }`}
                >
                  {step.done ? (
                    <CheckCircle className="w-3.5 h-3.5" />
                  ) : step.current ? (
                    <Clock className="w-3.5 h-3.5" />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </div>
                <span
                  className={`text-[9px] mt-1 font-semibold leading-tight ${
                    step.done
                      ? "text-emerald-400/80"
                      : step.current
                        ? "text-amber-400/80"
                        : "text-white/30"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`w-4 sm:w-6 h-px mx-0.5 mb-4 ${
                    step.done ? "bg-emerald-500/40" : "bg-white/10"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
          <p className="text-xs text-white/70 leading-relaxed">
            The club admin will review and approve your request.
            You&apos;ll get full access once approved.{" "}
            <span className="text-white/40">
              Check back later or contact the club desk.
            </span>
          </p>
        </div>

        <button
          onClick={onLogOut}
          className="w-full py-3 px-6 rounded-xl bg-white/10 text-white font-bold hover:bg-white/20 transition-all text-xs"
        >
          Sign Out
        </button>
      </motion.div>
    </div>
  );
}
