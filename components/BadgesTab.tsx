"use client";
import { useState, useMemo } from "react";
import { useStore } from "@/hooks/useStore";
import { BadgeType, Badge, BadgeTier, BadgeTypeDef } from "@/lib/types";
import {
  BadgeIcon,
  BadgeCard,
  getBadgeMeta,
  getBadgeTierColors,
  getAllBadgeTypes,
  getStackableSet,
  TIER_COLORS,
  DEFAULT_BADGE_DEFS,
  BadgeShowcase,
  generateBadgeShareImage,
} from "./BadgeIcon";
import { Award, Search, Plus, Trash2, X, Share2, Trophy, Settings, Edit, Check, Palette, Upload } from "lucide-react";

const ICON_LIBRARY: { cat: string; icons: string[] }[] = [
  { cat: "Cricket", icons: ["🏏", "🏆", "🎯", "🔥", "💯", "🎳", "⚾", "🥎", "🏟"] },
  { cat: "Achievement", icons: ["⭐", "🌟", "✨", "💎", "👑", "🎖", "🏅", "★", "♛", "☆", "🎗", "🥇", "🥈", "🥉"] },
  { cat: "Power", icons: ["⚡", "🦁", "💪", "🐯", "🦅", "☄", "🔱", "⚔", "🛡", "🎪", "🫡"] },
  { cat: "Text", icons: ["MVP", "ACE", "PRO", "TOP", "MOM", "CAP", "ALL", "OG", "GOD", "VIP", "KAV", "MAX", "WIN"] },
  { cat: "Numbers", icons: ["1", "2", "3", "4", "5", "10", "25", "50", "2K", "5K", "10K", "100", "200", "300", "500"] },
];
import { serverTimestamp } from "firebase/firestore";
import dynamic from "next/dynamic";
import { useToast } from "@/components/ui/Toast";
const TenureBadgeEvaluator = dynamic(() => import("./TenureBadgeEvaluator"), { ssr: false });
const StatsBadgeEvaluator = dynamic(() => import("./StatsBadgeEvaluator"), { ssr: false });

export function BadgesTab({
  store,
  isClubAdmin,
  currentUserId,
  currentUserName,
  defaultView,
}: {
  store: ReturnType<typeof useStore>;
  isClubAdmin: boolean;
  currentUserId: string;
  currentUserName: string;
  defaultView?: "gallery" | "award" | "hall" | "manage";
}) {
  const { toast } = useToast();
  const [view, setView] = useState<"gallery" | "award" | "hall" | "manage">(defaultView || "gallery");
  const [search, setSearch] = useState("");
  const [awardPlayers, setAwardPlayers] = useState<string[]>([]);
  const [awardSearch, setAwardSearch] = useState("");
  const [awardBadge, setAwardBadge] = useState<BadgeType | null>(null);
  const [awardNote, setAwardNote] = useState("");
  const [awardMatchId, setAwardMatchId] = useState("");
  const [isAwarding, setIsAwarding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showcaseBadge, setShowcaseBadge] = useState<Badge | null>(null);
  const [showTenureEval, setShowTenureEval] = useState(false);
  const [showStatsEval, setShowStatsEval] = useState(false);

  const [editingDef, setEditingDef] = useState<BadgeTypeDef | null>(null);
  const [defForm, setDefForm] = useState({ id: "", label: "", short: "", tier: "bronze" as BadgeTier, emoji: "", stackable: false });
  const [isSavingDef, setIsSavingDef] = useState(false);
  const [confirmDeleteDef, setConfirmDeleteDef] = useState<string | null>(null);
  const [showDefForm, setShowDefForm] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [isSeedingDefaults, setIsSeedingDefaults] = useState(false);

  const { players, badges, matches, badgeTypeDefs } = store;
  const customDefs = badgeTypeDefs;

  const allBadgeTypes = useMemo(() => getAllBadgeTypes(customDefs), [customDefs]);
  const stackableSet = useMemo(() => getStackableSet(customDefs), [customDefs]);

  const activePlayers = useMemo(
    () => players.filter((p) => !p.disabled && p.inviteStatus !== "Rejected" && p.inviteStatus !== "Pending").sort((a, b) => a.name.localeCompare(b.name)),
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
    if (!awardPlayers.length || !awardBadge) return;

    setIsAwarding(true);
    try {
      const meta = getBadgeMeta(awardBadge, customDefs);
      const names: string[] = [];

      for (const pid of awardPlayers) {
        const player = players.find((p) => p.id === pid);
        if (!player) continue;
        names.push(player.name);

        await store.addBadge({
          playerId: pid,
          playerName: player.name,
          badgeType: awardBadge,
          awardedBy: currentUserId,
          awardedByName: currentUserName,
          awardedAt: serverTimestamp(),
          redeemed: false,
          ...(awardNote ? { note: awardNote } : {}),
          ...(awardMatchId ? { matchId: awardMatchId } : {}),
        });
      }

      if (names.length) {
        const nameStr = names.length <= 3
          ? names.join(", ")
          : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
        const postText = `🏆 BADGE UNLOCKED!\n\n${nameStr} earned the ✨ ${meta.label} ✨ badge!\n\n${meta.emoji}\n\n#KAvachPlay #CricketBadge`;
        await store.addPost?.({
          text: postText,
          authorName: "KAvach Badges",
          authorId: currentUserId,
        });
      }

      setAwardPlayers([]);
      setAwardSearch("");
      setAwardBadge(null);
      setAwardNote("");
      setAwardMatchId("");
    } finally {
      setIsAwarding(false);
    }
  };

  const handleDeleteBadge = async (badgeId: string) => {
    await store.deleteBadge(badgeId);
    setConfirmDelete(null);
  };

  const handleShare = async (badge: Badge) => {
    const meta = getBadgeMeta(badge.badgeType, customDefs);
    try {
      const { blob, caption } = await generateBadgeShareImage(badge, meta);
      if (navigator.share && blob) {
        const file = new File([blob], "kavach-badge.png", { type: "image/png" });
        await navigator.share({ text: caption, files: [file] });
      } else if (navigator.share) {
        await navigator.share({ text: caption });
      } else {
        await navigator.clipboard?.writeText(caption);
        toast("Badge info copied to clipboard!", "success");
      }
    } catch {
      // user cancelled
    }
  };

  const existingBadgeTypes = (playerId: string): Set<BadgeType> => {
    const playerBadges = badgesByPlayer.get(playerId) || [];
    return new Set(playerBadges.map((b) => b.badgeType));
  };

  const availableBadgesForPlayers = (playerIds: string[]): BadgeType[] => {
    return allBadgeTypes.filter((bt) => {
      if (stackableSet.has(bt)) return true;
      return playerIds.some(pid => !existingBadgeTypes(pid).has(bt));
    });
  };

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  const openNewDefForm = () => {
    setEditingDef(null);
    setDefForm({ id: "", label: "", short: "", tier: "bronze", emoji: "", stackable: false });
    setShowDefForm(true);
    setShowIconPicker(false);
  };

  const openEditDefForm = (def: BadgeTypeDef) => {
    setEditingDef(def);
    setDefForm({ id: def.id, label: def.label, short: def.short, tier: def.tier, emoji: def.emoji, stackable: def.stackable });
    setShowDefForm(true);
    setShowIconPicker(false);
  };

  const handleSaveDef = async () => {
    if (!defForm.label.trim() || !defForm.short.trim() || !defForm.emoji.trim()) return;
    const id = editingDef ? editingDef.id : (defForm.id || slugify(defForm.label));
    if (!id) return;

    setIsSavingDef(true);
    try {
      if (editingDef) {
        await store.updateBadgeTypeDef(id, {
          label: defForm.label.trim(),
          short: defForm.short.trim(),
          tier: defForm.tier,
          emoji: defForm.emoji.trim(),
          stackable: defForm.stackable,
        });
      } else {
        await store.addBadgeTypeDef({
          id,
          label: defForm.label.trim(),
          short: defForm.short.trim(),
          tier: defForm.tier,
          emoji: defForm.emoji.trim(),
          stackable: defForm.stackable,
          order: customDefs.length + 100,
        });
      }
      setEditingDef(null);
      setDefForm({ id: "", label: "", short: "", tier: "bronze", emoji: "", stackable: false });
      setShowDefForm(false);
      setShowIconPicker(false);
    } finally {
      setIsSavingDef(false);
    }
  };

  const handleDeleteDef = async (defId: string) => {
    await store.deleteBadgeTypeDef(defId);
    setConfirmDeleteDef(null);
  };

  const badgesExistForType = (typeId: string) => badges.some(b => b.badgeType === typeId);

  const handleSeedDefaults = async () => {
    const existing = new Set(customDefs.map(d => d.id));
    const entries = Object.entries(DEFAULT_BADGE_DEFS);
    setIsSeedingDefaults(true);
    try {
      let order = customDefs.length + 1;
      for (const [id, meta] of entries) {
        if (existing.has(id)) continue;
        await store.addBadgeTypeDef({
          id,
          label: meta.label,
          short: meta.short,
          tier: meta.tier,
          emoji: meta.emoji,
          stackable: meta.stackable,
          order: order++,
        });
      }
    } finally {
      setIsSeedingDefaults(false);
    }
  };

  const unseededDefaults = getAllBadgeTypes([]).filter(bt => !customDefs.some(d => d.id === bt));

  return (
    <div className="space-y-4">
      {/* View Switcher */}
      <div className="flex bg-surface-hover rounded-lg p-1 border border-border">
        {(
          [
            { key: "gallery" as const, label: "Badges", icon: Award },
            { key: "hall" as const, label: "Hall of Fame", icon: Trophy },
            ...(isClubAdmin ? [
              { key: "award" as const, label: "Grant", icon: Plus },
              { key: "manage" as const, label: "Manage", icon: Settings },
            ] : []),
          ] as { key: typeof view; label: string; icon: any }[]
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex-1 text-[10px] font-bold uppercase py-2 rounded-md transition flex items-center justify-center gap-1 ${
              view === key ? "bg-accent text-text-accent" : "text-text-muted hover:text-text-primary"
            }`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label.slice(0, 4)}</span>
          </button>
        ))}
      </div>

      {/* Gallery View */}
      {view === "gallery" && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-primary/30" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search players..."
              className="w-full bg-surface-hover border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-primary/30"
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
              <div key={player.id} className="bg-surface rounded-xl p-3 border border-border">
                <h3 className="font-bold text-text-primary text-sm mb-2">{player.name}</h3>
                <div className="flex flex-wrap gap-2">
                  {Array.from(grouped.entries()).map(([badgeType, bList]) => (
                    <div
                      key={badgeType}
                      className="relative group cursor-pointer"
                      onClick={() => setShowcaseBadge(bList[0])}
                    >
                      <BadgeCard
                        badgeType={badgeType}
                        count={stackableSet.has(badgeType) ? bList.length : undefined}
                        customDefs={customDefs}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); handleShare(bList[0]); }}
                        className="absolute -top-1 -left-1 opacity-0 group-hover:opacity-100 bg-accent text-text-accent rounded-full p-1 transition"
                        title="Share badge"
                      >
                        <Share2 className="w-3 h-3" />
                      </button>
                      {isClubAdmin && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(bList[bList.length - 1].id); }}
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
            <div className="text-center py-8 text-text-muted">
              <Award className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No badges awarded yet</p>
            </div>
          )}
        </div>
      )}

      {/* Hall of Fame */}
      {view === "hall" && (
        <div className="space-y-3">
          {allBadgeTypes.map((bt) => {
            const info = badgeCountsByType.get(bt);
            if (!info) return null;
            const meta = getBadgeMeta(bt, customDefs);
            const colors = getBadgeTierColors(meta.tier);
            return (
              <div
                key={bt}
                className="bg-surface rounded-xl p-3 border border-border flex items-center gap-3"
                style={{ borderColor: colors.border + "30" }}
              >
                <BadgeIcon badgeType={bt} size={44} customDefs={customDefs} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-text-primary text-sm">{meta.label}</p>
                  <p className="text-[11px] text-text-muted truncate">
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
            <div className="text-center py-8 text-text-muted">
              <Trophy className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No badges in the Hall of Fame yet</p>
            </div>
          )}
        </div>
      )}

      {/* Award View */}
      {view === "award" && isClubAdmin && (
        <div className="bg-surface rounded-xl p-4 border border-border space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-text-primary flex items-center gap-2">
              <Award className="w-5 h-5 text-accent" />
              Grant a Badge
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowTenureEval(true)}
                className="text-[10px] font-bold uppercase tracking-wider bg-surface-hover border border-border text-text-secondary hover:text-accent hover:border-accent/30 px-3 py-1.5 rounded-lg transition flex items-center gap-1.5"
              >
                <Award className="w-3.5 h-3.5" />
                Tenure
              </button>
              <button
                onClick={() => setShowStatsEval(true)}
                className="text-[10px] font-bold uppercase tracking-wider bg-surface-hover border border-border text-text-secondary hover:text-accent hover:border-accent/30 px-3 py-1.5 rounded-lg transition flex items-center gap-1.5"
              >
                <Trophy className="w-3.5 h-3.5" />
                Stats
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-text-muted uppercase tracking-widest mb-1 block">
              Players {awardPlayers.length > 0 && <span className="text-accent">({awardPlayers.length} selected)</span>}
            </label>

            {awardPlayers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {awardPlayers.map(pid => {
                  const p = players.find(pl => pl.id === pid);
                  return (
                    <span key={pid} className="inline-flex items-center gap-1 bg-accent/15 border border-accent/30 text-accent text-xs font-bold px-2 py-0.5 rounded-full">
                      {p?.name || pid}
                      <button onClick={() => setAwardPlayers(prev => prev.filter(id => id !== pid))} className="hover:text-text-primary transition">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
                <button
                  onClick={() => setAwardPlayers([])}
                  className="text-[10px] text-text-muted hover:text-text-secondary transition px-1"
                >
                  Clear all
                </button>
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-primary/30" />
              <input
                type="text"
                value={awardSearch}
                onChange={(e) => setAwardSearch(e.target.value)}
                placeholder="Search players..."
                className="w-full bg-surface-hover border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-primary/30"
              />
            </div>

            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-border bg-surface-hover divide-y divide-white/5">
              {(awardSearch
                ? activePlayers.filter(p => p.name.toLowerCase().includes(awardSearch.toLowerCase()))
                : activePlayers
              ).map(p => {
                const selected = awardPlayers.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setAwardPlayers(prev =>
                        selected ? prev.filter(id => id !== p.id) : [...prev, p.id]
                      );
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition ${
                      selected ? "bg-accent/10 text-accent" : "text-text-primary hover:bg-surface-hover"
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      selected ? "border-accent bg-accent" : "border-border"
                    }`}>
                      {selected && <Check className="w-3 h-3 text-black" />}
                    </div>
                    {p.name}
                  </button>
                );
              })}
              {awardSearch && activePlayers.filter(p => p.name.toLowerCase().includes(awardSearch.toLowerCase())).length === 0 && (
                <p className="text-xs text-text-primary/30 text-center py-3">No players match "{awardSearch}"</p>
              )}
            </div>
          </div>

          {awardPlayers.length > 0 && (
            <div>
              <label className="text-xs text-text-muted uppercase tracking-widest mb-1 block">Badge</label>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {availableBadgesForPlayers(awardPlayers).map((bt) => {
                  const meta = getBadgeMeta(bt, customDefs);
                  return (
                    <button
                      key={bt}
                      onClick={() => setAwardBadge(bt)}
                      className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition ${
                        awardBadge === bt
                          ? "border-accent bg-accent/10"
                          : "border-border hover:border-border"
                      }`}
                    >
                      <BadgeIcon badgeType={bt} size={32} customDefs={customDefs} />
                      <span className="text-[8px] text-text-secondary text-center leading-tight">{meta.short}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {awardBadge && (
            <>
              {stackableSet.has(awardBadge) && (
                <div>
                  <label className="text-xs text-text-muted uppercase tracking-widest mb-1 block">Match (optional)</label>
                  <select
                    value={awardMatchId}
                    onChange={(e) => setAwardMatchId(e.target.value)}
                    className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-text-primary"
                  >
                    <option value="">No specific match</option>
                    {matches
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .slice(0, 30)
                      .map((m) => (
                        <option key={m.id} value={m.id}>vs {m.opponent} — {new Date(m.date).toLocaleDateString()}</option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs text-text-muted uppercase tracking-widest mb-1 block">Note (optional)</label>
                <input
                  type="text"
                  value={awardNote}
                  onChange={(e) => setAwardNote(e.target.value)}
                  placeholder="e.g. 105 not out vs Titans"
                  className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-primary/30"
                />
              </div>

              <button
                onClick={handleAward}
                disabled={isAwarding || !awardPlayers.length}
                className="w-full bg-accent text-text-accent font-bold py-2.5 rounded-lg hover:brightness-110 transition disabled:opacity-50"
              >
                {isAwarding
                  ? "Awarding..."
                  : `Award ${getBadgeMeta(awardBadge, customDefs).label} to ${awardPlayers.length} player${awardPlayers.length > 1 ? "s" : ""}`}
              </button>
            </>
          )}
        </div>
      )}

      {/* Manage Badge Types View */}
      {view === "manage" && isClubAdmin && (
        <div className="space-y-4">
          <div className="bg-surface rounded-xl p-4 border border-border space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-text-primary flex items-center gap-2">
                <Settings className="w-5 h-5 text-accent" />
                Manage Badge Types
              </h3>
              <div className="flex gap-2">
                {unseededDefaults.length > 0 && (
                  <button
                    onClick={handleSeedDefaults}
                    disabled={isSeedingDefaults}
                    className="bg-surface-hover text-text-secondary text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 hover:bg-surface-hover border border-border transition disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" /> {isSeedingDefaults ? "Importing..." : "Import Defaults"}
                  </button>
                )}
                <button
                  onClick={openNewDefForm}
                  className="bg-accent text-text-accent text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 hover:brightness-110 transition"
                >
                  <Plus className="w-3.5 h-3.5" /> New Badge
                </button>
              </div>
            </div>

            <p className="text-xs text-text-muted">
              Default badges are always available. Custom badges you create here can be edited or removed.
            </p>

            {/* Badge Type Form */}
            {showDefForm && (
              <div className="bg-surface-hover rounded-lg p-3 border border-border space-y-3">
                <h4 className="text-sm font-bold text-text-primary">
                  {editingDef ? `Edit: ${editingDef.label}` : "Create New Badge Type"}
                </h4>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-text-muted uppercase tracking-widest mb-0.5 block">Label</label>
                    <input
                      type="text"
                      value={defForm.label}
                      onChange={(e) => {
                        const label = e.target.value;
                        setDefForm(f => ({
                          ...f,
                          label,
                          ...(!editingDef ? { id: slugify(label) } : {}),
                        }));
                      }}
                      placeholder="KAvach MVP"
                      className="w-full bg-surface-hover border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary placeholder:text-text-primary/30"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-text-muted uppercase tracking-widest mb-0.5 block">Short Name</label>
                    <input
                      type="text"
                      value={defForm.short}
                      onChange={(e) => setDefForm(f => ({ ...f, short: e.target.value }))}
                      placeholder="MVP"
                      className="w-full bg-surface-hover border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary placeholder:text-text-primary/30"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {!editingDef && (
                    <div>
                      <label className="text-[10px] text-text-muted uppercase tracking-widest mb-0.5 block">Key (slug)</label>
                      <input
                        type="text"
                        value={defForm.id}
                        onChange={(e) => setDefForm(f => ({ ...f, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") }))}
                        placeholder="mvp"
                        className="w-full bg-surface-hover border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary font-mono placeholder:text-text-primary/30"
                      />
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] text-text-muted uppercase tracking-widest mb-0.5 block">Badge Face Text</label>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={defForm.emoji}
                        onChange={(e) => setDefForm(f => ({ ...f, emoji: e.target.value }))}
                        placeholder="MVP"
                        maxLength={6}
                        className="flex-1 bg-surface-hover border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary text-center placeholder:text-text-primary/30"
                      />
                      <button
                        type="button"
                        onClick={() => setShowIconPicker(!showIconPicker)}
                        className={`p-1.5 rounded-lg border transition ${showIconPicker ? "border-accent bg-accent/10 text-accent" : "border-border text-text-muted hover:text-text-primary"}`}
                        title="Browse icons"
                      >
                        <Palette className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {showIconPicker && (
                  <div className="bg-surface-hover rounded-lg p-2 border border-border space-y-2 max-h-52 overflow-y-auto">
                    {ICON_LIBRARY.map(({ cat, icons }) => (
                      <div key={cat}>
                        <p className="text-[9px] text-text-muted uppercase tracking-widest mb-1">{cat}</p>
                        <div className="flex flex-wrap gap-1">
                          {icons.map(icon => (
                            <button
                              key={icon}
                              type="button"
                              onClick={() => { setDefForm(f => ({ ...f, emoji: icon })); setShowIconPicker(false); }}
                              className={`px-2 py-1 rounded text-sm border transition hover:bg-surface-hover ${
                                defForm.emoji === icon ? "border-accent bg-accent/10 text-accent" : "border-border text-text-secondary"
                              }`}
                            >
                              {icon}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={defForm.stackable}
                      onChange={(e) => setDefForm(f => ({ ...f, stackable: e.target.checked }))}
                      className="accent-accent w-4 h-4"
                    />
                    Stackable (can be awarded multiple times)
                  </label>

                  {defForm.emoji && (
                    <BadgeIcon badgeType={defForm.id || "preview"} size={36} customDefs={[{
                      id: defForm.id || "preview",
                      label: defForm.label || "Preview",
                      short: defForm.short || "Preview",
                      tier: defForm.tier,
                      emoji: defForm.emoji,
                      stackable: defForm.stackable,
                      order: 0,
                    }]} />
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowDefForm(false); setShowIconPicker(false); setEditingDef(null); setDefForm({ id: "", label: "", short: "", tier: "bronze", emoji: "", stackable: false }); }}
                    className="flex-1 py-2 border border-border rounded-lg text-text-secondary text-sm hover:bg-surface-hover"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveDef}
                    disabled={isSavingDef || !defForm.label.trim() || !defForm.emoji.trim() || (!editingDef && !defForm.id)}
                    className="flex-1 py-2 bg-accent text-text-accent rounded-lg text-sm font-bold hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {isSavingDef ? "Saving..." : editingDef ? "Update" : "Create"}
                  </button>
                </div>
              </div>
            )}

            {/* Custom badge types from Firestore */}
            {customDefs.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs text-text-muted uppercase tracking-widest">Custom Badges ({customDefs.length})</h4>
                {customDefs.map((def) => {
                  const colors = getBadgeTierColors(def.tier);
                  const hasAwards = badgesExistForType(def.id);
                  return (
                    <div
                      key={def.id}
                      className="flex items-center gap-3 p-2 rounded-lg border border-border bg-surface-hover"
                    >
                      <BadgeIcon badgeType={def.id} size={36} customDefs={customDefs} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-text-primary truncate">{def.label}</p>
                        <p className="text-[10px] text-text-muted">
                          {def.short}{def.stackable && " · stackable"}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => openEditDefForm(def)}
                          className="p-1.5 rounded-lg border border-border text-text-muted hover:text-text-primary hover:bg-surface-hover transition"
                          title="Edit"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteDef(def.id)}
                          className="p-1.5 rounded-lg border border-red-500/30 text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Default badge types */}
            {unseededDefaults.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs text-text-muted uppercase tracking-widest">Default Badges ({unseededDefaults.length})</h4>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {unseededDefaults.map((bt) => {
                    const meta = getBadgeMeta(bt);
                    return (
                      <div key={bt} className="flex flex-col items-center gap-1 p-2 rounded-lg border border-border bg-surface-hover">
                        <BadgeIcon badgeType={bt} size={28} />
                        <span className="text-[8px] text-text-muted text-center leading-tight">{meta.short}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Badge Showcase Modal */}
      {showcaseBadge && (
        <BadgeShowcase
          badge={showcaseBadge}
          customDefs={customDefs}
          onClose={() => setShowcaseBadge(null)}
        />
      )}

      {showTenureEval && (
        <TenureBadgeEvaluator
          store={store}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          onClose={() => setShowTenureEval(false)}
        />
      )}

      {showStatsEval && (
        <StatsBadgeEvaluator
          store={store}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          onClose={() => setShowStatsEval(false)}
        />
      )}

      {/* Delete Badge Confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-surface rounded-xl p-5 max-w-sm w-full border border-border space-y-4">
            <h3 className="font-bold text-text-primary">Remove Badge?</h3>
            <p className="text-sm text-text-secondary">This will permanently remove this badge from the player.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 border border-border rounded-lg text-text-secondary text-sm hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteBadge(confirmDelete)}
                className="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm font-bold hover:bg-red-600"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Badge Type Confirmation */}
      {confirmDeleteDef && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-surface rounded-xl p-5 max-w-sm w-full border border-border space-y-4">
            <h3 className="font-bold text-text-primary">Delete Badge Type?</h3>
            {badgesExistForType(confirmDeleteDef) ? (
              <p className="text-sm text-red-400">
                Some players have been awarded this badge. Deleting the type won't remove awarded badges, but they'll show a generic icon.
              </p>
            ) : (
              <p className="text-sm text-text-secondary">This badge type will be permanently removed.</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteDef(null)}
                className="flex-1 py-2 border border-border rounded-lg text-text-secondary text-sm hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteDef(confirmDeleteDef)}
                className="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm font-bold hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
