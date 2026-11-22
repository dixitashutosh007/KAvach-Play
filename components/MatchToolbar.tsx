"use client";

import { useState } from "react";
import { Search, RefreshCw, ExternalLink, Download, Trash2 } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { authedFetch } from "@/lib/authed-fetch";
import { formatDate } from "@/lib/utils";

type SyncProgress = {
  phase: "checking" | "syncing" | "done";
  current: number;
  total: number;
  synced: number;
  removed: number;
  errors: number;
};

export function MatchToolbar({ store }: { store: ReturnType<typeof useStore> }) {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [purging, setPurging] = useState(false);
  const { confirm: confirmAction } = useConfirm();
  const [syncStatus, setSyncStatus] = useState<{
    checked: boolean;
    inSync: boolean;
    appCount: number;
    calCount: number;
    missing: number;
    orphans: number;
  } | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const calendarId = store.appConfig?.googleCalendarId;
  const calendarUrl = calendarId
    ? `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}`
    : "";

  const calPost = async (body: any) => {
    const res = await authedFetch("/api/calendar/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!text) throw new Error("Empty response (timeout)");
    return JSON.parse(text);
  };

  const activeMatches = store.matches.filter(
    (m) => !m.isArchived && m.result !== "Abandoned",
  );

  const handleCheckSync = async () => {
    setStatusLoading(true);
    setSyncMsg("");
    try {
      const json = await calPost({ action: "list-events" });
      const calEvents: Array<{ eventId: string; kavachMatchId?: string; summary: string }> =
        json.events || [];
      const calMatchIds = new Set(
        calEvents.filter((e) => e.kavachMatchId).map((e) => e.kavachMatchId!),
      );
      const appMatchIds = new Set(activeMatches.map((m) => m.id));

      const missing = activeMatches.filter((m) => !calMatchIds.has(m.id)).length;
      const orphans = calEvents.filter(
        (e) => e.kavachMatchId && !appMatchIds.has(e.kavachMatchId),
      ).length;

      setSyncStatus({
        checked: true,
        inSync: missing === 0 && orphans === 0,
        appCount: activeMatches.length,
        calCount: calEvents.length,
        missing,
        orphans,
      });
    } catch (err: any) {
      setSyncMsg(`Check failed: ${err?.message || String(err)}`);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleResync = async () => {
    setSyncMsg("");
    setSyncStatus(null);

    const prog: SyncProgress = {
      phase: "checking",
      current: 0,
      total: 0,
      synced: 0,
      removed: 0,
      errors: 0,
    };
    setProgress({ ...prog });

    try {
      const json = await calPost({ action: "list-events" });
      const calEvents: Array<{ eventId: string; kavachMatchId?: string }> =
        json.events || [];
      const calMatchIds = new Set(
        calEvents.filter((e) => e.kavachMatchId).map((e) => e.kavachMatchId!),
      );
      const appMatchIds = new Set(activeMatches.map((m) => m.id));

      const toUpsert = activeMatches;
      const orphanEventIds = calEvents
        .filter((e) => e.kavachMatchId && !appMatchIds.has(e.kavachMatchId))
        .map((e) => e.eventId);

      prog.total = toUpsert.length + orphanEventIds.length;
      prog.phase = "syncing";
      setProgress({ ...prog });

      for (const match of toUpsert) {
        try {
          await calPost({ action: "upsert", matchId: match.id });
          prog.synced++;
        } catch {
          prog.errors++;
        }
        prog.current++;
        setProgress({ ...prog });
      }

      for (const eventId of orphanEventIds) {
        try {
          await calPost({ action: "delete", googleEventId: eventId });
          prog.removed++;
        } catch {
          prog.errors++;
        }
        prog.current++;
        setProgress({ ...prog });
      }

      prog.phase = "done";
      setProgress({ ...prog });

      const parts: string[] = [];
      if (prog.synced) parts.push(`${prog.synced} synced`);
      if (prog.removed) parts.push(`${prog.removed} removed`);
      if (prog.errors) parts.push(`${prog.errors} failed`);
      setSyncMsg(parts.join(", ") || "Nothing to sync.");
    } catch (err: any) {
      setSyncMsg(`Sync failed: ${err?.message || String(err)}`);
      setProgress(null);
    }
  };

  const handleExport = () => {
    const sorted = [...activeMatches].sort((a, b) => {
      const da = a.date.replace(/\//g, "-");
      const db_ = b.date.replace(/\//g, "-");
      return da.localeCompare(db_);
    });

    const groundMap = new Map(store.grounds.map((g) => [g.id, g.name]));
    const tournamentMap = new Map(store.tournaments.map((t) => [t.id, t.name]));

    const esc = (v: string) => {
      if (!v) return "";
      if (v.includes(",") || v.includes('"') || v.includes("\n"))
        return `"${v.replace(/"/g, '""')}"`;
      return v;
    };

    const header = "Date,Time,Opponent,Type,Format,Jersey,Ground,Tournament,Result";
    const rows = sorted.map((m) => {
      const ground = m.groundId ? groundMap.get(m.groundId) || "" : "";
      const tournament = m.tournamentId ? tournamentMap.get(m.tournamentId) || "" : "";
      let result = m.result || "Pending";
      if (
        (m.result === "KAvach Won" || m.result === "KAvach Lost") &&
        m.resultMarginAmount
      ) {
        result += ` by ${m.resultMarginAmount} ${m.resultMarginType || "runs"}`;
      }
      return [
        formatDate(m.date),
        m.time || "",
        m.opponent || "TBD",
        m.matchType || "",
        m.format || "",
        m.jerseyColor || "",
        ground,
        tournament,
        result,
      ]
        .map(esc)
        .join(",");
    });

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `KAvach_Match_Schedule_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePurge = async () => {
    setPurging(true);
    setSyncMsg("");
    setSyncStatus(null);
    try {
      const json = await calPost({ action: "purge" });
      setSyncMsg(
        `Calendar reset: ${json.deleted} event${json.deleted === 1 ? "" : "s"} deleted, ${json.clearedMatches} match link${json.clearedMatches === 1 ? "" : "s"} cleared.${json.errors?.length ? ` ${json.errors.length} failed.` : ""} Now hit "Sync to Calendar" to push fresh.`,
      );
    } catch (err: any) {
      setSyncMsg(`Purge failed: ${err?.message || String(err)}`);
    } finally {
      setPurging(false);
    }
  };

  const requestPurge = async () => {
    const ok = await confirmAction({
      title: "Reset Google Calendar?",
      message:
        "Delete all KAvach match events from the club Google Calendar and clear their match links? Use \"Sync to Calendar\" afterwards to push fresh events.",
      confirmLabel: "Yes, Reset",
      destructive: true,
    });
    if (ok) await handlePurge();
  };

  const busy = !!progress && progress.phase !== "done";

  return (
    <div className="space-y-2">
      {/* Workflow order (same on every width):
          Calendar sync: 1 Sync to Calendar (primary) · 2 Check Sync · 3 View Calendar
          Schedule tools: 4 Export Schedule · 5 Reset Calendar (destructive, last) */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-testid="calendar-sync-toolbar">
        <div role="group" aria-label="Calendar sync" className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <button
            onClick={handleResync}
            disabled={busy}
            data-testid="cal-sync"
            className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg px-3 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition disabled:opacity-50 cursor-pointer col-span-2 bg-accent/90 hover:bg-accent text-black"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
            {busy ? "Syncing…" : "Sync to Calendar"}
          </button>
          <button
            onClick={handleCheckSync}
            disabled={busy || statusLoading}
            data-testid="cal-check"
            className={`inline-flex items-center justify-center gap-1.5 h-9 rounded-lg px-3 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition disabled:opacity-50 cursor-pointer border border-border bg-surface hover:bg-surface-hover text-text-primary ${calendarUrl ? "" : "col-span-2"}`}
          >
            <Search className="w-3.5 h-3.5" aria-hidden="true" />
            {statusLoading ? "Checking…" : "Check Sync"}
          </button>
          {calendarUrl && (
            <a
              href={calendarUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="cal-view"
              className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg px-3 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition disabled:opacity-50 cursor-pointer border border-border bg-surface hover:bg-surface-hover text-text-primary"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              View Calendar
            </a>
          )}
        </div>
        <div role="group" aria-label="Schedule tools" className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <button
            onClick={handleExport}
            data-testid="cal-export"
            className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg px-3 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition disabled:opacity-50 cursor-pointer border border-border bg-surface hover:bg-surface-hover text-text-primary"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Export Schedule
          </button>
          <button
            onClick={requestPurge}
            disabled={busy || purging}
            data-testid="cal-reset"
            className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg px-3 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition disabled:opacity-50 cursor-pointer border border-red-200 bg-red-50 hover:bg-red-100 text-red-700"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            {purging ? "Resetting…" : "Reset Calendar"}
          </button>
        </div>
      </div>

      {syncStatus && (
        <div
          className={`text-[11px] font-bold rounded-lg p-2 ${
            syncStatus.inSync
              ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
              : "bg-amber-500/10 border border-amber-500/30 text-amber-300"
          }`}
        >
          {syncStatus.inSync
            ? `In Sync — ${syncStatus.appCount} matches in app, ${syncStatus.calCount} events on calendar.`
            : `Out of Sync — ${syncStatus.appCount} in app, ${syncStatus.calCount} on calendar. ${syncStatus.missing ? `${syncStatus.missing} missing from calendar. ` : ""}${syncStatus.orphans ? `${syncStatus.orphans} orphan event${syncStatus.orphans > 1 ? "s" : ""} on calendar.` : ""}`}
        </div>
      )}

      {progress && progress.phase !== "done" && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-text-secondary">
            <span>
              {progress.phase === "checking"
                ? "Loading calendar events…"
                : `${progress.current} / ${progress.total}`}
            </span>
            <span>
              {progress.synced > 0 && `${progress.synced} synced`}
              {progress.removed > 0 && ` · ${progress.removed} removed`}
              {progress.errors > 0 && ` · ${progress.errors} failed`}
            </span>
          </div>
          {progress.total > 0 && (
            <div className="h-1.5 w-full bg-surface-hover rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-200 rounded-full"
                style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {syncMsg && (
        <div className="text-[11px] text-text-secondary bg-surface-hover border border-border rounded-lg p-2">
          {syncMsg}
        </div>
      )}
    </div>
  );
}
