"use client";

/**
 * Player → Club → Player Directory (D-20).
 *
 * Lists members from the player records the app already holds (no extra reads),
 * rendered 20 at a time with "Show more". Opening a member shows their PUBLIC
 * profile only: every record passes through `toPublicPlayer()` first, so private
 * fields (mobile, email, date of birth, blood group, emergency contact,
 * locality, sizes) and payment data never reach this view (R2-B owner
 * principle). Badges for the opened member come from a bounded per-player query.
 *
 * Note: this is a presentation boundary. Player documents are still readable by
 * signed-in members at the data layer until the R2-B security work lands.
 */
import { useEffect, useMemo, useState } from "react";
import { Search, X, User } from "lucide-react";
import Image from "next/image";
import { useStore } from "@/hooks/useStore";
import { usePlayerBadges } from "@/hooks/useClubData";
import { DIRECTORY_PAGE_SIZE, filterDirectory, toPublicPlayer, type PublicPlayer } from "@/lib/club-feed";
import { BadgeIcon, getBadgeMeta } from "@/components/BadgeIcon";

function Avatar({ name, photoURL, size }: { name: string; photoURL?: unknown; size: number }) {
  const initials = name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "P";
  if (typeof photoURL === "string" && photoURL) {
    return (
      <Image src={photoURL} alt={name} width={size} height={size} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} referrerPolicy="no-referrer" />
    );
  }
  return (
    <span className="rounded-full bg-brand/10 text-scarlet font-black flex items-center justify-center shrink-0" style={{ width: size, height: size, fontSize: size / 3 }} aria-hidden="true">
      {initials}
    </span>
  );
}

function roleLine(p: PublicPlayer): string {
  const parts = [p.battingStyle, p.bowlingStyle].filter((v) => typeof v === "string" && v) as string[];
  if (p.isWicketKeeper) parts.push("Wicket-keeper");
  return parts.join(" · ");
}

export function PlayerDirectory({ store, currentUserId }: { store: ReturnType<typeof useStore>; currentUserId: string }) {
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(DIRECTORY_PAGE_SIZE);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    store.ensureBadgeTypeDefs?.();
  }, [store]);

  const matches = useMemo(() => filterDirectory(store.players as any[], search), [store.players, search]);
  const page = matches.slice(0, visible).map((p) => toPublicPlayer(p));
  const opened = useMemo(() => {
    const p = (store.players as any[]).find((x) => x.id === openId);
    return p ? toPublicPlayer(p) : null;
  }, [store.players, openId]);

  return (
    <div className="flex flex-col gap-3" data-testid="player-directory">
      <label className="relative block">
        <span className="sr-only">Search players</span>
        <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setVisible(DIRECTORY_PAGE_SIZE);
          }}
          placeholder="Search players by name, jersey or ID"
          className="w-full min-h-[44px] pl-9 pr-3 rounded-xl bg-surface border border-border text-sm text-text-primary focus:outline-none focus:border-scarlet"
        />
      </label>
      <p className="text-xs text-text-secondary" data-testid="directory-count">
        {matches.length} member{matches.length === 1 ? "" : "s"}
      </p>
      <ul className="rounded-2xl bg-surface border border-border divide-y divide-border overflow-hidden">
        {page.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              data-testid={`directory-player-${p.id}`}
              onClick={() => setOpenId(p.id)}
              className="w-full min-h-[60px] flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-hover transition cursor-pointer"
            >
              <Avatar name={p.name} photoURL={p.photoURL} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-text-primary truncate">{p.name}</span>
                <span className="block text-xs text-text-secondary truncate">{roleLine(p) || (typeof p.kavachId === "string" ? p.kavachId : "")}</span>
              </span>
              {typeof p.jerseyNumber === "string" && p.jerseyNumber && (
                <span className="text-xs font-bold text-text-secondary">#{p.jerseyNumber}</span>
              )}
            </button>
          </li>
        ))}
        {page.length === 0 && <li className="px-4 py-6 text-sm text-text-secondary">No members match your search.</li>}
      </ul>
      {matches.length > visible && (
        <button
          type="button"
          data-testid="directory-show-more"
          onClick={() => setVisible((v) => v + DIRECTORY_PAGE_SIZE)}
          className="min-h-[44px] w-full rounded-2xl border border-border bg-surface text-sm font-semibold text-scarlet hover:bg-surface-hover transition cursor-pointer"
        >
          Show more ({matches.length - visible} more)
        </button>
      )}
      {opened && (
        <PublicPlayerProfile
          player={opened}
          isSelf={opened.id === currentUserId}
          badgeTypeDefs={store.badgeTypeDefs}
          nonce={store.refreshNonce ?? 0}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

/** Another member's public profile (public fields only). */
export function PublicPlayerProfile({
  player,
  badgeTypeDefs,
  nonce,
  onClose,
}: {
  player: PublicPlayer;
  isSelf?: boolean;
  badgeTypeDefs: any[];
  nonce: number;
  onClose: () => void;
}) {
  const { data: badges, loading } = usePlayerBadges(player.id, nonce);
  const badgeTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of (badges || []) as any[]) counts.set(b.badgeType, (counts.get(b.badgeType) || 0) + 1);
    return [...counts.entries()];
  }, [badges]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="public-profile-name" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div
        data-testid="public-player-profile"
        className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto bg-background rounded-t-3xl sm:rounded-3xl p-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end">
          <button type="button" onClick={onClose} aria-label="Close profile" className="min-h-[44px] min-w-[44px] rounded-full hover:bg-surface-hover flex items-center justify-center cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-[#A30F2D] to-[#6E0A1F] text-white p-4 flex items-center gap-4">
          {typeof player.photoURL === "string" && player.photoURL ? (
            <Avatar name={player.name} photoURL={player.photoURL} size={72} />
          ) : (
            <span className="w-[72px] h-[72px] rounded-full bg-white/15 flex items-center justify-center shrink-0">
              <User className="w-8 h-8 text-white" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <h2 id="public-profile-name" className="text-xl font-black truncate">{player.name}</h2>
            {roleLine(player) && <p className="text-sm text-white/85 truncate">{roleLine(player)}</p>}
            {typeof player.kavachId === "string" && player.kavachId && <p className="text-xs text-white/75 mt-0.5">Player ID: {player.kavachId}</p>}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2">
          {typeof player.jerseyNumber === "string" && player.jerseyNumber && (
            <div className="p-3 rounded-xl bg-surface border border-border">
              <dt className="text-xs text-text-secondary">Jersey</dt>
              <dd className="text-sm font-bold text-text-primary">#{player.jerseyNumber}{typeof player.jerseyName === "string" && player.jerseyName ? ` · ${player.jerseyName}` : ""}</dd>
            </div>
          )}
          {typeof player.kavachJoining === "string" && player.kavachJoining && (
            <div className="p-3 rounded-xl bg-surface border border-border">
              <dt className="text-xs text-text-secondary">Joined</dt>
              <dd className="text-sm font-bold text-text-primary">{player.kavachJoining}</dd>
            </div>
          )}
          <div className="p-3 rounded-xl bg-surface border border-border">
            <dt className="text-xs text-text-secondary">Stunning catches</dt>
            <dd className="text-sm font-bold text-text-primary">{Number(player.stunningCatches || 0)}</dd>
          </div>
          <div className="p-3 rounded-xl bg-surface border border-border">
            <dt className="text-xs text-text-secondary">Dropped catches</dt>
            <dd className="text-sm font-bold text-text-primary">{Number(player.droppedCatches || 0)}</dd>
          </div>
        </dl>
        <section aria-label="Badges" className="p-3 rounded-xl bg-surface border border-border">
          <h3 className="text-sm font-bold text-text-primary mb-2">Badges</h3>
          {loading && !badges ? (
            <p className="text-xs text-text-secondary">Loading badges…</p>
          ) : badgeTypes.length === 0 ? (
            <p className="text-xs text-text-secondary">No badges yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-3">
              {badgeTypes.map(([type, count]) => (
                <li key={type} className="flex flex-col items-center w-16 text-center">
                  <BadgeIcon badgeType={type} size={40} customDefs={badgeTypeDefs} />
                  <span className="text-[11px] text-text-primary leading-tight mt-1">{getBadgeMeta(type, badgeTypeDefs).label}{count > 1 ? ` ×${count}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
