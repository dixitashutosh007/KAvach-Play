"use client";

import { useMemo, useState } from "react";
import { Award, Lock } from "lucide-react";
import type { Badge, BadgeCategory, BadgeTypeDef, Player } from "@/lib/types";
import {
  BadgeIcon,
  BadgeShowcase,
  getAllBadgeTypes,
  getBadgeMeta,
  getStackableSet,
  type BadgeMeta,
} from "@/components/BadgeIcon";
import { METALLIC_TIER_PALETTES } from "@/components/BadgeArtwork";
import { computeMilestoneProgress, type MilestoneProgress } from "@/lib/badge-milestones";

type StatusFilter = "all" | "earned" | "locked";

const CATEGORY_LABELS: { key: "all" | BadgeCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "tenure", label: "Tenure" },
  { key: "milestone", label: "Milestones" },
  { key: "performance", label: "Performance" },
  { key: "club", label: "Club" },
  { key: "special", label: "Special" },
  { key: "custom", label: "Custom" },
];

export function PlayerBadgeCollection({
  badges,
  playerId,
  badgeTypeDefs,
  player,
}: {
  badges: Badge[];
  playerId: string;
  badgeTypeDefs: BadgeTypeDef[];
  player?: Pick<Player, "kavachJoining" | "totalRuns" | "totalWickets"> | null;
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | BadgeCategory>("all");
  const [selectedEarned, setSelectedEarned] = useState<Badge | null>(null);
  const [selectedLocked, setSelectedLocked] = useState<{
    meta: BadgeMeta;
    progress: MilestoneProgress | null;
  } | null>(null);

  const myBadges = useMemo(
    () => badges.filter((b) => b.playerId === playerId),
    [badges, playerId],
  );

  const groupedEarned = useMemo(() => {
    const map = new Map<string, Badge[]>();
    for (const b of myBadges) {
      const list = map.get(b.badgeType) || [];
      list.push(b);
      map.set(b.badgeType, list);
    }
    return map;
  }, [myBadges]);

  const stackable = useMemo(() => getStackableSet(badgeTypeDefs), [badgeTypeDefs]);

  const earnedEntries = useMemo(() => {
    return Array.from(groupedEarned.entries()).map(([badgeType, list]) => ({
      badgeType,
      list,
      meta: getBadgeMeta(badgeType, badgeTypeDefs),
    }));
  }, [groupedEarned, badgeTypeDefs]);

  const lockedEntries = useMemo(() => {
    const allTypes = getAllBadgeTypes(badgeTypeDefs);
    return allTypes
      .filter((bt) => !groupedEarned.has(bt))
      .map((bt) => {
        const meta = getBadgeMeta(bt, badgeTypeDefs);
        return {
          badgeType: bt,
          meta,
          progress: computeMilestoneProgress(bt, player),
        };
      })
      // Archived custom badges are only shown if already earned, never in locked catalog
      .filter((entry) => entry.meta.active);
  }, [badgeTypeDefs, groupedEarned, player]);

  const filteredEarned = useMemo(
    () =>
      categoryFilter === "all"
        ? earnedEntries
        : earnedEntries.filter((e) => e.meta.category === categoryFilter),
    [earnedEntries, categoryFilter],
  );

  const filteredLocked = useMemo(
    () =>
      categoryFilter === "all"
        ? lockedEntries
        : lockedEntries.filter((e) => e.meta.category === categoryFilter),
    [lockedEntries, categoryFilter],
  );

  const showEarned = statusFilter === "all" || statusFilter === "earned";
  const showLocked = statusFilter === "all" || statusFilter === "locked";

  return (
    <div className="bg-surface rounded-2xl p-4 border border-border space-y-4" data-testid="player-badge-collection">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-text-primary flex items-center gap-2 text-base">
          <Award className="w-5 h-5 text-[#A30F2D]" />
          Badges
        </h3>
        <span className="text-xs font-semibold text-text-secondary">
          {earnedEntries.length} earned · {lockedEntries.length} locked
        </span>
      </div>

      {/* Earned / Locked / All tabs */}
      <div className="flex gap-2" role="tablist" aria-label="Badge status filter">
        {(
          [
            { key: "all", label: `All (${earnedEntries.length + lockedEntries.length})` },
            { key: "earned", label: `Earned (${earnedEntries.length})` },
            { key: "locked", label: `Locked (${lockedEntries.length})` },
          ] as { key: StatusFilter; label: string }[]
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={statusFilter === tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
              statusFilter === tab.key
                ? "bg-[#A30F2D] text-white border-[#A30F2D]"
                : "bg-surface-hover text-text-secondary border-border hover:text-text-primary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Category chips */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        {CATEGORY_LABELS.map((cat) => (
          <button
            key={cat.key}
            type="button"
            onClick={() => setCategoryFilter(cat.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition cursor-pointer ${
              categoryFilter === cat.key
                ? "bg-[#FCE8ED] text-[#A30F2D] border-[#A30F2D]/40"
                : "bg-surface text-text-secondary border-border hover:bg-surface-hover"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Earned Section */}
      {showEarned && (
        <section className="space-y-2.5" data-testid="badges-earned-section">
          <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
            Earned ({filteredEarned.length})
          </h4>
          {filteredEarned.length === 0 ? (
            <p className="text-xs text-text-muted py-2">
              No earned badges in this category yet.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {filteredEarned.map(({ badgeType, list, meta }) => {
                const palette = METALLIC_TIER_PALETTES[meta.tier];
                const count = stackable.has(badgeType) ? list.length : undefined;
                return (
                  <button
                    key={badgeType}
                    type="button"
                    onClick={() => setSelectedEarned(list[0])}
                    className="flex flex-col items-center text-center gap-2 p-3 rounded-xl border border-border bg-surface-hover hover:border-[#A30F2D]/40 transition cursor-pointer min-h-[120px]"
                  >
                    <BadgeIcon badgeType={badgeType} size={52} count={count} customDefs={badgeTypeDefs} />
                    <div className="space-y-1 min-w-0 w-full">
                      <p className="text-xs font-bold text-text-primary truncate">{meta.label}</p>
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        <span
                          className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                          style={{ background: palette.pillBg, color: palette.pillText }}
                        >
                          {meta.tier}
                        </span>
                        {!meta.active && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                            Archived
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Locked Section */}
      {showLocked && (
        <section className="space-y-2.5" data-testid="badges-locked-section">
          <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> Locked ({filteredLocked.length})
          </h4>
          {filteredLocked.length === 0 ? (
            <p className="text-xs text-text-muted py-2">All badges in this category are unlocked!</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {filteredLocked.map(({ badgeType, meta, progress }) => {
                const palette = METALLIC_TIER_PALETTES[meta.tier];
                return (
                  <button
                    key={badgeType}
                    type="button"
                    onClick={() => setSelectedLocked({ meta, progress })}
                    className="flex items-center gap-3 p-3 rounded-xl border border-border bg-surface hover:bg-surface-hover transition text-left cursor-pointer min-h-[76px]"
                  >
                    <BadgeIcon badgeType={badgeType} size={44} customDefs={badgeTypeDefs} locked />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-text-primary truncate">{meta.label}</p>
                        <span
                          className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0"
                          style={{ background: palette.pillBg, color: palette.pillText }}
                        >
                          {meta.tier}
                        </span>
                      </div>
                      {meta.criteria && (
                        <p className="text-[11px] text-text-secondary truncate">{meta.criteria}</p>
                      )}
                      {progress && (
                        <div className="space-y-1 pt-0.5">
                          <div className="w-full h-1.5 rounded-full bg-[#E5E7EB] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[#D51F43]"
                              style={{ width: `${progress.percent}%` }}
                            />
                          </div>
                          <p className="text-[10px] font-semibold text-text-muted">
                            {progress.current.toLocaleString()} / {progress.target.toLocaleString()} {progress.unit}
                          </p>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {selectedEarned && (
        <BadgeShowcase
          badge={selectedEarned}
          customDefs={badgeTypeDefs}
          onClose={() => setSelectedEarned(null)}
        />
      )}

      {selectedLocked && (
        <BadgeShowcase
          lockedMeta={selectedLocked.meta}
          progress={selectedLocked.progress}
          customDefs={badgeTypeDefs}
          onClose={() => setSelectedLocked(null)}
        />
      )}
    </div>
  );
}
