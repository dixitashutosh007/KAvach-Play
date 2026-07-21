"use client";

import { ArrowRight } from "lucide-react";

/**
 * Shown when the Firestore free-tier daily read quota is exceeded. Contains
 * a direct deep-link to the Firebase Console upgrade dialog so an admin can
 * enable pay-as-you-go billing in one click.
 */
export function QuotaExceededScreen({
  themeStyles,
  upgradeUrl,
}: {
  themeStyles: React.CSSProperties;
  upgradeUrl?: string;
}) {
  const url =
    upgradeUrl ||
    "https://console.firebase.google.com/project/gen-lang-client-0004191483/firestore/databases/ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412/data?openUpgradeDialog=true";
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
            This database has exceeded the free daily read limits. Daily read
            operations are currently suspended until the quota resets tomorrow.
          </p>
        </div>
        <div className="bg-white/5 p-4 rounded-xl text-left border border-white/5 space-y-3">
          <h4 className="text-[11px] font-bold text-accent uppercase tracking-wider">
            How to resolve immediately:
          </h4>
          <p className="text-[11px] text-white/50 leading-relaxed">
            You can instantly upgrade the database to the pay-as-you-go Plan
            (Flame/Blaze) via the Google Firebase Console. Simply click the link
            below and enable billing.
          </p>
          <a
            href={url}
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
