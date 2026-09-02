import { useState, useEffect, useCallback } from "react";
import { ScrollText, Filter, Trash2, ChevronDown, ChevronRight, RefreshCw, Database } from "lucide-react";
import {
  AuditLogEntry,
  AuditEntity,
  AuditAction,
  AuditActorType,
  fetchAuditLogs,
  getAuditLogCount,
  truncateAuditLogs,
  formatFieldName,
} from "@/lib/auditLog";
import { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

const ENTITY_OPTIONS: { value: AuditEntity; label: string }[] = [
  { value: "match", label: "Matches" },
  { value: "player", label: "Players" },
  { value: "payment", label: "Payments" },
  { value: "ground", label: "Grounds" },
  { value: "tournament", label: "Tournaments" },
  { value: "subscription", label: "Subscriptions" },
  { value: "badge", label: "Badges" },
  { value: "badge_type", label: "Badge Types" },
  { value: "merchandise", label: "Merchandise" },
  { value: "merch_order", label: "Orders" },
  { value: "fee", label: "Fees" },
  { value: "fee_plan", label: "Fee Plans" },
  { value: "settings", label: "Settings" },
  { value: "reminder", label: "Reminders" },
  { value: "poll", label: "Polls" },
  { value: "post", label: "Posts" },
  { value: "out_of_play", label: "PNA" },
  { value: "catch", label: "Catches" },
  { value: "user_role", label: "User Roles" },
];

const ACTION_OPTIONS: { value: AuditAction; label: string }[] = [
  { value: "created", label: "Created" },
  { value: "updated", label: "Updated" },
  { value: "deleted", label: "Deleted" },
  { value: "paid", label: "Paid" },
  { value: "sent", label: "Sent" },
  { value: "status_change", label: "Status Change" },
];

const ACTOR_TYPE_OPTIONS: { value: AuditActorType; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "player", label: "Player" },
  { value: "system", label: "System" },
];

const ACTION_COLORS: Record<AuditAction, string> = {
  created: "bg-emerald-500/20 text-emerald-400",
  updated: "bg-blue-500/20 text-blue-400",
  deleted: "bg-red-500/20 text-red-400",
  paid: "bg-green-500/20 text-green-400",
  sent: "bg-purple-500/20 text-purple-400",
  status_change: "bg-amber-500/20 text-amber-400",
};

const ENTITY_EMOJI: Record<string, string> = {
  match: "🏏",
  player: "👤",
  payment: "💰",
  ground: "🏟️",
  tournament: "🏆",
  subscription: "📋",
  badge: "🏅",
  badge_type: "🎖️",
  merchandise: "🛍️",
  merch_order: "📦",
  fee: "💸",
  fee_plan: "📊",
  fee_template: "📝",
  settings: "⚙️",
  reminder: "🔔",
  poll: "📊",
  post: "💬",
  out_of_play: "🚫",
  catch: "🧤",
  comment: "💭",
  user_role: "🔑",
};

function formatTimestamp(ts: any): string {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function AuditLogTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [entityFilter, setEntityFilter] = useState<AuditEntity | "">("");
  const [actionFilter, setActionFilter] = useState<AuditAction | "">("");
  const [actorTypeFilter, setActorTypeFilter] = useState<AuditActorType | "">("");

  const [logCount, setLogCount] = useState<number | null>(null);
  const [truncating, setTruncating] = useState(false);
  const [truncateMonths, setTruncateMonths] = useState<number | null>(null);
  const [truncateResult, setTruncateResult] = useState<string | null>(null);

  const loadLogs = useCallback(async (reset: boolean = true) => {
    if (reset) {
      setLoading(true);
      setLogs([]);
      setLastDoc(null);
    } else {
      setLoadingMore(true);
    }
    try {
      const result = await fetchAuditLogs({
        entityFilter: entityFilter || undefined,
        actionFilter: actionFilter || undefined,
        actorTypeFilter: actorTypeFilter || undefined,
        lastDoc: reset ? null : lastDoc,
      });
      setLogs(prev => reset ? result.logs : [...prev, ...result.logs]);
      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);
    } catch (e) {
      console.error("Failed to load audit logs:", e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [entityFilter, actionFilter, actorTypeFilter, lastDoc]);

  useEffect(() => {
    loadLogs(true);
  }, [entityFilter, actionFilter, actorTypeFilter]);

  const refreshCount = async () => {
    try {
      const count = await getAuditLogCount();
      setLogCount(count);
    } catch (e) {
      console.error("Failed to get log count:", e);
    }
  };

  useEffect(() => {
    refreshCount();
  }, []);

  const handleTruncate = async () => {
    if (!truncateMonths || !isSuperAdmin) return;
    setTruncating(true);
    setTruncateResult(null);
    try {
      const deleted = await truncateAuditLogs(truncateMonths);
      setTruncateResult(`Deleted ${deleted} log${deleted !== 1 ? "s" : ""} older than ${truncateMonths} month${truncateMonths !== 1 ? "s" : ""}.`);
      setTruncateMonths(null);
      loadLogs(true);
      refreshCount();
    } catch (e) {
      setTruncateResult("Failed to truncate logs.");
      console.error(e);
    } finally {
      setTruncating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-accent" /> Activity Log
        </h2>
        <div className="flex items-center gap-2">
          {logCount !== null && (
            <span className="text-xs text-white/40 font-mono flex items-center gap-1">
              <Database className="w-3 h-3" />
              {logCount.toLocaleString()} entries
            </span>
          )}
          <button
            onClick={() => { loadLogs(true); refreshCount(); }}
            className="p-1.5 rounded-lg bg-white/5 border border-glass-border text-white/50 hover:text-white transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="w-4 h-4 text-white/40" />
        <select
          value={entityFilter}
          onChange={e => setEntityFilter(e.target.value as AuditEntity | "")}
          className="rounded-lg border border-glass-border bg-black/40 px-2.5 py-1.5 text-xs font-bold text-white focus:border-accent focus:outline-none [&>option]:bg-neutral-950"
        >
          <option value="">All Types</option>
          {ENTITY_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value as AuditAction | "")}
          className="rounded-lg border border-glass-border bg-black/40 px-2.5 py-1.5 text-xs font-bold text-white focus:border-accent focus:outline-none [&>option]:bg-neutral-950"
        >
          <option value="">All Actions</option>
          {ACTION_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={actorTypeFilter}
          onChange={e => setActorTypeFilter(e.target.value as AuditActorType | "")}
          className="rounded-lg border border-glass-border bg-black/40 px-2.5 py-1.5 text-xs font-bold text-white focus:border-accent focus:outline-none [&>option]:bg-neutral-950"
        >
          <option value="">All Actors</option>
          {ACTOR_TYPE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="glass rounded-xl border border-glass-border overflow-hidden divide-y divide-glass-border">
        {loading && logs.length === 0 && (
          <div className="py-10 text-center text-sm text-white/50">Loading activity log...</div>
        )}
        {!loading && logs.length === 0 && (
          <div className="py-10 text-center text-sm text-white/50">No activity logs found.</div>
        )}

        {logs.map(log => {
          const isExpanded = expandedId === log.id;
          const hasChanges = log.changes && log.changes.length > 0;
          return (
            <div key={log.id} className="group">
              <div
                className={`flex items-start gap-3 px-4 py-3 transition cursor-pointer hover:bg-white/5 ${isExpanded ? "bg-white/5" : ""}`}
                onClick={() => hasChanges ? setExpandedId(isExpanded ? null : log.id) : undefined}
              >
                <span className="text-lg mt-0.5 shrink-0">{ENTITY_EMOJI[log.entity] || "📝"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${ACTION_COLORS[log.action]}`}>
                      {log.action.replace("_", " ")}
                    </span>
                    <span className="text-[10px] font-bold uppercase text-white/30 px-1.5 py-0.5 rounded bg-white/5">
                      {log.entity.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-sm text-white mt-1 leading-snug">{log.summary}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[11px] text-white/40">
                      by <span className="text-white/60 font-medium">{log.actorName}</span>
                    </span>
                    <span className="text-[11px] text-white/30">{formatTimestamp(log.timestamp)}</span>
                  </div>
                </div>
                {hasChanges && (
                  <div className="shrink-0 mt-2">
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-white/30" />
                      : <ChevronRight className="w-4 h-4 text-white/30" />}
                  </div>
                )}
              </div>
              {isExpanded && hasChanges && (
                <div className="px-4 pb-3 pl-12">
                  <div className="rounded-lg bg-black/30 border border-glass-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-white/40 text-[10px] uppercase tracking-wider">
                          <th className="text-left px-3 py-1.5 font-bold">Field</th>
                          <th className="text-left px-3 py-1.5 font-bold">Old Value</th>
                          <th className="text-left px-3 py-1.5 font-bold">New Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-glass-border">
                        {log.changes.map((c, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5 text-white/60 font-medium">{formatFieldName(c.field)}</td>
                            <td className="px-3 py-1.5 text-red-400/70">{c.oldValue ?? "-"}</td>
                            <td className="px-3 py-1.5 text-emerald-400/70">{c.newValue ?? "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <button
            onClick={() => loadLogs(false)}
            disabled={loadingMore}
            className="px-4 py-2 rounded-lg bg-white/5 border border-glass-border text-xs font-bold text-white/60 hover:text-white transition disabled:opacity-40"
          >
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}

      {isSuperAdmin && (
        <div className="glass rounded-xl border border-glass-border p-4 space-y-3">
          <h3 className="text-sm font-bold text-white/70 flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Truncate Old Logs
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {[3, 6, 9, 12].map(m => (
              <button
                key={m}
                onClick={() => setTruncateMonths(truncateMonths === m ? null : m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                  truncateMonths === m
                    ? "bg-red-500/20 border-red-500/40 text-red-400"
                    : "bg-white/5 border-glass-border text-white/50 hover:text-white"
                }`}
              >
                &gt; {m} months
              </button>
            ))}
            {truncateMonths && (
              <button
                onClick={handleTruncate}
                disabled={truncating}
                className="px-4 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-xs font-bold text-red-400 hover:bg-red-500/30 transition disabled:opacity-40"
              >
                {truncating ? "Deleting..." : `Delete logs older than ${truncateMonths}m`}
              </button>
            )}
          </div>
          {truncateResult && (
            <p className="text-xs text-white/50">{truncateResult}</p>
          )}
        </div>
      )}
    </div>
  );
}
