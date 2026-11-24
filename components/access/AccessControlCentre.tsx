"use client";

/**
 * Access Control Centre (`components/access/AccessControlCentre.tsx`) — D-22.
 *
 * Settings → Access Control. Super Admin only (the screen is behind the Settings
 * guard AND every request is re-checked by /api/admin/access on the server).
 * The single place where admin roles are viewed, granted and revoked:
 *   A. Role overview  — Super Admin, Club Admin, Finance Admin (+ counts)
 *   B. User directory — server-side search, filters and pagination
 *   C. Manage access  — side panel / bottom sheet with a change summary
 *   D. Change history — from the existing audit log (entity "access")
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Shield, ShieldCheck, Users, Wallet, Search, X, Loader2, History, ChevronLeft, ChevronRight, AlertTriangle, Check, ArrowRight, UserCog } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { ACTIVE_ROLES, ROLE_DEFINITIONS, diffRoles, type ActiveRole } from "@/lib/role-consolidation";
import { useToast } from "@/components/ui/Toast";

type Row = {
  key: string;
  uid: string | null;
  playerId: string | null;
  name: string;
  kavachId: string | null;
  photoURL: string | null;
  email: string | null;
  roles: ActiveRole[];
  status: "Active" | "Disabled" | "No account";
  linked: boolean;
  lastUpdated: string | null;
  legacy: string[];
};
type Overview = {
  roles: { id: ActiveRole; label: string; summary: string; capabilities: string[]; count: number }[];
  totalAccounts: number;
  migration: { matchAdmin: number; studioAdmin: number; designer: number; changes: number; receiveClubAdmin: number; flagged: unknown[] };
};
type Filter = "all" | ActiveRole | "multiple" | "none";
type HistoryItem = { id: string; user: string; before: string | null; after: string | null; summary: string; actor: string; at: string | null };

function apiFetch(url: string, init: RequestInit = {}) {
  const synthetic = process.env.NODE_ENV !== "production" && typeof window !== "undefined" && (window as any).__KAVACH_TEST_USER__ !== undefined;
  return synthetic ? fetch(url, init) : authedFetch(url, init);
}

const ROLE_ICON: Record<ActiveRole, React.ReactNode> = {
  superAdmin: <ShieldCheck className="w-5 h-5" />,
  clubAdmin: <Users className="w-5 h-5" />,
  financeAdmin: <Wallet className="w-5 h-5" />,
};
const ROLE_CHIP: Record<ActiveRole, string> = {
  superAdmin: "bg-brand text-white",
  clubAdmin: "bg-brand-surface text-brand border border-brand/20",
  financeAdmin: "bg-emerald-50 text-emerald-800 border border-emerald-200",
};
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All users" },
  { id: "superAdmin", label: "Super Admin" },
  { id: "clubAdmin", label: "Club Admin" },
  { id: "financeAdmin", label: "Finance Admin" },
  { id: "multiple", label: "Multiple roles" },
  { id: "none", label: "No admin role" },
];
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

export function RoleChips({ roles, empty = "—" }: { roles: ActiveRole[]; empty?: string }) {
  if (!roles.length) return <span className="text-xs text-text-secondary">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <span key={r} className={`px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${ROLE_CHIP[r]}`} data-testid={`role-chip-${r}`}>
          {ROLE_DEFINITIONS[r].label}
        </span>
      ))}
    </span>
  );
}

function Avatar({ row }: { row: Row }) {
  const [failed, setFailed] = useState(false);
  const initials = row.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  return row.photoURL && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={row.photoURL} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="w-10 h-10 rounded-full object-cover bg-surface-hover shrink-0" />
  ) : (
    <span className="w-10 h-10 rounded-full bg-brand-surface text-brand text-sm font-black flex items-center justify-center shrink-0">{initials}</span>
  );
}

export function AccessControlCentre({ currentUid, onBack }: { currentUid: string; onBack?: () => void }) {
  const { toast } = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [dir, setDir] = useState<{ rows: Row[]; total: number; page: number; pages: number } | null>(null);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [managing, setManaging] = useState<Row | null>(null);
  const reqId = useRef(0);

  const loadOverview = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/access?view=overview");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load roles.");
      setOverview(json);
      setOverviewError(null);
    } catch (e) {
      setOverviewError(e instanceof Error ? e.message : "Could not load roles.");
    }
  }, []);
  const loadHistory = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/access?view=history");
      const json = await res.json().catch(() => ({}));
      setHistory(res.ok ? json.items || [] : []);
    } catch {
      setHistory([]);
    }
  }, []);
  const loadDirectory = useCallback(async () => {
    const id = ++reqId.current;
    setDirLoading(true);
    try {
      const params = new URLSearchParams({ view: "directory", filter, page: String(page) });
      if (query) params.set("q", query);
      const res = await apiFetch(`/api/admin/access?${params}`);
      const json = await res.json().catch(() => ({}));
      if (id !== reqId.current) return;
      if (!res.ok) throw new Error(json.error || "Could not load users.");
      setDir(json);
      setDirError(null);
    } catch (e) {
      if (id === reqId.current) setDirError(e instanceof Error ? e.message : "Could not load users.");
    } finally {
      if (id === reqId.current) setDirLoading(false);
    }
  }, [filter, page, query]);

  useEffect(() => {
    loadOverview();
    loadHistory();
  }, [loadOverview, loadHistory]);
  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);
  // Debounced server-side search.
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setQuery(q.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const onSaved = () => {
    setManaging(null);
    loadOverview();
    loadDirectory();
    loadHistory();
  };

  const m = overview?.migration;
  return (
    <div className="space-y-5" data-testid="access-control-centre">
      <div className="flex items-start gap-3">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Back to Settings" className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-hover cursor-pointer shrink-0">
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-black font-heading text-text-primary tracking-tight">Access Control</h1>
          <p className="text-sm text-text-secondary">Who can administer KAvach Play, and what each role allows. Only Super Admins can change access.</p>
        </div>
      </div>

      {m && m.changes > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3" data-testid="access-migration-pending">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-bold">Role consolidation pending</p>
            <p>
              {m.matchAdmin} Match Admin, {m.studioAdmin} Studio Admin and {m.designer} Designer account(s) still carry retired roles. These roles no longer grant access;{" "}
              {m.receiveClubAdmin} account(s) will become Club Admin when the approved migration runs.
            </p>
          </div>
        </div>
      )}

      {/* A. Role overview */}
      <section aria-label="Roles" className="grid gap-3 sm:grid-cols-3" data-testid="access-role-cards">
        {overviewError && <p className="text-sm text-red-600 sm:col-span-3">{overviewError}</p>}
        {(overview?.roles ?? ACTIVE_ROLES.map((id) => ({ ...ROLE_DEFINITIONS[id], count: NaN }))).map((r) => {
          const on = filter === r.id;
          return (
            <div key={r.id} className={`rounded-2xl border bg-surface p-4 flex flex-col gap-2 ${on ? "border-brand ring-2 ring-brand/20" : "border-border"}`} data-testid={`access-role-card-${r.id}`}>
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-brand-surface text-brand flex items-center justify-center shrink-0">{ROLE_ICON[r.id]}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-black text-text-primary">{r.label}</p>
                  <p className="text-xs text-text-secondary">{Number.isNaN(r.count) ? "…" : `${r.count} user${r.count === 1 ? "" : "s"}`}</p>
                </div>
              </div>
              <p className="text-xs text-text-secondary flex-1">{r.summary}</p>
              <button
                type="button"
                onClick={() => {
                  setFilter(on ? "all" : r.id);
                  setPage(1);
                }}
                className="min-h-[44px] rounded-xl border border-border text-sm font-bold text-brand hover:bg-brand-surface cursor-pointer inline-flex items-center justify-center gap-1"
                data-testid={`access-manage-role-${r.id}`}
              >
                {on ? "Show all users" : "Manage users"} <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </section>

      {/* B. User access directory */}
      <section className="rounded-2xl border border-border bg-surface" aria-label="User access directory">
        <div className="p-4 border-b border-border space-y-3">
          <h2 className="text-base font-black text-text-primary">User Access Directory</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, Player ID, email or phone"
              className="min-h-[48px] w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30"
              data-testid="access-search"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1" role="tablist" aria-label="Filter users">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => {
                  setFilter(f.id);
                  setPage(1);
                }}
                className={`min-h-[40px] px-3 rounded-full text-xs font-bold whitespace-nowrap cursor-pointer border ${filter === f.id ? "bg-brand text-white border-brand" : "border-border text-text-primary hover:bg-surface-hover"}`}
                data-testid={`access-filter-${f.id}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {dirError && <p className="p-4 text-sm text-red-600">{dirError}</p>}
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-text-secondary border-b border-border">
                <th className="px-4 py-2 font-bold">Player</th>
                <th className="px-4 py-2 font-bold">Player ID</th>
                <th className="px-4 py-2 font-bold">Roles</th>
                <th className="px-4 py-2 font-bold">Account</th>
                <th className="px-4 py-2 font-bold">Last updated</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(dir?.rows ?? []).map((r) => (
                <tr key={r.key} className="border-b border-border/70 last:border-0" data-testid={`access-row-${r.uid || r.playerId}`}>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-3 min-w-0">
                      <Avatar row={r} />
                      <span className="min-w-0">
                        <span className="block font-bold text-text-primary truncate">{r.name}</span>
                        {r.email && <span className="block text-xs text-text-secondary truncate">{r.email}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">{r.kavachId || r.playerId || "—"}</td>
                  <td className="px-4 py-2.5">
                    <RoleChips roles={r.roles} />
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge row={r} />
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-secondary whitespace-nowrap">{fmtDate(r.lastUpdated)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <ManageButton row={r} onClick={() => setManaging(r)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile list */}
        <ul className="md:hidden divide-y divide-border">
          {(dir?.rows ?? []).map((r) => (
            <li key={r.key} className="p-3 flex items-center gap-3" data-testid={`access-row-m-${r.uid || r.playerId}`}>
              <Avatar row={r} />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-text-primary truncate">{r.name}</p>
                <p className="text-[11px] text-text-secondary font-mono truncate">{r.kavachId || r.playerId || r.email || "—"}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <RoleChips roles={r.roles} empty="" />
                  {r.status !== "Active" && <StatusBadge row={r} />}
                </div>
              </div>
              <ManageButton row={r} onClick={() => setManaging(r)} />
            </li>
          ))}
        </ul>
        {dir && dir.rows.length === 0 && !dirLoading && <p className="p-6 text-center text-sm text-text-secondary">No users match.</p>}
        <div className="flex items-center justify-between gap-2 p-3 border-t border-border">
          <span className="text-xs text-text-secondary" data-testid="access-page-info">
            {dirLoading ? (
              <>
                <Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1" /> Loading…
              </>
            ) : dir ? (
              `${dir.total} user${dir.total === 1 ? "" : "s"} · page ${dir.page} of ${dir.pages}`
            ) : (
              ""
            )}
          </span>
          <span className="flex gap-1">
            <button type="button" disabled={!dir || dir.page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page" className="w-11 h-11 rounded-xl border border-border flex items-center justify-center disabled:opacity-40 cursor-pointer">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button type="button" disabled={!dir || dir.page >= dir.pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page" className="w-11 h-11 rounded-xl border border-border flex items-center justify-center disabled:opacity-40 cursor-pointer">
              <ChevronRight className="w-4 h-4" />
            </button>
          </span>
        </div>
      </section>

      {/* D. Access change history */}
      <section className="rounded-2xl border border-border bg-surface" aria-label="Access change history" data-testid="access-history">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <History className="w-4 h-4 text-brand" />
          <h2 className="text-base font-black text-text-primary">Access Change History</h2>
        </div>
        {!history ? (
          <p className="p-4 text-sm text-text-secondary">
            <Loader2 className="inline w-4 h-4 animate-spin mr-1" /> Loading…
          </p>
        ) : history.length === 0 ? (
          <p className="p-4 text-sm text-text-secondary">No access changes recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.slice(0, 30).map((h) => (
              <li key={h.id} className="p-3 sm:px-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-bold text-text-primary">{h.user}</span>
                  <span className="text-xs text-text-secondary">{fmtWhen(h.at)}</span>
                </div>
                <p className="text-xs text-text-secondary">
                  {h.before ?? "—"} <ArrowRight className="inline w-3 h-3" /> <span className="font-bold text-text-primary">{h.after ?? "—"}</span>
                </p>
                <p className="text-xs text-text-secondary">
                  {h.summary} · by {h.actor}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {managing && <ManagePanel row={managing} currentUid={currentUid} onClose={() => setManaging(null)} onSaved={onSaved} toast={toast} />}
    </div>
  );
}

function StatusBadge({ row }: { row: Row }) {
  const cls =
    row.status === "Active" ? "bg-emerald-50 text-emerald-800" : row.status === "Disabled" ? "bg-red-50 text-red-700" : "bg-surface-hover text-text-secondary";
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${cls}`}>
      {row.status === "No account" ? "No linked account" : row.status}
    </span>
  );
}

function ManageButton({ row, onClick }: { row: Row; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[44px] px-3 rounded-xl border border-border text-sm font-bold text-text-primary hover:bg-surface-hover cursor-pointer inline-flex items-center gap-1 shrink-0"
      data-testid={`access-manage-${row.uid || row.playerId}`}
    >
      <UserCog className="w-4 h-4" /> Manage
    </button>
  );
}

// ── C. Manage user access ───────────────────────────────────────────────────

function ManagePanel({ row, currentUid, onClose, onSaved, toast }: { row: Row; currentUid: string; onClose: () => void; onSaved: () => void; toast: (m: string, t?: any) => void }) {
  const [selected, setSelected] = useState<ActiveRole[]>(row.roles);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const isSelf = row.uid === currentUid;
  const canEdit = Boolean(row.uid) && !isSelf && row.status !== "Disabled";
  const change = useMemo(() => diffRoles(row.roles, selected), [row.roles, selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (r: ActiveRole) => setSelected((s) => (s.includes(r) ? s.filter((x) => x !== r) : ACTIVE_ROLES.filter((x) => x === r || s.includes(x))));

  const save = async () => {
    if (inFlight.current || !row.uid) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: row.uid, roles: selected, expected: row.roles }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save the change.");
      toast(`Access updated for ${row.name}`, "success");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the change.");
      setStep("edit");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-stretch md:justify-end bg-black/40" role="dialog" aria-modal="true" aria-label={`Manage access for ${row.name}`} data-testid="access-manage-panel">
      <div className="w-full md:w-[440px] max-h-[92vh] md:max-h-none flex flex-col rounded-t-3xl md:rounded-none bg-surface shadow-2xl">
        <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-border">
          <Avatar row={row} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black text-text-primary truncate">{row.name}</h2>
            <p className="text-xs text-text-secondary font-mono truncate">{row.kavachId || row.playerId || "No player record"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-hover cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-background p-2.5">
              <dt className="text-text-secondary">Linked account</dt>
              <dd className="font-bold text-text-primary">{row.uid ? (row.linked ? "Linked" : "Account only") : "Not linked"}</dd>
            </div>
            <div className="rounded-xl bg-background p-2.5">
              <dt className="text-text-secondary">Status</dt>
              <dd className="font-bold text-text-primary">{row.status}</dd>
            </div>
          </dl>
          {!row.uid && <Notice>This player hasn't signed in yet, so there is no account to give a role to.</Notice>}
          {isSelf && <Notice>You can't change your own access. Ask another Super Admin.</Notice>}
          {row.status === "Disabled" && <Notice>This account is disabled. Re-enable it before granting roles.</Notice>}
          {row.legacy.length > 0 && <Notice>Carries retired role(s): {row.legacy.join(", ")}. They no longer grant access and will be converted to Club Admin by the approved migration.</Notice>}

          {step === "edit" ? (
            <fieldset className="space-y-2" disabled={!canEdit || saving}>
              <legend className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-1">Roles</legend>
              {ACTIVE_ROLES.map((r) => {
                const d = ROLE_DEFINITIONS[r];
                const on = selected.includes(r);
                return (
                  <label key={r} className={`flex gap-3 rounded-2xl border p-3 cursor-pointer ${on ? "border-brand bg-brand-surface/40" : "border-border"} ${!canEdit ? "opacity-60 cursor-not-allowed" : ""}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(r)} className="mt-1 w-5 h-5 accent-[#D51F43]" data-testid={`access-role-toggle-${r}`} />
                    <span className="min-w-0">
                      <span className="block font-bold text-text-primary">{d.label}</span>
                      <span className="block text-xs text-text-secondary">{d.summary}</span>
                      <ul className="mt-1 text-[11px] text-text-secondary list-disc pl-4">
                        {d.capabilities.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ) : (
            <div className="space-y-3" data-testid="access-change-summary">
              <SummaryBlock title="Current access" roles={row.roles} />
              <SummaryBlock title="Proposed access" roles={selected} />
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-1">Change</p>
                <ul className="text-sm space-y-1">
                  {change.grant.map((r) => (
                    <li key={`g-${r}`} className="text-emerald-700 font-bold">+ Grant {ROLE_DEFINITIONS[r].label}</li>
                  ))}
                  {change.revoke.map((r) => (
                    <li key={`r-${r}`} className="text-red-700 font-bold">− Revoke {ROLE_DEFINITIONS[r].label}</li>
                  ))}
                </ul>
                {change.revoke.includes("superAdmin") && <p className="mt-2 text-xs text-text-secondary">Their current sessions are signed out so the change applies immediately.</p>}
              </div>
            </div>
          )}
          {error && (
            <p className="text-sm font-semibold text-red-600" role="alert" data-testid="access-error">
              {error}
            </p>
          )}
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-border">
          <button type="button" onClick={step === "review" ? () => setStep("edit") : onClose} className="min-h-[48px] px-5 rounded-xl border border-border text-sm font-bold text-text-primary hover:bg-surface-hover cursor-pointer" data-testid="access-cancel">
            {step === "review" ? "Back" : "Cancel"}
          </button>
          {step === "edit" ? (
            <button
              type="button"
              disabled={!canEdit || !change.changed}
              onClick={() => setStep("review")}
              className="flex-1 min-h-[48px] rounded-xl bg-brand text-white text-sm font-black disabled:opacity-50 cursor-pointer"
              data-testid="access-review"
            >
              Review changes
            </button>
          ) : (
            <button type="button" disabled={saving} onClick={save} aria-busy={saving} className="flex-1 min-h-[48px] rounded-xl bg-brand text-white text-sm font-black inline-flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer" data-testid="access-save">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {saving ? "Saving…" : "Save changes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex gap-2">
      <Shield className="w-4 h-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function SummaryBlock({ title, roles }: { title: string; roles: ActiveRole[] }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-1">{title}</p>
      <RoleChips roles={roles} empty="No admin role" />
    </div>
  );
}
