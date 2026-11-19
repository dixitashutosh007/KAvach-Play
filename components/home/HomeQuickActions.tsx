"use client";

import { Calendar, Wallet, Video, ShoppingBag, Trophy, Users } from "lucide-react";

export function HomeQuickActions({
  hasDues,
  isFeatureEnabled,
  onNavigate,
}: {
  hasDues: boolean;
  isFeatureEnabled: (key: any) => boolean;
  onNavigate: (tab: string) => void;
}) {
  return (
    <div
      data-testid="home-quick-actions"
      aria-label="Quick Club Actions"
      className="w-full flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar pt-1"
    >
      {/* 1. Fixtures */}
      <button
        type="button"
        onClick={() => onNavigate("matches")}
        className="min-h-[44px] shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface border border-border hover:border-scarlet/30 hover:bg-canvas-warm text-xs font-bold text-text-primary transition shadow-xs cursor-pointer active:scale-98"
      >
        <Calendar className="w-4 h-4 text-scarlet" />
        <span>Fixtures</span>
      </button>

      {/* 2. Dues / Payments */}
      <button
        type="button"
        onClick={() => onNavigate("finance")}
        className={`min-h-[44px] shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-bold transition shadow-xs cursor-pointer active:scale-98 ${
          hasDues
            ? "bg-scarlet/10 border-scarlet/30 text-scarlet hover:bg-scarlet/15 font-black"
            : "bg-surface border-border hover:bg-canvas-warm text-text-primary"
        }`}
      >
        <Wallet className={`w-4 h-4 ${hasDues ? "text-scarlet" : "text-muted-gold"}`} />
        <span>{hasDues ? "Pay Dues" : "My Finance"}</span>
      </button>

      {/* 3. Studio & Nets (if feature enabled) */}
      {isFeatureEnabled("studio") && (
        <button
          type="button"
          onClick={() => onNavigate("studio")}
          className="min-h-[44px] shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface border border-border hover:border-scarlet/30 hover:bg-canvas-warm text-xs font-bold text-text-primary transition shadow-xs cursor-pointer active:scale-98"
        >
          <Video className="w-4 h-4 text-deep-wine" />
          <span>Studio & Nets</span>
        </button>
      )}

      {/* 4. Club Shop (if feature enabled) */}
      {isFeatureEnabled("shop") && (
        <button
          type="button"
          onClick={() => onNavigate("shop")}
          className="min-h-[44px] shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface border border-border hover:border-scarlet/30 hover:bg-canvas-warm text-xs font-bold text-text-primary transition shadow-xs cursor-pointer active:scale-98"
        >
          <ShoppingBag className="w-4 h-4 text-muted-gold" />
          <span>Club Shop</span>
        </button>
      )}

      {/* 5. Leaderboard (if feature enabled) */}
      {isFeatureEnabled("leaderboard") && (
        <button
          type="button"
          onClick={() => onNavigate("leaderboard")}
          className="min-h-[44px] shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface border border-border hover:border-scarlet/30 hover:bg-canvas-warm text-xs font-bold text-text-primary transition shadow-xs cursor-pointer active:scale-98"
        >
          <Trophy className="w-4 h-4 text-muted-gold" />
          <span>Leaderboard</span>
        </button>
      )}
    </div>
  );
}
