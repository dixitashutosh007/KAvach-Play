"use client";
import { useState, useMemo } from "react";
import { useStore } from "@/hooks/useStore";
import { BadgeType, Badge } from "@/lib/types";
import {
  BadgeIcon,
  BadgeCard,
  getBadgeMeta,
  getBadgeTierColors,
  ALL_BADGE_TYPES,
  STACKABLE_BADGES,
} from "./BadgeIcon";
import { Award, Search, Plus, Trash2, X, Share2, Trophy } from "lucide-react";
import { serverTimestamp } from "firebase/firestore";

export function BadgesTab({
  store,
  isClubAdmin,
  currentUserId,
  currentUserName,
}: {
  store: ReturnType<typeof useStore>;
  isClubAdmin: boolean;
  currentUserId: string;
  currentUserName: string;
}) {
  const [view, setView] = useState<"gallery" | "award" | "hall">("gallery");
  const [search, setSearch] = useState("");
  const [awardPlayer, setAwardPlayer] = useState<string | null>(null);
  const [awardBadge, setAwardBadge] = useState<BadgeType | null>(null);
  const [awardNote, setAwardNote] = useState("");
  const [awardMatchId, setAwardMatchId] = useState("");
  const [isAwarding, setIsAwarding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { players, badges, matches } = store;

  const activePlayers = useMemo(
    () => players.filter((p) => !p.disabled && p.inviteStatus === "Accepted").sort((a, b) => a.name.localeCompare(b.name)),
    [players],
  );

  const badgesByPlayer = useMemo(() => {
    const map = new Map<string, Badge[]>();
    badges.forEach((b) => {
      const arr = map.get(b.playerId) || [];
      arr.push(b);
      map.set(b.playerId, arr);
    });
    return map;
  }, [badges]);

  const badgeCountsByType = useMemo(() => {
    const map = new Map<BadgeType, { count: number; players: string[] }>();
    badges.forEach((b) => {
      const entry = map.get(b.badgeType) || { count: 0, players: [] };
      entry.count++;
      if (!entry.players.includes(b.playerName)) entry.players.push(b.playerName);
      map.set(b.badgeType, entry);
    });
    return map;
  }, [badges]);

  const filteredPlayers = useMemo(
    () =>
      search
        ? activePlayers.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
        : activePlayers,
    [activePlayers, search],
  );

  const handleAward = async () => {
    if (!awardPlayer || !awardBadge) return;
    const player = players.find((p) => p.id === awardPlayer);
    if (!player) return;

    setIsAwarding(true);
    try {
      await store.addBadge({
        playerId: awardPlayer,
        playerName: player.name,
        badgeType: awardBadge,
        awardedBy: currentUserId,
        awardedByName: currentUserName,
        awardedAt: serverTimestamp(),
        redeemed: false,
        ...(awardNote ? { note: awardNote } : {}),
        ...(awardMatchId ? { matchId: awardMatchId } : {}),
      });

      await store.addPost?.({
        text: `🏆 ${player.name} earned the ${getBadgeMeta(awardBadge).label} badge!`,
        authorName: "KAvach Badges",
        authorId: currentUserId,
      });

      setAwardPlayer(null);
      setAwardBadge(null);
      setAwardNote("");
      setAwardMatchId("");
    } finally {
      setIsAwarding(false);
    }
  };

  const handleDelete = async (badgeId: string) => {
    await store.deleteBadge(badgeId);
    setConfirmDelete(null);
  };

  const handleShare = async (badge: Badge) => {
    const meta = getBadgeMeta(badge.badgeType);
    const text = `${badge.playerName} earned the ${meta.label} badge at KAvach Play! 🏏🏆`;

    if (navigator.share) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 600;
        canvas.height = 400;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const colors = getBadgeTierColors(meta.tier);

          ctx.fillStyle = "#0a0a0a";
          ctx.fillRect(0, 0, 600, 400);

          ctx.strokeStyle = colors.border;
          ctx.lineWidth = 3;
          ctx.strokeRect(20, 20, 560, 360);

          ctx.fillStyle = colors.bg;
          ctx.font = "bold 48px system-ui";
          ctx.textAlign = "center";
          ctx.fillText(meta.emoji, 300, 140);

          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 28px system-ui";
          ctx.fillText(meta.label, 300, 200);

          ctx.fillStyle = "#aaaaaa";
          ctx.font = "20px system-ui";
          ctx.fillText(`Awarded to ${badge.playerName}`, 300, 250);

          ctx.fillStyle = colors.bg + "80";
          ctx.font = "bold 14px system-ui";
          ctx.fillText("KAvach Play", 300, 350);

          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/png"),
          );
          if (blob) {
            const file = new File([blob], "kavach-badge.png", { type: "image/png" });
            await navigator.share({ text, files: [file] });
            return;
          }
        }
        await navigator.share({ text });
      } catch {
        // user cancelled share
      }
    } else {
      await navigator.clipboard?.writeText(text);
      alert("Badge info copied to clipboard!");
    }
  };

  const existingBadgeTypes = (playerId: string): Set<BadgeType> => {
    const playerBadges = badgesByPlayer.get(playerId) || [];
    return new Set(playerBadges.map((b) => b.badgeType));
  };

  const availableBadgesForPlayer = (playerId: string): BadgeType[] => {
    const existing = existingBadgeTypes(playerId);
    return ALL_BADGE_TYPES.filter(
      (bt) => STACKABLE_BADGES.has(bt) || !existing.has(bt),
    );
  };

  return (
    <div className="space-y-4">
      {/* View Switcher */}
      <div className="flex bg-black/40 rounded-lg p-1 border border-glass-border">
        {(
          [
            { key: "gallery" as const, label: "My Badges", icon: Award },
            { key: "hall" as const, label: "Hall of Fame", icon: Trophy },
            ...(isClubAdmin ? [{ key: "award" as const, label: "Award", icon: Plus }] : []),
          ] as { key: typeof view; label: string; icon: any }[]
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex-1 text-[11px] font-bold uppercase py-2 rounded-md transition flex items-center justify-center gap-1.5 ${
              view === key ? "bg-accent text-black" : "text-white/50 hover:text-white"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Gallery View — all badges grouped by player */}
      {view === "gallery" && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search players..."
              className="w-full bg-black/30 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/30"
            />
          </div>

          {filteredPlayers.map((player) => {
            const playerBadges = badgesByPlayer.get(player.id);
            if (!playerBadges?.length) return null;

            const grouped = new Map<BadgeType, Badge[]>();
            playerBadges.forEach((b) => {
              const arr = grouped.get(b.badgeType) || [];
              arr.push(b);
              grouped.set(b.badgeType, arr);
            });

            return (
              <div key={player.id} className="glass rounded-xl p-3 border border-glass-border">
                <h3 className="font-bold text-white text-sm mb-2">{player.name}</h3>
                <div className="flex flex-wrap gap-2">
                  {Array.from(grouped.entries()).map(([badgeType, bList]) => (
                    <div key={badgeType} className="relative group">
                      <BadgeCard
                        badgeType={badgeType}
                        count={STACKABLE_BADGES.has(badgeType) ? bList.length : undefined}
                      />
                      {/* Share button on hover */}
                      <button
                        onClick={() => handleShare(bList[0])}
                        className="absolute -top-1 -left-1 opacity-0 group-hover:opacity-100 bg-accent text-black rounded-full p-1 transition"
                        title="Share badge"
                      >
                        <Share2 className="w-3 h-3" />
                      </button>
                      {/* Delete button for admins */}
                      {isClubAdmin && (
                        <button
                          onClick={() => setConfirmDelete(bList[bList.length - 1].id)}
                          className="absolute -bottom-1 -right-1 opacity-0 group-hover:opacity-100 bg-red-500 text-white rounded-full p-1 transition"
                          title="Remove badge"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {filteredPlayers.every((p) => !(badgesByPlayer.get(p.id)?.length)) && (
            <div className="text-center py-8 text-white/40">
              <Award className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No badges awarded yet</p>
            </div>
          )}
        </div>
      )}

      {/* Hall of Fame — badge-centric view */}
      {view === "hall" && (
        <div className="space-y-3">
          {ALL_BADGE_TYPES.map((bt) => {
            const info = badgeCountsByType.get(bt);
            if (!info) return null;
            const meta = getBadgeMeta(bt);
            const colors = getBadgeTierColors(meta.tier);
            return (
              <div
                key={bt}
                className="glass rounded-xl p-3 border border-glass-border flex items-center gap-3"
                style={{ borderColor: colors.border + "30" }}
              >
                <BadgeIcon badgeType={bt} size={44} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-sm">{meta.label}</p>
                  <p className="text-[11px] text-white/50 truncate">
                    {info.players.slice(0, 5).join(", ")}
                    {info.players.length > 5 && ` +${info.players.length - 5} more`}
                  </p>
                </div>
                <span
                  className="text-xs font-bold px-2 py-1 rounded-full"
                  style={{ background: colors.bg + "20", color: colors.bg }}
                >
                  {info.count}
                </span>
              </div>
            );
          })}

          {badges.length === 0 && (
            <div className="text-center py-8 text-white/40">
              <Trophy className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No badges in the Hall of Fame yet</p>
            </div>
          )}
        </div>
      )}

      {/* Award View — admin only */}
      {view === "award" && isClubAdmin && (
        <div className="glass rounded-xl p-4 border border-glass-border space-y-4">
          <h3 className="font-bold text-white flex items-center gap-2">
            <Award className="w-5 h-5 text-accent" />
            Award a Badge
          </h3>

          {/* Player select */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-widest mb-1 block">
              Player
            </label>
            <select
              value={awardPlayer || ""}
              onChange={(e) => setAwardPlayer(e.target.value || null)}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">Select a player...</option>
              {activePlayers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Badge select */}
          {awardPlayer && (
            <div>
              <label className="text-xs text-white/50 uppercase tracking-widest mb-1 block">
                Badge
              </label>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {availableBadgesForPlayer(awardPlayer).map((bt) => {
                  const meta = getBadgeMeta(bt);
                  return (
                    <button
                      key={bt}
                      onClick={() => setAwardBadge(bt)}
                      className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition ${
                        awardBadge === bt
                          ? "border-accent bg-accent/10"
                          : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      <BadgeIcon badgeType={bt} size={32} />
                      <span className="text-[8px] text-white/60 text-center leading-tight">
                        {meta.short}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Optional note */}
          {awardBadge && (
            <>
              {STACKABLE_BADGES.has(awardBadge) && (
                <div>
                  <label className="text-xs text-white/50 uppercase tracking-widest mb-1 block">
                    Match (optional)
                  </label>
                  <select
                    value={awardMatchId}
                    onChange={(e) => setAwardMatchId(e.target.value)}
                    className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value="">No specific match</option>
                    {matches
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .slice(0, 30)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          vs {m.opponent} — {new Date(m.date).toLocaleDateString()}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs text-white/50 uppercase tracking-widest mb-1 block">
                  Note (optional)
                </label>
                <input
                  type="text"
                  value={awardNote}
                  onChange={(e) => setAwardNote(e.target.value)}
                  placeholder="e.g. 105 not out vs Titans"
                  className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30"
                />
              </div>

              <button
                onClick={handleAward}
                disabled={isAwarding}
                className="w-full bg-accent text-black font-bold py-2.5 rounded-lg hover:brightness-110 transition disabled:opacity-50"
              >
                {isAwarding ? "Awarding..." : `Award ${getBadgeMeta(awardBadge).label}`}
              </button>
            </>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#1a1a2e] rounded-xl p-5 max-w-sm w-full border border-white/10 space-y-4">
            <h3 className="font-bold text-white">Remove Badge?</h3>
            <p className="text-sm text-white/60">This will permanently remove this badge from the player.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 border border-white/10 rounded-lg text-white/70 text-sm hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm font-bold hover:bg-red-600"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PlayerBadgeRow({
  playerId,
  badges,
}: {
  playerId: string;
  badges: Badge[];
}) {
  const playerBadges = badges.filter((b) => b.playerId === playerId);
  if (!playerBadges.length) return null;

  const grouped = new Map<BadgeType, Badge[]>();
  playerBadges.forEach((b) => {
    const arr = grouped.get(b.badgeType) || [];
    arr.push(b);
    grouped.set(b.badgeType, arr);
  });

  return (
    <div className="flex gap-1.5 flex-wrap">
      {Array.from(grouped.entries()).map(([badgeType, bList]) => (
        <BadgeIcon
          key={badgeType}
          badgeType={badgeType}
          size={28}
          count={STACKABLE_BADGES.has(badgeType) ? bList.length : undefined}
        />
      ))}
    </div>
  );
}
