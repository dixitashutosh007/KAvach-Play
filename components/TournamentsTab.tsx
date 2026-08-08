"use client";

/**
 * Tournaments admin (`components/TournamentsTab.tsx`)
 *
 * Two views, controlled by local state:
 *   - List: every tournament with status + per-player fee + edit/delete.
 *     "+ Add Tournament" opens a modal form. Delete is blocked when
 *     there are upcoming matches linked to the tournament.
 *   - Detail: picked tournament shows its info, all linked matches
 *     (upcoming + past), and a bulk-add scheduler that creates several
 *     matches at once from date/time inputs, prompting on conflicts
 *     with existing bookings on the same ground.
 *
 * Autofill formula for per-player fee:
 *   Math.round((amountPerMatch / 12) * 1.05)
 * Same 5% markup used everywhere else in the app.
 */

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Copy,
  Edit2,
  Plus,
  Trash2,
  Trophy,
  X,
  AlertTriangle,
  Calendar,
  Save,
} from "lucide-react";
import { useStore } from "@/hooks/useStore";
import type { Match, Tournament } from "@/lib/types";
import { inputToDbDate } from "@/lib/utils";

type Status = Tournament["status"];
const STATUS_LABELS: Status[] = ["Upcoming", "Ongoing", "Ended", "Disabled"];
const STATUS_STYLES: Record<Status, string> = {
  Upcoming: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  Ongoing: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  Ended: "bg-white/10 text-white/50 border-white/20",
  Disabled: "bg-red-500/20 text-red-300 border-red-500/40",
};

const perPlayerFromAmount = (amountPerMatch: number) =>
  Math.round((amountPerMatch / 12) * 1.05);

const isPastMatch = (m: Match) => {
  if (!m.date) return false;
  const [dd, mm, yyyy] = m.date.split("/");
  if (!dd || !mm || !yyyy) return false;
  const d = new Date(`${yyyy}-${mm}-${dd}T${m.time || "23:59"}:00`);
  return d.getTime() < Date.now();
};

export function TournamentsTab({
  store,
}: {
  store: ReturnType<typeof useStore>;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const detail = store.tournaments.find((t) => t.id === detailId) || null;
  const editing = store.tournaments.find((t) => t.id === editingId) || null;

  // Sort by status priority then name
  const sortedTournaments = useMemo(() => {
    const rank: Record<Status, number> = {
      Ongoing: 0,
      Upcoming: 1,
      Disabled: 2,
      Ended: 3,
    };
    return [...store.tournaments].sort((a, b) => {
      const r = rank[a.status] - rank[b.status];
      if (r !== 0) return r;
      return (a.name || "").localeCompare(b.name || "", "en", {
        sensitivity: "base",
      });
    });
  }, [store.tournaments]);

  if (detail) {
    return (
      <TournamentDetail
        tournament={detail}
        store={store}
        onBack={() => setDetailId(null)}
        onEdit={() => setEditingId(detail.id)}
      >
        {editing && (
          <TournamentFormModal
            tournament={editing}
            store={store}
            onClose={() => setEditingId(null)}
          />
        )}
      </TournamentDetail>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <Trophy className="w-5 h-5 text-accent" /> Tournaments
        </h2>
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-sm font-bold text-black shadow hover:bg-accent/90 transition"
        >
          <Plus className="w-4 h-4" /> Add Tournament
        </button>
      </div>

      {sortedTournaments.length === 0 ? (
        <div className="glass rounded-xl border border-glass-border p-6 text-center text-white/50 text-sm">
          No tournaments yet. Click{" "}
          <span className="text-accent font-bold">+ Add Tournament</span> to
          create one.
        </div>
      ) : (
        <div className="space-y-2">
          {sortedTournaments.map((t) => {
            const ground = store.grounds.find((g) => g.id === t.groundId);
            const linkedMatches = store.matches.filter(
              (m) => m.tournamentId === t.id && !m.isArchived,
            );
            const upcoming = linkedMatches.filter((m) => !isPastMatch(m));
            const canDelete = upcoming.length === 0;
            return (
              <div
                key={t.id}
                className="glass rounded-xl border border-glass-border p-3 hover:border-accent/40 transition cursor-pointer"
                onClick={() => setDetailId(t.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${STATUS_STYLES[t.status]}`}
                      >
                        {t.status}
                      </span>
                      <span className="text-[10px] text-white/50 font-mono">
                        ₹{t.perPlayerFee}/player
                      </span>
                      <span className="text-[10px] text-white/50">
                        · {linkedMatches.length} match
                        {linkedMatches.length !== 1 ? "es" : ""}
                        {upcoming.length > 0 ? ` (${upcoming.length} upcoming)` : ""}
                      </span>
                    </div>
                    <h3 className="font-bold text-white truncate">{t.name}</h3>
                    <div className="text-[11px] text-white/50 mt-0.5 truncate">
                      {ground?.name || "Unknown ground"} · {t.organiserName}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setEditingId(t.id)}
                      className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/20 hover:text-white transition"
                      title="Edit"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {deleteConfirmId === t.id ? (
                      <div className="flex items-center gap-1 bg-black/40 rounded-lg px-2 border border-red-500/30">
                        <span className="text-[10px] text-red-400 uppercase font-bold tracking-wider">
                          Sure?
                        </span>
                        <button
                          onClick={async () => {
                            await store.deleteTournament(t.id);
                            setDeleteConfirmId(null);
                          }}
                          className="text-red-400 hover:bg-red-500/20 rounded p-1 transition"
                        >
                          <span className="text-[10px] font-bold px-0.5">✓</span>
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(null)}
                          className="text-white/60 hover:bg-white/10 rounded p-1 transition"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (!canDelete) {
                            alert(
                              `Can't delete: ${upcoming.length} upcoming match${upcoming.length !== 1 ? "es are" : " is"} still linked to this tournament. End or delete those matches first.`,
                            );
                            return;
                          }
                          setDeleteConfirmId(t.id);
                        }}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition ${
                          canDelete
                            ? "bg-white/5 hover:bg-red-500/30 hover:text-red-400"
                            : "bg-white/5 opacity-30 cursor-not-allowed"
                        }`}
                        title={
                          canDelete
                            ? "Delete"
                            : `${upcoming.length} upcoming match(es) linked — cannot delete`
                        }
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(isAdding || editing) && (
        <TournamentFormModal
          tournament={editing || null}
          store={store}
          onClose={() => {
            setIsAdding(false);
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

/* --------------------------- Form modal ---------------------------- */

function TournamentFormModal({
  tournament,
  store,
  onClose,
}: {
  tournament: Tournament | null;
  store: ReturnType<typeof useStore>;
  onClose: () => void;
}) {
  const isEdit = !!tournament;
  const [form, setForm] = useState<
    Omit<Tournament, "id" | "createdAt" | "updatedAt">
  >(() => {
    if (tournament) {
      return {
        name: tournament.name,
        groundId: tournament.groundId,
        organiserName: tournament.organiserName,
        organiserPhone: tournament.organiserPhone,
        gpayNumber: tournament.gpayNumber,
        jerseyColor: tournament.jerseyColor,
        amountPerMatch: tournament.amountPerMatch,
        perPlayerFee: tournament.perPlayerFee,
        status: tournament.status,
        startDate: tournament.startDate || "",
        endDate: tournament.endDate || "",
        notes: tournament.notes || "",
      };
    }
    return {
      name: "",
      groundId: store.grounds[0]?.id || "",
      organiserName: "",
      organiserPhone: "",
      gpayNumber: "",
      jerseyColor: "Scarlet Red",
      amountPerMatch: 0,
      perPlayerFee: 0,
      status: "Upcoming",
      startDate: "",
      endDate: "",
      notes: "",
    };
  });

  const [feeManuallyEdited, setFeeManuallyEdited] = useState(isEdit);

  const setAmount = (n: number) => {
    setForm((f) => ({
      ...f,
      amountPerMatch: n,
      perPlayerFee: feeManuallyEdited ? f.perPlayerFee : perPlayerFromAmount(n),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.groundId) {
      alert("Name and Ground are required.");
      return;
    }
    if (isEdit && tournament) {
      await store.updateTournament(tournament.id, form);
    } else {
      await store.addTournament(form);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-md my-8">
        <div className="sticky top-0 bg-[#0f172a] p-4 flex justify-between items-center rounded-t-xl z-10 border-b border-glass-border">
          <h2 className="text-xl font-bold text-white">
            {isEdit ? "Edit Tournament" : "Add Tournament"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/50 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        <form
          onSubmit={handleSubmit}
          className="bg-[#0f172a] p-4 rounded-b-xl space-y-3 max-h-[80vh] overflow-y-auto custom-scrollbar"
        >
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Corporate Cup 2026"
              className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
              Ground <span className="text-red-400">*</span>
            </label>
            <select
              required
              value={form.groundId}
              onChange={(e) => setForm({ ...form, groundId: e.target.value })}
              className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
            >
              <option value="" disabled>Select a ground</option>
              {store.grounds.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Organiser
              </label>
              <input
                value={form.organiserName}
                onChange={(e) =>
                  setForm({ ...form, organiserName: e.target.value })
                }
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                placeholder="Name"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Phone
              </label>
              <input
                value={form.organiserPhone}
                onChange={(e) =>
                  setForm({ ...form, organiserPhone: e.target.value })
                }
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none font-mono"
                placeholder="+91 XXXXXXXXXX"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
              GPay Number
            </label>
            <input
              value={form.gpayNumber}
              onChange={(e) => setForm({ ...form, gpayNumber: e.target.value })}
              className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none font-mono"
              placeholder="+91 XXXXXXXXXX"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
              Jersey Colour
            </label>
            <div className="flex gap-2">
              {(["Scarlet Red", "Whites"] as const).map((c) => (
                <label
                  key={c}
                  className={`flex-1 text-center py-2 border rounded-lg text-sm cursor-pointer select-none transition flex items-center justify-center gap-2 ${
                    form.jerseyColor === c
                      ? "bg-accent text-black font-bold border-accent"
                      : "bg-transparent text-white border-glass-border hover:bg-white/5"
                  }`}
                >
                  <input
                    type="radio"
                    className="hidden"
                    name="tj"
                    checked={form.jerseyColor === c}
                    onChange={() => setForm({ ...form, jerseyColor: c })}
                  />
                  <div
                    className={`w-3 h-3 rounded-full ${c === "Scarlet Red" ? "bg-red-500" : "bg-[#e5e5e5] border border-slate-300"}`}
                  />
                  {c}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Amount / Match (₹)
              </label>
              <input
                type="number"
                min="0"
                value={form.amountPerMatch || ""}
                onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none font-mono"
                placeholder="e.g. 4800"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Per Player Fee (₹)
              </label>
              <input
                type="number"
                min="0"
                value={form.perPlayerFee || ""}
                onChange={(e) => {
                  setFeeManuallyEdited(true);
                  setForm({ ...form, perPlayerFee: parseInt(e.target.value) || 0 });
                }}
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none font-mono"
                placeholder="auto"
              />
              {!feeManuallyEdited && (
                <div className="text-[10px] text-white/40 mt-0.5">
                  auto = amount ÷ 12 × 1.05
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
              Status
            </label>
            <select
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as Status })
              }
              className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
            >
              {STATUS_LABELS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div className="text-[10px] text-white/40 mt-0.5">
              Ended and Disabled tournaments don't appear in the match form dropdown.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Start (opt.)
              </label>
              <input
                type="date"
                value={form.startDate || ""}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                End (opt.)
              </label>
              <input
                type="date"
                value={form.endDate || ""}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
              Notes (opt.)
            </label>
            <textarea
              value={form.notes || ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="w-full rounded-lg bg-accent py-2.5 text-sm font-bold text-black hover:bg-accent/90 transition flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              {isEdit ? "Save Changes" : "Create Tournament"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------------- Detail view --------------------------- */

function TournamentDetail({
  tournament,
  store,
  onBack,
  onEdit,
  children,
}: {
  tournament: Tournament;
  store: ReturnType<typeof useStore>;
  onBack: () => void;
  onEdit: () => void;
  children?: React.ReactNode;
}) {
  const ground = store.grounds.find((g) => g.id === tournament.groundId);
  const linkedMatches = useMemo(
    () =>
      store.matches
        .filter((m) => m.tournamentId === tournament.id && !m.isArchived)
        .sort((a, b) => {
          // Newest first, but upcoming above past
          const aPast = isPastMatch(a);
          const bPast = isPastMatch(b);
          if (aPast !== bPast) return aPast ? 1 : -1;
          return (b.date || "").localeCompare(a.date || "");
        }),
    [store.matches, tournament.id],
  );
  const upcomingCount = linkedMatches.filter((m) => !isPastMatch(m)).length;

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-white/70 hover:text-white text-sm font-bold uppercase tracking-widest"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Tournaments
      </button>

      <div className="glass rounded-xl border border-glass-border p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="w-4 h-4 text-accent" />
              <span
                className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${STATUS_STYLES[tournament.status]}`}
              >
                {tournament.status}
              </span>
            </div>
            <h2 className="text-xl font-bold text-white">{tournament.name}</h2>
            <div className="text-[11px] text-white/60 mt-1">
              {ground?.name || "Unknown ground"} · {tournament.organiserName}
              {tournament.organiserPhone ? ` · ${tournament.organiserPhone}` : ""}
            </div>
          </div>
          <button
            onClick={onEdit}
            className="flex items-center gap-1 rounded-full bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-bold text-white transition"
          >
            <Edit2 className="w-3.5 h-3.5" /> Edit
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div className="bg-black/30 rounded-lg p-2">
            <div className="text-[10px] uppercase text-white/40 tracking-widest">Amount/Match</div>
            <div className="text-lg font-bold text-white font-mono">₹{tournament.amountPerMatch}</div>
          </div>
          <div className="bg-black/30 rounded-lg p-2">
            <div className="text-[10px] uppercase text-white/40 tracking-widest">Per Player</div>
            <div className="text-lg font-bold text-accent font-mono">₹{tournament.perPlayerFee}</div>
          </div>
          <div className="bg-black/30 rounded-lg p-2">
            <div className="text-[10px] uppercase text-white/40 tracking-widest">Jersey</div>
            <div className="text-sm font-bold text-white">{tournament.jerseyColor}</div>
          </div>
          <div className="bg-black/30 rounded-lg p-2">
            <div className="text-[10px] uppercase text-white/40 tracking-widest">GPay</div>
            <div className="text-xs font-mono text-white truncate">{tournament.gpayNumber || "—"}</div>
          </div>
        </div>
        {tournament.notes && (
          <div className="mt-3 text-[11px] text-white/60 border-t border-glass-border pt-2">
            {tournament.notes}
          </div>
        )}
      </div>

      <BulkAddSection tournament={tournament} store={store} />

      <div className="glass rounded-xl border border-glass-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white">
            Linked Matches ({linkedMatches.length})
            {upcomingCount > 0 && (
              <span className="ml-2 text-emerald-400 normal-case tracking-normal font-normal text-xs">
                {upcomingCount} upcoming
              </span>
            )}
          </h3>
        </div>
        {linkedMatches.length === 0 ? (
          <div className="text-[11px] text-white/40 text-center py-4">
            No matches linked yet. Use Bulk Add above or the regular
            Match form (pick this tournament from the dropdown).
          </div>
        ) : (
          <div className="space-y-1">
            {linkedMatches.map((m) => {
              const past = isPastMatch(m);
              return (
                <div
                  key={m.id}
                  className={`flex items-center justify-between p-2 rounded-lg text-xs ${past ? "bg-white/5 text-white/50" : "bg-emerald-500/10 text-white"}`}
                >
                  <div>
                    <span className="font-mono">{m.date}</span>{" "}
                    <span className="font-mono text-white/50">{m.time}</span>
                    <span className="ml-2">vs {m.opponent}</span>
                  </div>
                  <span className="text-[10px] uppercase tracking-widest">
                    {past ? "Past" : "Upcoming"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {children}
    </div>
  );
}

/* -------------------------- Bulk-add -------------------------- */

type Slot = { id: string; date: string; time: string; opponent: string };

function BulkAddSection({
  tournament,
  store,
}: {
  tournament: Tournament;
  store: ReturnType<typeof useStore>;
}) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addSlot = () =>
    setSlots((s) => [
      ...s,
      { id: crypto.randomUUID(), date: "", time: "07:00", opponent: "" },
    ]);

  const removeSlot = (id: string) =>
    setSlots((s) => s.filter((r) => r.id !== id));

  // Check each slot for a conflict against existing matches on the same
  // ground at the same date+time. Returns per-slot conflict info.
  const conflictsPerSlot = useMemo(() => {
    return slots.map((s) => {
      if (!s.date || !s.time) return null;
      const dbDate = inputToDbDate(s.date);
      const conflict = store.matches.find(
        (m) =>
          !m.isArchived &&
          m.groundId === tournament.groundId &&
          m.date === dbDate &&
          m.time === s.time,
      );
      return conflict || null;
    });
  }, [slots, store.matches, tournament.groundId]);

  const runBulkAdd = async () => {
    const valid = slots.filter((s) => s.date && s.time);
    if (valid.length === 0) {
      alert("Add at least one date + time slot first.");
      return;
    }
    const conflicts = conflictsPerSlot.filter(Boolean);
    if (conflicts.length > 0) {
      const proceed = window.confirm(
        `${conflicts.length} of these slot${conflicts.length > 1 ? "s" : ""} already has a match booked on this ground at that time.\n\n` +
          `OK  → skip conflicting slots and create the rest.\n` +
          `Cancel → do nothing.`,
      );
      if (!proceed) return;
    }

    setIsSubmitting(true);
    try {
      let created = 0;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (!s.date || !s.time) continue;
        if (conflictsPerSlot[i]) continue; // skip conflict
        await store.addMatch({
          groundId: tournament.groundId,
          format: "T20",
          jerseyColor: tournament.jerseyColor,
          opponent: s.opponent || "TBD",
          matchType: "Tournament",
          fee: tournament.perPlayerFee,
          date: s.date,
          time: s.time,
          maxSquadSize: 12,
          tournamentId: tournament.id,
        } as any);
        created++;
      }
      alert(`Created ${created} match${created !== 1 ? "es" : ""}.`);
      setSlots([]);
    } catch (err: any) {
      alert(`Bulk add failed: ${err?.message || String(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="glass rounded-xl border border-glass-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold uppercase tracking-widest text-white flex items-center gap-2">
          <Calendar className="w-4 h-4 text-accent" /> Bulk-add Matches
        </h3>
        <button
          onClick={addSlot}
          className="flex items-center gap-1 rounded-full bg-accent/20 border border-accent/40 px-3 py-1 text-[11px] font-bold text-accent transition hover:bg-accent/30"
        >
          <Plus className="w-3 h-3" /> Add Slot
        </button>
      </div>
      <p className="text-[11px] text-white/50 mb-2 leading-tight">
        Each slot creates one match with the tournament's ground, jersey and
        per-player fee (₹{tournament.perPlayerFee}). If a slot's date+time
        already has a match on this ground you'll be prompted to skip it.
      </p>
      {slots.length === 0 && (
        <div className="text-[11px] text-white/40 text-center py-4">
          No slots yet.
        </div>
      )}
      {slots.map((s, i) => {
        const conflict = conflictsPerSlot[i];
        return (
          <div key={s.id} className="mb-2 grid grid-cols-[1fr,1fr,1fr,auto] gap-2 items-start">
            <input
              type="date"
              value={s.date}
              onChange={(e) => {
                const v = e.target.value;
                setSlots((arr) => arr.map((r) => (r.id === s.id ? { ...r, date: v } : r)));
              }}
              className="rounded-lg border border-glass-border bg-white/5 px-2 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
            />
            <input
              type="time"
              value={s.time}
              onChange={(e) => {
                const v = e.target.value;
                setSlots((arr) => arr.map((r) => (r.id === s.id ? { ...r, time: v } : r)));
              }}
              className="rounded-lg border border-glass-border bg-white/5 px-2 py-1.5 text-xs text-white focus:border-accent focus:outline-none [&::-webkit-calendar-picker-indicator]:invert"
            />
            <input
              type="text"
              placeholder="Opponent (opt.)"
              value={s.opponent}
              onChange={(e) => {
                const v = e.target.value;
                setSlots((arr) => arr.map((r) => (r.id === s.id ? { ...r, opponent: v } : r)));
              }}
              className="rounded-lg border border-glass-border bg-white/5 px-2 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
            />
            <button
              onClick={() => removeSlot(s.id)}
              className="px-2 rounded-lg bg-red-500/20 text-red-300 text-xs hover:bg-red-500/30"
            >
              <X className="w-3 h-3" />
            </button>
            {conflict && (
              <div className="col-span-4 -mt-1 text-[10px] text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Conflict: existing match vs {conflict.opponent} at{" "}
                {conflict.date} {conflict.time}
              </div>
            )}
          </div>
        );
      })}
      {slots.length > 0 && (
        <button
          onClick={runBulkAdd}
          disabled={isSubmitting}
          className="mt-2 w-full rounded-lg bg-accent py-2 text-sm font-bold text-black hover:bg-accent/90 transition disabled:opacity-60"
        >
          {isSubmitting ? "Creating..." : `Create ${slots.filter((s) => s.date && s.time).length} Match${slots.filter((s) => s.date && s.time).length !== 1 ? "es" : ""}`}
        </button>
      )}
    </div>
  );
}
