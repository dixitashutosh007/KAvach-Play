"use client";

import { useMemo } from "react";
import { Crown } from "lucide-react";
import type { Post } from "@/lib/types";
import { toMillis } from "@/lib/club-feed";
import { selectPlayerHomePotw } from "@/lib/weekend-ops";
import { PotwSlideBody } from "./CampaignHeroBanner";

/**
 * Dedicated Player of the Week announcement section on Player Home.
 * Displays only the newest eligible non-historical POTW post within its
 * 7-day `createdAt` window, updating live when `store.posts` changes.
 */
export function PotwHomeSection({
  posts,
  nowMs,
}: {
  posts: readonly Post[];
  nowMs: number;
}) {
  const activePotw = useMemo(
    () => selectPlayerHomePotw(posts, nowMs, toMillis),
    [posts, nowMs],
  );

  if (!activePotw) return null;

  return (
    <section
      data-testid="player-home-potw-section"
      aria-label="Player of the Week"
      className="w-full rounded-2xl bg-gradient-to-br from-[#5E0718] via-[#A30F2D] to-[#B8862F] text-white p-4 sm:p-5 shadow-md border border-white/15"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-black/25 text-[#F5D77A] border border-[#D6A52B]/40">
          <Crown className="w-3.5 h-3.5 text-[#D6A52B]" aria-hidden="true" />
          Player of the Week
        </span>
        {activePotw.weekendLabel && (
          <span className="text-[11px] font-semibold text-white/80">
            {activePotw.weekendLabel}
          </span>
        )}
      </div>

      <PotwSlideBody
        potw={{
          playerName: activePotw.playerName,
          photoURL: activePotw.photoURL,
          message: activePotw.message,
          weekendLabel: activePotw.weekendLabel,
        }}
      />
    </section>
  );
}
