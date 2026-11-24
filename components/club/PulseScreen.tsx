"use client";

/**
 * Player → Club → Pulse (D-20): poll activity from the last 30 days with
 * results, plus older polls on request. Voting stays on the existing Polls
 * screen (OpinionTab) so voting rules and the poll lifecycle are unchanged.
 * Results use the existing PollResults component (voter names are shown to
 * admins only, as before).
 */
import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { PollResults } from "@/components/OpinionTab";
import { recentWindowStart, toMillis } from "@/lib/club-feed";
import type { Poll, PollResponse } from "@/lib/types";

export function PulseScreen({ store, currentUserId }: { store: ReturnType<typeof useStore>; currentUserId: string }) {
  const [showOlder, setShowOlder] = useState(false);
  const { recent, older } = useMemo(() => {
    const start = recentWindowStart().getTime();
    const sorted = ((store.polls || []) as Poll[])
      .slice()
      .sort((a, b) => (toMillis(b.createdAt) ?? 0) - (toMillis(a.createdAt) ?? 0));
    return {
      recent: sorted.filter((p) => p.isActive || (toMillis(p.createdAt) ?? 0) >= start),
      older: sorted.filter((p) => !p.isActive && (toMillis(p.createdAt) ?? 0) < start),
    };
  }, [store.polls]);
  const answered = useMemo(
    () => new Set(((store.pollResponses || []) as PollResponse[]).filter((r) => r.playerId === currentUserId && !r.isArchived).map((r) => r.pollId)),
    [store.pollResponses, currentUserId],
  );

  const renderPoll = (poll: Poll) => (
    <article key={poll.id} data-testid={`pulse-poll-${poll.id}`} className="p-4 rounded-2xl bg-surface border border-border flex flex-col gap-3">
      <header className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
          <BarChart3 className="w-5 h-5 text-scarlet" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-text-primary">{poll.title}</h3>
          <p className="text-xs text-text-secondary mt-0.5">
            {poll.isActive ? "Active" : "Closed"} · {answered.has(poll.id) ? "You voted" : poll.isActive ? "Not voted yet" : "You didn't vote"}
          </p>
        </div>
      </header>
      <PollResults poll={poll} store={store} isAdmin={false} />
    </article>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="pulse-screen">
      <p className="text-sm text-text-secondary">Club opinion from the last 30 days. Vote on active polls from Polls.</p>
      {recent.length === 0 ? (
        <p className="p-4 rounded-2xl bg-surface border border-border text-sm text-text-secondary">No polls in the last 30 days.</p>
      ) : (
        recent.map(renderPoll)
      )}
      {older.length > 0 && !showOlder && (
        <button
          type="button"
          data-testid="pulse-show-older"
          onClick={() => setShowOlder(true)}
          className="min-h-[44px] w-full rounded-2xl border border-border bg-surface text-sm font-semibold text-scarlet hover:bg-surface-hover transition cursor-pointer"
        >
          Show older polls ({older.length})
        </button>
      )}
      {showOlder && older.map(renderPoll)}
    </div>
  );
}
