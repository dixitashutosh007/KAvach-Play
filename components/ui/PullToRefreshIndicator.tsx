"use client";

/** Subtle pull-to-refresh indicator (`components/ui/PullToRefreshIndicator.tsx`). */
import { ArrowDown, Check, Loader2, AlertCircle } from "lucide-react";
import { PULL_THRESHOLD_PX, type PullStatus } from "@/hooks/usePullToRefresh";

const LABELS: Record<PullStatus, string> = {
  idle: "",
  pulling: "Pull to refresh",
  ready: "Release to refresh",
  refreshing: "Refreshing…",
  done: "Up to date",
  error: "Couldn't refresh — check your connection",
};

export function PullToRefreshIndicator({ status, distance }: { status: PullStatus; distance: number }) {
  const visible = status !== "idle";
  const offset = status === "pulling" || status === "ready" ? distance : PULL_THRESHOLD_PX * 0.75;
  return (
    <div
      aria-live="polite"
      role="status"
      data-testid="pull-to-refresh-indicator"
      className="pointer-events-none fixed inset-x-0 top-16 z-30 flex justify-center"
      style={{
        transform: `translateY(${visible ? Math.max(0, offset - 36) : -60}px)`,
        opacity: visible ? 1 : 0,
        transition: status === "pulling" || status === "ready" ? "none" : "transform 200ms ease, opacity 200ms ease",
      }}
    >
      {visible && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] font-bold text-text-secondary shadow-sm">
          {status === "refreshing" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-scarlet motion-reduce:animate-none" aria-hidden="true" />
          ) : status === "done" ? (
            <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
          ) : status === "error" ? (
            <AlertCircle className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
          ) : (
            <ArrowDown
              className={`w-3.5 h-3.5 text-scarlet transition-transform motion-reduce:transition-none ${status === "ready" ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          )}
          {LABELS[status]}
        </span>
      )}
    </div>
  );
}
