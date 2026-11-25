"use client";

/**
 * Player → Club (D-20): the member's community and club-intelligence screen.
 *
 * Loads only compact previews:
 *  - club totals from the single admin-maintained `appConfig/clubStats` doc;
 *  - announcements and Pulse from bounded 30-day queries (hooks/useClubData);
 *  - leaderboard preview from the player records already in memory (no reads).
 * Full lists (announcements, Pulse, polls, leaderboard, badges, directory) open
 * as secondary screens on demand ("View More" / tiles).
 *
 * Circuit standings (India / Bangalore, most wins / most played) come from the
 * admin-maintained `circuitStandings` records (Admin Club → Club Stats): the club's
 * own all-time rank and total in each circuit (e.g. #20 · 500 wins). A circuit
 * without records shows "Not available" — nothing is invented.
 */
import { useEffect, useMemo, useState } from "react";
import { Trophy, Award, BarChart3, Activity, Megaphone, ChevronRight, Users, Medal, ShoppingBag } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { useClubStats } from "@/hooks/useClubStats";
import { useCircuitStandings } from "@/hooks/useCircuitStandings";
import { CIRCUITS, standingsByCircuit } from "@/lib/circuit-standings";
import { useRecentAnnouncements, usePulsePreview } from "@/hooks/useClubData";
import { computeWinRate, formatWinRate } from "@/lib/club-stats";
import { CLUB_ANNOUNCEMENT_PREVIEW, CLUB_PULSE_PREVIEW } from "@/lib/club-feed";
import { rankLeaderboard, countBadgesByPlayer } from "@/lib/leaderboard";
import { getAnnouncementDisplay } from "@/components/home/announcementDisplay";
import { getAvailableStatYears, aggregateKavachStats } from "@/lib/kavach-stats";

type Section = "all" | "announcements" | "pulse" | "stats";

export function PlayerClubTab({
  store,
  currentUserId,
  isFeatureEnabled,
  onNavigate,
}: {
  store: ReturnType<typeof useStore>;
  currentUserId: string;
  isFeatureEnabled: (key: any) => boolean;
  onNavigate: (tab: string, action?: string) => void;
}) {
  const [section, setSection] = useState<Section>("all");
  const nonce = store.refreshNonce ?? 0;
  const pulseOn = isFeatureEnabled("opinion");
  const show = (s: Exclude<Section, "all">) => section === "all" || section === s;
  const statsVisible = show("stats");

  useEffect(() => {
    if (statsVisible) {
      store.ensurePlayerStats?.();
    }
  }, [statsVisible, store]);

  const chips: { key: Section; label: string }[] = [
    { key: "all", label: "All" },
    { key: "announcements", label: "Announcements" },
    ...(pulseOn ? [{ key: "pulse" as Section, label: "Pulse" }] : []),
    { key: "stats", label: "Stats" },
  ];

  const tiles = [
    { tab: "leaderboard", label: "Leaderboard", icon: Trophy, on: isFeatureEnabled("leaderboard") },
    { tab: "badges", label: "Player Badges", icon: Award, on: isFeatureEnabled("badges") },
    { tab: "opinion", label: "Polls", icon: BarChart3, on: pulseOn },
    { tab: "pulse", label: "Pulse", icon: Activity, on: pulseOn },
  ].filter((t) => t.on);

  return (
    <div className="flex flex-col gap-4" data-testid="player-club">
      <h1 className="text-2xl font-black tracking-tight text-text-primary font-heading">Club</h1>

      <div role="tablist" aria-label="Club sections" className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {chips.map((c) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={section === c.key}
            data-testid={`club-chip-${c.key}`}
            onClick={() => setSection(c.key)}
            className={`shrink-0 min-h-[40px] px-4 rounded-full text-sm font-semibold border transition cursor-pointer ${
              section === c.key ? "bg-scarlet text-white border-scarlet" : "bg-surface text-text-primary border-border hover:bg-surface-hover"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {show("stats") && (
        <>
          <ClubInfoCard
            clubName={store.appConfig?.clubName || "KAvach Cricket Club"}
            activePlayersCount={store.players.filter((p) => !p.disabled && !p.mergedInto).length}
          />
          <ClubAtAGlance />
          <KavachStatsSection playerStats={store.playerStats || []} players={store.players || []} />
        </>
      )}

      {section === "all" && tiles.length > 0 && (
        <div className="grid grid-cols-4 gap-2" data-testid="club-tiles">
          {tiles.map(({ tab, label, icon: Icon }) => (
            <button
              key={tab}
              type="button"
              data-testid={`club-tile-${tab}`}
              onClick={() => onNavigate(tab)}
              className="min-h-[88px] flex flex-col items-center justify-center gap-2 rounded-2xl bg-surface border border-border hover:bg-surface-hover transition cursor-pointer px-1"
            >
              <span className="w-11 h-11 rounded-full bg-brand/10 flex items-center justify-center">
                <Icon className="w-5 h-5 text-scarlet" aria-hidden="true" />
              </span>
              <span className="text-xs font-semibold text-text-primary text-center leading-tight">{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Club Shop — on-demand facility: shown ONLY while an admin has the Shop
          enabled (appConfig features.shop); no placeholder when it is off. */}
      {section === "all" && isFeatureEnabled("shop") && (
        <button
          type="button"
          data-testid="club-shop-card"
          onClick={() => onNavigate("shop")}
          className="w-full text-left rounded-2xl border border-scarlet/30 bg-gradient-to-r from-brand-surface/70 to-surface p-4 flex items-center gap-4 hover:border-scarlet/60 transition cursor-pointer"
        >
          <span className="w-14 h-14 rounded-2xl bg-surface border border-scarlet/20 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-7 h-7 text-scarlet" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-black font-heading text-text-primary">Club Shop</span>
            <span className="block text-sm text-text-secondary">Official KAvach merchandise, jerseys and more</span>
          </span>
          <ChevronRight className="w-5 h-5 text-scarlet shrink-0" aria-hidden="true" />
        </button>
      )}

      {show("announcements") && (
        <RecentAnnouncements nonce={nonce} onOpen={(id) => onNavigate("announcements", id)} onViewMore={() => onNavigate("announcements")} />
      )}

      {pulseOn && show("pulse") && (
        <LatestPulse uid={currentUserId} nonce={nonce} onOpenPolls={() => onNavigate("opinion")} onViewMore={() => onNavigate("pulse")} />
      )}

      {show("stats") && isFeatureEnabled("leaderboard") && (
        <LeaderboardPreview store={store} onViewAll={() => onNavigate("leaderboard")} />
      )}

      {section === "all" && (
        <button
          type="button"
          data-testid="club-directory-link"
          onClick={() => onNavigate("players")}
          className="w-full min-h-[56px] flex items-center justify-between gap-3 px-4 rounded-2xl bg-surface border border-border hover:bg-surface-hover transition cursor-pointer"
        >
          <span className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-scarlet" aria-hidden="true" />
            </span>
            <span className="text-left">
              <span className="block text-sm font-bold text-text-primary">Player Directory</span>
              <span className="block text-xs text-text-secondary">Browse members and their public profiles</span>
            </span>
          </span>
          <ChevronRight className="w-4 h-4 text-text-muted" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, hint, action, onAction, testId }: { icon: typeof Trophy; title: string; hint?: string; action?: string; onAction?: () => void; testId?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-bold text-text-primary">
        <Icon className="w-5 h-5 text-scarlet" aria-hidden="true" />
        {title}
        {hint && <span className="text-xs font-normal text-text-secondary">({hint})</span>}
      </h2>
      {action && onAction && (
        <button type="button" data-testid={testId} onClick={onAction} className="min-h-[44px] px-1 text-sm font-semibold text-scarlet hover:underline cursor-pointer">
          {action}
        </button>
      )}
    </div>
  );
}

function ClubInfoCard({ clubName, activePlayersCount }: { clubName: string; activePlayersCount: number }) {
  return (
    <section
      data-testid="club-info-card"
      className="rounded-2xl bg-surface border border-border px-4 py-3.5 flex items-center justify-between gap-3"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-scarlet">Club Info</p>
        <p className="text-base font-black text-text-primary truncate">{clubName}</p>
        <p className="text-xs text-text-secondary">Registered club members: {activePlayersCount}</p>
      </div>
    </section>
  );
}

function KavachStatsSection({
  playerStats,
  players,
}: {
  playerStats: ReturnType<typeof useStore>["playerStats"];
  players: ReturnType<typeof useStore>["players"];
}) {
  const years = useMemo(() => getAvailableStatYears(playerStats), [playerStats]);
  const [selectedYear, setSelectedYear] = useState<"overall" | number>("overall");

  const activeYear: "overall" | number =
    selectedYear === "overall" || years.includes(selectedYear) ? selectedYear : "overall";

  const summary = useMemo(
    () => aggregateKavachStats(playerStats, players, activeYear),
    [playerStats, players, activeYear],
  );

  return (
    <section className="flex flex-col gap-2.5" data-testid="club-kavach-stats">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <SectionHeader icon={Trophy} title="KAvach Stats" hint={activeYear === "overall" ? "Overall" : String(activeYear)} />
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar" role="tablist" aria-label="KAvach Stats period">
          <button
            type="button"
            role="tab"
            aria-selected={activeYear === "overall"}
            data-testid="kavach-stats-overall"
            onClick={() => setSelectedYear("overall")}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition cursor-pointer ${
              activeYear === "overall"
                ? "bg-scarlet text-white border-scarlet"
                : "bg-surface text-text-primary border-border hover:bg-surface-hover"
            }`}
          >
            Overall
          </button>
          {years.map((yr) => (
            <button
              key={yr}
              type="button"
              role="tab"
              aria-selected={activeYear === yr}
              data-testid={`kavach-stats-year-${yr}`}
              onClick={() => setSelectedYear(yr)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition cursor-pointer ${
                activeYear === yr
                  ? "bg-scarlet text-white border-scarlet"
                  : "bg-surface text-text-primary border-border hover:bg-surface-hover"
              }`}
            >
              {yr}
            </button>
          ))}
        </div>
      </div>

      {!summary.hasData ? (
        <StateCard text="No KAvach player statistics recorded for this period yet." />
      ) : (
        <div className="rounded-2xl bg-surface border border-border p-4 space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center border-b border-border pb-3">
            <div>
              <p className="text-[11px] font-semibold text-text-secondary">Total Runs</p>
              <p className="text-lg font-black text-text-primary tabular-nums" data-testid="kavach-stats-runs">
                {summary.totalRuns.toLocaleString("en-IN")}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-text-secondary">Total Wickets</p>
              <p className="text-lg font-black text-text-primary tabular-nums" data-testid="kavach-stats-wickets">
                {summary.totalWickets.toLocaleString("en-IN")}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-text-secondary">Players</p>
              <p className="text-lg font-black text-text-primary tabular-nums" data-testid="kavach-stats-players">
                {summary.contributorsCount}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">Top Run Scorers</p>
              {summary.topScorers.length === 0 ? (
                <p className="text-xs text-text-muted">No batting records yet.</p>
              ) : (
                <ol className="space-y-1.5">
                  {summary.topScorers.map((p, idx) => (
                    <li key={p.playerId} className="flex items-center justify-between text-xs">
                      <span className="truncate font-semibold text-text-primary">
                        <span className="text-scarlet font-black mr-1.5">#{idx + 1}</span>
                        {p.name}
                      </span>
                      <span className="font-bold tabular-nums text-text-primary">{p.runs}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">Top Wicket Takers</p>
              {summary.topWicketTakers.length === 0 ? (
                <p className="text-xs text-text-muted">No bowling records yet.</p>
              ) : (
                <ol className="space-y-1.5">
                  {summary.topWicketTakers.map((p, idx) => (
                    <li key={p.playerId} className="flex items-center justify-between text-xs">
                      <span className="truncate font-semibold text-text-primary">
                        <span className="text-scarlet font-black mr-1.5">#{idx + 1}</span>
                        {p.name}
                      </span>
                      <span className="font-bold tabular-nums text-text-primary">{p.wickets}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** Club totals (admin-maintained) + circuit standings (admin-maintained `circuitStandings`). */
export function ClubAtAGlance() {
  const { stats, loading, error } = useClubStats();
  const rate = stats ? computeWinRate(stats.matchesPlayed, stats.matchesWon) : null;
  const circuit = useCircuitStandings();
  const byCircuit = standingsByCircuit(circuit.standings);
  const anySaved = circuit.standings.length > 0;
  return (
    <section data-testid="club-at-a-glance" className="rounded-2xl overflow-hidden border border-border bg-surface" aria-labelledby="club-glance-title">
      <div className="bg-[#171C26] text-white px-4 py-4">
        <h2 id="club-glance-title" className="text-lg font-black font-heading">KAvach Club – At a Glance</h2>
        {stats ? (
          <div className="mt-3 flex items-center gap-4">
            <div className="flex-1 grid grid-cols-2 divide-x divide-white/15">
              <div className="pr-3">
                <p className="text-xs text-white/70">Total Matches</p>
                <p className="text-3xl font-black" data-testid="club-total-matches">{stats.matchesPlayed}</p>
              </div>
              <div className="pl-3">
                <p className="text-xs text-white/70">Matches Won</p>
                <p className="text-3xl font-black" data-testid="club-matches-won">{stats.matchesWon}</p>
              </div>
            </div>
            <div className="shrink-0 w-20 h-20 rounded-full border-[6px] border-scarlet flex flex-col items-center justify-center" aria-label={`Win rate ${formatWinRate(rate)}`}>
              <span className="text-lg font-black leading-none" data-testid="club-win-rate">{formatWinRate(rate)}</span>
              <span className="text-[10px] text-white/70 mt-0.5">Win Rate</span>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-white/75" data-testid="club-stats-status">
            {loading ? "Loading club statistics…" : error ? "Club statistics couldn't be loaded right now." : "Club statistics haven't been published yet."}
          </p>
        )}
      </div>
      <div className="px-4 py-3" data-testid="club-circuit-standings">
        <p className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">Club Rankings</p>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-2">
          {CIRCUITS.map((c) => {
            const st = byCircuit[c.key];
            return (
              <li key={c.key} className="flex items-start gap-2 min-w-0" data-testid={`club-circuit-${c.key}`}>
                <Medal className="w-5 h-5 text-muted-gold shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-text-primary leading-tight">{c.metric}</span>
                  {st ? (
                    <span className="block text-sm font-black text-scarlet leading-tight tabular-nums" data-testid={`club-circuit-${c.key}-standing`}>
                      #{st.rank.toLocaleString("en-IN")}
                    </span>
                  ) : (
                    <span className="block text-[11px] text-text-muted leading-tight">{circuit.loading ? "Loading…" : "Not set"}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-text-secondary" data-testid="club-circuit-note">
          {anySaved
            ? "KAvach's official ranking in Bangalore and India."
            : circuit.error
              ? "Club rankings couldn't be loaded right now."
              : "Club rankings will appear here once the club publishes them."}
        </p>
      </div>
    </section>
  );
}

function RecentAnnouncements({ nonce, onOpen, onViewMore }: { nonce: number; onOpen: (id: string) => void; onViewMore: () => void }) {
  const { data, loading, error } = useRecentAnnouncements(nonce);
  const items = (data || []).slice(0, CLUB_ANNOUNCEMENT_PREVIEW);
  return (
    <section className="flex flex-col gap-2" data-testid="club-recent-announcements">
      <SectionHeader icon={Megaphone} title="Recent Announcements" action="View More" onAction={onViewMore} testId="club-announcements-more" />
      {loading && !data ? (
        <SkeletonRows count={2} />
      ) : error ? (
        <StateCard text="Announcements couldn't be loaded. Pull down to refresh." />
      ) : items.length === 0 ? (
        <StateCard text="No announcements in the last 30 days." />
      ) : (
        items.map((p) => {
          const d = getAnnouncementDisplay(p);
          return (
            <button
              key={p.id}
              type="button"
              data-testid={`club-announcement-${p.id}`}
              onClick={() => onOpen(p.id)}
              className="w-full text-left flex items-center gap-3 p-3 rounded-2xl bg-surface border border-border hover:bg-surface-hover transition cursor-pointer"
            >
              <span className="min-w-0 flex-1">
                {p.isPinned && (
                  <span className="inline-block mb-1 px-2 py-0.5 rounded-md bg-scarlet text-white text-[10px] font-bold uppercase tracking-wider">Important</span>
                )}
                <span className="block text-sm font-bold text-text-primary truncate">{d.headline || d.summary}</span>
                {d.headline && d.summary && <span className="block text-xs text-text-secondary truncate">{d.summary}</span>}
              </span>
              <ChevronRight className="w-4 h-4 text-text-muted shrink-0" aria-hidden="true" />
            </button>
          );
        })
      )}
    </section>
  );
}

function LatestPulse({ uid, nonce, onOpenPolls, onViewMore }: { uid: string; nonce: number; onOpenPolls: () => void; onViewMore: () => void }) {
  const { data, loading, error } = usePulsePreview(uid, nonce, CLUB_PULSE_PREVIEW);
  return (
    <section className="flex flex-col gap-2" data-testid="club-latest-pulse">
      <SectionHeader icon={BarChart3} title="Latest Pulse" hint="Last 30 days" action="View More" onAction={onViewMore} testId="club-pulse-more" />
      {loading && !data ? (
        <SkeletonRows count={1} />
      ) : error ? (
        <StateCard text="Pulse couldn't be loaded. Pull down to refresh." />
      ) : !data || data.items.length === 0 ? (
        <StateCard text="No polls in the last 30 days." />
      ) : (
        data.items.map(({ poll, votes, answered }) => (
          <button
            key={poll.id}
            type="button"
            data-testid={`club-poll-${poll.id}`}
            onClick={poll.isActive ? onOpenPolls : onViewMore}
            className="w-full text-left flex items-center gap-3 p-3 rounded-2xl bg-surface border border-border hover:bg-surface-hover transition cursor-pointer"
          >
            <span className="w-11 h-11 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
              <BarChart3 className="w-5 h-5 text-scarlet" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-text-primary line-clamp-2">{poll.title}</span>
              <span className="block text-xs text-text-secondary mt-0.5">
                {votes !== null ? `${votes} vote${votes === 1 ? "" : "s"} · ` : ""}
                {poll.isActive ? (answered ? "You voted" : "Vote now") : "Closed"}
              </span>
            </span>
            <ChevronRight className="w-4 h-4 text-text-muted shrink-0" aria-hidden="true" />
          </button>
        ))
      )}
    </section>
  );
}

function LeaderboardPreview({ store, onViewAll }: { store: ReturnType<typeof useStore>; onViewAll: () => void }) {
  // Uses player records already in memory; badge-based ranking is on the full screen.
  const top = useMemo(
    () => rankLeaderboard(store.players, "stunning", countBadgesByPlayer([])).slice(0, 3),
    [store.players],
  );
  return (
    <section className="flex flex-col gap-2" data-testid="club-leaderboard-preview">
      <SectionHeader icon={Trophy} title="Leaderboard" hint="Stunning catches" action="View All" onAction={onViewAll} testId="club-leaderboard-more" />
      {top.length === 0 ? (
        <StateCard text="No leaderboard entries yet." />
      ) : (
        <ol className="rounded-2xl bg-surface border border-border divide-y divide-border">
          {top.map((e, i) => (
            <li key={e.player.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-6 text-sm font-black text-scarlet">#{i + 1}</span>
              <span className="flex-1 text-sm font-semibold text-text-primary truncate">{e.player.name}</span>
              <span className="text-sm font-bold text-text-primary">{e.value}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" data-state="loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-16 rounded-2xl bg-surface-hover animate-pulse" />
      ))}
    </div>
  );
}

function StateCard({ text }: { text: string }) {
  return <p className="p-4 rounded-2xl bg-surface border border-border text-sm text-text-secondary">{text}</p>;
}
