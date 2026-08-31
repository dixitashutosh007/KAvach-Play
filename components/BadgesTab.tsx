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
  const [view, setView] = useState<"gallery" | "award" | "hall" | "manage">("gallery");
  const [search, setSearch] = useState("");
  const [awardPlayer, setAwardPlayer] = useState<string | null>(null);
  const [awardBadge, setAwardBadge] = useState<BadgeType | null>(null);
  const [awardNote, setAwardNote] = useState("");
  const [awardMatchId, setAwardMatchId] = useState("");
  const [isAwarding, setIsAwarding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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

      const meta = getBadgeMeta(awardBadge, customDefs);
      await store.addPost?.({
        text: `\u{1F3C6} ${player.name} earned the ${meta.label} badge!`,
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

  const handleDeleteBadge = async (badgeId: string) => {
    await store.deleteBadge(badgeId);
    setConfirmDelete(null);
  };

  const handleShare = async (badge: Badge) => {
    const meta = getBadgeMeta(badge.badgeType, customDefs);
    const text = `${badge.playerName} earned the ${meta.label} badge at KAvach Play!`;

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
        // user cancelled
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
    return allBadgeTypes.filter(
      (bt) => stackableSet.has(bt) || !existing.has(bt),
    );
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
      <div className="flex bg-black/40 rounded-lg p-1 border border-glass-border">
        {(
          [
            { key: "gallery" as const, label: "Badges", icon: Award },
            { key: "hall" as const, label: "Hall of Fame", icon: Trophy },
            ...(isClubAdmin ? [
              { key: "award" as const, label: "Award", icon: Plus },
              { key: "manage" as const, label: "Manage", icon: Settings },
            ] : []),
          ] as { key: typeof view; label: string; icon: any }[]
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex-1 text-[10px] font-bold uppercase py-2 rounded-md transition flex items-center justify-center gap-1 ${
              view === key ? "bg-accent text-black" : "text-white/50 hover:text-white"
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
                        count={stackableSet.has(badgeType) ? bList.length : undefined}
                        customDefs={customDefs}
                      />
                      <button
                        onClick={() => handleShare(bList[0])}
                        className="absolute -top-1 -left-1 opacity-0 group-hover:opacity-100 bg-accent text-black rounded-full p-1 transition"
                        title="Share badge"
                      >
                        <Share2 className="w-3 h-3" />
                      </button>
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
                className="glass rounded-xl p-3 border border-glass-border flex items-center gap-3"
                style={{ borderColor: colors.border + "30" }}
              >
                <BadgeIcon badgeType={bt} size={44} customDefs={customDefs} />
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

      {/* Award View */}
      {view === "award" && isClubAdmin && (
        <div className="glass rounded-xl p-4 border border-glass-border space-y-4">
          <h3 className="font-bold text-white flex items-center gap-2">
            <Award className="w-5 h-5 text-accent" />
            Award a Badge
          </h3>

          <div>
            <label className="text-xs text-white/50 uppercase tracking-widest mb-1 block">Player</label>
            <select
              value={awardPlayer || ""}
              onChange={(e) => setAwardPlayer(e.target.value || null)}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">Select a player...</option>
              {activePlayers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {awardPlayer && (
            <div>
              <label className="text-xs text-white/50 uppercase tracking-widest mb-1 block">Badge</label>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {availableBadgesForPlayer(awardPlayer).map((bt) => {
                  const meta = getBadgeMeta(bt, customDefs);
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
                      <BadgeIcon badgeType={bt} size={32} customDefs={customDefs} />
                      <span className="text-[8px] text-white/60 text-center leading-tight">{meta.short}</span>
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
                  <label className="text-xs text-white/50 uppercase tracking-widest mb-1 block">Match (optional)</label>
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
                        <option key={m.id} value={m.id}>vs {m.opponent} — {new Date(m.date).toLocaleDateString()}</option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs text-white/50 uppercase tracking-widest mb-1 block">Note (optional)</label>
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
                {isAwarding ? "Awarding..." : `Award ${getBadgeMeta(awardBadge, customDefs).label}`}
              </button>
            </>
          )}
        </div>
      )}

      {/* Manage Badge Types View */}
      {view === "manage" && isClubAdmin && (
        <div className="space-y-4">
          <div className="glass rounded-xl p-4 border border-glass-border space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-accent" />
                Manage Badge Types
              </h3>
              <div className="flex gap-2">
                {unseededDefaults.length > 0 && (
                  <button
                    onClick={handleSeedDefaults}
                    disabled={isSeedingDefaults}
                    className="bg-white/5 text-white/70 text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 hover:bg-white/10 border border-white/10 transition disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" /> {isSeedingDefaults ? "Importing..." : "Import Defaults"}
                  </button>
                )}
                <button
                  onClick={openNewDefForm}
                  className="bg-accent text-black text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 hover:brightness-110 transition"
                >
                  <Plus className="w-3.5 h-3.5" /> New Badge
                </button>
              </div>
            </div>

            <p className="text-xs text-white/40">
              Default badges are always available. Custom badges you create here can be edited or removed.
            </p>

            {/* Badge Type Form */}
            {showDefForm && (
              <div className="bg-black/30 rounded-lg p-3 border border-white/10 space-y-3">
                <h4 className="text-sm font-bold text-white">
                  {editingDef ? `Edit: ${editingDef.label}` : "Create New Badge Type"}
                </h4>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-white/50 uppercase tracking-widest mb-0.5 block">Label</label>
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
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white placeholder:text-white/30"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-white/50 uppercase tracking-widest mb-0.5 block">Short Name</label>
                    <input
                      type="text"
                      value={defForm.short}
                      onChange={(e) => setDefForm(f => ({ ...f, short: e.target.value }))}
                      placeholder="MVP"
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white placeholder:text-white/30"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {!editingDef && (
                    <div>
                      <label className="text-[10px] text-white/50 uppercase tracking-widest mb-0.5 block">Key (slug)</label>
                      <input
                        type="text"
                        value={defForm.id}
                        onChange={(e) => setDefForm(f => ({ ...f, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") }))}
                        placeholder="mvp"
                        className="w-full bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white font-mono placeholder:text-white/30"
                      />
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] text-white/50 uppercase tracking-widest mb-0.5 block">Badge Face Text</label>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={defForm.emoji}
                        onChange={(e) => setDefForm(f => ({ ...f, emoji: e.target.value }))}
                        placeholder="MVP"
                        maxLength={6}
                        className="flex-1 bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white text-center placeholder:text-white/30"
                      />
                      <button
                        type="button"
                        onClick={() => setShowIconPicker(!showIconPicker)}
                        className={`p-1.5 rounded-lg border transition ${showIconPicker ? "border-accent bg-accent/10 text-accent" : "border-white/10 text-white/50 hover:text-white"}`}
                        title="Browse icons"
                      >
                        <Palette className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-white/50 uppercase tracking-widest mb-0.5 block">Tier</label>
                    <select
                      value={defForm.tier}
                      onChange={(e) => setDefForm(f => ({ ...f, tier: e.target.value as BadgeTier }))}
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white"
                    >
                      <option value="bronze">Bronze</option>
                      <option value="silver">Silver</option>
                      <option value="gold">Gold</option>
                      <option value="diamond">Diamond</option>
                    </select>
                  </div>
                </div>

                {showIconPicker && (
                  <div className="bg-black/20 rounded-lg p-2 border border-white/10 space-y-2 max-h-52 overflow-y-auto">
                    {ICON_LIBRARY.map(({ cat, icons }) => (
                      <div key={cat}>
                        <p className="text-[9px] text-white/40 uppercase tracking-widest mb-1">{cat}</p>
                        <div className="flex flex-wrap gap-1">
                          {icons.map(icon => (
                            <button
                              key={icon}
                              type="button"
                              onClick={() => { setDefForm(f => ({ ...f, emoji: icon })); setShowIconPicker(false); }}
                              className={`px-2 py-1 rounded text-sm border transition hover:bg-white/10 ${
                                defForm.emoji === icon ? "border-accent bg-accent/10 text-accent" : "border-white/10 text-white/70"
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
                  <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
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
                    className="flex-1 py-2 border border-white/10 rounded-lg text-white/70 text-sm hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveDef}
                    disabled={isSavingDef || !defForm.label.trim() || !defForm.emoji.trim() || (!editingDef && !defForm.id)}
                    className="flex-1 py-2 bg-accent text-black rounded-lg text-sm font-bold hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-1"
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
                <h4 className="text-xs text-white/50 uppercase tracking-widest">Custom Badges ({customDefs.length})</h4>
                {customDefs.map((def) => {
                  const colors = getBadgeTierColors(def.tier);
                  const hasAwards = badgesExistForType(def.id);
                  return (
                    <div
                      key={def.id}
                      className="flex items-center gap-3 p-2 rounded-lg border border-white/10 bg-black/20"
                    >
                      <BadgeIcon badgeType={def.id} size={36} customDefs={customDefs} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white truncate">{def.label}</p>
                        <p className="text-[10px] text-white/40">
                          {def.short} · <span style={{ color: colors.bg }}>{def.tier}</span>
                          {def.stackable && " · stackable"}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => openEditDefForm(def)}
                          className="p-1.5 rounded-lg border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition"
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
                <h4 className="text-xs text-white/50 uppercase tracking-widest">Default Badges ({unseededDefaults.length})</h4>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {unseededDefaults.map((bt) => {
                    const meta = getBadgeMeta(bt);
                    return (
                      <div key={bt} className="flex flex-col items-center gap-1 p-2 rounded-lg border border-white/5 bg-black/10">
                        <BadgeIcon badgeType={bt} size={28} />
                        <span className="text-[8px] text-white/40 text-center leading-tight">{meta.short}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Badge Confirmation */}
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
          <div className="bg-[#1a1a2e] rounded-xl p-5 max-w-sm w-full border border-white/10 space-y-4">
            <h3 className="font-bold text-white">Delete Badge Type?</h3>
            {badgesExistForType(confirmDeleteDef) ? (
              <p className="text-sm text-red-400">
                Some players have been awarded this badge. Deleting the type won't remove awarded badges, but they'll show a generic icon.
              </p>
            ) : (
              <p className="text-sm text-white/60">This badge type will be permanently removed.</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteDef(null)}
                className="flex-1 py-2 border border-white/10 rounded-lg text-white/70 text-sm hover:bg-white/5"
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
