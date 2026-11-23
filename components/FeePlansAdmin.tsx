"use client";

/**
 * Finance → Other Fees → Finance Plans (`components/FeePlansAdmin.tsx`).
 *
 * Evolves the former "Match Fee Plans" screen (same `feePlans` collection and
 * store actions). Adds: overview with assignment counts, plan detail, dated
 * player assignments (via /api/finance/assignments), assignment history and
 * the Percentage Discount type / monthly allocation policy.
 *
 * Who can change what: plan create/edit/deactivate and assignments — Finance
 * Admin and Super Admin (enforced by Firestore rules for plans and by the
 * server API for assignments). Everyone else who can open this screen views.
 */
import React, { useMemo, useState } from "react";
import { ArrowLeft, CalendarRange, ChevronRight, Loader2, Plus, Search, Users } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useFinancePlanAssignments, type AssignmentActionResult } from "@/hooks/useFinancePlanAssignments";
import { getClubCalendarDate } from "@/lib/utils";
import {
  FINANCE_PLAN_TYPES,
  PLAN_TYPE_LABEL,
  assignmentOn,
  assignmentStatus,
  describePlan,
  legacyAssignmentsFor,
  validatePlanConfig,
  type AssignmentStatus,
} from "@/lib/finance-plans";
import type { FeePlan, FinancePlanAssignment, Player } from "@/lib/types";
import { ErrorNote, Sheet, fmtDate } from "@/components/finance/FinanceUi";
import { SubscriptionsPanel } from "@/components/finance/SubscriptionsPanel";
import { SponsorshipReport } from "@/components/finance/SponsorshipReport";

type Store = ReturnType<typeof useStore>;

const TYPE_CHIP: Record<string, string> = {
  regular: "bg-surface-hover text-text-secondary border-border",
  fixed: "bg-amber-50 text-amber-800 border-amber-200",
  percentage: "bg-violet-50 text-violet-800 border-violet-200",
  sponsored: "bg-emerald-50 text-emerald-800 border-emerald-200",
  monthly: "bg-blue-50 text-blue-800 border-blue-200",
};
const STATUS_CHIP: Record<AssignmentStatus, string> = {
  active: "bg-emerald-50 text-emerald-800 border-emerald-200",
  scheduled: "bg-blue-50 text-blue-800 border-blue-200",
  ended: "bg-surface-hover text-text-secondary border-border",
  cancelled: "bg-surface-hover text-text-muted border-border",
};
function rangeLabel(a: FinancePlanAssignment): string {
  const start = a.startDate ? fmtDate(a.startDate) : "Before date tracking";
  return `${start} → ${a.endDate ? fmtDate(a.endDate) : "no end date"}`;
}

export function FeePlansAdmin({ store }: { store: Store }) {
  const { user, hasAdminClaim } = useAuth();
  const appUser = store.appUsers.find((u: any) => u.id === user?.uid);
  const canManage = Boolean(hasAdminClaim || appUser?.isFinanceAdmin);
  const todayKey = getClubCalendarDate().dateString;
  const { assignments, loading, error, run, refresh } = useFinancePlanAssignments(true);

  const players: Player[] = useMemo(
    () => (store.players || []).filter((p: Player) => !p.disabled && !(p as any).mergedInto),
    [store.players],
  );
  const plans: FeePlan[] = store.feePlans || [];
  // Dated records + legacy plan ids still on player documents.
  const allAssignments = useMemo(
    () => [...assignments, ...players.flatMap((p) => legacyAssignmentsFor(p, plans))],
    [assignments, players, plans],
  );

  const [view, setView] = useState<{ kind: "overview" } | { kind: "plan"; planId: string } | { kind: "regular" }>({ kind: "overview" });
  const [editing, setEditing] = useState<FeePlan | "new" | null>(null);
  const [section, setSection] = useState<"plans" | "subscriptions" | "report">("plans");

  const activeOnToday = (planId: string) =>
    allAssignments.filter((a) => a.planId === planId && assignmentStatus(a, todayKey) === "active").length;
  const scheduledFor = (planId: string) =>
    allAssignments.filter((a) => a.planId === planId && assignmentStatus(a, todayKey) === "scheduled").length;
  const regularPlayers = players.filter((p) => !assignmentOn(allAssignments, p.id, todayKey));

  return (
    <div className="flex flex-col gap-4" data-testid="finance-plans">
      {editing && (
        <PlanEditor
          store={store}
          plan={editing === "new" ? null : editing}
          hasAssignments={editing !== "new" && allAssignments.some((a) => a.planId === editing.id)}
          onClose={() => setEditing(null)}
        />
      )}

      {view.kind === "overview" && (
        <div className="flex gap-1 rounded-xl border border-border p-1" role="tablist" aria-label="Finance Plans sections" data-testid="finance-plans-sections">
          {([
            ["plans", "Plans"],
            ["subscriptions", "Subscriptions"],
            ["report", "Sponsorship"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={section === value}
              onClick={() => setSection(value)}
              data-testid={`finance-plans-section-${value}`}
              className={`flex-1 min-h-[44px] rounded-lg text-xs font-bold cursor-pointer ${section === value ? "bg-brand text-white" : "text-text-secondary hover:bg-surface-hover"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {view.kind === "overview" && section === "subscriptions" && <SubscriptionsPanel canManage={canManage} todayKey={todayKey} />}
      {view.kind === "overview" && section === "report" && <SponsorshipReport todayKey={todayKey} />}

      {view.kind === "overview" && section === "plans" && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-black font-heading text-text-primary">Finance Plans</h3>
              <p className="text-xs text-text-secondary">
                Players without an active plan pay the Regular match fee. Plans apply by match date.
              </p>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => setEditing("new")}
                data-testid="finance-plan-new"
                className="shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl bg-brand text-white text-sm font-bold hover:opacity-90 cursor-pointer"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                New plan
              </button>
            )}
          </div>

          {error && <ErrorNote message={error} onRetry={refresh} />}

          <ul className="flex flex-col gap-2" data-testid="finance-plan-list">
            <li>
              <button
                type="button"
                onClick={() => setView({ kind: "regular" })}
                className="w-full text-left rounded-2xl border border-border bg-surface px-4 py-3 flex items-center gap-3 hover:border-brand/40 cursor-pointer"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-text-primary">Regular</span>
                    <TypeChip type="regular" />
                    <span className="text-[10px] font-bold text-text-muted">Built-in</span>
                  </span>
                  <span className="block text-xs text-text-secondary mt-0.5">Full match fee · no club sponsorship</span>
                </span>
                <CountBadge loading={loading} count={regularPlayers.length} label="players" />
                <ChevronRight className="w-4 h-4 text-text-muted" aria-hidden="true" />
              </button>
            </li>
            {plans.map((plan) => (
              <li key={plan.id}>
                <button
                  type="button"
                  onClick={() => setView({ kind: "plan", planId: plan.id })}
                  data-testid={`finance-plan-row-${plan.id}`}
                  className={`w-full text-left rounded-2xl border border-border bg-surface px-4 py-3 flex items-center gap-3 hover:border-brand/40 cursor-pointer ${plan.isActive === false ? "opacity-70" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-black text-text-primary truncate">{plan.name}</span>
                      <TypeChip type={plan.type} />
                      {plan.isActive === false && <span className="text-[10px] font-bold text-text-muted">Inactive</span>}
                    </span>
                    <span className="block text-xs text-text-secondary mt-0.5">{describePlan(plan)}</span>
                    {(plan.validFrom || plan.validTo) && (
                      <span className="block text-[11px] text-text-muted mt-0.5">
                        Valid {plan.validFrom ? `from ${fmtDate(plan.validFrom)} ` : ""}
                        {plan.validTo ? `until ${fmtDate(plan.validTo)}` : ""}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-col items-end gap-0.5">
                    <CountBadge loading={loading} count={activeOnToday(plan.id)} label="active" />
                    {scheduledFor(plan.id) > 0 && <span className="text-[10px] font-bold text-blue-700">+{scheduledFor(plan.id)} scheduled</span>}
                  </span>
                  <ChevronRight className="w-4 h-4 text-text-muted" aria-hidden="true" />
                </button>
              </li>
            ))}
            {plans.length === 0 && (
              <li className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">
                No Finance Plans yet.{canManage ? " Create one to give players a fixed fee, discount, sponsorship or subscription." : ""}
              </li>
            )}
          </ul>
        </>
      )}

      {view.kind === "regular" && (
        <div className="flex flex-col gap-3">
          <BackLink onClick={() => setView({ kind: "overview" })} />
          <div>
            <h3 className="text-lg font-black font-heading text-text-primary">Regular</h3>
            <p className="text-xs text-text-secondary">Players with no active plan today pay the full match fee.</p>
          </div>
          <PlayerNameList names={regularPlayers.map((p) => p.name)} loading={loading} />
        </div>
      )}

      {view.kind === "plan" && (() => {
        const plan = plans.find((p) => p.id === view.planId);
        if (!plan) {
          return (
            <div className="flex flex-col gap-3">
              <BackLink onClick={() => setView({ kind: "overview" })} />
              <p className="text-sm text-text-secondary">This plan no longer exists.</p>
            </div>
          );
        }
        return (
          <PlanDetail
            store={store}
            plan={plan}
            players={players}
            allAssignments={allAssignments}
            todayKey={todayKey}
            loading={loading}
            canManage={canManage}
            run={run}
            onBack={() => setView({ kind: "overview" })}
            onEdit={() => setEditing(plan)}
          />
        );
      })()}
    </div>
  );
}

// ── Plan detail ──────────────────────────────────────────────────────────────

function PlanDetail({
  store,
  plan,
  players,
  allAssignments,
  todayKey,
  loading,
  canManage,
  run,
  onBack,
  onEdit,
}: {
  store: Store;
  plan: FeePlan;
  players: Player[];
  allAssignments: FinancePlanAssignment[];
  todayKey: string;
  loading: boolean;
  canManage: boolean;
  run: (p: any) => Promise<AssignmentActionResult>;
  onBack: () => void;
  onEdit: () => void;
}) {
  const { toast } = useToast();
  const { confirm: confirmAction } = useConfirm();
  const [filter, setFilter] = useState<"current" | "history" | "all">("current");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<FinancePlanAssignment | null>(null);

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name || store.players.find((p: Player) => p.id === id)?.name || "Player";
  const rows = allAssignments
    .filter((a) => a.planId === plan.id)
    .map((a) => ({ a, status: assignmentStatus(a, todayKey), name: nameOf(a.playerId) }))
    .filter((r) =>
      filter === "all" ? true : filter === "current" ? r.status === "active" || r.status === "scheduled" : r.status === "ended" || r.status === "cancelled",
    )
    .filter((r) => !search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((x, y) => x.name.localeCompare(y.name));
  const neverAssigned = !allAssignments.some((a) => a.planId === plan.id);

  const toggleActive = async () => {
    try {
      await store.updateFeePlan(plan.id, { isActive: plan.isActive === false });
      toast(plan.isActive === false ? "Plan reactivated" : "Plan deactivated — existing assignments are unchanged", "success");
    } catch {
      toast("Could not update the plan.", "error");
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="finance-plan-detail">
      {adding && <AssignPlayers plan={plan} players={players} allAssignments={allAssignments} todayKey={todayKey} run={run} onClose={() => setAdding(false)} />}
      {ending && <EndAssignment assignment={ending} playerName={nameOf(ending.playerId)} todayKey={todayKey} run={run} onClose={() => setEnding(null)} />}

      <BackLink onClick={onBack} />

      <section className="rounded-2xl border border-border bg-surface p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-black font-heading text-text-primary">{plan.name}</h3>
          <TypeChip type={plan.type} />
          {plan.isActive === false && <span className="text-[10px] font-bold text-text-muted">Inactive</span>}
        </div>
        <p className="text-sm font-bold text-text-primary">{describePlan(plan)}</p>
        {plan.type === "monthly" && (
          <p className="text-xs text-text-secondary">
            Allocation: {plan.allocationPolicy === "distribute" ? "spread across eligible matches played in the period" : plan.allocationPolicy === "fixed_per_match" ? "fixed amount per match" : "not set"}.
            The subscription is collected once per period, not per match.
          </p>
        )}
        {(plan.validFrom || plan.validTo) && (
          <p className="flex items-center gap-1.5 text-xs text-text-secondary">
            <CalendarRange className="w-3.5 h-3.5" aria-hidden="true" />
            New assignments allowed {plan.validFrom ? `from ${fmtDate(plan.validFrom)} ` : ""}
            {plan.validTo ? `until ${fmtDate(plan.validTo)}` : ""}
          </p>
        )}
        {plan.description && <p className="text-xs text-text-secondary">{plan.description}</p>}
        {canManage && (
          <div className="flex gap-2 flex-wrap pt-1">
            <button type="button" onClick={onEdit} className="min-h-[40px] px-3 rounded-lg border border-brand/30 text-xs font-bold text-brand hover:bg-brand-surface cursor-pointer">
              Edit plan
            </button>
            <button type="button" onClick={toggleActive} className="min-h-[40px] px-3 rounded-lg border border-border text-xs font-bold text-text-primary hover:bg-surface-hover cursor-pointer">
              {plan.isActive === false ? "Reactivate" : "Deactivate"}
            </button>
            {neverAssigned && (
              <button
                type="button"
                onClick={async () => {
                  if (await confirmAction({ message: `Delete "${plan.name}"? It has never been assigned.`, destructive: true })) {
                    await store.deleteFeePlan(plan.id);
                    onBack();
                  }
                }}
                className="min-h-[40px] px-3 rounded-lg border border-red-200 text-xs font-bold text-red-700 hover:bg-red-50 cursor-pointer"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface overflow-hidden" data-testid="finance-plan-assignments">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
          <h4 className="inline-flex items-center gap-2 text-sm font-black font-heading text-text-primary">
            <Users className="w-4 h-4 text-brand" aria-hidden="true" />
            Assigned players
          </h4>
          {canManage && plan.isActive !== false && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              data-testid="finance-plan-add-players"
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg bg-brand text-white text-xs font-bold hover:opacity-90 cursor-pointer"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add players
            </button>
          )}
        </div>
        <div className="px-4 py-3 flex flex-col gap-2 border-b border-border">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assigned players"
              aria-label="Search assigned players"
              className="w-full min-h-[40px] pl-9 pr-3 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:border-brand/60"
            />
          </div>
          <div role="radiogroup" aria-label="Assignment filter" className="flex gap-1.5">
            {([
              ["current", "Current"],
              ["history", "History"],
              ["all", "All"],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={filter === v}
                onClick={() => setFilter(v)}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-bold border cursor-pointer ${filter === v ? "bg-brand border-brand text-white" : "bg-surface border-border text-text-primary"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <p className="px-4 py-5 text-sm text-text-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading assignments…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-5 text-sm text-text-secondary">{filter === "history" ? "No ended or cancelled assignments." : "No players on this plan."}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(({ a, status, name }) => (
              <li key={a.id} className="px-4 py-3 flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-text-primary truncate">{name}</span>
                    <span className={`px-1.5 py-0.5 rounded-md border text-[10px] font-bold capitalize ${STATUS_CHIP[status]}`}>{status}</span>
                    {a.legacy && <span className="text-[10px] font-bold text-amber-700">Legacy</span>}
                  </span>
                  <span className="block text-xs text-text-secondary">{rangeLabel(a)}</span>
                  {(a.endReason || a.endedByName) && (status === "ended" || status === "cancelled" || a.endDate) && (
                    <span className="block text-[11px] text-text-muted">
                      {a.endedByName ? `By ${a.endedByName}` : ""}
                      {a.endReason ? ` · ${a.endReason}` : ""}
                    </span>
                  )}
                </span>
                {canManage && (status === "active" || status === "scheduled") && (
                  <button
                    type="button"
                    onClick={() => setEnding(a)}
                    className="shrink-0 min-h-[36px] px-3 rounded-lg border border-border text-xs font-bold text-text-primary hover:bg-surface-hover cursor-pointer"
                  >
                    {status === "scheduled" ? "Cancel" : "End"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Assign players ───────────────────────────────────────────────────────────

function AssignPlayers({
  plan,
  players,
  allAssignments,
  todayKey,
  run,
  onClose,
}: {
  plan: FeePlan;
  players: Player[];
  allAssignments: FinancePlanAssignment[];
  todayKey: string;
  run: (p: any) => Promise<AssignmentActionResult>;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState(plan.validFrom && plan.validFrom > todayKey ? plan.validFrom : todayKey);
  const [endDate, setEndDate] = useState(plan.validTo || "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<{ playerName: string; message: string }[]>([]);

  const visible = players
    .filter((p) => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const submit = async () => {
    setSaving(true);
    setProblem(null);
    setConflicts([]);
    const res = await run({ action: "assign", planId: plan.id, playerIds: selected, startDate, endDate: endDate || null });
    setSaving(false);
    if (res.ok) {
      toast(`Assigned ${selected.length} player${selected.length === 1 ? "" : "s"} to ${plan.name}`, "success");
      onClose();
    } else {
      setProblem(res.error || "Could not assign players.");
      setConflicts(res.conflicts || []);
    }
  };

  return (
    <Sheet title={`Add players to ${plan.name}`} onClose={onClose} testId="finance-plan-assign-sheet">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
          Starts
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="min-h-[44px] rounded-lg border border-border bg-surface px-2 text-sm text-text-primary" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
          Ends <span className="font-normal text-text-muted">(optional)</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="min-h-[44px] rounded-lg border border-border bg-surface px-2 text-sm text-text-primary" />
        </label>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" aria-hidden="true" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players"
          aria-label="Search players"
          className="w-full min-h-[44px] pl-9 pr-3 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:border-brand/60"
        />
      </div>
      <p className="text-xs font-bold text-text-secondary" aria-live="polite">{selected.length} selected</p>
      <ul className="max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-border divide-y divide-border">
        {visible.map((p) => {
          const current = assignmentOn(allAssignments, p.id, startDate || todayKey);
          const isSel = selected.includes(p.id);
          return (
            <li key={p.id}>
              <label className={`flex items-center gap-3 min-h-[48px] px-3 cursor-pointer ${isSel ? "bg-brand-surface/60" : "hover:bg-surface-hover"}`}>
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={() => setSelected((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))}
                  className="w-4 h-4 accent-[var(--color-brand)]"
                />
                <span className="min-w-0 flex-1 text-sm font-bold text-text-primary truncate">{p.name}</span>
                <span className={`shrink-0 text-[11px] ${current ? "font-bold text-amber-700" : "text-text-muted"}`}>
                  {current ? `On ${current.planName}` : "Regular"}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {problem && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" data-testid="finance-plan-assign-error">
          <p className="font-bold">{problem}</p>
          {conflicts.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {conflicts.map((c, i) => (
                <li key={i}>{c.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="min-h-[48px] px-4 rounded-xl border border-border text-sm font-bold text-text-primary cursor-pointer">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving || selected.length === 0 || !startDate}
          data-testid="finance-plan-assign-submit"
          className="flex-1 min-h-[48px] rounded-xl bg-brand text-white text-sm font-black disabled:opacity-50 inline-flex items-center justify-center gap-2 cursor-pointer"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          Assign {selected.length || ""} player{selected.length === 1 ? "" : "s"}
        </button>
      </div>
    </Sheet>
  );
}

// ── End / cancel an assignment ──────────────────────────────────────────────

function EndAssignment({
  assignment,
  playerName,
  todayKey,
  run,
  onClose,
}: {
  assignment: FinancePlanAssignment;
  playerName: string;
  todayKey: string;
  run: (p: any) => Promise<AssignmentActionResult>;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const scheduled = assignmentStatus(assignment, todayKey) === "scheduled";
  const [endDate, setEndDate] = useState(todayKey);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setProblem(null);
    const payload = scheduled
      ? { action: "cancel", assignmentId: assignment.id, reason }
      : assignment.legacy && assignment.id.startsWith("legacy:")
        ? { action: "endLegacy", playerId: assignment.playerId, planId: assignment.planId, endDate, reason }
        : { action: "end", assignmentId: assignment.id, endDate, reason };
    const res = await run(payload);
    setSaving(false);
    if (res.ok) {
      toast(scheduled ? "Assignment cancelled" : "Assignment ended — history kept", "success");
      onClose();
    } else {
      setProblem(res.error || "Could not save.");
    }
  };

  return (
    <Sheet title={scheduled ? `Cancel ${playerName}'s plan` : `End ${playerName}'s plan`} onClose={onClose} testId="finance-plan-end-sheet">
      <p className="text-sm text-text-secondary">
        {assignment.planName} · {rangeLabel(assignment)}
      </p>
      {!scheduled && (
        <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
          Last day on this plan
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="min-h-[44px] rounded-lg border border-border bg-surface px-2 text-sm text-text-primary" />
          <span className="font-normal text-text-muted">Matches after this date use Regular unless another plan is assigned. Past matches are not changed.</span>
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
        Reason <span className="font-normal text-text-muted">(optional, kept in history)</span>
        <input type="text" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className="min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-text-primary" />
      </label>
      {problem && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{problem}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="min-h-[48px] px-4 rounded-xl border border-border text-sm font-bold text-text-primary cursor-pointer">
          Back
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving || (!scheduled && !endDate)}
          data-testid="finance-plan-end-submit"
          className="flex-1 min-h-[48px] rounded-xl bg-brand text-white text-sm font-black disabled:opacity-50 inline-flex items-center justify-center gap-2 cursor-pointer"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {scheduled ? "Cancel assignment" : "End assignment"}
        </button>
      </div>
    </Sheet>
  );
}

// ── Plan editor ──────────────────────────────────────────────────────────────

function PlanEditor({
  store,
  plan,
  hasAssignments,
  onClose,
}: {
  store: Store;
  plan: FeePlan | null;
  hasAssignments: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Partial<FeePlan>>(
    plan
      ? { ...plan }
      : { name: "", type: "fixed", isActive: true, allocationPolicy: "fixed_per_match" },
  );
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const num = (v: string) => (v === "" ? undefined : Number(v));

  const save = async () => {
    const candidate: Partial<FeePlan> = {
      name: (draft.name || "").trim(),
      type: draft.type,
      isActive: draft.isActive !== false,
      description: (draft.description || "").trim() || undefined,
      validFrom: draft.validFrom || undefined,
      validTo: draft.validTo || undefined,
      feeAmount: draft.type === "fixed" ? draft.feeAmount : undefined,
      discountPct: draft.type === "percentage" ? draft.discountPct : undefined,
      monthlyAmount: draft.type === "monthly" ? draft.monthlyAmount : undefined,
      allocationPolicy: draft.type === "monthly" ? draft.allocationPolicy : undefined,
      perMatchContribution: draft.type === "monthly" && draft.allocationPolicy === "fixed_per_match" ? draft.perMatchContribution : undefined,
    };
    const err = validatePlanConfig(candidate);
    if (err) {
      setProblem(err);
      return;
    }
    setSaving(true);
    try {
      if (plan) {
        // On edit, a cleared optional field is stored as null so the old value is removed.
        const update: Record<string, unknown> = { ...candidate };
        for (const k of ["description", "validFrom", "validTo", "feeAmount", "discountPct", "monthlyAmount", "allocationPolicy", "perMatchContribution"]) {
          if (update[k] === undefined && (plan as any)[k] !== undefined) update[k] = null;
        }
        await store.updateFeePlan(plan.id, update as Partial<FeePlan>);
      }
      else await store.addFeePlan(candidate as Omit<FeePlan, "id" | "createdAt" | "updatedAt">);
      toast(plan ? "Plan updated — applies to future calculations only" : "Plan created", "success");
      onClose();
    } catch {
      setProblem("The plan could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const field = "min-h-[44px] w-full rounded-lg border border-border bg-surface px-3 text-sm text-text-primary focus:outline-none focus:border-brand/60";

  return (
    <Sheet title={plan ? `Edit ${plan.name}` : "New Finance Plan"} onClose={onClose} testId="finance-plan-editor">
      <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
        Plan name
        <input type="text" value={draft.name || ""} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Youth 350" className={field} />
      </label>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-bold text-text-secondary mb-1">Plan type</legend>
        {FINANCE_PLAN_TYPES.map((t) => (
          <label
            key={t.value}
            className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${draft.type === t.value ? "border-brand bg-brand-surface/50" : "border-border"} ${hasAssignments && plan?.type !== t.value ? "opacity-50" : "cursor-pointer"}`}
          >
            <input
              type="radio"
              name="plan-type"
              value={t.value}
              checked={draft.type === t.value}
              disabled={hasAssignments && plan?.type !== t.value}
              onChange={() => setDraft({ ...draft, type: t.value })}
              className="mt-1 accent-[var(--color-brand)]"
            />
            <span>
              <span className="block text-sm font-bold text-text-primary">{t.label}</span>
              <span className="block text-xs text-text-secondary">{t.desc}</span>
            </span>
          </label>
        ))}
        {hasAssignments && <p className="text-[11px] text-text-muted">The type can't change once players have been assigned. Create a new plan instead.</p>}
      </fieldset>

      {draft.type === "fixed" && (
        <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
          Player pays per match (₹)
          <input type="number" min={0} inputMode="numeric" value={draft.feeAmount ?? ""} onChange={(e) => setDraft({ ...draft, feeAmount: num(e.target.value) })} className={field} />
        </label>
      )}
      {draft.type === "percentage" && (
        <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
          Discount (%)
          <input type="number" min={0} max={100} inputMode="decimal" value={draft.discountPct ?? ""} onChange={(e) => setDraft({ ...draft, discountPct: num(e.target.value) })} className={field} />
          <span className="font-normal text-text-muted">The discount is rounded to the nearest rupee and counted as club sponsorship.</span>
        </label>
      )}
      {draft.type === "monthly" && (
        <>
          <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
            Subscription per period (₹)
            <input type="number" min={0} inputMode="numeric" value={draft.monthlyAmount ?? ""} onChange={(e) => setDraft({ ...draft, monthlyAmount: num(e.target.value) })} className={field} />
          </label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-bold text-text-secondary mb-1">Allocation to matches</legend>
            {([
              ["fixed_per_match", "Fixed contribution per match", "A set amount of the subscription is allocated to each match; the club sponsors the rest."],
              ["distribute", "Spread across matches played", "The subscription is divided across the eligible matches played in the period, when the period is closed."],
            ] as const).map(([v, label, desc]) => (
              <label key={v} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer ${draft.allocationPolicy === v ? "border-brand bg-brand-surface/50" : "border-border"}`}>
                <input type="radio" name="allocation" checked={draft.allocationPolicy === v} onChange={() => setDraft({ ...draft, allocationPolicy: v })} className="mt-1 accent-[var(--color-brand)]" />
                <span>
                  <span className="block text-sm font-bold text-text-primary">{label}</span>
                  <span className="block text-xs text-text-secondary">{desc}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {draft.allocationPolicy === "fixed_per_match" && (
            <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
              Allocated per match (₹)
              <input type="number" min={0} inputMode="numeric" value={draft.perMatchContribution ?? ""} onChange={(e) => setDraft({ ...draft, perMatchContribution: num(e.target.value) })} className={field} />
            </label>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
          Valid from <span className="font-normal text-text-muted">(optional)</span>
          <input type="date" value={draft.validFrom || ""} onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
          Valid until <span className="font-normal text-text-muted">(optional)</span>
          <input type="date" value={draft.validTo || ""} onChange={(e) => setDraft({ ...draft, validTo: e.target.value })} className={field} />
        </label>
      </div>
      <p className="-mt-2 text-[11px] text-text-muted">Limits when players can be on this plan. It never changes past matches.</p>

      <label className="flex flex-col gap-1 text-xs font-bold text-text-secondary">
        Notes <span className="font-normal text-text-muted">(optional)</span>
        <input type="text" value={draft.description || ""} maxLength={200} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={field} />
      </label>

      {plan && <p className="text-[11px] text-text-secondary">Changes apply to future calculations only; recorded match fees are not recalculated.</p>}
      {problem && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{problem}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="min-h-[48px] px-4 rounded-xl border border-border text-sm font-bold text-text-primary cursor-pointer">
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          data-testid="finance-plan-save"
          className="flex-1 min-h-[48px] rounded-xl bg-brand text-white text-sm font-black disabled:opacity-50 inline-flex items-center justify-center gap-2 cursor-pointer"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {plan ? "Save plan" : "Create plan"}
        </button>
      </div>
    </Sheet>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function TypeChip({ type }: { type: string }) {
  return <span className={`px-1.5 py-0.5 rounded-md border text-[10px] font-bold ${TYPE_CHIP[type] || TYPE_CHIP.regular}`}>{PLAN_TYPE_LABEL[type] || type}</span>;
}

function CountBadge({ loading, count, label }: { loading: boolean; count: number; label: string }) {
  return (
    <span className="shrink-0 text-right">
      <span className="block text-base font-black tabular-nums text-text-primary">{loading ? "…" : count}</span>
      <span className="block text-[10px] font-bold text-text-muted">{label}</span>
    </span>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="self-start inline-flex items-center gap-1 min-h-[40px] text-xs font-bold text-text-secondary hover:text-text-primary cursor-pointer">
      <ArrowLeft className="w-4 h-4" aria-hidden="true" /> All plans
    </button>
  );
}

function PlayerNameList({ names, loading }: { names: string[]; loading: boolean }) {
  if (loading) return <p className="text-sm text-text-muted">Loading…</p>;
  if (names.length === 0) return <p className="text-sm text-text-secondary">Every player is on a plan today.</p>;
  return (
    <ul className="rounded-2xl border border-border bg-surface divide-y divide-border">
      {[...names].sort((a, b) => a.localeCompare(b)).map((n, i) => (
        <li key={`${n}-${i}`} className="px-4 py-2.5 text-sm font-semibold text-text-primary">{n}</li>
      ))}
    </ul>
  );
}
